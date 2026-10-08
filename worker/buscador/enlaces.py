"""Enlaces de compra: solo webs oficiales de las aerolíneas (nunca agencias)."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from urllib.parse import quote, urlencode

from .modelos import Opcion, Trayecto

log = logging.getLogger(__name__)

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


# Pestaña "Los más bajos" de Google Flights (sin esto se abre en "Mejores opciones")
PESTANA_MAS_BAJOS = "EgoIABAAGAAgAigB"


def _pasajeros(busqueda: dict) -> list[int]:
    from fli.search._proto import passenger_codes

    return passenger_codes(SimpleNamespace(
        adults=busqueda.get("adultos") or 1, children=busqueda.get("ninos") or 0,
        infants_on_lap=busqueda.get("bebes") or 0, infants_in_seat=0,
    ))


def google_flights(busqueda: dict, opcion: Opcion) -> str:
    """La misma búsqueda (aeropuertos, fechas y pasajeros de esta opción) en Google Flights,
    abierta directamente en la pestaña "Los más bajos"."""
    try:
        from fli.search._proto import encode_tfs_payload, encode_tfs_segment

        segmentos = encode_tfs_segment([opcion.ida.origen], [opcion.ida.destino], opcion.ida.fecha.isoformat())
        if opcion.vuelta:
            segmentos += encode_tfs_segment([opcion.vuelta.origen], [opcion.vuelta.destino], opcion.vuelta.fecha.isoformat())
        tfs = encode_tfs_payload(segmentos, is_one_way=opcion.vuelta is None, passengers=_pasajeros(busqueda), pin_max_u64=True)
        return f"https://www.google.com/travel/flights/search?tfs={tfs}&tfu={PESTANA_MAS_BAJOS}&hl=es&gl=ES&curr=EUR"
    except Exception as e:  # si la librería cambia, queda la búsqueda por texto
        log.warning("No se pudo crear el enlace de Google Flights: %s", type(e).__name__)
    o, d = opcion.ida.origen, opcion.ida.destino
    if opcion.vuelta:
        q = f"Flights to {d} from {o} on {opcion.ida.fecha} through {opcion.vuelta.fecha}"
    else:
        q = f"One way flights to {d} from {o} on {opcion.ida.fecha}"
    return f"https://www.google.com/travel/flights?q={quote(q)}&curr=EUR&hl=es&gl=ES"


def _segmento_fijado(trayecto: Trayecto) -> bytes:
    from fli.search._proto import LegSpec, encode_tfs_segment

    legs = [LegSpec(t.origen, t.salida.date().isoformat(), t.destino, t.aerolinea, str(t.numero)) for t in trayecto.tramos]
    return encode_tfs_segment([trayecto.origen], [trayecto.destino], trayecto.fecha.isoformat(), legs=legs)


def comprar_ya(busqueda: dict, opcion: Opcion) -> list[dict]:
    """Enlaces a la página de reserva de Google Flights con esos vuelos exactos ya elegidos
    (allí sale "Reservar con <aerolínea>"). Si ida y vuelta son billetes separados, uno para cada uno."""
    try:
        from fli.search._proto import encode_tfs_payload

        pasajeros = _pasajeros(busqueda)

        def url(segmentos: bytes, solo_ida: bool) -> str:
            tfs = encode_tfs_payload(segmentos, is_one_way=solo_ida, passengers=pasajeros)
            return f"https://www.google.com/travel/flights/booking?tfs={tfs}&hl=es&gl=ES&curr=EUR"

        if opcion.vuelta is None:
            return [{"texto": "Comprar ya", "url": url(_segmento_fijado(opcion.ida), True)}]
        if opcion.billetes_separados:
            return [
                {"texto": "Comprar la ida", "url": url(_segmento_fijado(opcion.ida), True)},
                {"texto": "Comprar la vuelta", "url": url(_segmento_fijado(opcion.vuelta), True)},
            ]
        return [{"texto": "Comprar ya", "url": url(_segmento_fijado(opcion.ida) + _segmento_fijado(opcion.vuelta), False)}]
    except Exception as e:  # si la librería cambia, quedan los enlaces de siempre
        log.warning("No se pudo crear el enlace de compra de Google Flights: %s", type(e).__name__)
        return []


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
