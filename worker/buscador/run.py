"""Una ronda del robot (la lanza GitHub Actions cada 3 horas).

Variables de entorno (secretos de GitHub):
    SUPABASE_URL, SUPABASE_SERVICE_KEY   obligatorias
    TELEGRAM_BOT_TOKEN                   para enviar avisos
    URL_WEB                              dirección de tu web (para enlazar el historial)
    FORZAR=1                             ignora los intervalos (no los bloqueos): solo para pruebas
"""

from __future__ import annotations

import logging
import os
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import enlaces
from .avisos import Telegram, codigo_en_mensaje, eur, mensaje_aviso
from .db import Supabase
from .decision import decidir, minutos_hasta_siguiente_revision
from .filtros import Validador
from .modelos import Opcion
from .nucleo import consultar, crear_fuentes, evaluar

log = logging.getLogger("buscador")

ZONA = ZoneInfo("Europe/Madrid")
LIMITE_RONDA_S = 12 * 60  # tiempo máximo de consultas por ronda (ahorra minutos de GitHub)
BLOQUEO_MAX = timedelta(hours=48)
OPCIONES_GUARDADAS = 5


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


def vincular_telegram(db: Supabase, tg: Telegram, perfiles: dict[str, dict]) -> int:
    """Lee los mensajes nuevos del bot y vincula el chat que envíe el código de la web."""
    ajuste = db.leer("ajustes", clave="eq.telegram_offset")
    offset = ajuste[0]["valor"] if ajuste else None
    codigos = {p["telegram_codigo"].upper(): p for p in perfiles.values() if p.get("telegram_codigo")}
    ultimo, vinculados = offset, 0
    mensajes = tg.mensajes_nuevos(offset)
    log.info("Telegram: %s mensaje(s) nuevo(s) para el bot", len(mensajes))
    for m in mensajes:
        ultimo = m["update_id"]
        mensaje = m.get("message") or {}
        chat = (mensaje.get("chat") or {}).get("id")
        texto = mensaje.get("text") or ""
        codigo = codigo_en_mensaje(texto)
        if chat and codigo in codigos:
            perfil = codigos.pop(codigo)
            db.actualizar("perfiles", {"id": f"eq.{perfil['id']}"}, {"telegram_chat_id": str(chat), "telegram_codigo": None})
            perfil["telegram_chat_id"] = str(chat)
            tg.enviar(chat, "✅ ¡Listo! Este chat queda vinculado a tu Buscador de Vuelos. Aquí te llegarán los avisos.")
            vinculados += 1
        elif chat and texto.startswith("/start"):
            tg.enviar(chat, "Hola 👋 Para vincular este chat envíame el código que aparece en tu web (Perfil → Telegram).")
    if ultimo != offset:
        db.guardar("ajustes", {"clave": "telegram_offset", "valor": ultimo})
    return vinculados


