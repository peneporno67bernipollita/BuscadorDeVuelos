"""Genera web/data/aeropuertos.json a partir de los datos públicos de OurAirports.

Uso:
    python scripts/construir_aeropuertos.py [ruta_airports.csv] [ruta_countries.csv]

Si no se pasan rutas, descarga los CSV de https://ourairports.com/data/ (dominio público).
Solo se guardan aeropuertos con código IATA y vuelos regulares.
"""

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "web" / "data" / "aeropuertos.json"
URL_AEROPUERTOS = "https://davidmegginson.github.io/ourairports-data/airports.csv"
URL_PAISES = "https://davidmegginson.github.io/ourairports-data/countries.csv"

# Nombres en español de los países más habituales (el resto queda en inglés).
PAISES_ES = {
    "ES": "España", "FR": "Francia", "IT": "Italia", "PT": "Portugal", "DE": "Alemania",
    "GB": "Reino Unido", "IE": "Irlanda", "NL": "Países Bajos", "BE": "Bélgica",
    "LU": "Luxemburgo", "CH": "Suiza", "AT": "Austria", "DK": "Dinamarca", "SE": "Suecia",
    "NO": "Noruega", "FI": "Finlandia", "IS": "Islandia", "PL": "Polonia",
    "CZ": "República Checa", "SK": "Eslovaquia", "HU": "Hungría", "RO": "Rumanía",
    "BG": "Bulgaria", "GR": "Grecia", "HR": "Croacia", "SI": "Eslovenia", "RS": "Serbia",
    "BA": "Bosnia y Herzegovina", "ME": "Montenegro", "AL": "Albania", "MK": "Macedonia del Norte",
    "MT": "Malta", "CY": "Chipre", "EE": "Estonia", "LV": "Letonia", "LT": "Lituania",
    "TR": "Turquía", "MA": "Marruecos", "DZ": "Argelia", "TN": "Túnez", "EG": "Egipto",
    "US": "Estados Unidos", "CA": "Canadá", "MX": "México", "AR": "Argentina", "BR": "Brasil",
    "CL": "Chile", "CO": "Colombia", "PE": "Perú", "CU": "Cuba", "DO": "República Dominicana",
    "AE": "Emiratos Árabes Unidos", "QA": "Catar", "IL": "Israel", "JP": "Japón",
    "CN": "China", "TH": "Tailandia", "IN": "India", "AU": "Australia", "UA": "Ucrania",
    "GE": "Georgia", "AM": "Armenia", "SN": "Senegal", "CV": "Cabo Verde", "KR": "Corea del Sur",
}

