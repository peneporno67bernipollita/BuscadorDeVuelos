# Investigación: cómo encontrar vuelos baratos (octubre de 2026)

Resumen de la investigación hecha antes de construir el programa y de cómo se ha aplicado.

## 1. Cuándo comprar (lo que más influye)

| Tipo de vuelo | Momento más barato | Fuente |
|---|---|---|
| Europa / corto radio | ~7 semanas antes (49+ días) | Google Flights, 5/10/2026 |
| Ryanair | 36-60 días antes ~£87 frente a ~£165 a 14-21 días; +50-75 % en los últimos ~10 días | análisis de precios de Ryanair, Royal Economic Society |
| Nacional | 22-57 días (óptimo ~39) | Google Flights |
| Larga distancia | 50-133 días (óptimo ~89); dentro de ese rango, apenas varía | Google Flights |
| Navidad | 33-67 días | Google Flights |
| Temporada alta en España | hasta 4 meses antes | Consumer.es |

**Aplicado:** ventana óptima de 21-60 días (nacional), 28-70 (Europa) y 50-135 (larga distancia). Hay un aviso obligatorio
antes de entrar en las 3 últimas semanas. Si el viaje es en menos de 3 semanas, se avisa enseguida con la mejor opción
(se puede buscar igualmente, aunque el precio suele subir). Cuanto más cerca está el viaje, más a menudo se revisa.

## 2. Qué día volar

- Europa / España: el **martes** suele ser el más barato (Londres −45 %, Berlín −50 %); el **domingo**, el más caro.
- Expedia 2026: el **viernes** pasa a ser el más barato en internacional (−8 % frente al domingo).
- Salir el lunes y volver martes o miércoles: −14 % (Google).

**Aplicado:** como los estudios no coinciden, no se fija ningún día. Con "margen de días" el robot mira el calendario de
precios y prueba las fechas más baratas.

## 3. Día y hora de compra

El día de compra influye poco (−1,4 % a −3 %) y la hora es casi un mito: hay unos 18 millones de cambios de tarifa al día.
**Aplicado:** el robot revisa varias veces al día en lugar de buscar una "hora mágica".

## 4. Navegación privada y cookies

Los estudios no encuentran que las cookies suban el precio. Consumer Reports, con 372 búsquedas: mismo precio en el 88 % de
los casos, más barato en incógnito en el 7 % y más caro en el 5 %. Lo que sube el precio es que se venden plazas.
**Aplicado igualmente, como pediste:**

- Cada búsqueda usa una sesión HTTP nueva, sin cookies (Google Flights y Ryanair) o un contexto de incógnito nuevo (Skyscanner).
- Cada ronda corre en una máquina de GitHub recién creada.

## 5. Más formas de ahorrar

| Técnica | Dato | En el programa |
|---|---|---|
| Vuelos de madrugada o nocturnos | 10-30 % más baratos | Los acepta salvo que pongas franjas horarias |
| Vuelos con escala | Los directos cuestan un ~20 % más | De 0 a 2 escalas, con espera máxima configurable |
| Dos billetes de solo ida | Las low cost ponen precio a cada trayecto por separado | Siempre se compara con ida y vuelta, también entre aerolíneas distintas |
| Escalas con billetes separados (self-transfer) | Si pierdes la conexión, pierdes el vuelo | **Excluido** siempre |
| Hidden city | Cancelan la vuelta y te pueden quitar las millas; American ganó 9,4 M$ a Skiplagged | **No** se usa |
| VPN / otro país | Resultados poco fiables en 2026 | **No** se usa |
| Aeropuerto exacto | Ryanair "París" = Beauvais, a 85 km | Solo el aeropuerto elegido; la vuelta, a los mismos |

## 6. Equipaje: el precio que muestran no es el real

