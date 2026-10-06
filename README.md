# ✈️ Buscador de Vuelos

Vigila precios de vuelos por ti y te avisa por **Telegram** cuando es buen momento para comprar.
Tú compras en la web oficial de la aerolínea.

- **Aeropuertos exactos**: elijas Orly, no "París"; la vuelta, a los mismos aeropuertos.
- **Horarios**: franjas de salida y de llegada para la ida y para la vuelta.
- **Pasajeros**: hasta 9 (adultos, niños y bebés), con el **precio total** de todos, maletas incluidas.
- **Descuentos**: familia numerosa y residente, aplicados automáticamente en vuelos nacionales.
- **Dos modos de búsqueda**: **fechas concretas** o **chollo** (cualquier fecha de un periodo).
- **Dos modos de precio**: **presupuesto máximo** o **lo más barato posible** (decide un algoritmo basado en la
  [investigación](docs/INVESTIGACION.md)).
- **Seguridad**: solo aerolíneas seguras (lista blanca estricta, editable) y solo enlaces a webs oficiales.
- **Privacidad**: cada búsqueda en una sesión privada nueva, sin cookies.

## Cómo funciona

```
 Tú ──► Web (Cloudflare Pages) ──► Base de datos (Supabase) ◄── Robot (GitHub Actions, cada 3 h)
                                                                     │
                                       Google Flights · Ryanair ◄────┤
                                                                     └──► Avisos por Telegram
```

1. En la web creas una búsqueda: aeropuertos, fechas, horarios, pasajeros, maletas y presupuesto.
2. Cada 3 horas GitHub ejecuta el robot. Cada búsqueda se revisa cada 3, 6 o 12 h, según lo cerca que esté el viaje.
   Cada web consultada tiene su propio ritmo, con 20 min de margen sobre lo recomendado.
3. El robot hace lo siguiente:
   - Descarta lo que no cumple tus filtros.
   - Calcula el total real: billetes + maletas − descuentos.
   - Guarda el historial y decide si avisar.
4. Te llega un Telegram con el vuelo, el desglose del precio y el enlace a la web oficial para comprar.

## Estructura

| Carpeta | Contenido |
|---|---|
| `web/` | La web (HTML + JavaScript, sin compilación). Funciona en el móvil. `?demo` muestra datos de ejemplo. |
| `worker/buscador/` | El robot en Python: fuentes (Google Flights, Ryanair, Skyscanner), filtros, precios, decisión y avisos. |
| `worker/tests/` | Pruebas automáticas, que se ejecutan antes de cada ronda. |
| `supabase/` | `instalar.sql`: tablas, seguridad y lista blanca de aerolíneas. |
| `.github/workflows/robot.yml` | Ejecuta el robot cada 3 horas. |
| `scripts/` | Generan los datos de aeropuertos y el SQL de instalación. |
| `docs/` | [Instalación paso a paso](docs/INSTALACION.md) e [investigación](docs/INVESTIGACION.md). |

## Puesta en marcha

Sigue **[docs/INSTALACION.md](docs/INSTALACION.md)** (unos 30 minutos, todo gratis).

## Probar en local

```bash
python -m venv .venv
.venv\Scripts\pip install -r worker/requirements.txt
cd worker
..\.venv\Scripts\python -m pytest -q tests
..\.venv\Scripts\python -m buscador.cli SVQ ORY --ida 2026-11-15 --vuelta 2026-11-19 --adultos 2 --facturada 1
```

La web en modo demo (sin base de datos): `python -m http.server 8765 --directory web` y abre <http://localhost:8765/?demo>.
