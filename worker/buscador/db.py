"""Acceso mínimo a Supabase (API REST de PostgREST) con la clave de servicio del robot."""

from __future__ import annotations

import httpx


class Supabase:
    def __init__(self, url: str, clave_servicio: str):
        # Acepta la URL del proyecto con o sin "/rest/v1" al final
        base = url.strip().rstrip("/")
        if base.endswith("/rest/v1"):
            base = base[: -len("/rest/v1")]
        self.base = base + "/rest/v1"
        cabeceras = {"apikey": clave_servicio, "Content-Type": "application/json"}
        # Las claves nuevas (sb_secret_...) no son JWT y solo van en "apikey";
        # la antigua service_role (JWT) también debe ir como Bearer.
        if not clave_servicio.startswith("sb_"):
            cabeceras["Authorization"] = f"Bearer {clave_servicio}"
        self.http = httpx.Client(headers=cabeceras, timeout=30)

    def _revisar(self, r: httpx.Response) -> httpx.Response:
        if r.status_code >= 400:
            raise RuntimeError(f"Supabase {r.request.method} {r.request.url.path}: {r.status_code} {r.text[:300]}")
        return r

    def leer(self, tabla: str, **params) -> list[dict]:
        params.setdefault("select", "*")
        return self._revisar(self.http.get(f"{self.base}/{tabla}", params=params)).json()

    def insertar(self, tabla: str, filas: dict | list[dict], devolver: bool = False) -> list[dict]:
        cabeceras = {"Prefer": "return=representation" if devolver else "return=minimal"}
        r = self._revisar(self.http.post(f"{self.base}/{tabla}", json=filas, headers=cabeceras))
        return r.json() if devolver else []

    def actualizar(self, tabla: str, filtros: dict, valores: dict) -> None:
        self._revisar(self.http.patch(f"{self.base}/{tabla}", params=filtros, json=valores))

    def guardar(self, tabla: str, filas: dict | list[dict]) -> None:
        """Inserta o actualiza por clave primaria."""
        cabeceras = {"Prefer": "resolution=merge-duplicates,return=minimal"}
        self._revisar(self.http.post(f"{self.base}/{tabla}", json=filas, headers=cabeceras))
