from datetime import date, datetime, timedelta

from buscador import precios
from buscador.decision import decidir
from buscador.filtros import Validador
from buscador.modelos import Opcion, Tramo, Trayecto

AEROLINEAS = {
    "FR": {"nombre": "Ryanair", "permitida": True, "cabina_max": 40, "facturada_nacional_max": 59.99,
           "facturada_europa_max": 59.99, "facturada_largo_max": 59.99, "cobra_por": "tramo"},
    "IB": {"nombre": "Iberia", "permitida": True, "cabina_max": 0, "facturada_nacional_max": 57,
           "facturada_europa_max": 95, "facturada_largo_max": 135, "cobra_por": "trayecto"},
    "XX": {"nombre": "Bloqueada", "permitida": False, "cabina_max": 0, "facturada_nacional_max": 0,
           "facturada_europa_max": 0, "facturada_largo_max": 0, "cobra_por": "tramo"},
}


def tramo(aero, o, d, salida, horas=2, operadora=None):
    return Tramo(aero, "100", o, d, salida, salida + timedelta(hours=horas), operadora)


def busqueda(**cambios):
    b = {
        "id": "x", "usuario": "u", "nombre": "prueba", "modo": "fechas", "ida_vuelta": True,
        "origen": "SVQ", "destino": "ORY", "fecha_ida": "2026-11-15", "fecha_vuelta": "2026-11-19",
        "adultos": 2, "ninos": 0, "bebes": 0, "maletas_cabina": 0, "maletas_20kg": 1,
        "escalas_max": 1, "escala_max_horas": 6, "modo_precio": "mas_barato", "presupuesto": None,
        "aplicar_descuentos": True, "info": {},
    }
    b.update(cambios)
    return b


IDA = datetime(2026, 11, 15, 7, 0)
VUELTA = datetime(2026, 11, 19, 18, 0)


def opcion_directa(aero_ida="FR", aero_vuelta="FR", precio=200.0):
    return Opcion("prueba", Trayecto([tramo(aero_ida, "SVQ", "ORY", IDA)]),
                  Trayecto([tramo(aero_vuelta, "ORY", "SVQ", VUELTA)]), precio)


# ---------------- precios ----------------

def test_maletas_por_tramo_y_por_trayecto():
    b = busqueda(maletas_20kg=2)
    op = Opcion("p", Trayecto([tramo("FR", "SVQ", "MAD", IDA), tramo("FR", "MAD", "ORY", IDA + timedelta(hours=3))]),
                Trayecto([tramo("IB", "ORY", "MAD", VUELTA), tramo("IB", "MAD", "SVQ", VUELTA + timedelta(hours=3))]), 300)
    precios.calcular(op, b, None, AEROLINEAS)
    # Ryanair cobra por vuelo: 2 vuelos x 2 maletas x 59,99. Iberia una vez por trayecto: 2 x 95
    assert op.precio_maletas == round(2 * 2 * 59.99 + 2 * 95, 2)
    assert op.precio_total == round(300 + op.precio_maletas, 2)
    assert op.maletas_estimadas


def test_familia_numerosa_solo_en_vuelos_nacionales():
    perfil = {"familia_numerosa": "general", "residente": "ninguno"}
    b_nac = busqueda(destino="BCN", maletas_20kg=0)
    op = Opcion("p", Trayecto([tramo("IB", "SVQ", "BCN", IDA)]), Trayecto([tramo("IB", "BCN", "SVQ", VUELTA)]), 200)
    precios.calcular(op, b_nac, perfil, AEROLINEAS)
    # 5 % sobre (200 - 20 € x 2 pasajeros x 2 vuelos) = 5 % de 120
    assert op.descuento == 6.0
    assert op.precio_total == 194.0

    op_int = opcion_directa(precio=200)
    precios.calcular(op_int, busqueda(maletas_20kg=0), perfil, AEROLINEAS)
    assert op_int.descuento == 0


def test_residente_canarias():
    perfil = {"familia_numerosa": "especial", "residente": "canarias"}
    b = busqueda(destino="TFN", maletas_20kg=0, adultos=1)
    op = Opcion("p", Trayecto([tramo("IB", "SVQ", "TFN", IDA)]), Trayecto([tramo("IB", "TFN", "SVQ", VUELTA)]), 140)
    precios.calcular(op, b, perfil, AEROLINEAS)
    assert op.descuento == round((140 - 40) * 0.85, 2)


# ---------------- filtros ----------------

