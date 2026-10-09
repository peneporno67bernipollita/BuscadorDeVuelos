"""Pruebas del robot con una base de datos y un Telegram simulados (sin red)."""

from datetime import datetime, timedelta, timezone

import pytest

from buscador import run


@pytest.fixture(autouse=True)
def limites_de_telegram_limpios():
    for limite in (run.LIMITE_DESCONOCIDO, run.LIMITE_RESPUESTAS_DESCONOCIDOS, run.LIMITE_VINCULADO):
        limite.marcas.clear()


class BaseDeDatosFalsa:
    def __init__(self, tablas):
        self.tablas = tablas
        self.borrados = []

    @staticmethod
    def _cumple(fila, filtros):
        for campo, condicion in filtros.items():
            if campo in ("select", "order", "limit"):
                continue
            op, _, valor = condicion.partition(".")
            if op == "eq" and str(fila.get(campo)).lower() != valor.lower():
                return False
        return True

    def leer(self, tabla, **filtros):
        return [dict(f) for f in self.tablas.get(tabla, []) if self._cumple(f, filtros)]

    def insertar(self, tabla, filas, devolver=False):
        filas = filas if isinstance(filas, list) else [filas]
        self.tablas.setdefault(tabla, []).extend(dict(f, id=len(self.tablas.get(tabla, [])) + 1) for f in filas)
        return [self.tablas[tabla][-1]] if devolver else []

    def actualizar(self, tabla, filtros, valores):
        for fila in self.tablas.get(tabla, []):
            if self._cumple(fila, filtros):
                fila.update(valores)

    def guardar(self, tabla, fila):
        filas = self.tablas.setdefault(tabla, [])
        filas[:] = [f for f in filas if f.get("clave") != fila.get("clave")] + [fila]

    def borrar(self, tabla, filtros):
        self.borrados.append((tabla, filtros))


class TelegramFalso:
    def __init__(self, mensajes):
        self.mensajes = mensajes
        self.enviados = []

    def mensajes_nuevos(self, desde, espera=0):
        return [m for m in self.mensajes if desde is None or m["update_id"] > desde]

    def enviar(self, chat, texto):
        self.enviados.append((str(chat), texto))
        return True


def _mensaje(update_id, chat, texto):
    return {"update_id": update_id, "message": {"chat": {"id": chat}, "text": texto}}


def test_vincular_con_codigo_y_responder_comandos():
    db = BaseDeDatosFalsa({
        "perfiles": [{"id": "u1", "telegram_codigo": "ABCD2345", "telegram_chat_id": None}],
        "busquedas": [{"id": "b1", "usuario": "u1", "nombre": "París", "origen": "SVQ", "destino": "ORY",
                       "activa": True, "precio_actual": 315.0, "mejor_precio": 300.0, "estado": "8 opciones"}],
        "ajustes": [],
    })
    tg = TelegramFalso([
        _mensaje(1, 99, "/start abcd2345"),  # enlace del botón de la web: /start CODIGO
        _mensaje(2, 99, "/estado"),
        _mensaje(3, 99, "hola"),
        _mensaje(4, 55, "/start"),  # otra persona que encuentra el bot
    ])
    perfiles = {p["id"]: p for p in db.leer("perfiles")}
    assert run.atender_telegram(db, tg, perfiles, "https://web") == 1
    perfil = db.leer("perfiles")[0]
    assert perfil["telegram_chat_id"] == "99" and perfil["telegram_codigo"] is None
    textos = [t for chat, t in tg.enviados if chat == "99"]
    assert "Listo" in textos[0]
    assert "París" in textos[1] and "315" in textos[1]  # /estado
    assert "/estado" in textos[2]  # ayuda
    assert any(chat == "55" and "código" in t for chat, t in tg.enviados)
    assert db.leer("ajustes", clave="eq.telegram_offset")[0]["valor"] == 4

    # Los mensajes ya leídos no se vuelven a procesar
    tg.enviados.clear()
    run.atender_telegram(db, tg, {p["id"]: p for p in db.leer("perfiles")}, None)
    assert tg.enviados == []


