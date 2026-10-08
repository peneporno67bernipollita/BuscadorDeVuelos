"""Avisos por Telegram (bot propio) y vinculación del chat con la web."""

from __future__ import annotations

import html
import logging

import httpx

from . import aeropuertos
from .decision import Decision
from .filtros import aeropuertos_busqueda
from .modelos import Opcion, Trayecto

log = logging.getLogger(__name__)

DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def eur(x: float) -> str:
    return f"{x:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def _fecha(d) -> str:
    return f"{DIAS[d.weekday()]} {d.day} {MESES[d.month - 1]}"


def _e(texto) -> str:
    return html.escape(str(texto), quote=False)


def _linea_trayecto(etiqueta: str, tr: Trayecto, aerolineas: dict[str, dict]) -> str:
    vuelos = ", ".join(
        f"{aerolineas.get(t.aerolinea, {}).get('nombre', t.aerolinea)} {t.aerolinea}{t.numero}"
        + (
            f" (operado por {aerolineas.get(t.operadora, {}).get('nombre', t.operadora)})"
            if t.operadora and t.operadora != t.aerolinea
            else ""
        )
        for t in tr.tramos
    )
    if tr.escalas == 0:
        escalas = "directo"
    else:
        sitios = ", ".join(
            f"{t.destino} {m // 60} h {m % 60:02d} min" for t, m in zip(tr.tramos, tr.esperas_min)
        )
        escalas = f"{tr.escalas} escala{'s' if tr.escalas > 1 else ''} ({sitios})"
    dia_sig = " (+1 día)" if tr.llegada.date() > tr.salida.date() else ""
    return (
        f"🛫 <b>{etiqueta}</b> {_fecha(tr.salida)} · {tr.salida:%H:%M} {tr.origen} → "
        f"{tr.llegada:%H:%M}{dia_sig} {tr.destino}\n      {_e(vuelos)} · {escalas}"
    )


def ruta_txt(b: dict) -> str:
    """"Sevilla (SVQ) o Jerez (XRY) → París Orly (ORY)"."""
    origenes, destinos = aeropuertos_busqueda(b)
    return " o ".join(map(aeropuertos.nombre, origenes)) + " → " + " o ".join(map(aeropuertos.nombre, destinos))


def pasajeros_txt(b: dict) -> str:
    partes = [f"{b['adultos']} adulto{'s' if b['adultos'] != 1 else ''}"]
    if b.get("ninos"):
        partes.append(f"{b['ninos']} niño{'s' if b['ninos'] != 1 else ''}")
    if b.get("bebes"):
        partes.append(f"{b['bebes']} bebé{'s' if b['bebes'] != 1 else ''}")
    maletas = []
    if b.get("maletas_cabina"):
        maletas.append(f"{b['maletas_cabina']} maleta{'s' if b['maletas_cabina'] != 1 else ''} de cabina")
    if b.get("maletas_20kg"):
        maletas.append(f"{b['maletas_20kg']} facturada{'s' if b['maletas_20kg'] != 1 else ''} de 20 kg")
    return ", ".join(partes) + (" · " + ", ".join(maletas) if maletas else " · sin maletas extra")


