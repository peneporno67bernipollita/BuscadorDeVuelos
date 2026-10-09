// Notificaciones en pantalla al estilo de Sileo (https://sileo.aaryan.design · MIT, © Aaryan Arora),
// reescritas sin React y con la paleta «Carta de navegación»: una pastilla que se estira con efecto
// «gota» (filtro SVG) y se despliega con el detalle. Es una sola notificación que se transforma:
// si llega otra mientras se ve, la pastilla cambia de texto y de tamaño en vez de apilarse.

const ALTO = 40; // alto de la pastilla
const RELLENO_PASTILLA = 10;
const MIN_DESPLEGADA = ALTO * 2.25;
const DESENFOQUE = 8; // radio 16 × 0,5, como Sileo
const DURACION = 6000;
const DESPLEGAR_A = 150;
const PLEGAR_A = 4000;
const SALIDA = 600;
const CAMBIO_PLEGADA = 200;
const SALIDA_CABECERA = 420;
const DESLIZAR_CERRAR = 30;
const DESLIZAR_MAX = 20;

const TIPOS = {
  ok: { estado: "ok", titulo: "Hecho", rol: "status" },
  error: { estado: "error", titulo: "Algo ha fallado", rol: "alert" },
  alerta: { estado: "alerta", titulo: "Atención", rol: "status" },
  info: { estado: "info", titulo: "Para que lo sepas", rol: "status" },
  accion: { estado: "accion", titulo: "Pendiente", rol: "status" },
};