def _fila_precio(b: dict, op: Opcion, es_mejor: bool, aerolineas: dict) -> dict:
    detalle = op.a_dict()
    detalle["enlaces"] = enlaces.compra(b, op, aerolineas)
    detalle["google_flights"] = enlaces.google_flights(b, op)
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
) -> bool:
    """Guarda el historial, decide si avisar y actualiza la búsqueda. Devuelve True si avisó."""
    filtros_historial = {"busqueda": f"eq.{b['id']}", "es_mejor": "eq.true", "select": "precio_total",
                         "order": "revisado.asc", "limit": 500}
    if b.get("historial_desde"):  # tras editar el viaje, el historial anterior no se compara
        filtros_historial["revisado"] = f"gte.{b['historial_desde']}"
    historial = [float(p["precio_total"]) for p in db.leer("precios", **filtros_historial)]
    if validas:
        db.insertar("precios", [_fila_precio(b, op, i == 0, aerolineas) for i, op in enumerate(validas[:OPCIONES_GUARDADAS])])

    mejor = validas[0] if validas else None
    decision = decidir(b, mejor, historial, calendario, hoy)

    info = dict(b.get("info") or {})
    info["opciones_validas"] = len(validas)
    info["rechazos"] = dict(rechazos.most_common(4))
    info["fuentes"] = fuentes_usadas
    if "habitual" in decision.contexto:
        info["habitual"] = decision.contexto["habitual"]
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
        )
        chat = (perfil or {}).get("telegram_chat_id")
        entregado = bool(tg and chat and tg.enviar(chat, texto))
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


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # httpx registra cada URL pedida (rutas, fechas...): no debe aparecer en registros públicos
    logging.getLogger("httpx").setLevel(logging.WARNING)
    url, clave = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    # Diagnóstico sin revelar nada: solo si cada dato de configuración existe o no
    hay = lambda nombre: "sí" if os.environ.get(nombre) else "NO"
    log.info(
        "Configuración: SUPABASE_URL=%s · SUPABASE_SERVICE_KEY=%s · TELEGRAM_BOT_TOKEN=%s · URL_WEB=%s",
        hay("SUPABASE_URL"), hay("SUPABASE_SERVICE_KEY"), hay("TELEGRAM_BOT_TOKEN"), hay("URL_WEB"),
    )
    if not url or not clave:
        # Sin configurar todavía: se avisa en el registro pero no se marca como fallo
        log.warning("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY (secretos del repositorio en GitHub). Nada que hacer.")
        return 0
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    url_web = os.environ.get("URL_WEB") or None
    forzar = os.environ.get("FORZAR", "").lower() in ("1", "true", "si", "sí")

    db = Supabase(url, clave)
    t0 = time.monotonic()
    ahora = datetime.now(timezone.utc)
    hoy = datetime.now(ZONA).date()
    ejecucion = db.insertar("ejecuciones", {"inicio": ahora.isoformat()}, devolver=True)[0]
    resumen: dict = {"forzada": forzar, "avisos": 0, "revisadas": 0, "errores": []}
    codigo_salida = 0
    try:
        aerolineas = {a["codigo"]: a for a in db.leer("aerolineas")}
        perfiles = {p["id"]: p for p in db.leer("perfiles")}
        config = {f["fuente"]: f for f in db.leer("estado_fuentes")}

        log.info("Supabase: conexión correcta · %s perfil(es), %s con Telegram vinculado, %s con código pendiente",
                 len(perfiles), sum(1 for p in perfiles.values() if p.get("telegram_chat_id")),
                 sum(1 for p in perfiles.values() if p.get("telegram_codigo")))
        tg = Telegram(token) if token else None
        if tg and not tg.token_valido():
            resumen["errores"].append("El token de Telegram no es válido: revisa el secreto TELEGRAM_BOT_TOKEN")
            tg = None
        if tg:
            resumen["telegram_vinculados"] = vincular_telegram(db, tg, perfiles)
            log.info("Telegram: token válido · %s chat(s) vinculado(s) en esta ronda", resumen["telegram_vinculados"])
        else:
            resumen["errores"].append("Sin TELEGRAM_BOT_TOKEN válido: no se envían avisos")
            log.warning("Telegram: sin token válido, no se pueden enviar avisos")

        pendientes = []
        for b in db.leer("busquedas", activa="eq.true"):
            if _caducada(b, hoy):
                db.actualizar("busquedas", {"id": f"eq.{b['id']}"}, {"activa": False, "estado": "Caducada: las fechas ya han pasado"})
                continue
            if forzar or _fecha_hora(b["proxima_revision"]) <= ahora:
                pendientes.append(b)
        # Primero los viajes más cercanos
        pendientes.sort(key=lambda b: str(b.get("fecha_ida") or b.get("chollo_desde")))
        resumen["pendientes"] = len(pendientes)

        listas = []
        for nombre, cfg in config.items():
            bloqueada = _fecha_hora(cfg.get("bloqueada_hasta"))
            ultima = _fecha_hora(cfg.get("ultima_ronda"))
            if not cfg["activa"] or (bloqueada and bloqueada > ahora):
                continue
            if not forzar and ultima and ahora - ultima < timedelta(minutes=cfg["intervalo_min"]):
                continue
            listas.append(nombre)
        resumen["fuentes_en_ronda"] = listas

        if pendientes and listas:
            fuentes = crear_fuentes(listas, config, aerolineas)
            tareas = {n: [b for b in pendientes if _aplica(n, b, hoy)] for n in fuentes}
            # Ryanair tiene un máximo de peticiones por ronda: primero las que hace más tiempo que no mira
            if "ryanair" in tareas:
                tareas["ryanair"].sort(key=lambda b: (b.get("info") or {}).get("ryanair_ultima", ""))
            validadores = {b["id"]: Validador(b, aerolineas) for b in pendientes}
            resultados, estado = consultar(fuentes, tareas, validadores, config, LIMITE_RONDA_S)
            resumen["fuentes"] = estado

            for nombre, est in estado.items():
                cfg = config[nombre]
                cambios = {"ultima_ronda": ahora.isoformat()}
                if est["bloqueo"]:
                    seguidos = cfg["bloqueos_seguidos"] + 1
                    espera = min(timedelta(minutes=cfg["intervalo_min"] * 2**seguidos), BLOQUEO_MAX)
                    cambios.update(bloqueos_seguidos=seguidos, bloqueada_hasta=(ahora + espera).isoformat(), ultimo_error=est["bloqueo"])
                else:
                    cambios.update(bloqueos_seguidos=0, bloqueada_hasta=None, ultima_ok=ahora.isoformat(),
                                   ultimo_error=est["errores"][-1] if est["errores"] else None)
                db.actualizar("estado_fuentes", {"fuente": f"eq.{nombre}"}, cambios)

            for b in pendientes:
                por_fuente = resultados.get(b["id"], {})
                if not por_fuente:
                    db.actualizar("busquedas", {"id": f"eq.{b['id']}"},
                                  {"estado": "En espera: ninguna web disponible en esta ronda"})
                    continue
                info = dict(b.get("info") or {})
                if "ryanair" in por_fuente:
                    info["ryanair_ultima"] = ahora.isoformat()
                    r = por_fuente["ryanair"]
                    if not r.opciones and not r.error:
                        info["ryanair_sin_ruta_hasta"] = (hoy + timedelta(days=7)).isoformat()
                b["info"] = info
                try:
                    validas, rechazos, calendario = evaluar(b, por_fuente, perfiles.get(b["usuario"]), aerolineas)
                    if procesar_busqueda(db, b, validas, rechazos, calendario, list(por_fuente), perfiles.get(b["usuario"]),
                                         aerolineas, tg, url_web, hoy, ahora):
                        resumen["avisos"] += 1
                    resumen["revisadas"] += 1
                except Exception as e:
                    log.error("Error procesando la búsqueda %s…: %s", b["id"][:8], type(e).__name__)
                    resumen["errores"].append(f"{b.get('nombre')}: {type(e).__name__}: {e}"[:300])
    except Exception as e:
        log.error("Fallo general de la ronda: %s", type(e).__name__)
        resumen["errores"].append(f"Fallo general: {type(e).__name__}: {e}"[:500])
        codigo_salida = 1
    finally:
        duracion = int(time.monotonic() - t0)
        db.actualizar("ejecuciones", {"id": f"eq.{ejecucion['id']}"},
                      {"fin": datetime.now(timezone.utc).isoformat(), "duracion_s": duracion, "resumen": resumen})
        # Solo números en el registro: si el repositorio es público, cualquiera puede leerlo.
        # El detalle (con nombres de búsquedas y errores) se guarda en Supabase, que es privado.
        log.info(
            "Ronda terminada en %s s: %s revisadas, %s avisos, %s incidencias",
            duracion, resumen.get("revisadas", 0), resumen.get("avisos", 0), len(resumen.get("errores", [])),
        )
    return codigo_salida


if __name__ == "__main__":
    sys.exit(main())
