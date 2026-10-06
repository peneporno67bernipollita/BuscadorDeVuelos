"""Genera supabase/instalar.sql = esquema.sql + lista blanca de aerolíneas.

Uso: python scripts/generar_sql.py
Vuelve a ejecutarlo si cambias worker/buscador/datos/aerolineas.json.
"""

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESQUEMA = RAIZ / "supabase" / "esquema.sql"
AEROLINEAS = RAIZ / "worker" / "buscador" / "datos" / "aerolineas.json"
SALIDA = RAIZ / "supabase" / "instalar.sql"

COLUMNAS = [
    "codigo", "nombre", "permitida", "criterio", "web_oficial", "cabina_max",
    "facturada_nacional_max", "facturada_europa_max", "facturada_largo_max",
    "cobra_por", "bebe_tasa", "notas",
]


def literal(valor) -> str:
    if valor is None:
        return "null"
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, (int, float)):
        return str(valor)
    return "'" + str(valor).replace("'", "''") + "'"


def main() -> None:
    aerolineas = json.loads(AEROLINEAS.read_text(encoding="utf-8"))
    filas = ",\n".join(
        "  (" + ", ".join(literal(a.get(c)) for c in COLUMNAS) + ")" for a in aerolineas
    )
    # Si la aerolínea ya existe no se pisa nada: tus cambios desde la web se respetan.
    semilla = (
        "\n-- =====================================================================\n"
        "-- Lista blanca inicial de aerolíneas (ver docs/INVESTIGACION.md)\n"
        "-- =====================================================================\n"
        f"insert into public.aerolineas ({', '.join(COLUMNAS)}) values\n{filas}\n"
        "on conflict (codigo) do nothing;\n"
    )
    SALIDA.write_text(ESQUEMA.read_text(encoding="utf-8") + semilla, encoding="utf-8")
    print(f"{SALIDA} generado con {len(aerolineas)} aerolíneas")


if __name__ == "__main__":
    main()
