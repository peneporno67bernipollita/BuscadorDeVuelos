"""El robot: revisa las búsquedas, guarda los precios y avisa por Telegram.

Modos:
    python -m buscador.run                 una sola ronda
    python -m buscador.run --continuo 345  sin parar durante 345 minutos (GitHub Actions encadena
                                           una sesión tras otra, así el robot nunca se detiene)

Variables de entorno (secretos de GitHub):
    SUPABASE_URL, SUPABASE_SERVICE_KEY   obligatorias
    TELEGRAM_BOT_TOKEN                   para enviar avisos
    URL_WEB                              dirección de tu web (para enlazar el historial)
    FORZAR=1                             revisa ya todas las búsquedas (no se salta los bloqueos)
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from . import enlaces
from .avisos import (
    AYUDA, MENSAJE_PRUEBA, TEXTO_LLAMADA_PRUEBA, TIPOS_LLAMADA, Telegram, codigo_en_mensaje, eur, llamar,
    mensaje_aviso, mensaje_estado, texto_llamada,
)
from .db import Supabase
from .decision import decidir, minutos_hasta_siguiente_revision
from .filtros import Validador, franja
from .modelos import Opcion
from .nucleo import consultar, crear_fuentes, evaluar
from .tiempo import hoy as hoy_espana

log = logging.getLogger("buscador")

LIMITE_RONDA_S = 12 * 60  # tiempo máximo de consultas por ronda
BLOQUEO_MAX = timedelta(hours=48)
OPCIONES_GUARDADAS = 5
ESPERA_ENTRE_VUELTAS_S = 60  # en modo continuo: cada minuto se mira Telegram y qué toca revisar
MARGEN_FINAL_S = 15 * 60  # en modo continuo no se empieza una ronda si queda menos que esto
PRIMERA_REVISION_MIN = 2  # una búsqueda nueva se mira en cuanto la web lleve 2 min sin consultarse
LIMPIEZA_CADA = timedelta(hours=6)
VERSION_DATOS = 2

# Ritmo de cada web en modo continuo (minutos entre rondas). Lo que de verdad marca el ritmo es
# cada búsqueda (cada 20-90 min, ver decision.py) y las pausas entre peticiones.
# Se aplica una sola vez a la base de datos (VERSION_DATOS).
RITMO_FUENTES = {
    "google_flights": {
        "intervalo_min": 5,
        "descripcion": "Fuente principal: compara casi todas las aerolíneas (Ryanair, Vueling, Iberia, easyJet...). "
        "Cada búsqueda se revisa cada 20-90 min según lo cerca que esté el viaje; 6-16 s entre peticiones.",
    },
    "ryanair": {
        "intervalo_min": 30,
        "descripcion": "Confirma el precio en la propia Ryanair. Una ronda cada 30 min como mucho; "
        "2 min entre peticiones (el doble de lo recomendado).",
    },
}


# ----------------------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------------------
def _sin_urls(texto: str) -> str:
    """Quita las URLs (pueden llevar rutas, fechas o tokens) antes de escribir en el registro público."""
    return re.sub(r"https?://\S+", "<url>", str(texto))[:200]


def _registrar_fuentes(estado: dict, resultados: dict) -> None:
    """Resumen por web: solo números y tipo de error, nada personal."""
    for nombre, est in estado.items():
        por_fuente = [por[nombre] for por in resultados.values() if nombre in por]
        log.info(
            "%s: %s búsqueda(s), %s petición(es), %s vuelo(s), %s precio(s) de calendario%s",
            nombre, est["busquedas"], est["peticiones"],
            sum(len(r.opciones) for r in por_fuente), sum(len(r.calendario) for r in por_fuente),
            f" · BLOQUEADA: {_sin_urls(est['bloqueo'])}" if est["bloqueo"] else "",
        )
        for error in est["errores"][:3]:
            log.warning("%s: %s", nombre, _sin_urls(error))


def _tiene_franjas(b: dict) -> bool:
    sentidos = ("ida", "vuelta") if b.get("ida_vuelta") else ("ida",)
    return any(franja(b, s) != (0, 24, 0, 24) for s in sentidos)


def _fecha_hora(valor: str | None) -> datetime | None:
    return datetime.fromisoformat(valor.replace("Z", "+00:00")) if valor else None


def _caducada(b: dict, hoy: date) -> bool:
    if b["modo"] == "fechas":
        return date.fromisoformat(str(b["fecha_ida"])) < hoy
    return date.fromisoformat(str(b["chollo_hasta"])) < hoy


def _aplica(fuente: str, b: dict, hoy: date) -> bool:
    info = b.get("info") or {}
    if fuente == "skyscanner":
        return b["modo"] == "fechas"
    if fuente == "ryanair":
        sin_ruta = info.get("ryanair_sin_ruta_hasta")
        return not sin_ruta or date.fromisoformat(sin_ruta) <= hoy
    return True


def _ajuste(db: Supabase, clave: str):
    fila = db.leer("ajustes", clave=f"eq.{clave}")
    return fila[0]["valor"] if fila else None


# ----------------------------------------------------------------------------------------
# Mantenimiento
# ----------------------------------------------------------------------------------------
def migrar_datos(db: Supabase) -> None:
    """Pone al día los datos de configuración (sin tocar la estructura de la base de datos)."""
    if int(_ajuste(db, "version_datos") or 1) >= VERSION_DATOS:
        return
    for fuente, valores in RITMO_FUENTES.items():
        db.actualizar("estado_fuentes", {"fuente": f"eq.{fuente}"}, valores)
    db.guardar("ajustes", {"clave": "version_datos", "valor": VERSION_DATOS})
    log.info("Configuración de las webs actualizada al modo continuo (versión %s)", VERSION_DATOS)


def limpiar_historial(db: Supabase, ahora: datetime) -> None:
    """Las opciones no ganadoras solo sirven unos días; el historial de precios (la mejor de cada
    revisión) se conserva entero para la gráfica."""
    db.borrar("precios", {"es_mejor": "eq.false", "revisado": f"lt.{(ahora - timedelta(days=2)).isoformat()}"})
    db.borrar("ejecuciones", {"inicio": f"lt.{(ahora - timedelta(days=14)).isoformat()}"})


def escribir_latido(db: Supabase, modo: str, hasta: datetime | None) -> None:
    """Señal de vida del robot para la web ("en directo")."""
    db.guardar("ajustes", {"clave": "latido", "valor": {
        "en": datetime.now(timezone.utc).isoformat(), "modo": modo, "hasta": hasta.isoformat() if hasta else None,
    }})


# ----------------------------------------------------------------------------------------
# Telegram
# ----------------------------------------------------------------------------------------
def atender_telegram(db: Supabase, tg: Telegram, perfiles: dict[str, dict], url_web: str | None) -> int:
    """Vincula chats con el código de la web, responde a /estado y /ayuda y envía mensajes de prueba."""
    offset = _ajuste(db, "telegram_offset")
    codigos = {p["telegram_codigo"].upper(): p for p in perfiles.values() if p.get("telegram_codigo")}
    por_chat = {str(p["telegram_chat_id"]): p for p in perfiles.values() if p.get("telegram_chat_id")}
    ultimo, vinculados = offset, 0
    for m in tg.mensajes_nuevos(offset):
        ultimo = m["update_id"]
        mensaje = m.get("message") or {}
        chat = (mensaje.get("chat") or {}).get("id")
        texto = (mensaje.get("text") or "").strip()
        if not chat:
            continue
        codigo = codigo_en_mensaje(texto)
        if codigo in codigos:
            perfil = codigos.pop(codigo)
            cambios = {"telegram_chat_id": str(chat), "telegram_codigo": None}
            usuario_tg = (mensaje.get("from") or {}).get("username")
            if usuario_tg and "telegram_usuario" in perfil and not perfil.get("telegram_usuario"):
                cambios["telegram_usuario"] = f"@{usuario_tg}"
            db.actualizar("perfiles", {"id": f"eq.{perfil['id']}"}, cambios)
            perfil["telegram_chat_id"] = str(chat)
            por_chat[str(chat)] = perfil
            tg.enviar(chat, "✅ ¡Listo! Este chat queda vinculado a tu Buscador de Vuelos. Aquí te llegarán los avisos.\n\n" + AYUDA)
            vinculados += 1
        elif str(chat) in por_chat:
            orden = texto.split()[0].lower() if texto else ""
            if orden.startswith("/estado"):
                busquedas = db.leer("busquedas", usuario=f"eq.{por_chat[str(chat)]['id']}", order="creada.desc")
                tg.enviar(chat, mensaje_estado(busquedas, url_web))
            elif orden.startswith("/start"):
                tg.enviar(chat, "✅ Este chat ya está vinculado. Aquí te llegarán los avisos.\n\n" + AYUDA)
            else:
                tg.enviar(chat, AYUDA)
        elif texto.startswith("/start"):
            tg.enviar(chat, "Hola 👋 Para vincular este chat envíame el código que aparece en tu web (Perfil → Telegram).")
    if ultimo != offset:
        db.guardar("ajustes", {"clave": "telegram_offset", "valor": ultimo})

    # Mensajes de prueba pedidos desde la web (perfiles.telegram_prueba)
    for p in perfiles.values():
        if p.get("telegram_prueba") and p.get("telegram_chat_id"):
            tg.enviar(p["telegram_chat_id"], MENSAJE_PRUEBA)
            db.actualizar("perfiles", {"id": f"eq.{p['id']}"}, {"telegram_prueba": False})
            p["telegram_prueba"] = False
        if p.get("llamada_prueba"):
            ok = llamar(p.get("telegram_usuario") or "", TEXTO_LLAMADA_PRUEBA)
            db.actualizar("perfiles", {"id": f"eq.{p['id']}"}, {"llamada_prueba": False})
            p["llamada_prueba"] = False
            if p.get("telegram_chat_id"):
                tg.enviar(p["telegram_chat_id"], "📞 Llamada de prueba hecha: tu móvil debería haber sonado." if ok else (
                    "📞 No se pudo hacer la llamada de prueba. Comprueba que tu usuario de Telegram está bien escrito en la web "
                    "y que has autorizado a CallMeBot enviando /start a @CallMeBot_txtbot. Si CallMeBot te ha avisado de "
                    "\"spam\", envía un mensaje a su bot de llamadas (@CallMeBot_API o @CallMeBot_API + número) y añádelo "
                    "a tus contactos: https://www.callmebot.com/blog/spam-error/"))
    return vinculados


# ----------------------------------------------------------------------------------------
# Una búsqueda
# ----------------------------------------------------------------------------------------
def acumular_calendario(info: dict, nuevos: list, hoy: date, dias_validez: int = 10) -> None:
    """Guarda en info.calendario los precios vistos (chollo) y pasa el turno de fechas a la siguiente ronda."""
    acumulado = dict(info.get("calendario") or {})
    for c in nuevos:
        acumulado[f"{c.fecha_ida.isoformat()}|{c.fecha_vuelta.isoformat() if c.fecha_vuelta else ''}"] = [
            round(c.precio, 2), hoy.isoformat()
        ]
    limite = (hoy - timedelta(days=dias_validez)).isoformat()
    info["calendario"] = {
        clave: valor for clave, valor in acumulado.items() if clave[:10] > hoy.isoformat() and valor[1] >= limite
    }
    info["chollo_turno"] = int(info.get("chollo_turno", 0)) + 1


def _fila_precio(b: dict, op: Opcion, es_mejor: bool, aerolineas: dict) -> dict:
    detalle = op.a_dict()
    detalle["enlaces"] = enlaces.compra(b, op, aerolineas)
    detalle["google_flights"] = enlaces.google_flights(b, op)
    detalle["comprar"] = enlaces.comprar_ya(b, op)
    return {
        "busqueda": b["id"],
        "usuario": b["usuario"],
        "fuente": op.fuente,
        "fecha_ida": op.ida.fecha.isoformat(),
        "fecha_vuelta": op.vuelta.fecha.isoformat() if op.vuelta else None,
        "precio_billetes": round(op.precio_billetes, 2),
        "precio_maletas": op.precio_maletas,
        "descuento": op.descuento,
        "precio_total": op.precio_total,
        "maletas_estimadas": op.maletas_estimadas,
        "es_mejor": es_mejor,
        "detalle": detalle,
    }


def procesar_busqueda(
    db: Supabase,
    b: dict,
    validas: list[Opcion],
    rechazos: Counter,
    calendario: list[float],
    fuentes_usadas: list[str],
    perfil: dict | None,
    aerolineas: dict,
    tg: Telegram | None,
    url_web: str | None,
    hoy: date,
    ahora: datetime,
    errores: list[str] | None = None,
) -> bool:
    """Guarda el historial, decide si avisar y actualiza la búsqueda. Devuelve True si avisó."""
    if not validas and not rechazos and errores:
        # Ninguna web pudo responder: no es que no haya vuelos. Se reintenta pronto.
        db.actualizar("busquedas", {"id": f"eq.{b['id']}"}, {
            "ultima_revision": ahora.isoformat(),
            "proxima_revision": (ahora + timedelta(minutes=20)).isoformat(),
            "estado": "No se pudo consultar en esta ronda: " + _sin_urls(errores[0])[:150],
        })
        return False

    filtros_historial = {"busqueda": f"eq.{b['id']}", "es_mejor": "eq.true", "select": "precio_total,revisado",
                         "order": "revisado.asc", "limit": 5000}
    if b.get("historial_desde"):  # tras editar el viaje, el historial anterior no se compara
        filtros_historial["revisado"] = f"gte.{b['historial_desde']}"
    puntos = db.leer("precios", **filtros_historial)
    historial = [float(p["precio_total"]) for p in puntos]
    horas = (ahora - _fecha_hora(puntos[0]["revisado"])).total_seconds() / 3600 if puntos else 0.0

    if validas:
        db.insertar("precios", [_fila_precio(b, op, i == 0, aerolineas) for i, op in enumerate(validas[:OPCIONES_GUARDADAS])])

    mejor = validas[0] if validas else None
    decision = decidir(b, mejor, historial, calendario, hoy, horas_historial=horas)

    info = dict(b.get("info") or {})
    info["opciones_validas"] = len(validas)
    info["rechazos"] = dict(rechazos.most_common(4))
    info["fuentes"] = fuentes_usadas
    if "habitual" in decision.contexto:
        info["habitual"] = decision.contexto["habitual"]
    if mejor and historial:
        info["variacion"] = round(mejor.precio_total - historial[-1], 2)  # respecto a la revisión anterior
    cambios = {
        "ultima_revision": ahora.isoformat(),
        "proxima_revision": (ahora + timedelta(minutes=minutos_hasta_siguiente_revision(b, hoy))).isoformat(),
        "precio_actual": mejor.precio_total if mejor else None,
        "info": info,
    }
    if mejor:
        previo = b.get("mejor_precio")
        cambios["mejor_precio"] = min(float(previo), mejor.precio_total) if previo is not None else mejor.precio_total
        cambios["estado"] = f"{len(validas)} opciones válidas · la mejor: {eur(mejor.precio_total)}"
    elif rechazos:
        motivo, veces = rechazos.most_common(1)[0]
        cambios["estado"] = f"Ningún vuelo cumple tus filtros (motivo principal: {motivo}, {veces} vuelos)"
    else:
        cambios["estado"] = "No se han encontrado vuelos para esta ruta y fechas"

    avisado = False
    if decision.avisar and mejor:
        texto = mensaje_aviso(
            b, mejor, decision, enlaces.compra(b, mejor, aerolineas), enlaces.google_flights(b, mejor), aerolineas,
            f"{url_web.rstrip('/')}/#/busqueda/{b['id']}" if url_web else None,
            comprar=enlaces.comprar_ya(b, mejor),
        )
        chat = (perfil or {}).get("telegram_chat_id")
        entregado = bool(tg and chat and tg.enviar(chat, texto))
        if decision.tipo in TIPOS_LLAMADA and (perfil or {}).get("llamar_chollos") and (perfil or {}).get("telegram_usuario"):
            llamar(perfil["telegram_usuario"], texto_llamada(decision.tipo, b, mejor.precio_total))
        db.insertar("avisos", {
            "busqueda": b["id"], "usuario": b["usuario"], "tipo": decision.tipo, "motivo": decision.motivo,
            "precio_total": mejor.precio_total, "mensaje": texto, "entregado": entregado,
        })
        if decision.fija_precio:
            cambios["ultimo_aviso_precio"] = mejor.precio_total
            cambios["ultimo_aviso_en"] = ahora.isoformat()
        if decision.tipo in ("final", "sin_presupuesto", "proximo"):
            cambios["aviso_final_enviado"] = True
        avisado = True
        log.info("Aviso '%s' enviado (búsqueda %s…)", decision.tipo, b["id"][:8])

    db.actualizar("busquedas", {"id": f"eq.{b['id']}"}, cambios)
    return avisado


# ----------------------------------------------------------------------------------------
# Una ronda
# ----------------------------------------------------------------------------------------
def es_nueva(b: dict) -> bool:
    """Búsqueda recién creada (o recién editada) que todavía no tiene precio."""
    ultima = b.get("ultima_revision")
    desde = b.get("historial_desde")
    return not ultima or bool(desde and _fecha_hora(desde) > _fecha_hora(ultima))


def fuentes_listas(config: dict, pendientes: list[dict], ahora: datetime, forzar: bool) -> list[str]:
    """Webs que se pueden consultar ya. Una búsqueda nueva no espera al ritmo normal de cada web
    (para ver su primer precio cuanto antes), pero sí un mínimo entre consultas; los bloqueos se respetan siempre."""
    hay_nuevas = any(es_nueva(b) for b in pendientes)
    listas = []
    for nombre, cfg in config.items():
        bloqueada = _fecha_hora(cfg.get("bloqueada_hasta"))
        ultima = _fecha_hora(cfg.get("ultima_ronda"))
        if not cfg["activa"] or (bloqueada and bloqueada > ahora):
            continue
        intervalo = min(cfg["intervalo_min"], PRIMERA_REVISION_MIN) if hay_nuevas else cfg["intervalo_min"]
        if not forzar and ultima and ahora - ultima < timedelta(minutes=intervalo):
            continue
        listas.append(nombre)
    return listas


def ronda(db: Supabase, tg: Telegram | None, url_web: str | None, forzar: bool, limite_s: float) -> dict | None:
    """Revisa las búsquedas a las que les toca. Devuelve el resumen, o None si no había nada que hacer."""
    ahora = datetime.now(timezone.utc)
    hoy = hoy_espana()
    pendientes = []
    for b in db.leer("busquedas", activa="eq.true"):
        if _caducada(b, hoy):
            db.actualizar("busquedas", {"id": f"eq.{b['id']}"}, {"activa": False, "estado": "Caducada: las fechas ya han pasado"})
            continue
        if forzar or _fecha_hora(b["proxima_revision"]) <= ahora:
            pendientes.append(b)
    if not pendientes:
        return None
    pendientes.sort(key=lambda b: str(b.get("fecha_ida") or b.get("chollo_desde")))  # primero los viajes cercanos

    config = {f["fuente"]: f for f in db.leer("estado_fuentes")}
    listas = fuentes_listas(config, pendientes, ahora, forzar)
    if not listas:
        return None

    t0 = time.monotonic()
    ejecucion = db.insertar("ejecuciones", {"inicio": ahora.isoformat()}, devolver=True)[0]
    resumen: dict = {"forzada": forzar, "avisos": 0, "revisadas": 0, "errores": [],
                     "pendientes": len(pendientes), "fuentes_en_ronda": listas}
    try:
        aerolineas = {a["codigo"]: a for a in db.leer("aerolineas")}
        perfiles = {p["id"]: p for p in db.leer("perfiles")}
        fuentes = crear_fuentes(listas, config, aerolineas)
        tareas = {n: [b for b in pendientes if _aplica(n, b, hoy)] for n in fuentes}
        # Ryanair tiene un máximo de peticiones por ronda: primero las que hace más tiempo que no mira
        if "ryanair" in tareas:
            tareas["ryanair"].sort(key=lambda b: (b.get("info") or {}).get("ryanair_ultima", ""))
        validadores = {b["id"]: Validador(b, aerolineas) for b in pendientes}
        resultados, estado = consultar(fuentes, tareas, validadores, config, limite_s)
        _registrar_fuentes(estado, resultados)
        resumen["fuentes"] = estado

        for nombre, est in estado.items():
            cfg = config[nombre]
            cambios = {"ultima_ronda": ahora.isoformat()}
            if est["bloqueo"]:
                seguidos = cfg["bloqueos_seguidos"] + 1
                # Al menos 30 min de descanso, y el doble con cada bloqueo seguido (máximo 48 h)
                espera = min(timedelta(minutes=max(cfg["intervalo_min"], 30) * 2**seguidos), BLOQUEO_MAX)
                cambios.update(bloqueos_seguidos=seguidos, bloqueada_hasta=(ahora + espera).isoformat(), ultimo_error=est["bloqueo"])
            else:
                cambios.update(bloqueos_seguidos=0, bloqueada_hasta=None, ultima_ok=ahora.isoformat(),
                               ultimo_error=est["errores"][-1] if est["errores"] else None)
            db.actualizar("estado_fuentes", {"fuente": f"eq.{nombre}"}, cambios)

        for b in pendientes:
            por_fuente = resultados.get(b["id"], {})
            if not por_fuente:
                db.actualizar("busquedas", {"id": f"eq.{b['id']}"},
                              {"estado": "Pendiente: no dio tiempo en esta ronda, se revisará en la siguiente"})
                continue
            info = dict(b.get("info") or {})
            if "ryanair" in por_fuente:
                info["ryanair_ultima"] = ahora.isoformat()
                r = por_fuente["ryanair"]
                # Sin tarifas en una consulta real y sin franjas horarias: Ryanair no vuela esa ruta
                # (con franjas, o fechas sin vuelo ese día, la respuesta también sale vacía)
                if r.peticiones and not r.opciones and not r.error and not _tiene_franjas(b):
                    info["ryanair_sin_ruta_hasta"] = (hoy + timedelta(days=3)).isoformat()
            if b["modo"] == "chollo" and "google_flights" in por_fuente:
                acumular_calendario(info, por_fuente["google_flights"].calendario, hoy)
            b["info"] = info
            try:
                validas, rechazos, calendario = evaluar(b, por_fuente, perfiles.get(b["usuario"]), aerolineas)
                if b["modo"] == "chollo":
                    # Lo "normal" de la ruta se calcula con todo lo visto en los últimos días
                    calendario = [precio for precio, _visto in (info.get("calendario") or {}).values()]
                log.info("Búsqueda %s…: %s opción(es) válida(s); descartadas: %s",
                         b["id"][:8], len(validas), dict(rechazos) or "ninguna")
                errores = [r.error for r in por_fuente.values() if r.error and not r.opciones]
                if procesar_busqueda(db, b, validas, rechazos, calendario, list(por_fuente), perfiles.get(b["usuario"]),
                                     aerolineas, tg, url_web, hoy, ahora, errores):
                    resumen["avisos"] += 1
                resumen["revisadas"] += 1
            except Exception as e:
                log.error("Error procesando la búsqueda %s…: %s", b["id"][:8], type(e).__name__)
                resumen["errores"].append(f"{b.get('nombre')}: {type(e).__name__}: {e}"[:300])
    except Exception as e:
        log.error("Fallo en la ronda: %s", type(e).__name__)
        resumen["errores"].append(f"Fallo en la ronda: {type(e).__name__}: {e}"[:500])
    finally:
        duracion = int(time.monotonic() - t0)
        db.actualizar("ejecuciones", {"id": f"eq.{ejecucion['id']}"},
                      {"fin": datetime.now(timezone.utc).isoformat(), "duracion_s": duracion, "resumen": resumen})
        # Solo números en el registro: si el repositorio es público, cualquiera puede leerlo.
        log.info("Ronda terminada en %s s: %s revisadas, %s avisos, %s incidencias",
                 duracion, resumen["revisadas"], resumen["avisos"], len(resumen["errores"]))
    return resumen


# ----------------------------------------------------------------------------------------
# Programa
# ----------------------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Robot del Buscador de Vuelos")
    parser.add_argument("--continuo", type=float, metavar="MINUTOS", help="funcionar sin parar durante estos minutos")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # httpx registra cada URL pedida (rutas, fechas...) y fli escribe fechas de viaje en sus avisos:
    # no deben aparecer en registros públicos (los fallos ya se resumen sin datos personales)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("fli").setLevel(logging.ERROR)

    url, clave = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    hay = lambda nombre: "sí" if os.environ.get(nombre) else "NO"  # nunca se escribe el valor
    log.info("Configuración: SUPABASE_URL=%s · SUPABASE_SERVICE_KEY=%s · TELEGRAM_BOT_TOKEN=%s · URL_WEB=%s",
             hay("SUPABASE_URL"), hay("SUPABASE_SERVICE_KEY"), hay("TELEGRAM_BOT_TOKEN"), hay("URL_WEB"))
    if not url or not clave:
        log.warning("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY (secretos del repositorio en GitHub). Nada que hacer.")
        return 0
    url_web = os.environ.get("URL_WEB") or None
    forzar = os.environ.get("FORZAR", "").lower() in ("1", "true", "si", "sí")

    db = Supabase(url, clave)
    inicio = time.monotonic()
    fin = inicio + args.continuo * 60 if args.continuo else None
    hasta = datetime.now(timezone.utc) + timedelta(minutes=args.continuo) if args.continuo else None

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    tg = Telegram(token) if token else None
    if tg and not tg.token_valido():
        log.warning("Telegram: el token no es válido, revisa el secreto TELEGRAM_BOT_TOKEN")
        tg = None
    log.info("Telegram: %s", "token válido" if tg else "sin token válido, no se pueden enviar avisos")

    try:
        migrar_datos(db)
    except Exception as e:
        log.warning("No se pudo actualizar la configuración: %s", type(e).__name__)

    ultima_limpieza = None
    codigo_salida = 0
    while True:
        ahora = datetime.now(timezone.utc)
        try:
            if ultima_limpieza is None or ahora - ultima_limpieza > LIMPIEZA_CADA:
                limpiar_historial(db, ahora)
                ultima_limpieza = ahora
            escribir_latido(db, "continuo" if fin else "ronda", hasta)
            if tg:
                perfiles = {p["id"]: p for p in db.leer("perfiles")}
                if atender_telegram(db, tg, perfiles, url_web):
                    log.info("Telegram: chat vinculado")
            restante = fin - time.monotonic() if fin else None
            if restante is None:
                ronda(db, tg, url_web, forzar, LIMITE_RONDA_S)
            elif restante > MARGEN_FINAL_S:
                ronda(db, tg, url_web, forzar, min(LIMITE_RONDA_S, restante - MARGEN_FINAL_S / 2))
            forzar = False  # solo la primera vuelta revisa todo
        except Exception as e:
            # Un fallo puntual (red, Supabase...) no detiene el robot continuo: se reintenta en la siguiente vuelta
            log.error("Fallo en esta vuelta: %s: %s", type(e).__name__, _sin_urls(e))
            if not fin:
                codigo_salida = 1
        if not fin or time.monotonic() + ESPERA_ENTRE_VUELTAS_S >= fin:
            break
        time.sleep(ESPERA_ENTRE_VUELTAS_S)

    log.info("Robot detenido tras %s min", round((time.monotonic() - inicio) / 60))
    return codigo_salida


if __name__ == "__main__":
    sys.exit(main())
