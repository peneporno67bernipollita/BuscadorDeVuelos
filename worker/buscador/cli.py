"""Prueba una búsqueda desde tu PC, sin base de datos ni Telegram.

Ejemplos (desde la carpeta worker/):
    python -m buscador.cli SVQ ORY --ida 2026-11-15 --vuelta 2026-11-19 --adultos 2 --facturada 1
    python -m buscador.cli SVQ BVA --chollo 2026-11-01:2027-01-31 --noches 3-5 --presupuesto 120
    python -m buscador.cli MAD PMI --ida 2026-12-04 --vuelta 2026-12-08 --familia general --fuentes google_flights
"""

from __future__ import annotations

import argparse
import json
import logging
import uuid
from datetime import date
from pathlib import Path

from . import enlaces
from .avisos import eur, mensaje_aviso
from .decision import decidir
from .filtros import Validador
from .nucleo import consultar, crear_fuentes, evaluar

DATOS = Path(__file__).resolve().parent / "datos" / "aerolineas.json"
CONFIG = {
    "google_flights": {"pausa_min_s": 6, "pausa_max_s": 16, "max_peticiones": 60},
    "ryanair": {"pausa_min_s": 120, "pausa_max_s": 140, "max_peticiones": 3},
    "skyscanner": {"pausa_min_s": 30, "pausa_max_s": 60, "max_peticiones": 2},
}


def _franja(texto: str | None) -> tuple[int, int]:
    if not texto:
        return 0, 24
    a, b = texto.split("-")
    return int(a), int(b)


def main() -> None:
    p = argparse.ArgumentParser(description="Prueba una búsqueda de vuelos")
    p.add_argument("origen")
    p.add_argument("destino")
    p.add_argument("--ida", help="AAAA-MM-DD (modo fechas)")
    p.add_argument("--vuelta", help="AAAA-MM-DD (si es ida y vuelta)")
    p.add_argument("--flex", type=int, default=0, help="± días de margen (0-3)")
    p.add_argument("--chollo", help="DESDE:HASTA (modo chollo, cualquier fecha del rango)")
    p.add_argument("--noches", help="MIN-MAX noches (chollo de ida y vuelta)")
    p.add_argument("--solo-ida", action="store_true")
    p.add_argument("--adultos", type=int, default=1)
    p.add_argument("--ninos", type=int, default=0)
    p.add_argument("--bebes", type=int, default=0)
    p.add_argument("--cabina", type=int, default=0, help="nº de maletas de cabina (10 kg)")
    p.add_argument("--facturada", type=int, default=0, help="nº de maletas facturadas de 20 kg")
    p.add_argument("--escalas", type=int, default=1)
    p.add_argument("--espera-max", type=int, default=6, help="horas máximas de escala")
    p.add_argument("--ida-salida", help="franja H-H, p. ej. 6-14")
    p.add_argument("--ida-llegada", help="franja H-H")
    p.add_argument("--vuelta-salida", help="franja H-H")
    p.add_argument("--vuelta-llegada", help="franja H-H")
    p.add_argument("--presupuesto", type=float, help="total máximo para todos (si no, 'lo más barato')")
    p.add_argument("--familia", choices=["ninguna", "general", "especial"], default="ninguna")
    p.add_argument("--residente", choices=["ninguno", "canarias", "baleares", "melilla"], default="ninguno")
    p.add_argument("--fuentes", default="google_flights,ryanair")
    p.add_argument("--json", action="store_true", help="salida en JSON")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    ida_vuelta = not a.solo_ida and (bool(a.vuelta) or bool(a.chollo and a.noches))
    b = {
        "id": str(uuid.uuid4()), "usuario": "local", "nombre": f"{a.origen}-{a.destino} (prueba)",
        "modo": "chollo" if a.chollo else "fechas", "ida_vuelta": ida_vuelta,
        "origen": a.origen.upper(), "destino": a.destino.upper(),
        "fecha_ida": a.ida, "fecha_vuelta": a.vuelta, "flex_dias": a.flex,
        "adultos": a.adultos, "ninos": a.ninos, "bebes": a.bebes,
        "maletas_cabina": a.cabina, "maletas_20kg": a.facturada,
        "escalas_max": a.escalas, "escala_max_horas": a.espera_max,
        "modo_precio": "presupuesto" if a.presupuesto else "mas_barato", "presupuesto": a.presupuesto,
        "aplicar_descuentos": True, "info": {},
    }
    if a.chollo:
        b["chollo_desde"], b["chollo_hasta"] = a.chollo.split(":")
        if a.noches:
            b["noches_min"], b["noches_max"] = map(int, a.noches.split("-"))
    for sentido, salida, llegada in (("ida", a.ida_salida, a.ida_llegada), ("vuelta", a.vuelta_salida, a.vuelta_llegada)):
        b[f"{sentido}_salida_min"], b[f"{sentido}_salida_max"] = _franja(salida)
        b[f"{sentido}_llegada_min"], b[f"{sentido}_llegada_max"] = _franja(llegada)

    aerolineas = {x["codigo"]: x for x in json.loads(DATOS.read_text(encoding="utf-8"))}
    perfil = {"familia_numerosa": a.familia, "residente": a.residente}
    nombres = [n.strip() for n in a.fuentes.split(",") if n.strip()]
    fuentes = crear_fuentes(nombres, CONFIG, aerolineas)
    resultados, estado = consultar(
        fuentes, {n: [b] for n in fuentes}, {b["id"]: Validador(b, aerolineas)}, CONFIG, 15 * 60
    )
    validas, rechazos, calendario = evaluar(b, resultados.get(b["id"], {}), perfil, aerolineas)
    decision = decidir(b, validas[0] if validas else None, [], calendario, date.today())

    if a.json:
        print(json.dumps({"opciones": [o.a_dict() for o in validas[:10]], "rechazos": rechazos,
                          "estado_fuentes": estado, "decision": decision.__dict__}, ensure_ascii=False, indent=1, default=str))
        return

    print(f"\nFuentes: {json.dumps(estado, ensure_ascii=False)}")
    print(f"Calendario: {len(calendario)} precios · Rechazadas: {dict(rechazos)}")
    print(f"Opciones válidas: {len(validas)}\n")
    for i, o in enumerate(validas[:8], 1):
        tr = " | ".join(
            f"{t.aerolinea}{t.numero}{'/' + t.operadora if t.operadora and t.operadora != t.aerolinea else ''} "
            f"{t.origen}->{t.destino} {t.salida:%d/%m %H:%M}-{t.llegada:%H:%M}"
            for t in o.tramos
        )
        print(f"{i}. {eur(o.precio_total)} = billetes {eur(o.precio_billetes)} + maletas {eur(o.precio_maletas)} "
              f"- dto {eur(o.descuento)} [{o.fuente}{', billetes separados' if o.billetes_separados else ''}]\n   {tr}")
    print(f"\nDecisión: {'AVISAR' if decision.avisar else 'esperar'} {decision.tipo} {decision.motivo}")
    if validas:
        print("\n--- Vista previa del mensaje de Telegram ---")
        print(mensaje_aviso(b, validas[0], decision if decision.avisar else decision.__class__(True, "prueba", "Prueba", "Mensaje de prueba"),
                            enlaces.compra(b, validas[0], aerolineas), enlaces.google_flights(b, validas[0]), aerolineas, None))


if __name__ == "__main__":
    main()