def test_hilo_de_atencion_contesta_y_da_senal_de_vida():
    db = BaseDeDatosFalsa({
        "perfiles": [{"id": "u1", "telegram_codigo": None, "telegram_chat_id": "99", "telegram_prueba": True}],
        "ajustes": [],
    })
    tg = TelegramFalso([_mensaje(1, 99, "/ayuda")])
    atencion = run.Atencion("https://x.supabase.co", "clave", None, "https://web", None)
    ultimo = atencion.vuelta(db, tg, float("-inf"))
    assert ultimo > float("-inf") and db.leer("ajustes", clave="eq.latido")  # señal de vida escrita
    textos = [t for _, t in tg.enviados]
    assert any("Buscador de Vuelos" in t for t in textos) and any("prueba" in t.lower() for t in textos)
    assert db.leer("perfiles")[0]["telegram_prueba"] is False
    # La siguiente vuelta no vuelve a escribir la señal de vida hasta que pase un minuto
    assert atencion.vuelta(db, TelegramFalso([]), ultimo) == ultimo


def test_alarma_de_prueba_desde_la_web(monkeypatch):
    enviadas = []
    monkeypatch.setattr(run, "alarma", lambda tema, titulo, texto, enlace=None: enviadas.append((tema, titulo)) or True)
    db = BaseDeDatosFalsa({
        "perfiles": [{"id": "u1", "telegram_chat_id": "99", "ntfy_tema": "vuelos-secreto123", "alarma_chollos": True,
                      "alarma_prueba": True}],
        "ajustes": [],
    })
    tg = TelegramFalso([])
    run.atender_telegram(db, tg, {p["id"]: p for p in db.leer("perfiles")}, "https://web")
    assert enviadas == [("vuelos-secreto123", "🔔 Prueba de alarma")]
    assert db.leer("perfiles")[0]["alarma_prueba"] is False and "ntfy" in tg.enviados[0][1]


def test_alarma_urgente_con_botones_de_compra():
    from buscador.avisos import alarma, texto_alarma

    class Respuesta:
        status_code = 200

    class Http:
        def post(self, url, json, timeout):
            self.url, self.datos = url, json
            return Respuesta()

    http = Http()
    comprar = [{"texto": "Comprar ya", "url": "https://www.google.com/travel/flights/booking?tfs=x"}]
    assert alarma("vuelos-abc", "🔥 Chollo encontrado", texto_alarma({"nombre": "Escapada a París"}, 70.0),
                  enlace="https://web/#/busqueda/1", comprar=comprar, http=http)
    assert http.url == "https://ntfy.sh/" and http.datos["topic"] == "vuelos-abc" and http.datos["priority"] == 5
    assert "70,00 €" in http.datos["message"] and http.datos["click"].endswith("/busqueda/1")
    assert http.datos["actions"][0]["label"] == "Comprar ya"
    assert alarma("", "x", "y", http=http) is False  # sin tema no se envía nada
    Respuesta.status_code = 429
    assert alarma("vuelos-abc", "x", "y", http=http) is False


def test_mensaje_de_prueba_desde_la_web():
    db = BaseDeDatosFalsa({
        "perfiles": [{"id": "u1", "telegram_chat_id": "99", "telegram_prueba": True}],
        "ajustes": [],
    })
    tg = TelegramFalso([])
    run.atender_telegram(db, tg, {p["id"]: p for p in db.leer("perfiles")}, None)
    assert tg.enviados and "prueba" in tg.enviados[0][1].lower()
    assert db.leer("perfiles")[0]["telegram_prueba"] is False


def test_migracion_de_ritmo_se_aplica_una_vez():
    db = BaseDeDatosFalsa({
        "estado_fuentes": [{"fuente": "google_flights", "intervalo_min": 140}, {"fuente": "ryanair", "intervalo_min": 380}],
        "ajustes": [],
    })
    run.migrar_datos(db)
    assert {f["fuente"]: f["intervalo_min"] for f in db.leer("estado_fuentes")} == {"google_flights": 5, "ryanair": 30}
    db.actualizar("estado_fuentes", {"fuente": "eq.google_flights"}, {"intervalo_min": 77})  # cambio manual
    run.migrar_datos(db)
    assert db.leer("estado_fuentes", fuente="eq.google_flights")[0]["intervalo_min"] == 77  # no se pisa