def test_aeropuerto_exacto_y_vuelta_al_mismo_aeropuerto():
    v = Validador(busqueda(), AEROLINEAS)
    assert v.opcion(opcion_directa()) is None
    mal = Opcion("p", Trayecto([tramo("FR", "SVQ", "BVA", IDA)]), Trayecto([tramo("FR", "BVA", "SVQ", VUELTA)]), 50)
    assert "llega a BVA" in v.opcion(mal)
    vuelta_a_otro = Opcion("p", Trayecto([tramo("FR", "SVQ", "ORY", IDA)]), Trayecto([tramo("FR", "ORY", "AGP", VUELTA)]), 50)
    assert "llega a AGP" in v.opcion(vuelta_a_otro)


def test_franjas_horarias_y_llegada_al_dia_siguiente():
    v = Validador(busqueda(ida_salida_min=8, ida_llegada_max=22), AEROLINEAS)
    assert "sale a las 07:00" in v.opcion(opcion_directa())
    nocturno = Opcion("p", Trayecto([tramo("FR", "SVQ", "ORY", datetime(2026, 11, 15, 21, 30), horas=3)]),
                      Trayecto([tramo("FR", "ORY", "SVQ", VUELTA)]), 50)
    v2 = Validador(busqueda(ida_llegada_max=23), AEROLINEAS)
    assert "día siguiente" in v2.opcion(nocturno)


def test_lista_blanca_incluye_operadora():
    v = Validador(busqueda(), AEROLINEAS)
    op = Opcion("p", Trayecto([tramo("IB", "SVQ", "ORY", IDA, operadora="XX")]), Trayecto([tramo("FR", "ORY", "SVQ", VUELTA)]), 50)
    assert "bloqueada" in v.opcion(op)
    op2 = Opcion("p", Trayecto([tramo("IB", "SVQ", "ORY", IDA, operadora="ZZ")]), Trayecto([tramo("FR", "ORY", "SVQ", VUELTA)]), 50)
    assert "lista blanca" in v.opcion(op2)


def test_escala_demasiado_larga():
    v = Validador(busqueda(), AEROLINEAS)
    op = Opcion("p", Trayecto([tramo("IB", "SVQ", "MAD", IDA), tramo("IB", "MAD", "ORY", IDA + timedelta(hours=10))]),
                Trayecto([tramo("FR", "ORY", "SVQ", VUELTA)]), 50)
    assert "escala de" in v.opcion(op)


# ---------------- decisión ----------------

def _con_total(total, billetes=None):
    op = opcion_directa(precio=billetes if billetes is not None else total)
    op.precio_total = total
    return op


def test_presupuesto():
    b = busqueda(modo_precio="presupuesto", presupuesto=200)
    hoy = date(2026, 9, 1)
    assert decidir(b, _con_total(210), [], [], hoy).avisar is False
    d = decidir(b, _con_total(199.99), [], [], hoy)
    assert d.avisar and d.tipo == "presupuesto"


def test_rebaja_tras_aviso():
    b = busqueda(modo_precio="presupuesto", presupuesto=200, ultimo_aviso_precio=180)
    hoy = date(2026, 9, 1)
    assert decidir(b, _con_total(175), [], [], hoy).avisar is False  # baja menos de 5 % y de 10 €
    assert decidir(b, _con_total(170), [], [], hoy).tipo == "bajada"


def test_viaje_proximo_avisa_ya():
    b = busqueda()
    d = decidir(b, _con_total(300), [], [], date(2026, 11, 5))
    assert d.avisar and d.tipo == "proximo"


def test_ventana_optima_minimo_visto():
    b = busqueda()
    hoy = date(2026, 10, 1)  # 45 días antes: dentro de la ventana para Europa
    assert decidir(b, _con_total(250), [260, 255], [], hoy, horas_historial=12).tipo == "buen_momento"
    # Con solo 1 hora observada todavía no se fía del mínimo
    assert decidir(b, _con_total(250), [260, 255], [], hoy, horas_historial=1).avisar is False
    assert decidir(b, _con_total(270), [260, 255], [], hoy).avisar is False


def test_pronto_solo_chollos():
    b = busqueda()
    hoy = date(2026, 7, 1)  # 137 días antes: demasiado pronto para Europa
    assert decidir(b, _con_total(250), [260, 255], [], hoy).avisar is False
    hist = [300, 310, 305, 300, 295, 300]
    assert decidir(b, _con_total(230), hist, [], hoy, horas_historial=30).tipo == "chollo"


