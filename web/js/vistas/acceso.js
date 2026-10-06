import { api } from "../api.js";
import { $, aviso, esc } from "../util.js";

export function vistaAcceso(app) {
  let modo = "entrar";
  const pintar = () => {
    app.innerHTML = `
      <div class="acceso">
        <div class="marca-grande">✈️</div>
        <h1 style="text-align:center">Buscador de Vuelos</h1>
        <p class="suave" style="text-align:center">Vigila precios por ti y te avisa cuándo comprar.</p>
        <div class="tarjeta">
          <div class="pestanas">
            <button type="button" data-modo="entrar" class="${modo === "entrar" ? "activa" : ""}">Entrar</button>
            <button type="button" data-modo="registro" class="${modo === "registro" ? "activa" : ""}">Crear cuenta</button>
          </div>
          <form id="form-acceso" novalidate>
            <div class="campo">
              <label for="email">Correo electrónico</label>
              <input id="email" type="email" autocomplete="email" required>
            </div>
            <div class="campo ${modo === "recuperar" ? "oculto" : ""}">
              <label for="password">Contraseña</label>
              <input id="password" type="password" autocomplete="${modo === "registro" ? "new-password" : "current-password"}" minlength="6">
              ${modo === "registro" ? '<div class="ayuda">Mínimo 6 caracteres.</div>' : ""}
            </div>
            ${modo === "registro" ? '<div class="nota">Esta web es solo para ti: únicamente se puede crear <b>una</b> cuenta. Después te llegará un correo para confirmarla.</div>' : ""}
            <div id="error" class="error-form"></div>
            <button class="primario" type="submit" style="width:100%;justify-content:center">
              ${modo === "entrar" ? "Entrar" : modo === "registro" ? "Crear mi cuenta" : "Enviarme un enlace"}
            </button>
          </form>
          <p class="pequeno" style="margin-top:.8rem;text-align:center">
            ${modo === "recuperar"
              ? '<button type="button" class="enlace" data-modo="entrar">Volver a entrar</button>'
              : '<button type="button" class="enlace" data-modo="recuperar">¿Has olvidado la contraseña?</button>'}
          </p>
        </div>
      </div>`;

    app.querySelectorAll("[data-modo]").forEach((b) =>
      b.addEventListener("click", () => {
        modo = b.dataset.modo;
        pintar();
      }),
    );
    $("#form-acceso").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = $("#email").value.trim();
      const password = $("#password").value;
      const error = $("#error");
      error.textContent = "";
      if (!email.includes("@")) return (error.textContent = "Escribe un correo válido.");
      if (modo !== "recuperar" && password.length < 6) return (error.textContent = "La contraseña debe tener al menos 6 caracteres.");
      const boton = ev.submitter;
      boton.disabled = true;
      try {
        if (modo === "entrar") {
          await api.entrar(email, password);
        } else if (modo === "registro") {
          const datos = await api.registrar(email, password);
          if (!datos?.session) {
            app.querySelector(".tarjeta").innerHTML = `
              <h2>📬 Revisa tu correo</h2>
              <p>Te hemos enviado un enlace a <b>${esc(email)}</b> para confirmar la cuenta. Ábrelo y volverás aquí ya dentro.</p>
              <p class="suave pequeno">Si no lo ves, mira en la carpeta de spam.</p>`;
          }
        } else {
          await api.recuperar(email);
          aviso("Si el correo existe, te llegará un enlace para entrar.");
          modo = "entrar";
          pintar();
        }
      } catch (e) {
        error.textContent = e.message;
      } finally {
        boton.disabled = false;
      }
    });
  };
  pintar();
}
