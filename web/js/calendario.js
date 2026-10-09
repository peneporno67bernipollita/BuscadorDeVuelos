// Selector de fechas propio (sustituye al calendario del navegador). El campo es una tarjeta de embarque
// —ida a un lado, vuelta al otro y las noches en medio— y abre un calendario donde la ruta de la ida a la
// vuelta se marca en magenta, como la ruta activa de una carta de navegación.
// Teclado: flechas (día y semana), Re Pág / Av Pág (mes; con Mayús, año), Inicio / Fin (semana),
// Intro o espacio (elegir) y Esc (cerrar). Con lector de pantalla, cada día dice su fecha y su papel.
import { icono } from "./iconos.js";
import { alSalir, esc } from "./util.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = [["L", "lunes"], ["M", "martes"], ["X", "miércoles"], ["J", "jueves"], ["V", "viernes"], ["S", "sábado"], ["D", "domingo"]];
const fmtCorto = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" });
const fmtLargo = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const flecha = (d) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

export const aFecha = (iso) => {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return a && m && d ? new Date(a, m - 1, d) : null;
};
export const aIso = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
const sumarDias = (f, n) => new Date(f.getFullYear(), f.getMonth(), f.getDate() + n);
const sumarMeses = (f, n) => {
  const destino = new Date(f.getFullYear(), f.getMonth() + n, 1);
  const ultimo = new Date(destino.getFullYear(), destino.getMonth() + 1, 0).getDate();
  return new Date(destino.getFullYear(), destino.getMonth(), Math.min(f.getDate(), ultimo));
};
const primeroDeMes = (f) => new Date(f.getFullYear(), f.getMonth(), 1);
const igual = (a, b) => Boolean(a && b) && a.getTime() === b.getTime();
export const diasEntre = (a, b) => Math.round((b - a) / 86400000);
const corto = (f) => fmtCorto.format(f).replace(",", "");

/**
 * Campo de fechas. Opciones:
 *   inicio, fin       "AAAA-MM-DD" (fin solo con rango)
 *   rango             true: dos fechas (ida y vuelta, desde y hasta); false: una sola
 *   etiquetas         ["Ida", "Vuelta"]
 *   duracion(n)       texto entre las dos fechas ("3 noches"); n = días entre ellas
 *   min, max          "AAAA-MM-DD"
 *   nombre            nombre accesible del campo
 *   alCambiar(inicio, fin)
 */
