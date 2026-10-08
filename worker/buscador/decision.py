"""¿Es el momento de avisar para comprar?

Basado en la investigación (docs/INVESTIGACION.md):
- Ventana más barata: nacional ~3-9 semanas antes, Europa ~4-10, larga distancia ~7-19.
- En las 3 últimas semanas el precio casi siempre sube (Ryanair: +50-75 % en los últimos días).
- Nadie conoce el mínimo futuro: se avisa cuando el precio es el más bajo visto o está en la
  zona baja de lo habitual para fechas cercanas, y siempre antes de entrar en las 3 últimas semanas.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from statistics import median

from . import aeropuertos
from .modelos import Opcion

# Días antes de la salida en los que suele estar lo más barato (inicio, fin)
VENTANA_OPTIMA = {"nacional": (21, 60), "europa": (28, 70), "largo": (50, 135)}
DIAS_VIAJE_PROXIMO = 21  # menos de 3 semanas: avisar ya con lo mejor que haya
DIAS_AVISO_FINAL = 24  # último aviso antes de entrar en las 3 últimas semanas
BAJADA_MINIMA_PCT = 0.05  # volver a avisar si baja al menos un 5 %...
BAJADA_MINIMA_EUR = 10.0  # ...o al menos 10 €
# Con revisiones cada pocos minutos, un "mínimo" de la última hora no dice nada:
# para darlo por bueno hace falta haber observado el precio durante un tiempo.
HORAS_PARA_MINIMO = 6
HORAS_PARA_CHOLLO_ANTICIPADO = 24


@dataclass
class Decision:
    avisar: bool
    tipo: str = ""
    titulo: str = ""
    motivo: str = ""
    # True si el aviso cuenta como "precio avisado" (para no repetir salvo bajadas)
    fija_precio: bool = True
    contexto: dict = field(default_factory=dict)


def _percentil(valores: list[float], p: float) -> float:
    datos = sorted(valores)
    if not datos:
        raise ValueError("sin datos")
    k = (len(datos) - 1) * p / 100
    f = int(k)
    c = min(f + 1, len(datos) - 1)
    return datos[f] + (datos[c] - datos[f]) * (k - f)


def _eur(x: float) -> str:
    return f"{x:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def decidir(
    busqueda: dict,
    mejor: Opcion | None,
    historial: list[float],
    calendario: list[float],
    hoy: date,
    horas_historial: float = 0.0,
) -> Decision:
    """historial: mejores totales de revisiones anteriores (antiguo → reciente).
    calendario: precios de billetes (sin maletas) de fechas cercanas o del rango del chollo.
    horas_historial: cuántas horas abarca el historial (de la primera revisión a la última)."""
    contexto: dict = {}
    if historial:
        contexto["minimo_visto"] = min(historial)
    if len(calendario) >= 5:
        contexto["habitual"] = (round(_percentil(calendario, 25)), round(_percentil(calendario, 75)))

    modo_fechas = busqueda["modo"] == "fechas"
    dias = None
    if modo_fechas:
        dias = (date.fromisoformat(str(busqueda["fecha_ida"])) - hoy).days
        contexto["dias"] = dias

    if mejor is None:
        # Ningún vuelo cumple los filtros (aeropuertos, horarios, escalas, aerolíneas)
        return Decision(False, contexto=contexto)

    total = mejor.precio_total
    ultimo = busqueda.get("ultimo_aviso_precio")
    ultimo = float(ultimo) if ultimo is not None else None

    # --- Ya se avisó antes: solo se vuelve a avisar si baja de verdad ---
    if ultimo is not None:
        if total <= ultimo * (1 - BAJADA_MINIMA_PCT) or ultimo - total >= BAJADA_MINIMA_EUR:
            return Decision(
                True, "bajada", "📉 ¡Ha bajado todavía más!",
                f"El precio ha bajado de {_eur(ultimo)} a {_eur(total)} desde el último aviso.",
                contexto=contexto,
            )
        return Decision(False, contexto=contexto)

    # --- Modo presupuesto: avisar en cuanto algo no supere el máximo ---
    if busqueda.get("modo_precio") == "presupuesto":
        presupuesto = float(busqueda["presupuesto"])
        if total <= presupuesto:
            return Decision(
                True, "presupuesto", "✅ ¡Dentro de tu presupuesto!",
                f"Total {_eur(total)} para todos, sin pasar de tu máximo de {_eur(presupuesto)}.",
                contexto=contexto,
            )
        if modo_fechas and dias is not None and dias <= DIAS_AVISO_FINAL and not busqueda.get("aviso_final_enviado"):
            return Decision(
                True, "sin_presupuesto", "⚠️ Aún no hay nada dentro de tu presupuesto",
                f"Faltan {dias} días y a partir de ahora el precio suele subir. Lo más barato que "
                f"cumple tus filtros cuesta {_eur(total)} (tu máximo: {_eur(presupuesto)}). "
                "Sigo vigilando por si baja.",
                fija_precio=False, contexto=contexto,
            )
        return Decision(False, contexto=contexto)

    # --- Modo chollo (cualquier fecha) y "lo más barato posible" ---
    if not modo_fechas:
        if len(calendario) >= 5:
            mediana = median(calendario)
            umbral = min(_percentil(calendario, 20), mediana * 0.80)
            if mejor.precio_billetes <= umbral:
                return Decision(
                    True, "chollo", "🔥 ¡Chollo encontrado!",
                    f"Billetes a {_eur(mejor.precio_billetes)}, al menos un 20 % por debajo del precio "
                    f"normal de esta ruta en tus fechas (mediana {_eur(mediana)}).",
                    contexto=contexto,
                )
        if len(historial) >= 4 and horas_historial >= HORAS_PARA_MINIMO and total <= median(historial) * 0.80:
            return Decision(
                True, "chollo", "🔥 ¡Chollo encontrado!",
                f"{_eur(total)}: un 20 % por debajo de lo que he visto hasta ahora en esta ruta.",
                contexto=contexto,
            )
        return Decision(False, contexto=contexto)

    # --- Modo fechas y "lo más barato posible" ---
    if dias <= DIAS_VIAJE_PROXIMO:
        return Decision(
            True, "proximo", "⏰ Viaje próximo: mejor opción ahora",
            f"Sales en {dias} días. A partir de ahora el precio casi siempre sube, así que esta es "
            "la mejor opción que hay. Te avisaré si baja.",
            contexto=contexto,
        )
    if dias <= DIAS_AVISO_FINAL:
        return Decision(
            True, "final", "⏳ Último aviso recomendado",
            f"Faltan {dias} días: en las próximas 3 semanas el precio suele subir. Es buen momento para comprar.",
            contexto=contexto,
        )

    zona = aeropuertos.tipo_ruta(busqueda["origen"], busqueda["destino"])
    _, fin_ventana = VENTANA_OPTIMA[zona]
    referencia_baja = _percentil(calendario, 25) if len(calendario) >= 5 else None
    minimo = min(historial) if historial else None

    if dias <= fin_ventana:
        if len(historial) >= 2 and horas_historial >= HORAS_PARA_MINIMO and total <= minimo:
            return Decision(
                True, "buen_momento", "✅ Buen momento para comprar",
                f"Es el precio más bajo de las últimas {round(horas_historial)} h de vigilancia y estás en la ventana en la que "
                f"los vuelos suelen estar más baratos ({dias} días antes).",
                contexto=contexto,
            )
        if referencia_baja is not None and mejor.precio_billetes <= referencia_baja:
            return Decision(
                True, "buen_momento", "✅ Buen momento para comprar",
                f"Está en la zona baja de lo habitual para fechas cercanas y estás en la ventana "
                f"más barata ({dias} días antes).",
                contexto=contexto,
            )
        return Decision(False, contexto=contexto)

    # Todavía es pronto: solo se avisa si es algo excepcional
    if len(historial) >= 6 and horas_historial >= HORAS_PARA_CHOLLO_ANTICIPADO and total <= median(historial) * 0.80:
        return Decision(
            True, "chollo", "🔥 Chollo anticipado",
            f"Aún es pronto ({dias} días), pero {_eur(total)} está un 20 % por debajo de lo que he visto.",
            contexto=contexto,
        )
    if len(calendario) >= 10 and mejor.precio_billetes <= median(calendario) * 0.75:
        return Decision(
            True, "chollo", "🔥 Chollo anticipado",
            f"Aún es pronto ({dias} días), pero los billetes están un 25 % por debajo de lo normal "
            "en fechas cercanas.",
            contexto=contexto,
        )
    return Decision(False, contexto=contexto)


# Cada cuántos minutos se revisa una búsqueda (el robot funciona sin parar).
# Las aerolíneas cambian precios varias veces al día: revisar más a menudo no aporta más
# información y solo haría que Google bloquease al robot.
REVISION_PROXIMO_MIN = 20  # viaje en menos de 3 semanas
REVISION_MEDIO_MIN = 40  # viaje en menos de 2 meses
REVISION_LEJANO_MIN = 90  # viaje en más de 2 meses
REVISION_CHOLLO_MIN = 60  # chollo (cada revisión mira 8 fechas)


def minutos_hasta_siguiente_revision(busqueda: dict, hoy: date) -> int:
    """Cuanto más cerca está el viaje, más a menudo se revisa."""
    if busqueda["modo"] != "fechas":
        return REVISION_CHOLLO_MIN
    dias = (date.fromisoformat(str(busqueda["fecha_ida"])) - hoy).days
    if dias <= DIAS_VIAJE_PROXIMO:
        return REVISION_PROXIMO_MIN
    if dias <= 60:
        return REVISION_MEDIO_MIN
    return REVISION_LEJANO_MIN