- Ryanair Basic solo incluye un bolso de 40×30×20. La maleta de cabina de 10 kg se paga, y la facturada de 20 kg cuesta 21,49-59,99 € **por vuelo**.
- Vueling Basic: facturada de 20 kg entre 14 y 96 € por vuelo.
- Iberia, 23 kg: 18-57 € en España, 20-95 € en Europa y 50-135 € en larga distancia.
- Google Flights no suma las maletas facturadas en vuelos europeos.
- Normativa: la multa de Consumo de 179 M€ está suspendida cautelarmente. La reforma de la UE (julio de 2026, en vigor en 2027)
  solo garantiza gratis el bolso de 40×30×15.

**Aplicado:** cada búsqueda pregunta cuántos llevan maleta de cabina y cuántos facturan 20 kg. Se suma por pasajero y por vuelo
o trayecto, según cobre cada aerolínea. Si no se conoce el precio exacto se usa el **máximo**, para que nunca te avise de un
total por debajo del real.

## 7. Descuentos

- **Familia numerosa:** 5 % (general) o 10 % (especial) sobre la tarifa, sin tasas, **solo en vuelos nacionales**.
- **Residente** (Canarias, Baleares, Melilla): 75 %, u 80 / 85 % si además eres familia numerosa.

**Aplicado:** se calculan automáticamente con una estimación prudente de las tasas, para no inflar el descuento.

## 8. Seguridad de las aerolíneas (lista blanca)

- Lista negra de la UE (junio de 2026): 154 aerolíneas prohibidas. Ninguna está en la lista blanca.
- **AirlineRatings 2026**:
  - Tradicionales: Iberia es la nº20 del mundo; Turkish es la más segura de Europa (nº12).
  - Low cost: easyJet nº5, Wizz Air nº9, Vueling nº12, Norwegian nº13, Ryanair nº18, Transavia nº20…
- Air Europa (7/7 Seven Star PLUS), Volotea (7/7 + IOSA), Binter (7/7 + IOSA).
- **KM Malta Airlines** (sucesora de Air Malta) tiene 7/7 e IOSA.
- **Malta Air** es una filial 100 % de Ryanair con 179 aviones, que vende sus vuelos como Ryanair.

**Aplicado:** lista blanca estricta de 77 aerolíneas (editable en la web). Se comprueba tanto la que **vende** como la que
**opera** cada vuelo, para evitar aviones alquilados con tripulación de otra compañía.

## 9. Dónde comprar

Las agencias encarecen los extras: eDreams Prime cobra los asientos un 56 % más y las maletas un 32 % más que la web de la
aerolínea. **Aplicado:** los enlaces de compra van **solo a la web oficial** de cada aerolínea. Nunca a agencias como eDreams,
Mytrip o Kiwi.

## 10. Webs consultadas y sus límites

| Web | Situación | Ritmo aplicado (referencia + 20 min) |
|---|---|---|
| Google Flights | Fuente principal: compara casi todas las aerolíneas, Ryanair incluida. Sin límite publicado; se recomiendan 3-8 s entre peticiones | Ronda cada 2 h 20 min; 6-16 s entre peticiones |
| Ryanair | Sus condiciones permiten el uso **privado y no comercial**; ~1 petición/min recomendada | Ronda cada 6 h 20 min; 2 min entre peticiones; máximo 3 por ronda |
| Skyscanner | Sus condiciones prohíben los robots. Su sistema anti-bots (HUMAN/PerimeterX) bloqueó la primera petición de prueba | Desactivada (ronda cada 12 h 20 min si la activas) |

- Ninguna web publica un límite fijo: bloquean según una "puntuación de sospecha".
- Si una web bloquea, el robot **no intenta saltarse la verificación**: la deja descansar el doble de tiempo cada vez (máximo 48 h) y sigue con las demás.
- Servicios descartados: Amadeus Self-Service (cerró el 17/7/2026) y Kiwi Tequila (sin altas nuevas desde 2024).

## Fuentes