def mensaje_aviso(
    b: dict,
    op: Opcion,
    decision: Decision,
    enlaces_compra: list[dict],
    enlace_google: str,
    aerolineas: dict[str, dict],
    url_web: str | None,
    comprar: list[dict] | None = None,
) -> str:
    ruta = ruta_txt(b)
    lineas = [
        f"<b>{_e(decision.titulo)}</b>",
        f"<b>{_e(b['nombre'])}</b>",
        _e(ruta) + (" · ida y vuelta" if op.vuelta else " · solo ida"),
        "",
        _linea_trayecto("Ida", op.ida, aerolineas),
    ]
    if op.vuelta:
        lineas.append(_linea_trayecto("Vuelta", op.vuelta, aerolineas))
    lineas += ["", f"👥 {_e(pasajeros_txt(b))}", "", f"💶 <b>TOTAL: {eur(op.precio_total)}</b> (todos los pasajeros)"]
    lineas.append(f"   Billetes: {eur(op.precio_billetes)}")
    if op.precio_maletas:
        lineas.append(f"   Maletas: {eur(op.precio_maletas)} (máximo estimado: puede salir más barato)")
    if op.descuento:
        lineas.append(f"   Descuento: −{eur(op.descuento)} ({_e(op.descuento_detalle)})")
    ctx = decision.contexto
    extra = []
    if "minimo_visto" in ctx:
        extra.append(f"mínimo visto {eur(ctx['minimo_visto'])}")
    if "habitual" in ctx:
        extra.append(f"billetes habituales {ctx['habitual'][0]}-{ctx['habitual'][1]} €")
    if extra:
        lineas.append("📊 " + " · ".join(extra))
    lineas += ["", f"ℹ️ {_e(decision.motivo)}"]
    if op.billetes_separados:
        lineas.append("⚠️ Ida y vuelta son billetes separados: tienes que comprar los dos.")
    for nota in op.notas:
        lineas.append(f"ℹ️ {_e(nota)}")
    if comprar:
        lineas += ["", "🛒 <b>Comprar ya (Google Flights, con estos vuelos elegidos):</b>"]
        for e in comprar:
            lineas.append(f'👉 <a href="{_e(e["url"])}">{_e(e["texto"])}</a>')
    lineas += ["", "🏢 <b>O en la web oficial:</b>"]
    for e in enlaces_compra:
        lineas.append(f'• <a href="{_e(e["url"])}">{_e(e["aerolinea"])}</a>')
    lineas.append(f'🔎 <a href="{_e(enlace_google)}">Ver los más baratos en Google Flights</a>')
    if url_web:
        lineas.append(f'📈 <a href="{_e(url_web)}">Historial en tu web</a>')
    lineas.append("Revisa el precio final en la web antes de pagar: puede cambiar en cualquier momento.")
    return unir_sin_pasarse(lineas)


# Llamada de voz por Telegram para los chollazos (servicio externo gratuito: https://www.callmebot.com).
# Solo se usa si lo activas en tu perfil; antes hay que autorizarlo una vez enviando /start a @CallMeBot_txtbot.
CALLMEBOT_URL = "https://api.callmebot.com/start.php"
VOZ_LLAMADA = "es-ES-Standard-A"
TIPOS_LLAMADA = {
    "bajada_fuerte": "Bajada fuerte de precio",
    "chollo": "Chollo de vuelos",
    "presupuesto": "Precio dentro de tu objetivo",
}
TEXTO_LLAMADA_PRUEBA = (
    "Hola, soy tu Buscador de Vuelos. Esta es una llamada de prueba: así sonará el teléfono cuando encuentre un chollo."
)


def texto_llamada(tipo: str, b: dict, total: float) -> str:
    precio = f"{total:.2f}".replace(".", ",").removesuffix(",00")
    titulo = TIPOS_LLAMADA.get(tipo, "Aviso de vuelos")
    return f"{titulo}. {b['nombre']}: {precio} euros en total. Mira Telegram para comprarlo."[:256]


def llamar(usuario: str, texto: str, http=None) -> bool:
    """Te llama por Telegram y una voz lee el texto. Devuelve True si CallMeBot aceptó la llamada."""
    usuario = (usuario or "").strip()
    if not usuario:
        return False
    if not usuario.startswith(("@", "+")):
        usuario = "@" + usuario
    params = {"user": usuario, "text": texto[:256], "lang": VOZ_LLAMADA, "rpt": 2, "cc": "no"}
    cliente = http or httpx
    try:
        r = cliente.get(CALLMEBOT_URL, params=params, timeout=40)
    except httpx.HTTPError as e:
        log.warning("CallMeBot no responde: %s", type(e).__name__)
        return False
    cuerpo = r.text.lower()
    ok = r.status_code == 200 and not any(p in cuerpo for p in ("error", "not author", "no autoriz", "invalid", "not found"))
    if not ok:
        # Sin el usuario: el registro del robot es público
        log.warning("CallMeBot no hizo la llamada (HTTP %s): %s", r.status_code,
                    " ".join(r.text.replace(usuario, "@usuario").split())[:160])
    return ok


LIMITE_TELEGRAM = 4000  # Telegram admite 4096 caracteres por mensaje


