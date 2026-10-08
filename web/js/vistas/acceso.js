import { api } from "../api.js";
import { icono } from "../iconos.js";
import { $, aviso, conCarga, esc } from "../util.js";

const MAPA = `
  <svg class="mapa-vuelo" viewBox="0 0 600 360" fill="none" aria-hidden="true">
    <path class="trayectoria" d="M40 300 C 180 120, 360 90, 560 60" stroke="url(#g)" stroke-width="2.5"/>
    <circle cx="40" cy="300" r="7" fill="#22d3ee"/><circle cx="560" cy="60" r="7" fill="#a78bfa"/>
    <circle cx="40" cy="300" r="16" stroke="#22d3ee" stroke-opacity=".35"/><circle cx="560" cy="60" r="16" stroke="#a78bfa" stroke-opacity=".35"/>
    <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#22d3ee"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
  </svg>`;

export function vistaAcceso(app) {
  let modo = "entrar";
  const pintar = () => {
    const textoBoton = modo === "entrar" ? "Entrar" : modo === "registro" ? "Crear mi cuenta" : "Enviarme un enlace";
    app.innerHTML = `
      <div class="acceso pagina">
        <section class="acceso-heroe">
          <span class="etiqueta-superior">${icono("chispas")} Vuelos baratos en piloto automático</span>
          <h1>Deja que el robot<br><span class="texto-degradado">vigile los precios</span><br>por ti.</h1>
          <p class="grande">Revisa tus búsquedas sin parar, te enseña la evolución en directo y te avisa por Telegram
            cuando llega el buen momento para comprar.</p>
          <ul class="ventajas">
            <li><span>${icono("grafica")}</span>Gráfica de precios en tiempo real</li>
            <li><span>${icono("telegram")}</span>Avisos al instante en Telegram</li>
            <li><span>${icono("escudo")}</span>Solo aerolíneas seguras y webs oficiales</li>
            <li><span>${icono("maleta")}</span>Precio total real, con maletas y descuentos</li>
          </ul>
          ${MAPA}
        </section>
        <section class="acceso-panel">
          <div class="tarjeta acceso-tarjeta">
            <div class="fila" style="margin-bottom:1.3rem">
              <span class="marca-logo">${icono("avion")}</span>
              <div><b>Buscador de Vuelos</b><div class="suave pequeno">Tu buscador personal</div></div>
            </div>
            ${modo === "recuperar" ? "<h2>Recuperar contraseña</h2>" : `
            <div class="pestanas" role="tablist">
              <button type="button" data-modo="entrar" class="${modo === "entrar" ? "activa" : ""}">Entrar</button>
              <button type="button" data-modo="registro" class="${modo === "registro" ? "activa" : ""}">Crear cuenta</button>
            </div>`}
            <form id="form-acceso" novalidate>
              <div class="campo">
                <label for="email">Correo electrónico</label>
                <input id="email" type="email" autocomplete="email" placeholder="tu@correo.com" required>
              </div>
              <div class="campo ${modo === "recuperar" ? "oculto" : ""}">
                <label for="password">Contraseña</label>
                <input id="password" type="password" placeholder="••••••••" autocomplete="${modo === "registro" ? "new-password" : "current-password"}" minlength="6">
                ${modo === "registro" ? '<div class="ayuda">Mínimo 6 caracteres.</div>' : ""}
              </div>
              ${modo === "registro" ? `<div class="nota">${icono("info")}<span>Esta web es solo para ti: únicamente se puede crear <b>una</b> cuenta. Te llegará un correo para confirmarla.</span></div>` : ""}
              <div id="error" class="error-form" role="alert"></div>
              <button class="primario grande bloque" type="submit" style="margin-top:.6rem">${textoBoton}${icono("flecha")}</button>
            </form>
            <p class="pequeno" style="margin:1.1rem 0 0;text-align:center">
              ${modo === "recuperar"
                ? '<button type="button" class="fantasma pequeno" data-modo="entrar">Volver a entrar</button>'
                : '<button type="button" class="fantasma pequeno" data-modo="recuperar">¿Has olvidado la contraseña?</button>'}
            </p>
          </div>
        </section>
      </div>`;

    app.querySelectorAll("[data-modo]").forEach((b) =>
      b.addEventListener("click", () => {
        modo = b.dataset.modo;
        pintar();
      }),
    );
    $("#email").focus();
    $("#form-acceso").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = $("#email").value.trim();
      const password = $("#password").value;
      const error = $("#error");
      error.textContent = "";
      if (!email.includes("@")) return (error.textContent = "Escribe un correo válido.");
      if (modo !== "recuperar" && password.length < 6) return (error.textContent = "La contraseña debe tener al menos 6 caracteres.");
      try {
        await conCarga(ev.submitter, (async () => {
          if (modo === "entrar") {
            await api.entrar(email, password);
          } else if (modo === "registro") {
            const datos = await api.registrar(email, password);
            if (!datos?.session) {
              app.querySelector(".acceso-tarjeta").innerHTML = `
                <div class="vacio" style="padding:1rem 0">
                  <div class="ilustracion">${icono("enviar")}</div>
                  <h2>Revisa tu correo</h2>
                  <p>Te hemos enviado un enlace a <b>${esc(email)}</b> para confirmar la cuenta. Ábrelo y volverás aquí ya dentro.</p>
                  <p class="pequeno tenue">Si no lo ves, mira en la carpeta de spam.</p>
                </div>`;
            }
          } else {
            await api.recuperar(email);
            aviso("Si el correo existe, te llegará un enlace para entrar.");
            modo = "entrar";
            pintar();
          }
        })());
      } catch (e) {
        error.textContent = e.message;
      }
    });
  };
  pintar();
}
