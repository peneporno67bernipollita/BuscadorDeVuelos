"""Datos de aeropuertos (país, región) y tipo de ruta."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

RUTA_DATOS = Path(__file__).resolve().parents[2] / "web" / "data" / "aeropuertos.json"

# Regiones con descuento de residente (código ISO de región de OurAirports)
REGION_RESIDENTE = {"canarias": "ES-CN", "baleares": "ES-IB", "melilla": "ES-ML"}


@lru_cache(maxsize=1)
def _todos() -> dict[str, dict]:
    datos = json.loads(RUTA_DATOS.read_text(encoding="utf-8"))
    return {a["c"]: a for a in datos}


def info(codigo: str) -> dict | None:
    return _todos().get(codigo.upper())


def existe(codigo: str) -> bool:
    return info(codigo) is not None


def nombre(codigo: str) -> str:
    a = info(codigo)
    if not a:
        return codigo
    # Nombre en español si lo hay (p. ej. "París Orly"); si no, la ciudad
    ciudad = a.get("es") or a.get("m") or a.get("n")
    return f"{ciudad} ({codigo})"


def pais(codigo: str) -> str | None:
    a = info(codigo)
    return a["p"] if a else None


def region(codigo: str) -> str | None:
    a = info(codigo)
    return a["r"] if a else None


def es_espana(codigo: str) -> bool:
    return pais(codigo) == "ES"


def _es_europa(codigo: str) -> bool:
    a = info(codigo)
    # Canarias figura como "África" en los datos, pero es España
    return bool(a) and (a["co"] == "EU" or a["p"] == "ES")


def tipo_ruta(origen: str, destino: str) -> str:
    """'nacional' (España-España), 'europa' o 'largo'."""
    if es_espana(origen) and es_espana(destino):
        return "nacional"
    if _es_europa(origen) and _es_europa(destino):
        return "europa"
    return "largo"
