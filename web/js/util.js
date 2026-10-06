// Utilidades de la web: formato, escape de HTML, aeropuertos y avisos en pantalla.

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

export const esc = (valor) =>
  String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtEur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const eur = (n) => (n === null || n === undefined || n === "" ? "—" : fmtEur.format(Number(n)));

const aFecha = (d) => new Date(String(d).length === 10 ? `${d}T12:00:00` : d);
const fmtFecha = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" });
const fmtFechaAnyo = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
const fmtFechaHora = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });

export const fecha = (d) => (d ? fmtFecha.format(aFecha(d)) : "");
export const fechaAnyo = (d) => (d ? fmtFechaAnyo.format(aFecha(d)) : "");
export const fechaHora = (iso) => (iso ? fmtFechaHora.format(new Date(iso)) : "—");
// Las horas de los vuelos vienen en hora local del aeropuerto, sin zona: se muestran tal cual
export const horaLocal = (iso) => (iso ? String(iso).slice(11, 16) : "");
export const hora = (iso) => (iso ? fmtHora.format(new Date(iso)) : "");

export function hace(iso) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (Math.abs(min) < 1) return "ahora mismo";
  const futuro = min < 0;
  const m = Math.abs(min);
  const texto = m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} días`;
  return futuro ? `en ${texto}` : `hace ${texto}`;
}

export const diasHasta = (d) => Math.round((aFecha(d) - new Date()) / 86400000);

// ---------------------------------------------------------------------------
// Aeropuertos (datos públicos de OurAirports, ~4000 con vuelos regulares)
// ---------------------------------------------------------------------------
let cacheAeropuertos = null;
export async function aeropuertos() {
  if (!cacheAeropuertos) {
    const lista = await fetch("data/aeropuertos.json").then((r) => r.json());
    const mapa = new Map(lista.map((a) => [a.c, a]));
    const quitarTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const a of lista) a._txt = quitarTildes(`${a.c} ${a.es || ""} ${a.n} ${a.m} ${a.pn} ${a.k}`);
    cacheAeropuertos = { lista, mapa, quitarTildes };
  }
  return cacheAeropuertos;
}

export function nombreAeropuerto(datos, codigo, conCodigo = true) {
  const a = datos?.mapa.get(codigo);
  if (!a) return codigo;
  const nombre = a.es || a.m || a.n;
  return conCodigo ? `${nombre} (${codigo})` : nombre;
}

export function buscarAeropuertos(datos, texto, limite = 8) {
  const q = datos.quitarTildes(texto.trim());
  if (q.length < 2) return [];
  const exacto = datos.mapa.get(texto.trim().toUpperCase());
  const palabras = q.split(/\s+/);
  const encontrados = datos.lista.filter((a) => palabras.every((p) => a._txt.includes(p)));
  // Primero coincidencia exacta de código, luego los que tienen nombre en español (los más habituales)
  encontrados.sort((x, y) => (y.es ? 1 : 0) - (x.es ? 1 : 0) || (y.p === "ES") - (x.p === "ES"));
  const res = exacto ? [exacto, ...encontrados.filter((a) => a !== exacto)] : encontrados;
  return res.slice(0, limite);
}

// ---------------------------------------------------------------------------
// Avisos en pantalla
// ---------------------------------------------------------------------------
export function aviso(mensaje, tipo = "ok") {
  const el = document.createElement("div");
  el.className = `toast toast-${tipo}`;
  el.textContent = mensaje;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 300);
  }, tipo === "error" ? 6000 : 3000);
}

export function pasajerosTexto(b) {
  const p = [`${b.adultos} adulto${b.adultos !== 1 ? "s" : ""}`];
  if (b.ninos) p.push(`${b.ninos} niño${b.ninos !== 1 ? "s" : ""}`);
  if (b.bebes) p.push(`${b.bebes} bebé${b.bebes !== 1 ? "s" : ""}`);
  return p.join(", ");
}

export function maletasTexto(b) {
  const m = [];
  if (b.maletas_cabina) m.push(`${b.maletas_cabina} de cabina`);
  if (b.maletas_20kg) m.push(`${b.maletas_20kg} de 20 kg`);
  return m.length ? `Maletas: ${m.join(", ")}` : "Sin maletas extra";
}

export function fechasTexto(b) {
  if (b.modo === "chollo") {
    const noches = b.ida_vuelta ? ` · ${b.noches_min}-${b.noches_max} noches` : "";
    return `Cualquier fecha del ${fechaAnyo(b.chollo_desde)} al ${fechaAnyo(b.chollo_hasta)}${noches}`;
  }
  const flex = b.flex_dias ? ` (±${b.flex_dias} día${b.flex_dias > 1 ? "s" : ""})` : "";
  return b.ida_vuelta ? `${fecha(b.fecha_ida)} → ${fecha(b.fecha_vuelta)}${flex}` : `${fecha(b.fecha_ida)}${flex} · solo ida`;
}

export function generarCodigo() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((x) => letras[x % letras.length]).join("");
}
