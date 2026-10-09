"""Estructuras de datos comunes a todas las fuentes."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class Tramo:
    """Un vuelo concreto (un despegue y un aterrizaje). Horas locales de cada aeropuerto."""

    aerolinea: str  # código IATA de quien vende el vuelo
    numero: str
    origen: str
    destino: str
    salida: datetime
    llegada: datetime
    operadora: str | None = None  # código IATA de quien opera el avión (si se conoce)

    @property
    def opera(self) -> str:
        return self.operadora or self.aerolinea

    def a_dict(self) -> dict:
        return {
            "aerolinea": self.aerolinea,
            "operadora": self.operadora,
            "numero": self.numero,
            "origen": self.origen,
            "destino": self.destino,
            "salida": self.salida.isoformat(timespec="minutes"),
            "llegada": self.llegada.isoformat(timespec="minutes"),
        }


@dataclass
class Trayecto:
    """La ida o la vuelta: uno o varios tramos encadenados."""

    tramos: list[Tramo]

    @property
    def origen(self) -> str:
        return self.tramos[0].origen

    @property
    def destino(self) -> str:
        return self.tramos[-1].destino

    @property
    def salida(self) -> datetime:
        return self.tramos[0].salida

    @property
    def llegada(self) -> datetime:
        return self.tramos[-1].llegada

    @property
    def fecha(self) -> date:
        return self.salida.date()

    @property
    def escalas(self) -> int:
        return len(self.tramos) - 1

    @property
    def esperas_min(self) -> list[int]:
        """Minutos de espera en cada escala."""
        return [
            int((b.salida - a.llegada).total_seconds() // 60)
            for a, b in zip(self.tramos, self.tramos[1:])
        ]

    def a_dict(self) -> dict:
        return {"tramos": [t.a_dict() for t in self.tramos], "escalas": self.escalas}


@dataclass
class Opcion:
    """Una forma concreta de hacer el viaje, con su precio total para todos los pasajeros."""

    fuente: str
    ida: Trayecto
    vuelta: Trayecto | None
    precio_billetes: float  # total de billetes de todos los pasajeros, en euros
    billetes_separados: bool = False  # ida y vuelta se compran por separado
    precio_maletas: float = 0.0
    maletas_estimadas: bool = False
    descuento: float = 0.0
    descuento_detalle: str = ""
    precio_total: float = 0.0
    desglose_maletas: list[str] = field(default_factory=list)
    notas: list[str] = field(default_factory=list)

    @property
    def trayectos(self) -> list[Trayecto]:
        return [self.ida] + ([self.vuelta] if self.vuelta else [])

    @property
    def tramos(self) -> list[Tramo]:
        return [t for tr in self.trayectos for t in tr.tramos]

    @property
    def vuelta_a_otro_aeropuerto(self) -> bool:
        """Sales de un aeropuerto (p. ej. Jerez) y la vuelta llega a otro (p. ej. Sevilla)."""
        return self.vuelta is not None and self.vuelta.destino != self.ida.origen

    @property
    def clave(self) -> tuple:
        """Identifica el itinerario para no repetir la misma opción de dos fuentes."""
        return tuple((t.aerolinea, t.numero, t.salida.isoformat()) for t in self.tramos)

    def a_dict(self) -> dict:
        return {
            "fuente": self.fuente,
            "ida": self.ida.a_dict(),
            "vuelta": self.vuelta.a_dict() if self.vuelta else None,
            "billetes_separados": self.billetes_separados,
            "vuelta_a_otro_aeropuerto": self.vuelta_a_otro_aeropuerto,
            "precio_billetes": round(self.precio_billetes, 2),
            "precio_maletas": round(self.precio_maletas, 2),
            "maletas_estimadas": self.maletas_estimadas,
            "desglose_maletas": self.desglose_maletas,
            "descuento": round(self.descuento, 2),
            "descuento_detalle": self.descuento_detalle,
            "precio_total": round(self.precio_total, 2),
            "notas": self.notas,
        }


@dataclass
class PrecioCalendario:
    """Precio de billetes (sin maletas) de una combinación de fechas, sin detalle de vuelos."""

    fecha_ida: date
    fecha_vuelta: date | None
    precio: float


@dataclass
class ResultadoFuente:
    """Lo que una fuente ha encontrado para una búsqueda en esta ronda."""

    opciones: list[Opcion] = field(default_factory=list)
    calendario: list[PrecioCalendario] = field(default_factory=list)
    peticiones: int = 0
    error: str | None = None


class ErrorExplicado(Exception):
    """Fallo con el mensaje ya escrito para ti: la web lo muestra tal cual, sin nombres técnicos."""


class FuenteBloqueada(Exception):
    """La web ha bloqueado al robot (CAPTCHA, 403, 429...). No se intenta saltar el bloqueo."""
