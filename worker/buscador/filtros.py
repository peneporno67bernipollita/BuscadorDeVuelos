"""Filtros que debe cumplir cada opción: aeropuertos exactos, horarios, escalas y aerolíneas."""

from __future__ import annotations

from collections.abc import Collection

from .modelos import Opcion, Trayecto

MINUTOS_DIA = 24 * 60
MAX_AEROPUERTOS = 4  # por lado (el principal y hasta 3 alternativos)


def aeropuertos_busqueda(busqueda: dict) -> tuple[list[str], list[str]]:
    """Aeropuertos de salida (el principal y los alternativos que añadas en la web, p. ej. Jerez o Sevilla)
    y el de llegada, que es siempre uno. La vuelta llega a cualquiera de los de salida: lo ideal es el mismo
    del que sales, pero si volver al otro sale más barato también se busca (y se indica)."""
    origenes = [busqueda["origen"], *(busqueda.get("origenes_extra") or [])]
    origenes = [c for c in dict.fromkeys(origenes) if c != busqueda["destino"]]
    return origenes[:MAX_AEROPUERTOS], [busqueda["destino"]]


def _lista(codigos: str | Collection[str]) -> list[str]:
    return [codigos] if isinstance(codigos, str) else list(codigos)


def _minutos_desde_medianoche(trayecto: Trayecto, momento) -> int:
    """Minutos desde la medianoche del día de salida (una llegada al día siguiente supera 1440)."""
    dias = (momento.date() - trayecto.salida.date()).days
    return dias * MINUTOS_DIA + momento.hour * 60 + momento.minute


def _en_franja(minutos: int, hora_min: int, hora_max: int) -> bool:
    if minutos < hora_min * 60:
        return False
    if hora_max >= 24:  # 24 = sin límite superior
        return True
    return minutos <= hora_max * 60


def franja(busqueda: dict, sentido: str) -> tuple[int, int, int, int]:
    """(salida_min, salida_max, llegada_min, llegada_max) en horas para 'ida' o 'vuelta'."""

    def valor(campo: str, defecto: int) -> int:
        v = busqueda.get(f"{sentido}_{campo}")
        return defecto if v is None else int(v)

    return valor("salida_min", 0), valor("salida_max", 24), valor("llegada_min", 0), valor("llegada_max", 24)


def validar_trayecto(
    trayecto: Trayecto,
    origen: str | Collection[str],
    destino: str | Collection[str],
    franja_horas: tuple[int, int, int, int],
    escalas_max: int,
    espera_max_min: int,
) -> str | None:
    """Devuelve el motivo de rechazo, o None si el trayecto es válido.
    origen/destino: un aeropuerto o varios (vale cualquiera de ellos)."""
    origenes, destinos = _lista(origen), _lista(destino)
    if trayecto.origen not in origenes:
        return f"sale de {trayecto.origen} y no de {' / '.join(origenes)}"
    if trayecto.destino not in destinos:
        return f"llega a {trayecto.destino} y no a {' / '.join(destinos)}"
    for a, b in zip(trayecto.tramos, trayecto.tramos[1:]):
        if a.destino != b.origen:
            return f"cambio de aeropuerto en la escala ({a.destino} → {b.origen})"
    if trayecto.escalas > escalas_max:
        return f"{trayecto.escalas} escalas (máximo {escalas_max})"
    esperas = trayecto.esperas_min
    if esperas and min(esperas) < 0:
        return "escala con horas incoherentes"
    if esperas and max(esperas) > espera_max_min:
        return f"escala de {max(esperas) // 60} h {max(esperas) % 60} min (máximo {espera_max_min // 60} h)"
    sal_min, sal_max, lle_min, lle_max = franja_horas
    salida = _minutos_desde_medianoche(trayecto, trayecto.salida)
    if not _en_franja(salida, sal_min, sal_max):
        return f"sale a las {trayecto.salida:%H:%M}, fuera de tu franja {sal_min}-{sal_max} h"
    llegada = _minutos_desde_medianoche(trayecto, trayecto.llegada)
    if not _en_franja(llegada, lle_min, lle_max):
        dia = " (día siguiente)" if llegada >= MINUTOS_DIA else ""
        return f"llega a las {trayecto.llegada:%H:%M}{dia}, fuera de tu franja {lle_min}-{lle_max} h"
    return None


def validar_aerolineas(opcion: Opcion, aerolineas: dict[str, dict]) -> str | None:
    """Tanto quien vende como quien opera cada vuelo deben estar en la lista blanca."""
    for t in opcion.tramos:
        for codigo, papel in ((t.aerolinea, "vende"), (t.opera, "opera")):
            a = aerolineas.get(codigo)
            if not a:
                return f"{codigo} ({papel} el vuelo {t.aerolinea}{t.numero}) no está en tu lista blanca"
            if not a.get("permitida"):
                return f"{a['nombre']} está bloqueada en tu lista de aerolíneas"
    return None


class Validador:
    """Aplica todos los filtros de una búsqueda."""

    def __init__(self, busqueda: dict, aerolineas: dict[str, dict]):
        self.b = busqueda
        self.aerolineas = aerolineas
        self.escalas_max = busqueda.get("escalas_max", 1)
        self.espera_max = (busqueda.get("escala_max_horas") or 6) * 60

    def sentido(self, trayecto: Trayecto, sentido: str) -> str | None:
        """Valida solo la ida o solo la vuelta (para combinar billetes de solo ida)."""
        # La vuelta sale de uno de tus aeropuertos de llegada y vuelve a uno de los de salida.
        origenes, destinos = aeropuertos_busqueda(self.b)
        o, d = (origenes, destinos) if sentido == "ida" else (destinos, origenes)
        motivo = validar_trayecto(trayecto, o, d, franja(self.b, sentido), self.escalas_max, self.espera_max)
        if motivo:
            return ("Ida: " if sentido == "ida" else "Vuelta: ") + motivo
        return validar_aerolineas(Opcion(fuente="", ida=trayecto, vuelta=None, precio_billetes=0), self.aerolineas)

    def opcion(self, opcion: Opcion) -> str | None:
        motivo = self.sentido(opcion.ida, "ida")
        if motivo:
            return motivo
        if self.b.get("ida_vuelta"):
            if not opcion.vuelta:
                return "falta la vuelta"
            motivo = self.sentido(opcion.vuelta, "vuelta")
            if motivo:
                return motivo
            if opcion.vuelta.salida <= opcion.ida.llegada:
                return "la vuelta sale antes de llegar la ida"
        return None
