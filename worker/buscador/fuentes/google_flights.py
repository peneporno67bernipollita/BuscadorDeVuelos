"""Google Flights (fuente principal): compara casi todas las aerolíneas a la vez.

Cada consulta es una petición HTTP independiente, sin cookies ni sesión guardada
(equivalente a navegación privada). El ritmo lo marca estado_fuentes: pausas aleatorias
entre peticiones y como máximo una petición cada `pausa_min` segundos.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from datetime import date, timedelta

from fli.models import (
    Airline,
    Airport,
    DateSearchFilters,
    FlightSearchFilters,
    FlightSegment,
    LayoverRestrictions,
    MaxStops,
    PassengerInfo,
    SeatType,
    SortBy,
    TimeRestrictions,
    TripType,
)
from fli.search import SearchDates, SearchFlights
from fli.search._concurrency import TokenBucketRateLimiter
from fli.search.client import get_client

from .. import filtros
from ..modelos import FuenteBloqueada, Opcion, PrecioCalendario, ResultadoFuente, Tramo, Trayecto

log = logging.getLogger(__name__)

LOCALE = {"currency": "EUR", "language": "es", "country": "ES"}
ESCALAS = {0: MaxStops.NON_STOP, 1: MaxStops.ONE_STOP_OR_FEWER, 2: MaxStops.TWO_OR_FEWER_STOPS}
MAX_DIAS_FUTURO = 300  # Google no busca más allá de ~305 días


def _codigo(aerolinea) -> str:
    return aerolinea.name.removeprefix("_")


def _a_trayecto(resultado) -> Trayecto:
    return Trayecto(
        [
            Tramo(
                aerolinea=_codigo(l.airline),
                numero=str(l.flight_number),
                origen=l.departure_airport.name,
                destino=l.arrival_airport.name,
                salida=l.departure_datetime,
                llegada=l.arrival_datetime,
                operadora=_codigo(l.operating_airline) if l.operating_airline else None,
            )
            for l in resultado.legs
        ]
    )


def _es_bloqueo(error: Exception) -> bool:
    texto = str(error).lower()
    return any(s in texto for s in ("429", "403", "unusual traffic", "captcha", "too many requests"))


class GoogleFlights:
    nombre = "google_flights"

    def __init__(self, pausa_min_s: float, pausa_max_s: float, codigos_permitidos: set[str]):
        self.pausa = (pausa_min_s, pausa_max_s)
        # Nunca más de una petición cada pausa_min segundos (también en las internas de la librería)
        get_client()._rate_limiter = TokenBucketRateLimiter(calls=1, period=float(pausa_min_s))
        self.incluir = [a for c in sorted(codigos_permitidos) if (a := self._aerolinea(c))]
        self.peticiones = 0
        self._primera = True

    @staticmethod
    def _aerolinea(codigo: str):
        for nombre in (codigo, "_" + codigo):
            if nombre in Airline.__members__:
                return Airline[nombre]
        return None

    def _pausa(self) -> None:
        if not self._primera:
            time.sleep(random.uniform(*self.pausa))
        self._primera = False

    def _llamar(self, funcion, *args, peticiones: int = 1, **kwargs):
        self._pausa()
        self.peticiones += peticiones
        try:
            return funcion(*args, **kwargs, **LOCALE)
        except Exception as e:  # la librería lanza excepciones genéricas
            if _es_bloqueo(e):
                raise FuenteBloqueada(f"Google Flights ha limitado las peticiones: {e}") from e
            raise

    # ------------------------------------------------------------------
    # Construcción de filtros
    # ------------------------------------------------------------------
    @staticmethod
    def _aeropuerto(codigo: str):
        if codigo not in Airport.__members__:
            raise ValueError(f"Google Flights no reconoce el aeropuerto {codigo}")
        return Airport[codigo]

    def _segmento(self, b: dict, sentido: str, fecha: date) -> FlightSegment:
        o, d = (b["origen"], b["destino"]) if sentido == "ida" else (b["destino"], b["origen"])
        sal_min, sal_max, lle_min, lle_max = filtros.franja(b, sentido)
        horas = TimeRestrictions(
            earliest_departure=sal_min or None,
            latest_departure=sal_max if sal_max < 24 else None,
            earliest_arrival=lle_min or None,
            latest_arrival=lle_max if lle_max < 24 else None,
        )
        tiene_horas = any(v is not None for v in horas.model_dump().values())
        return FlightSegment(
            departure_airport=[[self._aeropuerto(o), 0]],
            arrival_airport=[[self._aeropuerto(d), 0]],
            travel_date=fecha.isoformat(),
            time_restrictions=horas if tiene_horas else None,
        )

    def _comunes(self, b: dict) -> dict:
        return {
            "passenger_info": PassengerInfo(
                adults=b.get("adultos") or 1, children=b.get("ninos") or 0, infants_on_lap=b.get("bebes") or 0
            ),
            "stops": ESCALAS.get(b.get("escalas_max", 1), MaxStops.ANY),
            "seat_type": SeatType.ECONOMY,
            "layover_restrictions": LayoverRestrictions(max_duration=(b.get("escala_max_horas") or 6) * 60),
            "airlines": self.incluir or None,
        }

    # ------------------------------------------------------------------
    # Consultas
    # ------------------------------------------------------------------
    def calendario(self, b: dict, desde: date, hasta: date, noches: int | None) -> list[PrecioCalendario]:
        """Precio más barato (solo billetes) de cada fecha del rango, con una o pocas peticiones."""
        manana = date.today() + timedelta(days=1)
        desde = max(desde, manana)
        hasta = min(hasta, date.today() + timedelta(days=MAX_DIAS_FUTURO))
        if hasta < desde:
            return []
        segmentos = [self._segmento(b, "ida", desde)]
        if noches:
            segmentos.append(self._segmento(b, "vuelta", desde + timedelta(days=noches)))
        comunes = self._comunes(b)
        # Con límite de duración de escala, el calendario de Google devuelve un solo día (probado
        # el 6/10/2026). El calendario es solo una referencia de precios: la escala se filtra después.
        comunes.pop("layover_restrictions")
        filtros_fechas = DateSearchFilters(
            trip_type=TripType.ROUND_TRIP if noches else TripType.ONE_WAY,
            flight_segments=segmentos,
            from_date=desde.isoformat(),
            to_date=hasta.isoformat(),
            duration=noches,
            **comunes,
        )
        trozos = (hasta - desde).days // SearchDates.MAX_DAYS_PER_SEARCH + 1
        res = self._llamar(SearchDates().search, filtros_fechas, peticiones=trozos) or []
        return [
            PrecioCalendario(r.date[0].date(), r.date[1].date() if len(r.date) > 1 else None, float(r.price))
            for r in res
            if r.price
        ]

    def _solo_ida(self, b: dict, sentido: str, fecha: date) -> list:
        f = FlightSearchFilters(
            trip_type=TripType.ONE_WAY,
            flight_segments=[self._segmento(b, sentido, fecha)],
            sort_by=SortBy.CHEAPEST,
            **self._comunes(b),
        )
        return self._llamar(SearchFlights().search, f) or []

    def vuelos(self, b: dict, fecha_ida: date, fecha_vuelta: date | None, validador: filtros.Validador) -> list[Opcion]:
        """Opciones concretas para unas fechas: ida y vuelta juntas y, además, dos billetes de solo ida."""
        opciones: list[Opcion] = []
        if fecha_vuelta:
            f = FlightSearchFilters(
                trip_type=TripType.ROUND_TRIP,
                flight_segments=[self._segmento(b, "ida", fecha_ida), self._segmento(b, "vuelta", fecha_vuelta)],
                sort_by=SortBy.CHEAPEST,
                **self._comunes(b),
            )
            # top_n=2: se piden las vueltas de las 2 idas más baratas (3 peticiones)
            for combo in self._llamar(SearchFlights().search, f, top_n=2, peticiones=3) or []:
                ida, vuelta = combo[0], combo[-1]
                if vuelta.price is None or ida.self_transfer or vuelta.self_transfer:
                    continue
                tr_ida, tr_vuelta = _a_trayecto(ida), _a_trayecto(vuelta)
                aerolineas_ida = {t.aerolinea for t in tr_ida.tramos}
                aerolineas_vuelta = {t.aerolinea for t in tr_vuelta.tramos}
                opciones.append(
                    Opcion(
                        fuente=self.nombre,
                        ida=tr_ida,
                        vuelta=tr_vuelta,
                        precio_billetes=float(vuelta.price),
                        # Si no comparten aerolínea, Google lo vende como dos billetes
                        billetes_separados=not (aerolineas_ida & aerolineas_vuelta),
                    )
                )

        # Billetes de solo ida (y vuelta por separado): en low cost suele salir más barato
        mejor = {}
        for sentido, fecha in (("ida", fecha_ida), ("vuelta", fecha_vuelta)):
            if fecha is None:
                continue
            validos = []
            for r in self._solo_ida(b, sentido, fecha):
                if r.price is None or r.self_transfer:
                    continue
                tr = _a_trayecto(r)
                if validador.sentido(tr, sentido) is None:
                    validos.append((float(r.price), tr))
            if not validos:
                mejor = {}
                break
            mejor[sentido] = min(validos, key=lambda x: x[0])
        if "ida" in mejor and (fecha_vuelta is None or "vuelta" in mejor):
            precio_ida, tr_ida = mejor["ida"]
            precio_vuelta, tr_vuelta = mejor.get("vuelta", (0.0, None))
            opciones.append(
                Opcion(
                    fuente=self.nombre,
                    ida=tr_ida,
                    vuelta=tr_vuelta,
                    precio_billetes=precio_ida + precio_vuelta,
                    billetes_separados=tr_vuelta is not None,
                )
            )
        return opciones

    # ------------------------------------------------------------------
    # Punto de entrada por búsqueda
    # ------------------------------------------------------------------
    @staticmethod
    def nueva_sesion_privada() -> None:
        """Descarta la sesión HTTP anterior (y sus cookies): cada búsqueda empieza de cero."""
        get_client()._sessions = threading.local()

    def buscar(self, b: dict, validador: filtros.Validador) -> ResultadoFuente:
        self.nueva_sesion_privada()
        antes = self.peticiones
        res = ResultadoFuente()
        if b["modo"] == "fechas":
            fi = date.fromisoformat(str(b["fecha_ida"]))
            fv = date.fromisoformat(str(b["fecha_vuelta"])) if b.get("ida_vuelta") else None
            noches = (fv - fi).days if fv else None
            flex = b.get("flex_dias") or 0
            # Calendario de ±7 días: sirve para saber qué es "habitual" y para elegir fechas si hay margen
            if noches != 0:
                res.calendario = self.calendario(b, fi - timedelta(days=7), fi + timedelta(days=7), noches)
            pares = [(fi, fv)]
            if flex and res.calendario:
                en_margen = sorted(
                    (c for c in res.calendario if abs((c.fecha_ida - fi).days) <= flex), key=lambda c: c.precio
                )
                pares = [(c.fecha_ida, c.fecha_vuelta) for c in en_margen[:2]] or pares
        else:
            desde = date.fromisoformat(str(b["chollo_desde"]))
            hasta = date.fromisoformat(str(b["chollo_hasta"]))
            if b.get("ida_vuelta"):
                n_min, n_max = b["noches_min"], b["noches_max"]
                for noches in sorted({n_min, (n_min + n_max) // 2, n_max}):
                    res.calendario += self.calendario(b, desde, hasta - timedelta(days=noches), noches)
            else:
                res.calendario = self.calendario(b, desde, hasta, None)
            mas_baratos = sorted(res.calendario, key=lambda c: c.precio)
            pares, vistos = [], set()
            for c in mas_baratos:
                if (c.fecha_ida, c.fecha_vuelta) not in vistos:
                    vistos.add((c.fecha_ida, c.fecha_vuelta))
                    pares.append((c.fecha_ida, c.fecha_vuelta))
                if len(pares) == 2:
                    break

        hoy = date.today()
        for fi, fv in pares:
            if fi < hoy:
                continue
            res.opciones += self.vuelos(b, fi, fv, validador)
        res.peticiones = self.peticiones - antes
        return res
