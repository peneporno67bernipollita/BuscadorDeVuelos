// Acceso a los datos: Supabase de verdad o, si no está configurado (o con ?demo), datos de ejemplo.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { crearDemo } from "./demo.js";

export const configurado = Boolean(SUPABASE_URL) && !SUPABASE_URL.includes("TU-PROYECTO");
export const modoDemo = new URLSearchParams(location.search).has("demo");

const ERRORES = [
  [/invalid login credentials/i, "Correo o contraseña incorrectos."],
  [/email not confirmed/i, "Todavía no has confirmado tu correo: revisa tu bandeja de entrada (y el spam)."],
  [/database error saving new user|registro cerrado/i, "Registro cerrado: esta web ya tiene dueño (solo admite una cuenta)."],
  [/user already registered/i, "Ese correo ya tiene cuenta. Entra con tu contraseña."],
  [/password should be at least/i, "La contraseña debe tener al menos 6 caracteres."],
  [/rate limit/i, "Demasiados intentos seguidos. Espera unos minutos."],
  [/violates check constraint/i, "Algún dato no es válido. Revisa el formulario."],
  [/failed to fetch|network/i, "No hay conexión con la base de datos. Revisa tu internet."],
];

function traducir(error) {
  const texto = error?.message || String(error);
  const encontrado = ERRORES.find(([patron]) => patron.test(texto));
  return new Error(encontrado ? encontrado[1] : texto);
}

function comprobar({ data, error }) {
  if (error) throw traducir(error);
  return data;
}

async function crearReal() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const usuario = async () => (await sb.auth.getSession()).data.session?.user ?? null;
  const volverAqui = location.origin + location.pathname;

  return {
    usuario,
    alCambiarSesion: (cb) => sb.auth.onAuthStateChange((_evento, sesion) => cb(sesion?.user ?? null)),
    async entrar(email, password) {
      comprobar(await sb.auth.signInWithPassword({ email, password }));
    },
    async registrar(email, password) {
      return comprobar(await sb.auth.signUp({ email, password, options: { emailRedirectTo: volverAqui } }));
    },
    async recuperar(email) {
      comprobar(await sb.auth.resetPasswordForEmail(email, { redirectTo: volverAqui }));
    },
    async cambiarPassword(password) {
      comprobar(await sb.auth.updateUser({ password }));
    },
    salir: () => sb.auth.signOut(),

    async perfil() {
      const u = await usuario();
      return comprobar(await sb.from("perfiles").select("*").eq("id", u.id).single());
    },
    async guardarPerfil(campos) {
      const u = await usuario();
      return comprobar(await sb.from("perfiles").update(campos).eq("id", u.id).select().single());
    },

    busquedas: async () => comprobar(await sb.from("busquedas").select("*").order("creada", { ascending: false })),
    busqueda: async (id) => comprobar(await sb.from("busquedas").select("*").eq("id", id).single()),
    crearBusqueda: async (datos) => comprobar(await sb.from("busquedas").insert(datos).select().single()),
    actualizarBusqueda: async (id, campos) =>
      comprobar(await sb.from("busquedas").update(campos).eq("id", id).select().single()),
    borrarBusqueda: async (id) => comprobar(await sb.from("busquedas").delete().eq("id", id)),

    historial: async (id) =>
      comprobar(
        await sb.from("precios").select("revisado,precio_total,fuente").eq("busqueda", id).eq("es_mejor", true)
          .order("revisado", { ascending: true }).limit(1000),
      ),
    historialTodas: async () =>
      comprobar(
        await sb.from("precios").select("busqueda,revisado,precio_total").eq("es_mejor", true)
          .order("revisado", { ascending: true }).limit(3000),
      ),
    async ultimasOpciones(id) {
      const ultima = comprobar(
        await sb.from("precios").select("revisado").eq("busqueda", id).order("revisado", { ascending: false }).limit(1),
      );
      if (!ultima.length) return [];
      return comprobar(
        await sb.from("precios").select("*").eq("busqueda", id).eq("revisado", ultima[0].revisado)
          .order("precio_total", { ascending: true }),
      );
    },
    avisos: async (id) =>
      comprobar(await sb.from("avisos").select("*").eq("busqueda", id).order("enviado", { ascending: false }).limit(50)),
    avisosRecientes: async () =>
      comprobar(await sb.from("avisos").select("*").order("enviado", { ascending: false }).limit(10)),

    aerolineas: async () => comprobar(await sb.from("aerolineas").select("*").order("nombre")),
    guardarAerolinea: async (a) => comprobar(await sb.from("aerolineas").upsert(a).select().single()),
    borrarAerolinea: async (codigo) => comprobar(await sb.from("aerolineas").delete().eq("codigo", codigo)),

    fuentes: async () => comprobar(await sb.from("estado_fuentes").select("*").order("intervalo_min")),
    actualizarFuente: async (fuente, campos) =>
      comprobar(await sb.from("estado_fuentes").update(campos).eq("fuente", fuente).select().single()),
    ejecuciones: async (limite = 30) =>
      comprobar(await sb.from("ejecuciones").select("*").order("inicio", { ascending: false }).limit(limite)),
    async ejecucionesDelMes() {
      const inicio = new Date();
      inicio.setDate(1);
      inicio.setHours(0, 0, 0, 0);
      return comprobar(
        await sb.from("ejecuciones").select("duracion_s").gte("inicio", inicio.toISOString()).limit(1000),
      );
    },
  };
}

export const api = modoDemo || !configurado ? crearDemo() : await crearReal();
export const esDemo = modoDemo || !configurado;
