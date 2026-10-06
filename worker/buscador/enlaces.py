"""Enlaces de compra: solo webs oficiales de las aerolíneas (nunca agencias)."""

from __future__ import annotations

from urllib.parse import quote, urlencode

from .modelos import Opcion, Trayecto

GRUPO_RYANAIR = {"FR", "RK", "AL", "LW", "RR"}


def _ryanair(busqueda: dict, ida: Trayecto, vuelta: Trayecto | None) -> str:
    """Abre ryanair.com con la búsqueda ya rellena (ruta, fechas y pasajeros)."""
    params = {
        "adults": busqueda.get("adultos") or 1,
        "teens": 0,
        "children": busqueda.get("ninos") or 0,
        "infants": busqueda.get("bebes") or 0,
        "dateOut": ida.fecha.isoformat(),
        "dateIn": vuelta.fecha.isoformat() if vuelta else "",
        "isConnectedFlight": "false",
        "discount": 0,
        "isReturn": "true" if vuelta else "false",
        "originIata": ida.origen,
        "destinationIata": ida.destino,
    }
    return "https://www.ryanair.com/es/es/trip/flights/select?" + urlencode(params)


def google_flights(busqueda: dict, opcion: Opcion) -> str:
    """Búsqueda equivalente en Google Flights, para comprobar el vuelo con tus propios ojos."""
    o, d = opcion.ida.origen, opcion.ida.destino
    if opcion.vuelta:
        q = f"Flights to {d} from {o} on {opcion.ida.fecha} through {opcion.vuelta.fecha}"
    else:
        q = f"One way flights to {d} from {o} on {opcion.ida.fecha}"
    return f"https://www.google.com/travel/flights?q={quote(q)}&curr=EUR&hl=es&gl=ES"


def compra(busqueda: dict, opcion: Opcion, aerolineas: dict[str, dict]) -> list[dict]:
    """Una entrada por aerolínea que vende algún vuelo de la opción, con su web oficial."""
    enlaces: list[dict] = []
    vistos: set[str] = set()
    en_ida = {t.aerolinea for t in opcion.ida.tramos}
    en_vuelta = {t.aerolinea for t in opcion.vuelta.tramos} if opcion.vuelta else set()
    for codigo in dict.fromkeys(t.aerolinea for t in opcion.tramos):
        if codigo in vistos:
            continue
        a = aerolineas.get(codigo, {})
        if codigo in GRUPO_RYANAIR:
            vistos |= GRUPO_RYANAIR
            ryanair_ida, ryanair_vuelta = en_ida & GRUPO_RYANAIR, en_vuelta & GRUPO_RYANAIR
            if ryanair_ida and ryanair_vuelta:
                url = _ryanair(busqueda, opcion.ida, opcion.vuelta)
            elif ryanair_ida:
                url = _ryanair(busqueda, opcion.ida, None)
            else:
                url = _ryanair(busqueda, opcion.vuelta, None)
            nombre = "Ryanair"
        else:
            vistos.add(codigo)
            url = a.get("web_oficial") or ""
            nombre = a.get("nombre", codigo)
        if url and all(e["url"] != url for e in enlaces):
            enlaces.append({"aerolinea": nombre, "url": url})
    return enlaces
