"""Fecha y hora de referencia del robot: siempre la de España, aunque el servidor esté en UTC."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

ZONA = ZoneInfo("Europe/Madrid")


def hoy() -> date:
    return datetime.now(ZONA).date()