const svg = (trazos) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${trazos}</svg>`;
const ICONOS = {
  ok: svg('<path d="M20 6 9 17l-5-5"/>'),
  error: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  alerta: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  accion: svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
};

const esc = (valor) =>
  String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mayuscula = (t) => (t ? t[0].toLocaleUpperCase("es") + t.slice(1) : t);

/**
 * Parte un mensaje en título corto + detalle: "Cambios guardados: el robot la revisa en un minuto"
 * → «Cambios guardados» y, al desplegarse, «El robot la revisa en un minuto».
 */
export function partirMensaje(mensaje, tituloPorDefecto) {
  const texto = String(mensaje ?? "").trim();
  const corte = texto.match(/^(.{2,44}?)(?::\s+|(?<=[.!?])\s+)(\S[\s\S]*)$/u);
  if (corte) return { titulo: corte[1].replace(/\.$/, ""), descripcion: mayuscula(corte[2]) };
  if (texto.length <= 44) return { titulo: texto, descripcion: "" };
  return { titulo: tituloPorDefecto, descripcion: texto };
}

let actual = null; // la notificación visible (solo hay una, que se transforma)

function zona() {
  let caja = document.getElementById("toasts");
  if (!caja) {
    caja = document.createElement("div");
    caja.id = "toasts";
    document.body.append(caja);
  }
  if (!document.getElementById("notis-gota")) {
    caja.className = "notis";
    caja.insertAdjacentHTML("afterbegin", `<svg class="notis-filtro" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="notis-gota" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${DESENFOQUE}" result="desenfoque"/>
        <feColorMatrix in="desenfoque" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="gota"/>
        <feComposite in="SourceGraphic" in2="gota" operator="atop"/>
      </filter></svg>`);
  }
  return caja;
}

const centrada = () => window.matchMedia("(max-width: 900px)").matches;

class Noti {
  constructor(vista) {
    this.timers = new Set();
    this.raton = false;
    this.abierta = false;
    this.saliendo = false;
    this.el = document.createElement("div");
    this.el.className = "noti";
    this.el.innerHTML = `
      <div class="noti-lienzo" aria-hidden="true"><div class="noti-pastilla"></div><div class="noti-cuerpo"></div></div>
      <div class="noti-cabecera" aria-hidden="true"><div class="noti-pila"></div></div>
      <div class="noti-contenido"><div class="noti-detalle"></div></div>
      <span class="noti-lector"></span>`;
    this.pila = this.el.querySelector(".noti-pila");
    this.detalle = this.el.querySelector(".noti-detalle");
    this.lector = this.el.querySelector(".noti-lector");
    this.escuchar();
    zona().append(this.el);
    this.aplicar(vista, true);
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.setAttribute("data-lista", "")));
  }

  temporizador(ms, fn) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  parar() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  programar() {
    this.parar();
    const hay = Boolean(this.vista.descripcion || this.vista.boton);
    if (this.raton) {
      // Con el ratón encima no se cierra: el mensaje nuevo se despliega y espera
      if (hay) this.temporizador(DESPLEGAR_A, () => this.desplegar(true));
      return;
    }
    if (hay) {
      this.temporizador(DESPLEGAR_A, () => this.desplegar(true));
      this.temporizador(PLEGAR_A, () => this.desplegar(false));
    }
    this.temporizador(this.vista.duracion, () => this.cerrar());
  }

  /** Pinta una vista nueva (la primera o la que sustituye a la anterior). */
  aplicar(vista, primera = false) {
    this.vista = vista;
    this.el.dataset.estado = vista.estado;
    // El lector de pantalla oye el mensaje completo aunque el detalle esté plegado
    this.lector.setAttribute("role", vista.rol);
    this.lector.textContent = "";
    requestAnimationFrame(() => (this.lector.textContent = [vista.titulo, vista.descripcion].filter(Boolean).join(". ")));

    const anterior = this.pila.querySelector(".noti-titular:not([data-saliendo])");
    const nuevo = document.createElement("div");
    nuevo.className = "noti-titular";
    nuevo.dataset.estado = vista.estado;
    nuevo.innerHTML = `<span class="noti-insignia">${ICONOS[vista.estado]}</span><span class="noti-titulo">${esc(vista.titulo)}</span>`;
    if (anterior && !primera) {
      anterior.dataset.saliendo = "";
      setTimeout(() => anterior.remove(), SALIDA_CABECERA);
    }
    this.pila.prepend(nuevo);
    this.titular = nuevo;

    this.detalle.innerHTML = vista.descripcion ? esc(vista.descripcion) : "";
    if (vista.boton) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "noti-boton";
      b.textContent = vista.boton.texto;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        vista.boton.alPulsar?.();
        this.cerrar();
      });
      this.detalle.append(b);
    }
    this.medir();
    this.programar();
  }

  /** Ancho de la pastilla según el título y alto del cuerpo según el detalle. */
  medir() {
    const ancho = this.el.clientWidth || 350;
    const pastilla = Math.min(ancho, Math.max(ALTO, this.titular.scrollWidth + 16 + RELLENO_PASTILLA));
    const x = centrada() ? (ancho - pastilla) / 2 : ancho - pastilla;
    const hay = Boolean(this.vista.descripcion || this.vista.boton);
    const desplegada = hay ? Math.max(MIN_DESPLEGADA, ALTO + this.detalle.scrollHeight) : ALTO;
    const s = this.el.style;
    s.setProperty("--pw", `${pastilla}px`);
    s.setProperty("--px", `${x}px`);
    s.setProperty("--desplegada", `${desplegada}px`);
    s.setProperty("--cuerpo", `${desplegada - ALTO}px`);
  }

  desplegar(si) {
    const puede = si && !this.saliendo && Boolean(this.vista.descripcion || this.vista.boton);
    if (puede === this.abierta) return;
    this.abierta = puede;
    if (puede) this.medir();
    this.el.toggleAttribute("data-abierta", puede);
  }

  /** Llega otro mensaje: si está desplegada, primero se pliega y luego cambia. */
  sustituir(vista) {
    if (this.saliendo) return false;
    this.parar();
    if (this.abierta) {
      this.desplegar(false);
      this.temporizador(CAMBIO_PLEGADA, () => this.aplicar(vista));
    } else {
      this.aplicar(vista);
    }
    return true;
  }

  cerrar() {
    if (this.saliendo) return;
    this.saliendo = true;
    this.parar();
    this.desplegar(false);
    this.el.setAttribute("data-saliendo", "");
    if (actual === this) actual = null;
    setTimeout(() => this.el.remove(), SALIDA);
  }

  escuchar() {
    const el = this.el;
    el.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType !== "mouse" || this.saliendo) return;
      this.raton = true;
      this.parar();
      this.desplegar(true);
    });
    el.addEventListener("pointerleave", (ev) => {
      if (ev.pointerType !== "mouse" || !this.raton) return;
      this.raton = false;
      this.desplegar(false);
      this.temporizador(PLEGAR_A, () => this.cerrar());
    });
    // Deslizar hacia arriba o abajo la cierra; un toque en el móvil la abre o la pliega
    let inicio = null;
    let tipo = "mouse";
    const mover = (ev) => {
      if (inicio === null) return;
      const dy = ev.clientY - inicio;
      el.style.translate = `0 ${Math.sign(dy) * Math.min(Math.abs(dy), DESLIZAR_MAX)}px`;
    };
    const soltar = (ev) => {
      if (inicio === null) return;
      const dy = ev.clientY - inicio;
      inicio = null;
      el.style.translate = "";
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerup", soltar);
      el.removeEventListener("pointercancel", soltar);
      if (Math.abs(dy) > DESLIZAR_CERRAR) return this.cerrar();
      if (tipo === "mouse") return;
      this.parar();
      if (Math.abs(dy) < 6) this.desplegar(!this.abierta);
      this.temporizador(PLEGAR_A, () => this.cerrar());
    };
    el.addEventListener("pointerdown", (ev) => {
      if (this.saliendo || ev.target.closest(".noti-boton")) return;
      inicio = ev.clientY;
      tipo = ev.pointerType;
      if (tipo !== "mouse") this.parar();
      ev.target.setPointerCapture?.(ev.pointerId);
      el.addEventListener("pointermove", mover, { passive: true });
      el.addEventListener("pointerup", soltar);
      el.addEventListener("pointercancel", soltar);
    });
  }
}

/**
 * Muestra una notificación. Uso: aviso("Perfil guardado"), aviso(error.message, "error"),
 * aviso("Horario guardado", "ok", { descripcion: "…", boton: { texto: "Ver", alPulsar() {…} } }).
 * tipo: "ok" | "error" | "alerta" | "info" | "accion".
 */
export function aviso(mensaje, tipo = "ok", opciones = {}) {
  const base = TIPOS[tipo] || TIPOS.ok;
  const partes = opciones.descripcion !== undefined
    ? { titulo: mensaje, descripcion: opciones.descripcion }
    : partirMensaje(mensaje, base.titulo);
  const vista = {
    estado: base.estado,
    rol: base.rol,
    titulo: partes.titulo,
    descripcion: partes.descripcion,
    boton: opciones.boton || null,
    duracion: opciones.duracion ?? DURACION,
  };
  if (actual && actual.sustituir(vista)) return;
  actual = new Noti(vista);
}

// Al girar el móvil o cambiar el ancho, la pastilla se recoloca
window.addEventListener("resize", () => actual?.medir());