def unir_sin_pasarse(lineas: list[str], limite: int = LIMITE_TELEGRAM) -> str:
    """Une líneas completas sin pasar del límite (cortar a mitad rompería el HTML del mensaje)."""
    texto = ""
    for linea in lineas:
        siguiente = f"{texto}\n{linea}" if texto else linea
        if len(siguiente) > limite - 2:
            return texto + "\n…"
        texto = siguiente
    return texto


AYUDA = (
    "✈️ <b>Buscador de Vuelos</b>\n"
    "Te aviso por aquí cuando una de tus búsquedas llega a buen precio.\n\n"
    "/estado · cómo van tus búsquedas ahora mismo\n"
    "/ayuda · este mensaje\n\n"
    "Las búsquedas se crean y se editan en tu web."
)

MENSAJE_PRUEBA = (
    "🧪 <b>Mensaje de prueba</b>\n"
    "Si lees esto, los avisos de tu Buscador de Vuelos te llegarán aquí. ✅\n"
    "Escribe /estado para ver cómo van tus búsquedas."
)


def mensaje_estado(busquedas: list[dict], url_web: str | None) -> str:
    """Resumen de las búsquedas activas para el comando /estado."""
    activas = [b for b in busquedas if b.get("activa")]
    if not activas:
        return "No tienes ninguna búsqueda activa. Créala en tu web" + (f": {_e(url_web)}" if url_web else ".")
    lineas = [f"📋 <b>Tus búsquedas</b> ({len(activas)})", ""]
    for b in activas:
        ruta = ruta_txt(b)
        if b.get("precio_actual") is not None:
            precio = f"💶 <b>{eur(float(b['precio_actual']))}</b>"
            if b.get("mejor_precio") is not None:
                precio += f" · mínimo visto {eur(float(b['mejor_precio']))}"
        else:
            precio = "💶 sin precio todavía"
        lineas += [f"<b>{_e(b['nombre'])}</b>", _e(ruta), precio, f"ℹ️ {_e(b.get('estado') or 'Pendiente')}", ""]
    if url_web:
        lineas.append(f'📈 <a href="{_e(url_web)}">Abrir tu web</a>')
    return unir_sin_pasarse(lineas)


class Telegram:
    def __init__(self, token: str):
        self.url = f"https://api.telegram.org/bot{token}"
        self.http = httpx.Client(timeout=20)

    def enviar(self, chat_id: str, texto: str) -> bool:
        try:
            r = self.http.post(
                f"{self.url}/sendMessage",
                json={"chat_id": chat_id, "text": texto, "parse_mode": "HTML", "disable_web_page_preview": True},
            )
            if r.status_code != 200:
                log.warning("Telegram respondió %s: %s", r.status_code, r.text[:200])
            return r.status_code == 200
        except httpx.HTTPError as e:
            log.warning("No se pudo enviar el aviso por Telegram: %s", type(e).__name__)
            return False

    def token_valido(self) -> bool:
        """Comprueba el token con getMe (sin escribir nada en el registro que lo revele)."""
        try:
            r = self.http.get(f"{self.url}/getMe")
        except httpx.HTTPError as e:
            log.warning("Telegram no responde: %s", type(e).__name__)
            return False
        if r.status_code != 200:
            log.warning("Telegram rechaza el token (HTTP %s)", r.status_code)
        return r.status_code == 200

    def mensajes_nuevos(self, desde_update: int | None) -> list[dict]:
        params = {"timeout": 0, "allowed_updates": '["message"]'}
        if desde_update is not None:
            params["offset"] = desde_update + 1
        try:
            r = self.http.get(f"{self.url}/getUpdates", params=params)
        except httpx.HTTPError as e:
            log.warning("No se pudieron leer los mensajes de Telegram: %s", type(e).__name__)
            return []
        if r.status_code != 200:
            # 409 = el bot tiene un webhook configurado y no admite getUpdates
            log.warning("No se pudieron leer los mensajes de Telegram (HTTP %s): %s", r.status_code, r.text[:150])
            return []
        return r.json().get("result", [])


def codigo_en_mensaje(texto: str) -> str | None:
    """Acepta '/start CODIGO' o simplemente 'CODIGO'."""
    partes = (texto or "").strip().split()
    if not partes:
        return None
    candidato = partes[-1].upper()
    return candidato if 4 <= len(candidato) <= 12 and candidato.isalnum() else None
