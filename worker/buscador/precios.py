"""Precio final de cada opción: billetes + maletas − descuentos, para todos los pasajeros.

Regla de oro: si no se conoce un precio exacto se usa el MÁXIMO estimado, para que el
robot nunca te avise de un total por debajo del real (y tu presupuesto se respete siempre).
"""

from __future__ import annotations

from . import aeropuertos
from .modelos import Opcion

# Tasas aeroportuarias que se restan antes de aplicar el % de descuento (que solo se aplica
# a la tarifa). Se usa un valor alto a propósito: así el descuento estimado nunca se pasa.
TASAS_POR_PASAJERO_Y_VUELO = 20.0

# Si una aerolínea no tuviera datos de maletas (no debería pasar con la lista blanca)
MALETA_DESCONOCIDA = {"cabina_max": 60.0, "facturada": 130.0}

CAMPO_FACTURADA = {
    "nacional": "facturada_nacional_max",
    "europa": "facturada_europa_max",
    "largo": "facturada_largo_max",
}

# Descuentos oficiales en vuelos nacionales (sobre la tarifa, sin tasas)
DESCUENTO_FAMILIA = {"general": 0.05, "especial": 0.10}
DESCUENTO_RESIDENTE = {"ninguna": 0.75, "general": 0.80, "especial": 0.85}


def coste_maletas(opcion: Opcion, busqueda: dict, aerolineas: dict[str, dict]) -> tuple[float, list[str]]:
    """Coste máximo estimado de las maletas de todos los pasajeros, en todos los vuelos."""
    n_cabina = busqueda.get("maletas_cabina") or 0
    n_20kg = busqueda.get("maletas_20kg") or 0
    if not (n_cabina or n_20kg):
        return 0.0, []

    zona = aeropuertos.tipo_ruta(busqueda["origen"], busqueda["destino"])
    campo = CAMPO_FACTURADA[zona]
    total = 0.0
    desglose: list[str] = []
    for sentido, trayecto in (("Ida", opcion.ida), ("Vuelta", opcion.vuelta)):
        if trayecto is None:
            continue
        # Cuántas veces cobra cada aerolínea: por vuelo ('tramo') o una vez por trayecto
        cobros: dict[str, int] = {}
        for tramo in trayecto.tramos:
            a = aerolineas.get(tramo.aerolinea, {})
            if a.get("cobra_por", "tramo") == "trayecto":
                cobros[tramo.aerolinea] = 1
            else:
                cobros[tramo.aerolinea] = cobros.get(tramo.aerolinea, 0) + 1
        for codigo, veces in cobros.items():
            a = aerolineas.get(codigo, {})
            precio_cabina = float(a.get("cabina_max", MALETA_DESCONOCIDA["cabina_max"]))
            precio_20kg = float(a.get(campo, MALETA_DESCONOCIDA["facturada"]))
            coste = veces * (n_cabina * precio_cabina + n_20kg * precio_20kg)
            if coste <= 0:
                continue
            total += coste
            partes = []
            if n_cabina:
                partes.append(f"{n_cabina} cabina × {precio_cabina:.2f} €")
            if n_20kg:
                partes.append(f"{n_20kg} de 20 kg × {precio_20kg:.2f} €")
            veces_txt = f" × {veces} vuelos" if veces > 1 else ""
            desglose.append(
                f"{sentido} ({a.get('nombre', codigo)}): ({' + '.join(partes)}){veces_txt} = {coste:.2f} €"
            )
    return round(total, 2), desglose


def porcentaje_descuento(opcion: Opcion, busqueda: dict, perfil: dict | None) -> tuple[float, str]:
    """Descuento de residente o de familia numerosa (solo vuelos dentro de España)."""
    if not perfil or busqueda.get("aplicar_descuentos") is False:
        return 0.0, ""
    if not all(aeropuertos.es_espana(t.origen) and aeropuertos.es_espana(t.destino) for t in opcion.tramos):
        return 0.0, ""

    familia = perfil.get("familia_numerosa") or "ninguna"
    residente = perfil.get("residente") or "ninguno"
    region = aeropuertos.REGION_RESIDENTE.get(residente)
    if region and region in (
        aeropuertos.region(busqueda["origen"]),
        aeropuertos.region(busqueda["destino"]),
    ):
        pct = DESCUENTO_RESIDENTE[familia]
        etiqueta = "Residente" + (f" + familia numerosa {familia}" if familia != "ninguna" else "")
        return pct, etiqueta
    if familia in DESCUENTO_FAMILIA:
        return DESCUENTO_FAMILIA[familia], f"Familia numerosa {familia}"
    return 0.0, ""


def calcular(opcion: Opcion, busqueda: dict, perfil: dict | None, aerolineas: dict[str, dict]) -> Opcion:
    """Rellena maletas, descuento y precio total de la opción (la modifica y la devuelve)."""
    opcion.precio_maletas, opcion.desglose_maletas = coste_maletas(opcion, busqueda, aerolineas)
    opcion.maletas_estimadas = opcion.precio_maletas > 0

    pct, etiqueta = porcentaje_descuento(opcion, busqueda, perfil)
    if pct:
        pasajeros = (busqueda.get("adultos") or 1) + (busqueda.get("ninos") or 0)
        tasas = TASAS_POR_PASAJERO_Y_VUELO * pasajeros * len(opcion.tramos)
        base = max(0.0, opcion.precio_billetes - tasas)
        opcion.descuento = round(base * pct, 2)
        opcion.descuento_detalle = f"{etiqueta}: {pct * 100:.0f} % sobre la tarifa sin tasas (estimado)"
    else:
        opcion.descuento = 0.0
        opcion.descuento_detalle = ""

    opcion.precio_total = round(opcion.precio_billetes + opcion.precio_maletas - opcion.descuento, 2)
    return opcion
