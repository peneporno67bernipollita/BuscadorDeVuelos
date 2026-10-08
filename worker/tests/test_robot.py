"""Pruebas del robot con una base de datos y un Telegram simulados (sin red)."""

from datetime import datetime, timedelta, timezone

from buscador import run


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

    def mensajes_nuevos(self, desde):
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