def test_chollo_por_calendario():
    b = busqueda(modo="chollo", chollo_desde="2026-11-01", chollo_hasta="2027-01-31")
    calendario = [100, 110, 120, 130, 140, 150, 160, 170]
    assert decidir(b, _con_total(140, billetes=95), [], calendario, date(2026, 10, 1)).tipo == "chollo"
    assert decidir(b, _con_total(160, billetes=125), [], calendario, date(2026, 10, 1)).avisar is False


# ---------------- conexión con Supabase ----------------

def test_cabeceras_segun_tipo_de_clave():
    from buscador.db import Supabase

    nueva = Supabase("https://x.supabase.co", "sb_secret_abc")
    assert nueva.http.headers["apikey"] == "sb_secret_abc"
    assert "authorization" not in nueva.http.headers  # las claves sb_ no son JWT
    antigua = Supabase("https://x.supabase.co", "eyJhbGciOi.antigua")
    assert antigua.http.headers["authorization"] == "Bearer eyJhbGciOi.antigua"


def test_url_con_o_sin_rest_v1():
    from buscador.db import Supabase

    for url in ("https://x.supabase.co", "https://x.supabase.co/", "https://x.supabase.co/rest/v1/"):
        assert Supabase(url, "sb_secret_abc").base == "https://x.supabase.co/rest/v1"


def test_clasificar_respuestas_de_google():
    from buscador.fuentes.google_flights import describir_respuesta

    pagina = "<html><script>AF_initDataCallback({key: 'ds:1', data: []})</script></html>"
    assert describir_respuesta(200, pagina).startswith("página de resultados")
    error13 = ')]}\'\n[["wrb.fr",null,null,null,null,[13,null,[["type.googleapis.com/travel.frontend.flights.ErrorResponse"]]]]]'
    assert describir_respuesta(200, error13).startswith("error 13")
    assert describir_respuesta(429, "<html>").startswith("bloqueo")
    assert describir_respuesta(200, "<html>Our systems have detected unusual traffic").startswith("bloqueo")
    assert describir_respuesta(200, '<html><a href="https://consent.google.com/x">').startswith("página de consentimiento")
    assert describir_respuesta(200, "<html><body>hola</body></html>").startswith("página sin datos")


def test_muestras_y_calendario_acumulado_del_chollo():
    from buscador.fuentes.google_flights import FECHAS_CHOLLO_POR_RONDA, GoogleFlights, calendario_guardado
    from buscador.modelos import PrecioCalendario
    from buscador.run import acumular_calendario

    hoy = date.today()
    b = busqueda(modo="chollo", ida_vuelta=True, chollo_desde=(hoy + timedelta(days=5)).isoformat(),
                 chollo_hasta=(hoy + timedelta(days=95)).isoformat(), noches_min=2, noches_max=4, info={})
    vistas = set()
    for turno in range(40):
        b["info"]["chollo_turno"] = turno
        muestras = GoogleFlights._muestras_chollo(b)
        assert 0 < len(muestras) <= FECHAS_CHOLLO_POR_RONDA
        for fi, noches in muestras:
            assert fi + timedelta(days=noches) <= hoy + timedelta(days=95)
        # En cada ronda, fechas de días de la semana distintos (no siempre el mismo)
        assert len({fi.weekday() for fi, _ in muestras}) >= 4
        vistas |= set(muestras)
    assert len({fi for fi, _ in vistas}) > 80  # en 40 rondas se ha mirado casi cada día del periodo

    solo_ida = busqueda(modo="chollo", ida_vuelta=False, chollo_desde=(hoy + timedelta(days=20)).isoformat(),
                        chollo_hasta=(hoy + timedelta(days=80)).isoformat(), info={})
    for turno in range(10):
        solo_ida["info"]["chollo_turno"] = turno
        assert len({fi.weekday() for fi, _ in GoogleFlights._muestras_chollo(solo_ida)}) >= 4

    info = {"calendario": {"2000-01-01|2000-01-03": [10, "2000-01-01"]}}  # pasada: se descarta
    acumular_calendario(info, [PrecioCalendario(hoy + timedelta(days=9), hoy + timedelta(days=12), 80.0)], hoy)
    assert list(info["calendario"]) == [f"{hoy + timedelta(days=9)}|{hoy + timedelta(days=12)}"]
    assert info["chollo_turno"] == 1
    assert calendario_guardado({"info": info})[0].precio == 80.0
