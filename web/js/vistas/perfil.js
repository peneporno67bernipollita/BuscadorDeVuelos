import { api, enviarAlarmaPrueba, esDemo } from "../api.js";
import { BOT_TELEGRAM } from "../config.js";
import { icono } from "../iconos.js";
import { $, aviso, cadaSegundos, conCarga, confirmar, esc, generarCodigo, hace, limpiarPantalla } from "../util.js";

const FAMILIA = [
  ["ninguna", "No tengo", "Sin descuento", "usuario"],
  ["general", "General", "5 % en vuelos nacionales", "personas"],
  ["especial", "Especial", "10 % en vuelos nacionales", "personas"],
];
const RESIDENTE = [["ninguno", "No"], ["canarias", "Canarias"], ["baleares", "Baleares"], ["melilla", "Melilla"]];
const ENLACE_BOT = `https://t.me/${BOT_TELEGRAM}`;

/** ¿El robot ha dado señales de vida en los últimos 5 minutos? */
const robotEnMarcha = (latido) => Boolean(latido?.en) && Date.now() - new Date(latido.en) < 5 * 60000;

function notaRobot(latido) {
  return robotEnMarcha(latido)
    ? `<div class="nota ok" data-robot>${icono("robot")}<span>El robot está en marcha (última señal ${hace(latido.en)}): te contestará en menos de un minuto.</span></div>`
    : `<div class="nota alerta" data-robot>${icono("aviso")}<span>El robot no está en marcha ahora mismo${latido?.en ? ` (última señal ${hace(latido.en)})` : ""}.
        Arráncalo en GitHub → Actions → <b>Robot de vuelos</b> → <b>Run workflow</b>; al arrancar leerá tu mensaje.</span></div>`;
}

const TIENDAS_NTFY = {
  android: "https://play.google.com/store/apps/details?id=io.heckel.ntfy",
  iphone: "https://apps.apple.com/app/ntfy/id1625396347",
};
/** Canal secreto de ntfy: hace de contraseña, así que es largo y aleatorio. */
const nuevoTemaNtfy = () => `vuelos-${generarCodigo()}${generarCodigo()}`.toLowerCase();

function notaAlarma() {
  return `<div class="nota">${icono("reloj")}<span>Alarma de prueba pedida: el robot la enviará en cuanto termine lo que está buscando (unos minutos).</span></div>`;
}