def test_limpieza_solo_borra_opciones_antiguas_no_ganadoras():
    db = BaseDeDatosFalsa({})
    run.limpiar_historial(db, datetime(2026, 10, 10, tzinfo=timezone.utc))
    precios = dict(db.borrados)["precios"]
    assert precios["es_mejor"] == "eq.false"  # el historial de la gráfica (es_mejor) no se toca
    assert precios["revisado"].startswith("lt.2026-10-08")


def test_ronda_sin_nada_pendiente_no_hace_nada():
    futuro = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    db = BaseDeDatosFalsa({"busquedas": [{"id": "b1", "activa": True, "modo": "fechas", "fecha_ida": "2099-01-01",
                                          "proxima_revision": futuro}]})
    assert run.ronda(db, None, None, forzar=False, limite_s=60) is None
    assert "ejecuciones" not in db.tablas  # no se apunta una ronda vacía


def test_busqueda_nueva_no_espera_al_ritmo_normal_de_la_web():
    ahora = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
    hace = lambda minutos: (ahora - timedelta(minutes=minutos)).isoformat()  # noqa: E731
    config = {
        "google_flights": {"activa": True, "intervalo_min": 5, "ultima_ronda": hace(3), "bloqueada_hasta": None},
        "ryanair": {"activa": True, "intervalo_min": 30, "ultima_ronda": hace(1), "bloqueada_hasta": None},
        "skyscanner": {"activa": True, "intervalo_min": 740, "ultima_ronda": hace(10),
                       "bloqueada_hasta": (ahora + timedelta(hours=1)).isoformat()},
    }
    vieja = {"ultima_revision": hace(40), "historial_desde": None}
    nueva = {"ultima_revision": None, "historial_desde": None}
    editada = {"ultima_revision": hace(40), "historial_desde": hace(1)}
    # Solo búsquedas ya revisadas: cada web va a su ritmo (Google se miró hace 3 min y va cada 5)
    assert run.fuentes_listas(config, [vieja], ahora, forzar=False) == []
    # Una nueva o recién editada: Google ya vale (más de 2 min); Ryanair (1 min) y la bloqueada, no
    assert run.fuentes_listas(config, [vieja, nueva], ahora, forzar=False) == ["google_flights"]
    assert run.fuentes_listas(config, [editada], ahora, forzar=False) == ["google_flights"]
    assert not run.es_nueva(vieja) and run.es_nueva(nueva) and run.es_nueva(editada)


def test_horario_solo_telegram_para_la_alarma():
    from buscador.avisos import alarma_en_pausa

    madrid = lambda d, h, m=0: datetime(2026, 10, d, h, m, tzinfo=timezone(timedelta(hours=2)))  # 12/10/2026 = lunes
    base = {"ntfy_pausa": True, "ntfy_pausa_desde": "09:00:00", "ntfy_pausa_hasta": "14:00:00",
            "ntfy_pausa_dias": [1, 2, 3, 4, 5], "zona_horaria": "Europe/Madrid"}
    assert alarma_en_pausa(base, madrid(12, 10)) is True          # lunes 10:00
    assert alarma_en_pausa(base, madrid(12, 14)) is False         # a las 14:00 ya suena
    assert alarma_en_pausa(base, madrid(12, 8, 59)) is False
    assert alarma_en_pausa(base, madrid(11, 10)) is False         # domingo: no está entre los días
    assert alarma_en_pausa({**base, "ntfy_pausa": False}, madrid(12, 10)) is False
    # Las horas son las de su zona, aunque el robot trabaje en UTC
    assert alarma_en_pausa(base, datetime(2026, 10, 12, 7, 30, tzinfo=timezone.utc)) is True  # 9:30 en Madrid
    assert alarma_en_pausa({**base, "zona_horaria": "Atlantic/Canary"},
                           datetime(2026, 10, 12, 7, 30, tzinfo=timezone.utc)) is False      # 8:30 en Canarias
    assert alarma_en_pausa({**base, "zona_horaria": "Marte/Base"}, madrid(12, 10)) is True  # zona rara: España

    # De noche, pasando de medianoche: cuenta el día en que empieza
    noche = {**base, "ntfy_pausa_desde": "23:00", "ntfy_pausa_hasta": "08:00"}
    assert alarma_en_pausa(noche, madrid(16, 23, 30)) is True     # viernes noche
    assert alarma_en_pausa(noche, madrid(17, 7)) is True          # sábado de madrugada (empezó el viernes)
    assert alarma_en_pausa(noche, madrid(18, 7)) is False         # domingo de madrugada (empezó el sábado)
    assert alarma_en_pausa(noche, madrid(13, 7)) is True          # martes de madrugada (empezó el lunes)
    assert alarma_en_pausa(noche, madrid(13, 12)) is False
    assert alarma_en_pausa({**base, "ntfy_pausa_hasta": "09:00"}, madrid(11, 3)) is False  # domingo
    assert alarma_en_pausa({**base, "ntfy_pausa_hasta": "09:00"}, madrid(12, 3)) is True   # lunes: todo el día
    assert alarma_en_pausa({**base, "ntfy_pausa_dias": []}, madrid(12, 10)) is False


