"""Avisos por Telegram (bot propio) y vinculación del chat con la web."""

from __future__ import annotations

import html
import logging

import httpx

from . import aeropuertos
from .decision import Decision
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
) -> str:
    ruta = f"{aeropuertos.nombre(b['origen'])} → {aeropuertos.nombre(b['destino'])}"
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
    lineas += ["", "🛒 <b>Comprar en la web oficial:</b>"]
    for e in enlaces_compra:
        lineas.append(f'• <a href="{_e(e["url"])}">{_e(e["aerolinea"])}</a>')
    lineas.append(f'🔎 <a href="{_e(enlace_google)}">Ver estos vuelos en Google Flights</a>')
    if url_web:
        lineas.append(f'📈 <a href="{_e(url_web)}">Historial en tu web</a>')
    lineas.append("Revisa el precio final en la web antes de pagar: puede cambiar en cualquier momento.")
    return "\n".join(lineas)[:4000]


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
