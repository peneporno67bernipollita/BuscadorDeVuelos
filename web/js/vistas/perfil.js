import { api } from "../api.js";
import { $, aviso, esc, generarCodigo } from "../util.js";

export async function vistaPerfil(app, primeraVez, alTerminar) {
  const perfil = await api.perfil();
  if (!perfil.telegram_chat_id && !perfil.telegram_codigo) {
    perfil.telegram_codigo = generarCodigo();
    await api.guardarPerfil({ telegram_codigo: perfil.telegram_codigo });
  }
  const radio = (nombre, valor, texto, actual) =>
    `<label><input type="radio" name="${nombre}" value="${valor}" ${actual === valor ? "checked" : ""}>${texto}</label>`;

  app.innerHTML = `
    <div class="titulo-pagina"><h1>${primeraVez ? "👋 Bienvenido: completa tu perfil" : "Perfil"}</h1></div>
    ${primeraVez ? '<p class="suave">Solo se pregunta una vez. Con esto el robot calcula tus descuentos y sabe dónde avisarte.</p>' : ""}
    <form id="form-perfil" class="tarjeta">
      <div class="campo">
        <label for="nombre">Tu nombre</label>
        <input id="nombre" value="${esc(perfil.nombre || "")}" maxlength="60">
      </div>
      <fieldset class="campo">
        <legend>¿Tienes título de familia numerosa?</legend>
        <div class="opciones-radio">
          ${radio("familia", "ninguna", "No", perfil.familia_numerosa)}
          ${radio("familia", "general", "Sí, categoría general", perfil.familia_numerosa)}
          ${radio("familia", "especial", "Sí, categoría especial", perfil.familia_numerosa)}
        </div>
        <div class="ayuda">Descuento oficial en vuelos <b>dentro de España</b>: 5 % (general) o 10 % (especial) sobre la tarifa, sin tasas.
          El robot lo resta automáticamente en esos vuelos. El número del título no se guarda: lo pones tú al comprar.</div>
      </fieldset>
      <div class="campo">
        <label for="residente">¿Eres residente en Canarias, Baleares o Melilla?</label>
        <select id="residente">
          <option value="ninguno">No</option>
          <option value="canarias">Sí, en Canarias</option>
          <option value="baleares">Sí, en Baleares</option>
          <option value="melilla">Sí, en Melilla</option>
        </select>
        <div class="ayuda">Descuento de residente: 75 % de la tarifa (80 % u 85 % si además eres familia numerosa) en vuelos entre tu isla/ciudad y el resto de España.</div>
      </div>
      <button class="primario" type="submit">${primeraVez ? "Guardar y continuar" : "Guardar cambios"}</button>
    </form>

    <section class="tarjeta">
      <h2>📱 Avisos por Telegram</h2>
      ${perfil.telegram_chat_id
        ? `<p><span class="insignia ok">Vinculado</span> Los avisos llegarán a tu chat de Telegram.</p>
           <button type="button" id="desvincular" class="pequeno">Desvincular y generar un código nuevo</button>`
        : `<p>Para recibir los avisos en el móvil, vincula tu bot de Telegram:</p>
           <ol class="pasos">
             <li>Crea tu bot con <b>@BotFather</b> y guarda su token en GitHub (lo explica <code>docs/INSTALACION.md</code>, paso 5).</li>
             <li>Abre el chat con tu bot en Telegram y envíale este mensaje:<br>
               <span class="codigo-telegram">/start ${esc(perfil.telegram_codigo)}</span></li>
             <li>El robot lo verá en su siguiente ronda (máximo 3 horas) y te contestará "✅ ¡Listo!".
               Si no quieres esperar, en GitHub → Actions → "Robot de vuelos" pulsa <b>Run workflow</b>.</li>
           </ol>
           <p class="suave pequeno">El código solo sirve una vez y únicamente lo conoces tú, así nadie más puede recibir tus avisos.</p>`}
    </section>

    ${primeraVez ? "" : `
    <section class="tarjeta">
      <h2>🔒 Cambiar contraseña</h2>
      <form id="form-pass" class="fila">
        <input id="nueva-pass" type="password" minlength="6" placeholder="Nueva contraseña" autocomplete="new-password" style="max-width:260px">
        <button type="submit">Cambiar</button>
      </form>
    </section>`}`;

  $("#residente").value = perfil.residente || "ninguno";

  $("#form-perfil").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const campos = {
      nombre: $("#nombre").value.trim() || null,
      familia_numerosa: app.querySelector('input[name="familia"]:checked')?.value || "ninguna",
      residente: $("#residente").value,
      perfil_completado: true,
    };
    try {
      await api.guardarPerfil(campos);
      aviso("Perfil guardado");
      if (alTerminar) alTerminar();
    } catch (e) {
      aviso(e.message, "error");
    }
  });

  $("#desvincular")?.addEventListener("click", async () => {
    if (!confirm("¿Desvincular Telegram? Dejarás de recibir avisos hasta que lo vuelvas a vincular.")) return;
    await api.guardarPerfil({ telegram_chat_id: null, telegram_codigo: generarCodigo() });
    vistaPerfil(app, primeraVez, alTerminar);
  });

  $("#form-pass")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pass = $("#nueva-pass").value;
    if (pass.length < 6) return aviso("Mínimo 6 caracteres", "error");
    try {
      await api.cambiarPassword(pass);
      $("#nueva-pass").value = "";
      aviso("Contraseña cambiada");
    } catch (e) {
      aviso(e.message, "error");
    }
  });
}
