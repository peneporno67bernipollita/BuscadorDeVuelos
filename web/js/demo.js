// Datos de ejemplo para ver la web sin base de datos (?demo). Los cambios no se guardan.

const dia = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const soloFecha = (ms) => iso(ms).slice(0, 10);
const ahora = Date.now();

function tramo(aerolinea, numero, origen, destino, fechaMs, salida, llegada) {
  const d = soloFecha(fechaMs);
  return { aerolinea, operadora: null, numero, origen, destino, salida: `${d}T${salida}`, llegada: `${d}T${llegada}` };
}

function crearDatos() {
  const ida1 = ahora + 46 * dia;
  const vuelta1 = ida1 + 4 * dia;
  const busquedas = [
    {
      id: "demo-1", usuario: "demo", nombre: "Puente en París", modo: "fechas", ida_vuelta: true,
      origen: "SVQ", destino: "ORY", fecha_ida: soloFecha(ida1), fecha_vuelta: soloFecha(vuelta1), flex_dias: 1,
      chollo_desde: null, chollo_hasta: null, noches_min: null, noches_max: null,
      ida_salida_min: 6, ida_salida_max: 14, ida_llegada_min: 0, ida_llegada_max: 24,
      vuelta_salida_min: 12, vuelta_salida_max: 24, vuelta_llegada_min: 0, vuelta_llegada_max: 24,
      adultos: 2, ninos: 1, bebes: 0, maletas_cabina: 1, maletas_20kg: 1, aplicar_descuentos: true,
      escalas_max: 1, escala_max_horas: 4, modo_precio: "presupuesto", presupuesto: 600,
      activa: true, proxima_revision: iso(ahora + 2.5 * 3600000), ultima_revision: iso(ahora - 0.5 * 3600000),
      mejor_precio: 574.4, precio_actual: 589.9, ultimo_aviso_precio: 574.4, ultimo_aviso_en: iso(ahora - 2 * dia),
      aviso_final_enviado: false, estado: "27 opciones válidas · la mejor: 589,90 €",
      info: { opciones_validas: 27, rechazos: { "horario fuera de tus franjas": 12, "escala demasiado larga": 4 }, habitual: [480, 610], fuentes: ["google_flights", "ryanair"] },
      creada: iso(ahora - 12 * dia),
    },
    {
      id: "demo-2", usuario: "demo", nombre: "Escapada a Lisboa cuando sea barata", modo: "chollo", ida_vuelta: true,
      origen: "SVQ", destino: "LIS", fecha_ida: null, fecha_vuelta: null, flex_dias: 0,
      chollo_desde: soloFecha(ahora + 7 * dia), chollo_hasta: soloFecha(ahora + 150 * dia), noches_min: 2, noches_max: 4,
      ida_salida_min: 0, ida_salida_max: 24, ida_llegada_min: 0, ida_llegada_max: 24,
      vuelta_salida_min: 0, vuelta_salida_max: 24, vuelta_llegada_min: 0, vuelta_llegada_max: 24,
      adultos: 1, ninos: 0, bebes: 0, maletas_cabina: 0, maletas_20kg: 0, aplicar_descuentos: true,
      escalas_max: 0, escala_max_horas: 6, modo_precio: "mas_barato", presupuesto: null,
      activa: true, proxima_revision: iso(ahora + 9 * 3600000), ultima_revision: iso(ahora - 3 * 3600000),
      mejor_precio: 61.0, precio_actual: 74.0, ultimo_aviso_precio: null, ultimo_aviso_en: null,
      aviso_final_enviado: false, estado: "8 opciones válidas · la mejor: 74,00 €",
      info: { opciones_validas: 8, rechazos: {}, habitual: [70, 115], fuentes: ["google_flights", "ryanair"] },
      creada: iso(ahora - 20 * dia),
    },
  ];

  const historial = [];
  const base1 = [640, 628, 631, 612, 605, 596, 601, 588, 574.4, 581, 592, 589.9];
  base1.forEach((p, i) => historial.push({ busqueda: "demo-1", revisado: iso(ahora - (base1.length - i) * 0.9 * dia), precio_total: p, fuente: "google_flights" }));
  const base2 = [92, 88, 95, 79, 61, 70, 83, 77, 74];
  base2.forEach((p, i) => historial.push({ busqueda: "demo-2", revisado: iso(ahora - (base2.length - i) * 2 * dia), precio_total: p, fuente: "google_flights" }));

  const opcion = (id, total, billetes, maletas, ida, vuelta, separados, fuente = "google_flights") => ({
    id, busqueda: "demo-1", revisado: iso(ahora - 0.5 * 3600000), fuente, fecha_ida: soloFecha(ida1), fecha_vuelta: soloFecha(vuelta1),
    precio_billetes: billetes, precio_maletas: maletas, descuento: 0, precio_total: total, maletas_estimadas: true, es_mejor: id === 1,
    detalle: {
      fuente, billetes_separados: separados, precio_billetes: billetes, precio_maletas: maletas, descuento: 0, precio_total: total,
      ida: { tramos: ida, escalas: ida.length - 1 }, vuelta: { tramos: vuelta, escalas: vuelta.length - 1 },
      desglose_maletas: [`Ida (Vueling): (1 cabina × 50,00 € + 1 de 20 kg × 96,00 €) = 146,00 €`],
      notas: [], enlaces: [{ aerolinea: "Vueling", url: "https://www.vueling.com" }, { aerolinea: "Transavia France", url: "https://www.transavia.com" }],
      google_flights: "https://www.google.com/travel/flights?q=Flights%20to%20ORY%20from%20SVQ",
    },
  });
  const opciones = [
    opcion(1, 589.9, 357.9, 232, [tramo("VY", "8073", "SVQ", "ORY", ida1, "06:40", "09:15")], [tramo("TO", "4605", "ORY", "SVQ", vuelta1, "16:35", "18:55")], true),
    opcion(2, 612.0, 380.0, 232, [tramo("VY", "8073", "SVQ", "ORY", ida1, "06:40", "09:15")], [tramo("VY", "8076", "ORY", "SVQ", vuelta1, "19:55", "22:25")], false),
    opcion(3, 655.5, 655.5, 0, [tramo("IB", "5101", "SVQ", "MAD", ida1, "07:10", "08:15"), tramo("IB", "3402", "MAD", "ORY", ida1, "09:35", "11:40")], [tramo("IB", "3405", "ORY", "MAD", vuelta1, "13:00", "15:05"), tramo("IB", "5110", "MAD", "SVQ", vuelta1, "16:20", "17:25")], false),
  ];

  const avisos = [
    { id: 1, busqueda: "demo-1", usuario: "demo", enviado: iso(ahora - 2 * dia), tipo: "presupuesto", motivo: "Total 574,40 € para todos, sin pasar de tu máximo de 600,00 €.", precio_total: 574.4, entregado: true },
  ];

  const aerolineas = [
    { codigo: "FR", nombre: "Ryanair", permitida: true, criterio: "Grupo Ryanair: AirlineRatings 2026: top 25 low cost (nº18), certificada en la UE", web_oficial: "https://www.ryanair.com", cabina_max: 40, facturada_nacional_max: 59.99, facturada_europa_max: 59.99, facturada_largo_max: 59.99, cobra_por: "tramo", bebe_tasa: 25, notas: "Basic solo incluye bolso 40x30x20." },
    { codigo: "VY", nombre: "Vueling", permitida: true, criterio: "AirlineRatings 2026: top 25 low cost (nº12)", web_oficial: "https://www.vueling.com", cabina_max: 50, facturada_nacional_max: 96, facturada_europa_max: 96, facturada_largo_max: 99, cobra_por: "tramo", bebe_tasa: null, notas: "" },
    { codigo: "IB", nombre: "Iberia", permitida: true, criterio: "AirlineRatings 2026: top 25 tradicionales (nº20)", web_oficial: "https://www.iberia.com", cabina_max: 0, facturada_nacional_max: 57, facturada_europa_max: 95, facturada_largo_max: 135, cobra_por: "trayecto", bebe_tasa: null, notas: "Maleta de cabina incluida." },
    { codigo: "TO", nombre: "Transavia France", permitida: true, criterio: "AirlineRatings 2026: top 25 low cost (nº20, grupo Transavia)", web_oficial: "https://www.transavia.com", cabina_max: 45, facturada_nacional_max: 70, facturada_europa_max: 70, facturada_largo_max: 70, cobra_por: "tramo", bebe_tasa: null, notas: "" },
    { codigo: "KM", nombre: "KM Malta Airlines", permitida: true, criterio: "AirlineRatings 7/7 y auditoría IOSA", web_oficial: "https://kmmaltairlines.com", cabina_max: 0, facturada_nacional_max: 70, facturada_europa_max: 70, facturada_largo_max: 120, cobra_por: "trayecto", bebe_tasa: null, notas: "" },
  ];

  const fuentes = [
    { fuente: "google_flights", nombre: "Google Flights", activa: true, intervalo_min: 140, pausa_min_s: 6, pausa_max_s: 16, max_peticiones: 60, ultima_ronda: iso(ahora - 0.5 * 3600000), ultima_ok: iso(ahora - 0.5 * 3600000), bloqueada_hasta: null, bloqueos_seguidos: 0, ultimo_error: null, descripcion: "Fuente principal: compara casi todas las aerolíneas." },
    { fuente: "ryanair", nombre: "Ryanair (web oficial)", activa: true, intervalo_min: 380, pausa_min_s: 120, pausa_max_s: 140, max_peticiones: 3, ultima_ronda: iso(ahora - 3.5 * 3600000), ultima_ok: iso(ahora - 3.5 * 3600000), bloqueada_hasta: null, bloqueos_seguidos: 0, ultimo_error: null, descripcion: "Confirma el precio en la propia Ryanair." },
    { fuente: "skyscanner", nombre: "Skyscanner", activa: false, intervalo_min: 740, pausa_min_s: 30, pausa_max_s: 60, max_peticiones: 2, ultima_ronda: null, ultima_ok: null, bloqueada_hasta: null, bloqueos_seguidos: 0, ultimo_error: null, descripcion: "Desactivada: bloquea a los robots desde la primera petición." },
  ];

  const ejecuciones = Array.from({ length: 12 }, (_, i) => ({
    id: 100 - i, inicio: iso(ahora - (i * 3 + 0.5) * 3600000), fin: iso(ahora - (i * 3 + 0.4) * 3600000),
    duracion_s: 140 + ((i * 37) % 120), resumen: { revisadas: i % 3 === 0 ? 2 : 1, avisos: i === 5 ? 1 : 0, errores: [], fuentes_en_ronda: i % 2 ? ["google_flights"] : ["google_flights", "ryanair"] },
  }));

  const perfil = { id: "demo", nombre: "Demo",familia_numerosa: "general", residente: "ninguno", telegram_chat_id: null, telegram_codigo: "K7PM4QXR", perfil_completado: true };
  return { busquedas, historial, opciones, avisos, aerolineas, fuentes, ejecuciones, perfil };
}

