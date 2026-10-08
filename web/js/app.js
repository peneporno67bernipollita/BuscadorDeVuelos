// Enrutador de la web (rutas con #), control de acceso, tema y estado del robot en directo.
import { api, configurado, esDemo } from "./api.js";
import { icono, pintarIconos } from "./iconos.js";
import { $, $$, activarOndas, aviso, esc, hace, limpiarPantalla } from "./util.js";
import { vistaAcceso } from "./vistas/acceso.js";
import { vistaPerfil } from "./vistas/perfil.js";
import { vistaPanel } from "./vistas/panel.js";
import { vistaFormulario } from "./vistas/formulario.js";
import { vistaDetalle } from "./vistas/detalle.js";
import { vistaAerolineas } from "./vistas/aerolineas.js";
import { vistaEstado } from "./vistas/estado.js";

const app = $("#app");
let usuario = null;
let perfilCompletado = false;

const RUTAS = [
  [/^\/?$/, "panel", () => vistaPanel(app)],
  [/^\/nueva$/, "nueva", () => vistaFormulario(app)],
  [/^\/editar\/(.+)$/, "nueva", (m) => vistaFormulario(app, m[1])],
  [/^\/duplicar\/(.+)$/, "nueva", (m) => vistaFormulario(app, m[1], true)],
  [/^\/busqueda\/(.+)$/, "panel", (m) => vistaDetalle(app, m[1])],
  [/^\/perfil$/, "perfil", () => vistaPerfil(app, false)],
  [/^\/aerolineas$/, "aerolineas", () => vistaAerolineas(app)],
  [/^\/estado$/, "estado", () => vistaEstado(app)],
];

function marcarMenu(ruta) {
  $$("[data-ruta]").forEach((a) => a.classList.toggle("activa", a.dataset.ruta === ruta));
}

async function navegar() {
  limpiarPantalla();
  const ruta = decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
  document.body.classList.toggle("sin-sesion", !usuario);
  if (!usuario) return vistaAcceso(app);
  if (!perfilCompletado) {
    // Primera vez: completar el perfil (familia numerosa, Telegram...)
    marcarMenu("perfil");
    return vistaPerfil(app, true, () => {
      perfilCompletado = true;
      location.hash = "#/";
      navegar();
    });
  }
  for (const [patron, menu, vista] of RUTAS) {
    const m = ruta.match(patron);
    if (m) {
      marcarMenu(menu);
      app.innerHTML = '<div class="cargando-pagina"><div class="anillo"></div></div>';
      try {
        await vista(m);
        app.firstElementChild?.classList.add("pagina");
      } catch (e) {
        console.error(e);
        app.innerHTML = `<div class="tarjeta vacio pagina"><div class="ilustracion">${icono("aviso")}</div>
          <h2>Algo ha fallado</h2><p>${esc(e.message)}</p><a class="boton primario" href="#/">Volver al panel</a></div>`;
      }
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
  }
  location.hash = "#/";
}

async function alCambiarUsuario(u) {
  usuario = u;
  perfilCompletado = false;
  if (u) {
    try {
      perfilCompletado = Boolean((await api.perfil())?.perfil_completado);
    } catch (e) {
      // El usuario de la sesión guardada ya no existe (p. ej. se borró en Supabase): cerrar sesión
      if (/0 rows|no rows|multiple \(or no\) rows|JWT|not found/i.test(e.message)) {
        await api.salir();
        aviso("Tu sesión anterior ya no es válida. Entra o crea tu cuenta de nuevo.");
        return;
      }
      aviso(e.message, "error");
    }
  }
  navegar();
}

// ---------------------------------------------------------------------------
// Tema claro / oscuro
// ---------------------------------------------------------------------------
function temaActual() {
  const elegido = document.documentElement.dataset.tema;
  if (elegido) return elegido;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}
function pintarBotonesTema() {
  const oscuro = temaActual() === "oscuro";
  $$("[data-cambiar-tema]").forEach((b) => {
    const texto = b.classList.contains("icono") ? "" : oscuro ? "Claro" : "Oscuro";
    b.innerHTML = `${icono(oscuro ? "sol" : "luna")}${texto}`;
    b.title = oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  });
}
$$("[data-cambiar-tema]").forEach((b) =>
  b.addEventListener("click", () => {
    const nuevo = temaActual() === "oscuro" ? "claro" : "oscuro";
    document.documentElement.dataset.tema = nuevo;
    try { localStorage.setItem("tema", nuevo); } catch (e) { /* sin almacenamiento: solo esta visita */ }
    pintarBotonesTema();
    navegar(); // las gráficas toman los colores del tema nuevo
  }),
);

// ---------------------------------------------------------------------------
// Robot en directo (señal de vida que el robot escribe cada minuto)
// ---------------------------------------------------------------------------
async function pintarEstadoRobot() {
  if (!usuario) return;
  let latido = null;
  try {
    latido = await api.latido();
  } catch (e) { /* sin latido: se muestra como desconocido */ }
  const segundos = latido?.en ? (Date.now() - new Date(latido.en)) / 1000 : null;
  const vivo = segundos !== null && segundos < 5 * 60;
  const clase = vivo ? "" : segundos !== null && segundos < 3 * 3600 ? "aviso" : "apagado";
  const titulo = vivo ? "Robot en directo" : latido ? "Robot en pausa" : "Robot sin señal";
  const detalle = vivo ? `buscando · ${hace(latido.en)}` : latido ? `última señal ${hace(latido.en)}` : "aún no ha arrancado";
  $("#estado-robot-lateral").innerHTML = `<span class="punto-vivo ${clase}"></span><span><b>${titulo}</b>${detalle}</span>`;
  $("#estado-robot-superior").innerHTML = `<span class="punto-vivo ${clase}" title="${titulo}: ${detalle}"></span>${vivo ? "En directo" : ""}`;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
pintarIconos();
pintarBotonesTema();
activarOndas();
$$("[data-salir]").forEach((b) =>
  b.addEventListener("click", async () => {
    await api.salir();
    location.hash = "#/";
  }),
);
window.addEventListener("hashchange", navegar);
setInterval(pintarEstadoRobot, 30000);

if (esDemo) {
  const banda = $("#banda-demo");
  banda.hidden = false;
  banda.innerHTML = configurado
    ? 'Modo demostración: datos de ejemplo que cambian solos; nada se guarda. <a href="./">Salir del modo demo</a>'
    : "Modo demostración: la web aún no está conectada a Supabase (mira docs/INSTALACION.md).";
}

// Supabase avisa también al refrescar el token: solo se recarga si cambia el usuario
let ultimoId; // undefined = todavía no se sabe
function siCambiaUsuario(u) {
  const id = u?.id ?? null;
  if (id !== ultimoId) {
    ultimoId = id;
    alCambiarUsuario(u).then(pintarEstadoRobot);
  }
}
api.alCambiarSesion(siCambiaUsuario);
siCambiaUsuario(await api.usuario());