- [Google Flights / 9to5Google (5/10/2026)](https://9to5google.com/2026/10/05/google-flights-cheap-times/)
- [Expedia 2026 Air Hacks](https://www.expedia.com/newsroom/expedia-2026-air-hacks/)
- [Consumer.es](https://www.consumer.es/viajes/reservar-vuelo-barato-mejor-dia-anticipacion.html)
- [Skyscanner / Euronews](https://www.euronews.com/2026/04/27/revealed-skyscanners-smart-guide-to-summer-travel-savings-in-europe)
- [Precios de Ryanair](https://plofair.com/blog/ryanair-price-patterns)
- [Royal Economic Society](https://res.org.uk/mediabriefing/everything-you-wanted-to-know-about-ryanair-pricing-but-never-dared-to-test/)
- [Kiwi: incógnito](https://www.kiwi.com/stories/stop-wasting-time-incognito-mode-doesnt-cut-airline-fares/)
- [Cookies y precios](https://www.mightytravels.com/2024/12/do-browser-cookies-really-impact-flight-prices-a-data-driven-investigation/)
- [Horarios de vuelo](https://www.farecompare.com/travel-advice/morning-flight-or-red-eye-the-best-times-to-fly/)
- [ATPCO](https://www.stockandland.com.au/story/9360485/atpco-logs-18m-fare-shifts-daily-why-flight-prices-change/)
- [Hidden city](https://www.going.com/guides/what-you-need-to-know-about-hidden-city-ticketing)
- [VPN](https://thealviator.com/2025/10/vpn-cheaper-flight-myth/)
- [Equipaje de Ryanair 2026](https://airadvisor.com/es/franquicia-de-equipaje/ryanair)
- [Precios de equipaje 2026](https://vuelosdeals.com/blog/facturar-maleta-precio-aerolineas-2026)
- [Multa de Consumo](https://www.preferente.com/noticias-de-transportes/noticias-de-aerolineas/ratificado-multa-de-179-millones-a-las-low-cost-por-cobrar-el-equipaje-de-mano-340449.html)
- [Reforma de la UE](https://www.euronews.com/2026/07/07/european-parliament-approves-free-cabin-luggage-and-delay-compensation-for-air-passengers)
- [Familia numerosa (Vueling)](https://help.vueling.com/hc/es/articles/19798792287121-Descuento-para-familias-numerosas)
- [AirlineRatings 2026](https://www.airlineratings.com/articles/worlds-safest-airlines-for-2026)
- [Lista negra de la UE](https://transport.ec.europa.eu/news-events/news/commission-updates-eu-air-safety-list-all-air-carriers-kyrgyzstan-removed-air-express-algeria-added-2026-06-09_en)
- [KM Malta](https://www.airlineratings.com/airlines/km-malta-airlines/safety)
- [Malta Air](https://en.wikipedia.org/wiki/Malta_Air)
- [Air Europa](https://www.airlineratings.com/articles/air-europa-first-in-europe-to-achieve-seven-star-plus-safety-rating)
- [Volotea](https://www.airlineratings.com/airlines/volotea/safety)
- [Binter](https://www.airlineratings.com/airlines/binter-canarias/safety)
- [eDreams frente a la web directa](https://www.marketscreener.com/quote/stock/RYANAIR-HOLDINGS-PLC-1412410/news/Ryanair-SEPTEMBER-OTA-SURVEY-SHOWS-EDREAMS-PRIME-OVERCHARGES-OVER-THREE-TIMES-THE-PRICE-OF-BOOKING-47846286/)
- [Términos de Ryanair](https://www.ryanair.com/us/en/lp/legal/terms-of-use)
- [Términos de Skyscanner](https://www.skyscanner.net/terms-of-service)
- [Skyscanner / PerimeterX](https://github.com/agentfirstdev/whitelabel/issues/25)
- [Cierre de Amadeus](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers)
- [fli](https://github.com/punitarani/fli)