/** Alarma en el móvil (app ntfy) para los chollazos. */
function bloqueAlarma(perfil) {
  if (!("alarma_chollos" in perfil)) {
    return `
      <div class="alarma-movil">
        <h3>${icono("campana")}Alarma en el móvil para los chollazos</h3>
        <div class="nota alerta">${icono("aviso")}<span>Para activarla falta actualizar la base de datos: en Supabase → SQL Editor
          pega todo <code>supabase/instalar.sql</code> y pulsa Run.</span></div>
      </div>`;
  }
  const tema = esc(perfil.ntfy_tema || "");
  return `
    <div class="alarma-movil">
      <div class="fila entre">
        <h3>${icono("campana")}Alarma en el móvil para los chollazos</h3>
        <label class="interruptor"><input type="checkbox" id="alarma-chollos" ${perfil.alarma_chollos ? "checked" : ""}><span class="pista"></span>Activada</label>
      </div>
      <p class="suave pequeno">Con una <b>bajada fuerte</b>, un <b>chollo</b> o un precio <b>dentro de tu objetivo</b>, además del mensaje de Telegram
        te llega una alerta urgente de la app gratuita <b>ntfy</b>, con botón para comprar. En Android puede sonar como una alarma aunque tengas "No molestar".</p>
      <ol class="pasos">
        <li><span>Instala <b>ntfy</b>: <a href="${TIENDAS_NTFY.android}" target="_blank" rel="noopener">Android (Google Play)</a> ·
          <a href="${TIENDAS_NTFY.iphone}" target="_blank" rel="noopener">iPhone (App Store)</a>.</span></li>
        <li><span>Suscríbete a tu canal secreto. En Android, desde el móvil:
          <a class="boton pequeno" href="ntfy://ntfy.sh/${tema}?display=Chollos%20de%20vuelos">${icono("externo")}Abrir en ntfy</a>.
          O en la app pulsa <b>+</b>, escribe este nombre y deja el servidor que viene (ntfy.sh):
          <span class="fila" style="margin-top:.45rem;gap:.4rem"><span class="tema-ntfy" id="tema-ntfy">${tema}</span>
          <button class="icono pequeno" id="copiar-tema" title="Copiar el nombre del canal">${icono("copiar")}</button></span>
          Si te lo ofrece, marca <b>Entrega instantánea</b> (así llega al momento aunque el móvil lleve rato con la pantalla apagada).</span></li>
        <li><span><b>Que suene fuerte</b> (Android): mantén pulsado el icono de ntfy → <b>Notificaciones</b> → canal de <b>prioridad máxima</b>
          ("Max priority") → elige un sonido de alarma y permite que <b>ignore "No molestar"</b>.</span></li>
        <li><span>Activa el interruptor y pulsa <b>Probar alarma</b>.</span></li>
      </ol>
      <div id="alarma-estado">${perfil.alarma_prueba ? notaAlarma() : ""}</div>
      <div class="fila" style="margin-top:.6rem">
        <button class="primario" id="probar-alarma" ${perfil.alarma_prueba ? "disabled" : ""}>${icono("campana")}Probar alarma</button>
      </div>
      <p class="pequeno tenue" style="margin-top:.7rem">El nombre del canal funciona como una contraseña: no lo compartas. ntfy.sh recibe el texto
        del aviso (nombre de la búsqueda y precio). En iPhone llega como notificación normal: no puede saltarse el "No molestar".</p>
    </div>`;
}

function tarjetaTelegram(perfil, latido) {
  if (perfil.telegram_chat_id) {
    return `
      <section class="tarjeta resaltada" id="telegram">
        <div class="tarjeta-titulo"><h2>${icono("telegram")}Avisos por Telegram</h2>
          <span class="chip ok">${icono("check")}Vinculado</span></div>
        <p>Los avisos te llegan al chat con <a href="${ENLACE_BOT}" target="_blank" rel="noopener">@${esc(BOT_TELEGRAM)}</a>.
          En ese chat también puedes escribir <code>/estado</code> para ver tus búsquedas o <code>/ayuda</code>.</p>
        <div id="prueba-estado">${perfil.telegram_prueba ? notaPrueba() : ""}</div>
        <div class="fila" style="margin-top:1rem">
          <button class="primario" id="probar" ${perfil.telegram_prueba ? "disabled" : ""}>${icono("enviar")}Enviar mensaje de prueba</button>
          <a class="boton" href="${ENLACE_BOT}" target="_blank" rel="noopener">${icono("externo")}Abrir el chat</a>
        </div>
        <div style="margin-top:1.1rem;padding-top:1rem;border-top:1px solid var(--borde)">
          <button class="fantasma pequeno peligro" id="revincular">${icono("intercambiar")}Volver a vincular (código nuevo)</button>
          <div class="ayuda">Úsalo si cambias de móvil o de cuenta de Telegram, o si los avisos no te llegan.</div>
        </div>
        ${bloqueAlarma(perfil)}
        ${notaRobot(latido)}
      </section>`;
  }
  const codigo = esc(perfil.telegram_codigo);
  return `
    <section class="tarjeta resaltada" id="telegram">
      <div class="tarjeta-titulo"><h2>${icono("telegram")}Vincula Telegram</h2>
        <span class="vivo" style="color:var(--alerta)"><span class="punto-vivo aviso"></span>Esperando…</span></div>
      <p class="suave">Así el robot te escribe al móvil en cuanto encuentra el buen momento para comprar.</p>
      <div class="fila" style="margin:1rem 0">
        <span class="codigo-grande" id="codigo">${codigo}</span>
        <button class="icono" id="copiar" title="Copiar el código">${icono("copiar")}</button>
      </div>
      <a class="boton primario grande bloque" href="${ENLACE_BOT}?start=${encodeURIComponent(perfil.telegram_codigo)}" target="_blank" rel="noopener">
        ${icono("telegram")}Abrir Telegram y vincular</a>
      <ol class="pasos" style="margin-top:1.2rem">
        <li><span>Pulsa <b>Abrir Telegram y vincular</b>: se abre el chat con <b>@${esc(BOT_TELEGRAM)}</b> con tu código ya puesto.</span></li>
        <li><span>En Telegram pulsa <b>Iniciar</b> (o <b>Start</b>). Si ya habías hablado con el bot, envíale
          <code>/start ${codigo}</code>.</span></li>
        <li><span>El robot te contestará <b>"✅ ¡Listo!"</b> y esta tarjeta se pondrá en verde sola.</span></li>
      </ol>
      ${notaRobot(latido)}
      <p class="pequeno tenue" style="margin-top:.9rem">El código sirve una sola vez y solo lo ves tú: nadie más puede recibir tus avisos.
        <button class="fantasma pequeno" id="otro-codigo">${icono("intercambiar")}Generar otro código</button></p>
    </section>`;
}