def test_en_horario_solo_telegram_avisa_por_telegram_sin_alarma(monkeypatch):
    from collections import Counter

    from test_logica import busqueda, opcion_directa

    from buscador.decision import Decision

    alarmas = []
    monkeypatch.setattr(run, "alarma", lambda *a, **k: alarmas.append(a) or True)
    monkeypatch.setattr(run, "decidir", lambda *a, **k: Decision(True, "chollo", "🔥 ¡Chollo encontrado! −40 %", "x", True))
    perfil = {"id": "u1", "telegram_chat_id": "99", "ntfy_tema": "vuelos-secreto123", "alarma_chollos": True,
              "ntfy_pausa": True, "ntfy_pausa_desde": "00:00", "ntfy_pausa_hasta": "00:00", "ntfy_pausa_dias": [1, 2, 3, 4, 5, 6, 7]}
    for pausa, esperadas in ((True, 0), (False, 1)):
        db, tg = BaseDeDatosFalsa({"busquedas": [busqueda()], "precios": [], "avisos": []}), TelegramFalso([])
        ahora, op = datetime.now(timezone.utc), opcion_directa()
        op.precio_total = 120.0
        run.procesar_busqueda(db, db.leer("busquedas")[0], [op], Counter(), [], ["google"],
                              {**perfil, "ntfy_pausa": pausa}, {}, tg, None, ahora.date(), ahora)
        assert len(tg.enviados) == 1 and ("en pausa" in tg.enviados[0][1]) is pausa
        assert len(alarmas) == esperadas
        alarmas.clear()


def test_el_bot_limita_a_los_desconocidos():
    db = BaseDeDatosFalsa({"perfiles": [{"id": "u1", "telegram_codigo": "ABCD2345", "telegram_chat_id": None}], "ajustes": []})
    # Alguien prueba códigos al azar: tras 5 intentos en una hora se le ignora, aunque luego acierte
    tg = TelegramFalso([_mensaje(i, 555, f"/start ZZZZ{i:04d}") for i in range(1, 8)] + [_mensaje(8, 555, "/start ABCD2345")])
    assert run.atender_telegram(db, tg, {p["id"]: p for p in db.leer("perfiles")}, None) == 0
    assert len(tg.enviados) == 5
    assert db.leer("perfiles")[0]["telegram_chat_id"] is None
    # Pasada la hora puede volver a intentarlo
    limite = run.Limitador(2, 60)
    assert limite.permitir("x", 0) and limite.permitir("x", 1) and not limite.permitir("x", 2)
    assert limite.permitir("x", 61)


def test_enlaces_de_telegram_seguros():
    from buscador.avisos import _href, es_https

    assert es_https("https://www.iberia.com") and not es_https("javascript:alert(1)") and not es_https("http://x.com")
    assert not es_https('https://x.com/"><b>')
    assert _href('https://x.com/?a="b"&c=<d>') == "https://x.com/?a=&quot;b&quot;&amp;c=&lt;d&gt;"