# Alias en español para que el buscador de la web encuentre "Londres", "París", etc.
ALIAS = {
    "LHR": "Londres Heathrow", "LGW": "Londres Gatwick", "STN": "Londres Stansted",
    "LTN": "Londres Luton", "LCY": "Londres City", "SEN": "Londres Southend",
    "CDG": "París Charles de Gaulle", "ORY": "París Orly", "BVA": "París Beauvais (a 85 km de París)",
    "FCO": "Roma Fiumicino", "CIA": "Roma Ciampino", "MXP": "Milán Malpensa", "LIN": "Milán Linate",
    "BGY": "Milán Bérgamo", "MUC": "Múnich", "LIS": "Lisboa", "BRU": "Bruselas",
    "CRL": "Bruselas Charleroi", "AMS": "Ámsterdam Schiphol", "ATH": "Atenas",
    "JFK": "Nueva York JFK", "EWR": "Nueva York Newark", "LGA": "Nueva York LaGuardia",
    "GVA": "Ginebra", "ZRH": "Zúrich", "VIE": "Viena", "PRG": "Praga", "WAW": "Varsovia",
    "WMI": "Varsovia Modlin", "ARN": "Estocolmo Arlanda", "BMA": "Estocolmo Bromma",
    "NYO": "Estocolmo Skavsta", "CPH": "Copenhague", "DUB": "Dublín", "EDI": "Edimburgo",
    "FLR": "Florencia", "PSA": "Pisa", "VCE": "Venecia Marco Polo", "TSF": "Venecia Treviso",
    "NAP": "Nápoles", "OPO": "Oporto", "RAK": "Marrakech", "IST": "Estambul",
    "SAW": "Estambul Sabiha Gökçen", "BER": "Berlín", "FRA": "Fráncfort",
    "HHN": "Fráncfort Hahn (a 120 km de Fráncfort)", "CGN": "Colonia Bonn", "HAM": "Hamburgo",
    "NCE": "Niza", "MRS": "Marsella", "BOD": "Burdeos", "LYS": "Lyon", "BSL": "Basilea Mulhouse",
    "BLQ": "Bolonia", "TRN": "Turín", "PMO": "Palermo", "CTA": "Catania", "MLA": "Malta La Valeta",
    "BUD": "Budapest", "OTP": "Bucarest", "SOF": "Sofía", "KRK": "Cracovia", "TLL": "Tallin",
    "RIX": "Riga", "VNO": "Vilna", "HEL": "Helsinki", "OSL": "Oslo", "KEF": "Reikiavik",
    "CMN": "Casablanca", "TNG": "Tánger", "CAI": "El Cairo", "TLV": "Tel Aviv", "DXB": "Dubái",
    "DOH": "Doha", "MEX": "Ciudad de México", "BOG": "Bogotá", "EZE": "Buenos Aires",
    "MAD": "Madrid Barajas", "BCN": "Barcelona El Prat", "AGP": "Málaga", "SVQ": "Sevilla",
    "PMI": "Palma de Mallorca", "IBZ": "Ibiza", "MAH": "Menorca Mahón", "TFS": "Tenerife Sur",
    "TFN": "Tenerife Norte", "LPA": "Gran Canaria Las Palmas", "ACE": "Lanzarote",
    "FUE": "Fuerteventura", "SPC": "La Palma", "LCG": "A Coruña La Coruña",
    "SCQ": "Santiago de Compostela", "VGO": "Vigo", "OVD": "Asturias Oviedo", "SDR": "Santander",
    "BIO": "Bilbao", "EAS": "San Sebastián", "VLC": "Valencia", "ALC": "Alicante Elche",
    "RMU": "Murcia Corvera", "GRX": "Granada", "XRY": "Jerez de la Frontera", "LEI": "Almería",
    "ZAZ": "Zaragoza", "REU": "Reus Tarragona", "GRO": "Girona", "VLL": "Valladolid",
    "BJZ": "Badajoz", "MLN": "Melilla", "LEN": "León", "PNA": "Pamplona", "VIT": "Vitoria",
    "GMZ": "La Gomera", "VDE": "El Hierro",
}

TIPOS_VALIDOS = {"large_airport", "medium_airport", "small_airport"}


def leer_csv(ruta_o_url: str) -> list[dict]:
    if ruta_o_url.startswith("http"):
        with urllib.request.urlopen(ruta_o_url, timeout=60) as r:
            texto = r.read().decode("utf-8")
    else:
        texto = Path(ruta_o_url).read_text(encoding="utf-8")
    return list(csv.DictReader(io.StringIO(texto)))


def main() -> None:
    ruta_aeropuertos = sys.argv[1] if len(sys.argv) > 1 else URL_AEROPUERTOS
    ruta_paises = sys.argv[2] if len(sys.argv) > 2 else URL_PAISES
    paises = {p["code"]: p["name"] for p in leer_csv(ruta_paises)}

    salida = []
    vistos = set()
    for a in leer_csv(ruta_aeropuertos):
        iata = (a.get("iata_code") or "").strip().upper()
        if len(iata) != 3 or iata in vistos:
            continue
        if a["type"] not in TIPOS_VALIDOS or a["scheduled_service"] != "yes":
            continue
        vistos.add(iata)
        pais = a["iso_country"]
        salida.append({
            "c": iata,
            "n": a["name"],
            "m": a["municipality"],
            "p": pais,
            "pn": PAISES_ES.get(pais, paises.get(pais, pais)),
            "r": a["iso_region"],
            "co": a["continent"],
            "la": round(float(a["latitude_deg"]), 4),
            "lo": round(float(a["longitude_deg"]), 4),
            "k": (a.get("keywords") or "")[:160],
        })
        if iata in ALIAS:
            salida[-1]["es"] = ALIAS[iata]

    salida.sort(key=lambda x: x["c"])
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(salida)} aeropuertos guardados en {SALIDA}")


if __name__ == "__main__":
    main()