export function selectorFechas(contenedor, opciones) {
  const o = { rango: false, etiquetas: ["Fecha", ""], duracion: null, nombre: "Fechas", ...opciones };
  const min = aFecha(o.min);
  const max = aFecha(o.max);
  let inicio = aFecha(o.inicio);
  let fin = o.rango ? aFecha(o.fin) : null;
  let rango = o.rango;
  let eligiendo = "inicio";
  let vista = primeroDeMes(inicio || min || new Date());
  let foco = inicio || min || new Date();
  let previa = null;
  let abierto = false;
  let cierre = null;

  contenedor.innerHTML = `
    <div class="selector-fechas">
      <div class="billete" role="group" aria-label="${esc(o.nombre)}"></div>
      <div class="calendario" role="dialog" aria-label="${esc(o.nombre)}: calendario" hidden>
        <div class="cal-navegacion">
          <button type="button" class="icono pequeno fantasma" data-mes="-1" aria-label="Mes anterior">${flecha("m15 18-6-6 6-6")}</button>
          <button type="button" class="icono pequeno fantasma" data-mes="1" aria-label="Mes siguiente">${flecha("m9 18 6-6-6-6")}</button>
        </div>
        <div class="cal-meses"></div>
        <div class="cal-pie">
          <span class="cal-estado" aria-live="polite"></span>
          <button type="button" class="pequeno" data-listo>Listo</button>
        </div>
      </div>
    </div>`;
  const raiz = contenedor.querySelector(".selector-fechas");
  const billete = raiz.querySelector(".billete");
  const cal = raiz.querySelector(".calendario");
  const meses = cal.querySelector(".cal-meses");
  const estado = cal.querySelector(".cal-estado");

  const disponible = (f) => (!min || f >= min) && (!max || f <= max);
  // Dos meses si caben a la derecha del campo (el calendario puede salirse de la tarjeta), si no, uno
  const mesesVisibles = () => (document.documentElement.clientWidth - raiz.getBoundingClientRect().left - 16 >= 660 ? 2 : 1);

  // ---- La tarjeta de embarque (campo cerrado)
  const parte = (cual, etiqueta, f) => `
    <button type="button" class="billete-parte ${cual === "fin" ? "fin" : ""}" data-parte="${cual}" aria-haspopup="dialog"
      aria-expanded="${abierto && eligiendo === cual}" aria-label="${esc(etiqueta)}: ${f ? fmtLargo.format(f) : "sin elegir"}">
      <span class="billete-etq">${esc(etiqueta)}</span>
      <span class="billete-fecha ${f ? "" : "vacia"}">${f ? corto(f) : "Elegir"}</span>
      <span class="billete-anyo">${f ? f.getFullYear() : "&nbsp;"}</span>
    </button>`;
  const pintarBillete = () => {
    const n = inicio && fin ? diasEntre(inicio, fin) : null;
    billete.classList.toggle("doble", rango);
    billete.innerHTML = rango
      ? `${parte("inicio", o.etiquetas[0], inicio)}
         <span class="billete-medio" aria-hidden="true">${icono("avion")}<span class="billete-duracion">${n != null && o.duracion ? esc(o.duracion(n)) : ""}</span></span>
         ${parte("fin", o.etiquetas[1], fin)}`
      : `${parte("inicio", o.etiquetas[0], inicio)}<span class="billete-icono" aria-hidden="true">${icono("calendario")}</span>`;
  };

  // ---- El calendario
  const papel = (f) => {
    const clases = [];
    const hasta = fin || (rango && eligiendo === "fin" && previa && inicio && previa > inicio ? previa : null);
    if (igual(f, inicio)) clases.push("inicio");
    if (rango && igual(f, fin)) clases.push("fin");
    if (rango && inicio && hasta && f > inicio && f < hasta) clases.push("en-ruta");
    if (!fin && hasta && igual(f, hasta)) clases.push("fin-previa");
    if (igual(f, new Date(new Date().setHours(0, 0, 0, 0)))) clases.push("hoy");
    return clases;
  };
  const etiquetaDia = (f) => {
    const extra = igual(f, inicio) ? `, ${o.etiquetas[0].toLowerCase()}` : rango && igual(f, fin) ? `, ${o.etiquetas[1].toLowerCase()}` : "";
    return `${fmtLargo.format(f)}${extra}${disponible(f) ? "" : ", no disponible"}`;
  };
  const mesHtml = (primero) => {
    const hueco = (primero.getDay() + 6) % 7; // lunes primero
    const total = new Date(primero.getFullYear(), primero.getMonth() + 1, 0).getDate();
    const celdas = [];
    for (let i = 0; i < hueco; i++) celdas.push('<td role="presentation"></td>');
    for (let d = 1; d <= total; d++) {
      const f = new Date(primero.getFullYear(), primero.getMonth(), d);
      const marcado = igual(f, inicio) || (rango && igual(f, fin));
      celdas.push(`<td role="gridcell" aria-selected="${marcado}">
        <button type="button" class="cal-dia ${papel(f).join(" ")}" data-dia="${aIso(f)}" tabindex="${igual(f, foco) ? 0 : -1}"
          aria-label="${etiquetaDia(f)}" ${disponible(f) ? "" : "disabled"}>${d}</button></td>`);
    }
    while (celdas.length % 7) celdas.push('<td role="presentation"></td>');
    const filas = [];
    for (let i = 0; i < celdas.length; i += 7) filas.push(`<tr>${celdas.slice(i, i + 7).join("")}</tr>`);
    const titulo = `${MESES[primero.getMonth()]} ${primero.getFullYear()}`;
    return `
      <div class="cal-mes">
        <div class="cal-titulo">${titulo}</div>
        <table class="cal-tabla" role="grid" aria-label="${titulo}">
          <thead><tr>${DIAS.map(([c, largo]) => `<th scope="col" abbr="${largo}">${c}</th>`).join("")}</tr></thead>
          <tbody>${filas.join("")}</tbody>
        </table>
      </div>`;
  };
  const textoEstado = () => {
    if (!rango) return inicio ? `${o.etiquetas[0]}: ${corto(inicio)}` : `Elige ${o.etiquetas[0].toLowerCase()}`;
    if (eligiendo === "fin" && !fin) return `${o.etiquetas[0]}: ${inicio ? corto(inicio) : "—"} · ahora elige ${o.etiquetas[1].toLowerCase()}`;
    const n = inicio && fin ? diasEntre(inicio, fin) : null;
    return `${inicio ? corto(inicio) : "—"} → ${fin ? corto(fin) : "—"}${n != null && o.duracion ? ` · ${o.duracion(n)}` : ""}`;
  };
  const pintarMeses = (direccion = 0) => {
    const n = mesesVisibles();
    meses.style.setProperty("--meses", n);
    meses.innerHTML = Array.from({ length: n }, (_, i) => mesHtml(sumarMeses(vista, i))).join("");
    cal.querySelector('[data-mes="-1"]').disabled = Boolean(min) && vista <= primeroDeMes(min);
    cal.querySelector('[data-mes="1"]').disabled = Boolean(max) && sumarMeses(vista, n - 1) >= primeroDeMes(max);
    estado.textContent = textoEstado();
    if (direccion) {
      meses.classList.remove("desliza-atras", "desliza-adelante");
      void meses.offsetWidth;
      meses.classList.add(direccion < 0 ? "desliza-atras" : "desliza-adelante");
    }
  };
  // Solo cambian las clases (al pasar el ratón no se repinta el calendario entero)
  const repintarPapeles = () => {
    meses.querySelectorAll(".cal-dia").forEach((b) => {
      const f = aFecha(b.dataset.dia);
      b.className = `cal-dia ${papel(f).join(" ")}`;
    });
  };
  const enfocar = (f, direccion = 0) => {
    const limitado = min && f < min ? min : max && f > max ? max : f;
    foco = limitado;
    const n = mesesVisibles();
    if (limitado < vista || limitado >= sumarMeses(vista, n)) {
      const nueva = primeroDeMes(limitado);
      direccion = direccion || (nueva < vista ? -1 : 1);
      vista = limitado < vista ? nueva : sumarMeses(nueva, -(n - 1));
      pintarMeses(direccion);
    } else {
      meses.querySelectorAll(".cal-dia").forEach((b) => b.setAttribute("tabindex", b.dataset.dia === aIso(limitado) ? "0" : "-1"));
    }
    meses.querySelector(`[data-dia="${aIso(limitado)}"]`)?.focus();
  };

  // ---- Abrir y cerrar
  const avisar = () => o.alCambiar?.(inicio ? aIso(inicio) : null, rango && fin ? aIso(fin) : null);
  const fuera = (ev) => {
    if (!raiz.contains(ev.target)) cerrar(false);
  };
  const abrir = (cual) => {
    clearTimeout(cierre);
    eligiendo = rango && cual === "fin" && inicio ? "fin" : "inicio";
    foco = (eligiendo === "fin" ? fin || sumarDias(inicio, 1) : inicio) || min || new Date();
    vista = primeroDeMes(eligiendo === "fin" && inicio ? inicio : foco);
    if (foco >= sumarMeses(vista, mesesVisibles())) vista = primeroDeMes(foco);
    abierto = true;
    previa = null;
    cal.hidden = false;
    pintarMeses();
    pintarBillete();
    raiz.classList.add("abierto");
    requestAnimationFrame(() => cal.classList.add("visible"));
    meses.querySelector(`[data-dia="${aIso(foco)}"]`)?.focus();
    document.addEventListener("pointerdown", fuera, true);
  };
  function cerrar(devolverFoco = true) {
    if (!abierto) return;
    abierto = false;
    previa = null;
    document.removeEventListener("pointerdown", fuera, true);
    cal.classList.remove("visible");
    raiz.classList.remove("abierto");
    const cual = eligiendo;
    pintarBillete();
    cierre = setTimeout(() => (cal.hidden = true), 140);
    if (devolverFoco) billete.querySelector(`[data-parte="${rango ? cual : "inicio"}"]`)?.focus();
  }
  alSalir(() => {
    clearTimeout(cierre);
    document.removeEventListener("pointerdown", fuera, true);
  });

  const elegir = (f) => {
    if (!disponible(f)) return;
    if (!rango) {
      inicio = f;
      avisar();
      pintarMeses();
      return setTimeout(cerrar, 120);
    }
    if (eligiendo === "inicio" || (inicio && f < inicio)) {
      inicio = f;
      if (fin && fin < f) fin = null;
      eligiendo = "fin";
      foco = f;
      avisar();
      pintarMeses();
      pintarBillete();
      return meses.querySelector(`[data-dia="${aIso(f)}"]`)?.focus();
    }
    fin = f;
    avisar();
    pintarMeses();
    setTimeout(cerrar, 160);
  };

  billete.addEventListener("click", (ev) => {
    const boton = ev.target.closest("[data-parte]");
    if (!boton) return;
    if (abierto && eligiendo === boton.dataset.parte) return cerrar();
    abrir(boton.dataset.parte);
  });
  cal.addEventListener("click", (ev) => {
    const dia = ev.target.closest(".cal-dia");
    const mes = ev.target.closest("[data-mes]");
    if (dia) elegir(aFecha(dia.dataset.dia));
    else if (mes) {
      const paso = Number(mes.dataset.mes);
      vista = sumarMeses(vista, paso);
      foco = sumarMeses(foco, paso);
      pintarMeses(paso);
    } else if (ev.target.closest("[data-listo]")) cerrar();
  });
  meses.addEventListener("pointerover", (ev) => {
    const dia = ev.target.closest(".cal-dia");
    if (!rango || eligiendo !== "fin" || fin || !dia) return;
    previa = aFecha(dia.dataset.dia);
    repintarPapeles();
  });
  cal.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      return cerrar();
    }
    if (!ev.target.closest(".cal-dia")) return;
    const pasos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const dia = (foco.getDay() + 6) % 7;
    let destino = null;
    if (ev.key in pasos) destino = sumarDias(foco, pasos[ev.key]);
    else if (ev.key === "Home") destino = sumarDias(foco, -dia);
    else if (ev.key === "End") destino = sumarDias(foco, 6 - dia);
    else if (ev.key === "PageUp") destino = sumarMeses(foco, ev.shiftKey ? -12 : -1);
    else if (ev.key === "PageDown") destino = sumarMeses(foco, ev.shiftKey ? 12 : 1);
    if (!destino) return;
    ev.preventDefault();
    if (rango && eligiendo === "fin" && !fin) {
      previa = destino;
      repintarPapeles();
    }
    enfocar(destino);
  });
  // Si el foco sale del calendario con el tabulador, se cierra
  raiz.addEventListener("focusout", (ev) => {
    if (abierto && ev.relatedTarget && !raiz.contains(ev.relatedTarget)) cerrar(false);
  });

  pintarBillete();
  return {
    valor: () => [inicio ? aIso(inicio) : null, rango && fin ? aIso(fin) : null],
    /** Cambia entre una fecha y dos (p. ej. al pasar de "ida y vuelta" a "solo ida"). */
    ponerRango(siRango) {
      if (rango === siRango) return;
      rango = siRango;
      if (!rango) fin = null;
      else if (inicio && !fin) fin = sumarDias(inicio, 4);
      pintarBillete();
      avisar();
    },
  };
}