export function crearDemo() {
  const d = crearDatos();
  let sesion = { id: "demo", email: "demo@ejemplo.com" };
  const oyentes = [];
  const copia = (x) => structuredClone(x);
  return {
    usuario: async () => sesion,
    alCambiarSesion: (cb) => oyentes.push(cb),
    async entrar(email) {
      sesion = { id: "demo", email };
      oyentes.forEach((cb) => cb(sesion));
    },
    async registrar() {
      return { user: null };
    },
    async recuperar() {},
    async cambiarPassword() {},
    async salir() {
      sesion = null;
      oyentes.forEach((cb) => cb(null));
    },
    perfil: async () => copia(d.perfil),
    async guardarPerfil(campos) {
      Object.assign(d.perfil, campos);
      return copia(d.perfil);
    },
    busquedas: async () => copia(d.busquedas),
    busqueda: async (id) => copia(d.busquedas.find((b) => b.id === id)),
    async crearBusqueda(datos) {
      const b = { ...datos, id: `demo-${Date.now()}`, usuario: "demo", activa: true, info: {}, estado: "Pendiente de la primera revisión", proxima_revision: new Date().toISOString(), creada: new Date().toISOString() };
      d.busquedas.unshift(b);
      return copia(b);
    },
    async actualizarBusqueda(id, campos) {
      const b = d.busquedas.find((x) => x.id === id);
      Object.assign(b, campos);
      return copia(b);
    },
    async borrarBusqueda(id) {
      d.busquedas = d.busquedas.filter((b) => b.id !== id);
    },
    historial: async (id) => copia(d.historial.filter((h) => h.busqueda === id)),
    historialTodas: async () => copia(d.historial),
    ultimasOpciones: async (id) => copia(d.opciones.filter((o) => o.busqueda === id)),
    avisos: async (id) => copia(d.avisos.filter((a) => a.busqueda === id)),
    avisosRecientes: async () => copia(d.avisos),
    aerolineas: async () => copia(d.aerolineas),
    async guardarAerolinea(a) {
      const i = d.aerolineas.findIndex((x) => x.codigo === a.codigo);
      if (i >= 0) d.aerolineas[i] = { ...d.aerolineas[i], ...a };
      else d.aerolineas.push(a);
      return copia(a);
    },
    async borrarAerolinea(codigo) {
      d.aerolineas = d.aerolineas.filter((a) => a.codigo !== codigo);
    },
    fuentes: async () => copia(d.fuentes),
    async actualizarFuente(fuente, campos) {
      Object.assign(d.fuentes.find((f) => f.fuente === fuente), campos);
    },
    ejecuciones: async () => copia(d.ejecuciones),
    ejecucionesDelMes: async () => copia(d.ejecuciones),
  };
}
