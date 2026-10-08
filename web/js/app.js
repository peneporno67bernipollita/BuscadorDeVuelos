// Enrutador de la web (rutas con #) y control de acceso.
import { api, configurado, esDemo } from "./api.js";
import { $, $$, aviso, esc } from "./util.js";
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

async function navegar() {
  const ruta = decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
  $("#cabecera").hidden = !usuario;
  if (!usuario) {
    return vistaAcceso(app);
  }
  if (!perfilCompletado) {
    // Primera vez: completar el perfil (familia numerosa, Telegram...)
    $$("#menu a").forEach((a) => a.classList.toggle("activa", a.dataset.ruta === "perfil"));
    return vistaPerfil(app, true, () => {
      perfilCompletado = true;
      location.hash = "#/";
      navegar();
    });
  }
  for (const [patron, menu, vista] of RUTAS) {
    const m = ruta.match(patron);
    if (m) {
      $$("#menu a").forEach((a) => a.classList.toggle("activa", a.dataset.ruta === menu));
      app.innerHTML = '<p class="cargando">Cargando…</p>';
      try {
        await vista(m);
      } catch (e) {
        console.error(e);
        app.innerHTML = `<div class="tarjeta"><h2>Algo ha fallado</h2><p>${esc(e.message)}</p><a class="boton" href="#/">Volver al panel</a></div>`;
      }
      window.scrollTo(0, 0);
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

$("#salir").addEventListener("click", async () => {
  await api.salir();
  location.hash = "#/";
});
window.addEventListener("hashchange", navegar);

if (esDemo) {
  const banda = $("#banda-demo");
  banda.hidden = false;
  banda.innerHTML = configurado
    ? 'Modo demostración: datos de ejemplo, los cambios no se guardan. <a href="./">Salir del modo demo</a>'
    : "Modo demostración: la web aún no está conectada a Supabase (mira docs/INSTALACION.md). Los datos son de ejemplo.";
}

// Supabase avisa también al refrescar el token: solo se recarga si cambia el usuario
let ultimoId; // undefined = todavía no se sabe
function siCambiaUsuario(u) {
  const id = u?.id ?? null;
  if (id !== ultimoId) {
    ultimoId = id;
    alCambiarUsuario(u);
  }
}
api.alCambiarSesion(siCambiaUsuario);
siCambiaUsuario(await api.usuario());