function notaPrueba() {
  return `<div class="nota">${icono("reloj")}<span>Mensaje de prueba pedido: el robot lo enviará en menos de un minuto si está en marcha.</span></div>`;
}

export async function vistaPerfil(app, primeraVez, alTerminar) {
  const repintar = () => {
    limpiarPantalla();
    return vistaPerfil(app, primeraVez, alTerminar);
  };
  let [perfil, latido] = await Promise.all([api.perfil(), api.latido()]);
  if (!perfil.telegram_chat_id && !perfil.telegram_codigo) {
    perfil = await api.guardarPerfil({ telegram_codigo: generarCodigo() });
  }
  if ("alarma_chollos" in perfil && !perfil.ntfy_tema) {
    perfil = await api.guardarPerfil({ ntfy_tema: nuevoTemaNtfy() });
  }

  app.innerHTML = `
    <div>
      <div class="cabecera-pagina">
        <div>
          <h1>${primeraVez ? "👋 Antes de empezar" : "Tu perfil"}</h1>
          <p class="subtitulo">${primeraVez
            ? "Solo se pregunta una vez. Con esto el robot calcula tus descuentos y sabe dónde avisarte."
            : "Tus descuentos, los avisos de Telegram y tu contraseña."}</p>
        </div>
      </div>
      <div class="rejilla-2">
        <div class="escalonado">
          <form id="form-perfil" class="tarjeta" novalidate>
            <div class="tarjeta-titulo"><h2>${icono("usuario")}Tus datos</h2></div>
            <div class="campo"><label for="nombre">¿Cómo te llamas?</label>
              <input id="nombre" value="${esc(perfil.nombre || "")}" maxlength="60" placeholder="Para saludarte en el panel"></div>

            <label style="margin-top:1.3rem">¿Tienes título de familia numerosa?</label>
            <div class="opciones-tarjeta">
              ${FAMILIA.map(([valor, titulo, texto, ic]) => `
                <label class="opcion-tarjeta"><input type="radio" name="familia" value="${valor}" ${perfil.familia_numerosa === valor ? "checked" : ""}>
                  <span class="icono-opcion">${icono(ic)}</span><span><b>${titulo}</b><small>${texto}</small></span></label>`).join("")}
            </div>
            <div class="ayuda">Descuento oficial sobre la tarifa (sin tasas) en vuelos <b>dentro de España</b>. El robot lo resta solo;
              el número del título no se guarda: lo escribes tú al comprar.</div>

            <label style="margin-top:1.3rem">¿Eres residente en Canarias, Baleares o Melilla?</label>
            <div class="segmentado">
              ${RESIDENTE.map(([valor, texto]) => `<label><input type="radio" name="residente" value="${valor}" ${(perfil.residente || "ninguno") === valor ? "checked" : ""}>${texto}</label>`).join("")}
            </div>
            <div class="ayuda">Descuento de residente: 75 % de la tarifa (80 % u 85 % si además eres familia numerosa) en vuelos entre tu isla o ciudad y el resto de España.</div>

            <button class="primario grande" type="submit" style="margin-top:1.4rem">${icono("check")}${primeraVez ? "Guardar y empezar" : "Guardar cambios"}</button>
          </form>

          ${primeraVez ? "" : `
          <form id="form-pass" class="tarjeta" novalidate>
            <div class="tarjeta-titulo"><h2>${icono("candado")}Cambiar contraseña</h2></div>
            <div class="fila" style="align-items:flex-start">
              <input id="nueva-pass" type="password" minlength="6" placeholder="Nueva contraseña (mínimo 6)" autocomplete="new-password" style="flex:1;min-width:200px">
              <button type="submit">${icono("candado")}Cambiar</button>
            </div>
          </form>`}
        </div>
        <div class="escalonado" id="columna-telegram">${tarjetaTelegram(perfil, latido)}</div>
      </div>
    </div>`;

  // --- Datos y descuentos
  $("#form-perfil").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const campos = {
      nombre: $("#nombre").value.trim() || null,
      familia_numerosa: app.querySelector('input[name="familia"]:checked')?.value || "ninguna",
      residente: app.querySelector('input[name="residente"]:checked')?.value || "ninguno",
      perfil_completado: true,
    };
    try {
      await conCarga(ev.submitter, api.guardarPerfil(campos));
      aviso("Perfil guardado");
      if (alTerminar) alTerminar();
    } catch (e) {
      aviso(e.message, "error");
    }
  });

  $("#form-pass")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pass = $("#nueva-pass").value;
    if (pass.length < 6) return aviso("La contraseña necesita al menos 6 caracteres", "error");
    try {
      await conCarga(ev.submitter, api.cambiarPassword(pass));
      $("#nueva-pass").value = "";
      aviso("Contraseña cambiada");
    } catch (e) {
      aviso(e.message, "error");
    }
  });

  // --- Telegram
  const nuevoCodigo = async (boton) => {
    const campos = { telegram_chat_id: null, telegram_codigo: generarCodigo() };
    // telegram_prueba solo existe si la base de datos ya está actualizada (instalar.sql v2)
    if ("telegram_prueba" in perfil) campos.telegram_prueba = false;
    await conCarga(boton, api.guardarPerfil(campos));
    aviso("Código nuevo listo: pulsa «Abrir Telegram y vincular»");
    repintar();
  };
  $("#copiar")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(perfil.telegram_codigo);
      aviso("Código copiado");
    } catch {
      aviso("No se pudo copiar: selecciónalo y cópialo a mano", "error");
    }
  });
  $("#otro-codigo")?.addEventListener("click", (ev) => nuevoCodigo(ev.currentTarget).catch((e) => aviso(e.message, "error")));
  $("#revincular")?.addEventListener("click", async (ev) => {
    const boton = ev.currentTarget;
    const si = await confirmar({
      titulo: "¿Volver a vincular Telegram?",
      texto: "Se desconecta el chat actual y se genera un código nuevo. No recibirás avisos hasta que lo vincules otra vez.",
      aceptar: "Generar código nuevo",
    });
    if (si) nuevoCodigo(boton).catch((e) => aviso(e.message, "error"));
  });
  $("#probar")?.addEventListener("click", async (ev) => {
    const boton = ev.currentTarget;
    try {
      await conCarga(boton, api.pedirPruebaTelegram());
      perfil.telegram_prueba = true;
      boton.disabled = true;
      $("#prueba-estado").innerHTML = notaPrueba();
      aviso("Pedido: mira Telegram en un minuto");
    } catch (e) {
      aviso(e.message, "error");
    }
  });

  // --- Alarma en el móvil (ntfy)
  $("#alarma-chollos")?.addEventListener("change", async (ev) => {
    const caja = ev.currentTarget;
    try {
      Object.assign(perfil, await api.guardarPerfil({ alarma_chollos: caja.checked }));
      aviso(caja.checked ? "Alarma activada para los chollazos" : "Alarma desactivada");
    } catch (e) {
      caja.checked = !caja.checked;
      aviso(e.message, "error");
    }
  });
  $("#copiar-tema")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(perfil.ntfy_tema);
      aviso("Nombre del canal copiado");
    } catch {
      aviso("No se pudo copiar: selecciónalo y cópialo a mano", "error");
    }
  });
  $("#probar-alarma")?.addEventListener("click", async (ev) => {
    const boton = ev.currentTarget;
    try {
      // Directamente a ntfy: suena al momento
      await conCarga(boton, enviarAlarmaPrueba(perfil.ntfy_tema));
      $("#alarma-estado").innerHTML = `<div class="nota ok">${icono("campana")}<span>Alarma enviada: tu móvil debería estar sonando ya.
        ¿No suena? Comprueba que en la app ntfy estás suscrito a este canal exacto y revisa el sonido de la prioridad máxima.</span></div>`;
      aviso("Alarma enviada: debería sonar ahora mismo");
    } catch {
      // Si el navegador no puede, se la pide al robot (tarda un poco más)
      try {
        Object.assign(perfil, await conCarga(boton, api.guardarPerfil({ alarma_prueba: true })));
        boton.disabled = true;
        $("#alarma-estado").innerHTML = notaAlarma();
        aviso("Pedida al robot: te llegará en unos minutos");
      } catch (e) {
        aviso(e.message, "error");
      }
    }
  });

  // Mientras se espera la vinculación, el mensaje o la llamada de prueba, se comprueba cada pocos segundos
  cadaSegundos(esDemo ? 3 : 6, async () => {
    if (perfil.telegram_chat_id && !perfil.telegram_prueba && !perfil.alarma_prueba) return;
    let ahora;
    try {
      ahora = await api.perfil();
    } catch {
      return;
    }
    if (!perfil.telegram_chat_id && ahora.telegram_chat_id) {
      aviso("¡Telegram vinculado! Ya te llegarán los avisos 🎉");
      repintar();
    } else if (perfil.telegram_prueba && !ahora.telegram_prueba) {
      perfil.telegram_prueba = false;
      $("#prueba-estado").innerHTML = `<div class="nota ok">${icono("check")}<span>Mensaje de prueba enviado: debería estar ya en tu Telegram.</span></div>`;
      const boton = $("#probar");
      if (boton) boton.disabled = false;
    }
    if (perfil.alarma_prueba && !ahora.alarma_prueba) {
      perfil.alarma_prueba = false;
      $("#alarma-estado").innerHTML = `<div class="nota ok">${icono("campana")}<span>Alarma de prueba enviada. ¿No te ha llegado? Comprueba que en
        la app ntfy estás suscrito a este canal exacto; el bot te ha escrito en Telegram si hubo algún problema.</span></div>`;
      const boton = $("#probar-alarma");
      if (boton) boton.disabled = false;
    }
  });
  // El estado del robot (en marcha o no) se refresca cada minuto
  cadaSegundos(60, async () => {
    const nuevo = await api.latido().catch(() => null);
    const nota = $("#telegram [data-robot]");
    if (nota) nota.outerHTML = notaRobot(nuevo);
  });
}
