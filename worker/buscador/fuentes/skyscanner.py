"""Skyscanner (experimental, desactivada por defecto).

Se abre la búsqueda en Chrome sin interfaz, en un contexto nuevo (incógnito) por búsqueda.
Skyscanner protege su web con un sistema anti-robots (HUMAN/PerimeterX, "mantén pulsado")
y sus condiciones prohíben el acceso automatizado. Si aparece la verificación, NO se
intenta saltar: se marca la fuente como bloqueada y el robot la deja descansar.
En la prueba del 6/10/2026 bloqueó desde la primera petición.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime

from .. import filtros
from ..modelos import FuenteBloqueada, Opcion, ResultadoFuente, Tramo, Trayecto

log = logging.getLogger(__name__)

ESPERA_RESULTADOS_MS = 25000


def _url(b: dict) -> str:
    fi = date.fromisoformat(str(b["fecha_ida"]))
    ruta = f"https://www.skyscanner.es/transporte/vuelos/{b['origen'].lower()}/{b['destino'].lower()}/{fi:%y%m%d}/"
    if b.get("ida_vuelta"):
        ruta += f"{date.fromisoformat(str(b['fecha_vuelta'])):%y%m%d}/"
    # Skyscanner pide la edad de cada menor: se usa 5 años para niños y 1 para bebés
    edades = ["5"] * (b.get("ninos") or 0) + ["1"] * (b.get("bebes") or 0)
    return (
        f"{ruta}?adultsv2={b.get('adultos') or 1}&childrenv2={'%7C'.join(edades)}"
        f"&cabinclass=economy&rtn={1 if b.get('ida_vuelta') else 0}&preferdirects=false"
    )


def _codigo(carrier: dict | None) -> str | None:
    if not carrier:
        return None
    return carrier.get("alternateId") or carrier.get("displayCode")


def _trayecto(pierna: dict) -> Trayecto:
    tramos = []
    for s in pierna.get("segments", []):
        vende = _codigo(s.get("marketingCarrier")) or "??"
        tramos.append(
            Tramo(
                aerolinea=vende,
                numero=str(s.get("flightNumber", "")),
                origen=(s.get("origin") or {}).get("displayCode") or (s.get("origin") or {}).get("flightPlaceId"),
                destino=(s.get("destination") or {}).get("displayCode")
                or (s.get("destination") or {}).get("flightPlaceId"),
                salida=datetime.fromisoformat(s["departure"]),
                llegada=datetime.fromisoformat(s["arrival"]),
                operadora=_codigo(s.get("operatingCarrier")),
            )
        )
    return Trayecto(tramos)


def _extraer(datos: dict, ida_vuelta: bool) -> list[Opcion]:
    """Lectura tolerante del JSON interno de resultados (formato no documentado)."""
    resultados = (datos.get("itineraries") or {}).get("results") or datos.get("results") or []
    opciones = []
    for it in resultados:
        try:
            precio = float((it.get("price") or {}).get("raw"))
            piernas = it.get("legs") or []
            ida = _trayecto(piernas[0])
            vuelta = _trayecto(piernas[1]) if ida_vuelta and len(piernas) > 1 else None
            if ida_vuelta and vuelta is None:
                continue
            opciones.append(Opcion(fuente="skyscanner", ida=ida, vuelta=vuelta, precio_billetes=precio))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    return opciones


class Skyscanner:
    nombre = "skyscanner"

    def __init__(self):
        self.peticiones = 0

    def buscar(self, b: dict, validador: filtros.Validador) -> ResultadoFuente:
        res = ResultadoFuente()
        if b["modo"] != "fechas":
            return res  # el modo chollo se cubre con Google Flights y Ryanair
        from playwright.sync_api import sync_playwright

        capturas: list[str] = []
        self.peticiones += 1
        with sync_playwright() as p:
            navegador = p.chromium.launch(channel="chrome", headless=True)
            try:
                contexto = navegador.new_context(locale="es-ES")  # contexto nuevo = incógnito
                pagina = contexto.new_page()

                def al_responder(respuesta):
                    if "radar" in respuesta.url or "unified-search" in respuesta.url:
                        try:
                            capturas.append(respuesta.text())
                        except Exception:  # la respuesta puede no tener cuerpo
                            pass

                pagina.on("response", al_responder)
                pagina.goto(_url(b), wait_until="domcontentloaded", timeout=60000)
                pagina.wait_for_timeout(ESPERA_RESULTADOS_MS)
                texto = pagina.inner_text("body")[:3000].lower()
                if "/captcha" in pagina.url or "person or a robot" in texto or "persona o un robot" in texto:
                    raise FuenteBloqueada("Skyscanner muestra su verificación anti-robots (no se intenta saltar)")
            finally:
                navegador.close()

        res.peticiones = 1
        for cuerpo in capturas:
            try:
                res.opciones += _extraer(json.loads(cuerpo), bool(b.get("ida_vuelta")))
            except json.JSONDecodeError:
                continue
        if not res.opciones:
            res.error = "Skyscanner no devolvió resultados legibles"
        return res
