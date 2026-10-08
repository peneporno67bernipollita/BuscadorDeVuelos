import { api } from "../api.js";
import { graficaPrecios } from "../graficas.js";
import { icono } from "../iconos.js";
import {
  $, aeropuertos, alSalir, aviso, cadaSegundos, confirmar, contarHasta, cuentaAtras, deltaHtml, destello, esc, eur,
  fecha, fechaHora, fechasTexto, hace, horaLocal, limpiarPantalla, maletasTexto, pasajerosTexto,
} from "../util.js";

const NOMBRE_FUENTE = { google_flights: "Google Flights", ryanair: "Ryanair", skyscanner: "Skyscanner" };
const TIPO_AVISO = {
  presupuesto: "Dentro de presupuesto", buen_momento: "Buen momento para comprar", proximo: "Viaje próximo",
  final: "Último aviso", bajada: "Ha bajado todavía más", chollo: "Chollo", sin_presupuesto: "Nada dentro de presupuesto",
};
const PERIODOS = { "24h": 1, "7d": 7, todo: null };

// ---------------------------------------------------------------------------
// Vuelos como tarjeta de embarque
// ---------------------------------------------------------------------------
function lineaTrayecto(etiqueta, tr, aerolineas) {
  if (!tr) return "";
  const t0 = tr.tramos[0];
  const t1 = tr.tramos[tr.tramos.length - 1];
  const vuelos = tr.tramos.map((t) => {
    const vende = aerolineas.get(t.aerolinea)?.nombre || t.aerolinea;
    const opera = t.operadora && t.operadora !== t.aerolinea ? ` · opera ${aerolineas.get(t.operadora)?.nombre || t.operadora}` : "";
    return `${esc(vende)} ${esc(t.aerolinea)}${esc(t.numero)}${esc(opera)}`;
  }).join(" + ");
  const minutos = Math.round((new Date(t1.llegada) - new Date(t0.salida)) / 60000);
  const duracion = minutos > 0 ? `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min` : "";
  const escalas = tr.tramos.length === 1 ? "Directo" : `${tr.tramos.length - 1} escala${tr.tramos.length > 2 ? "s" : ""} · ${tr.tramos.slice(0, -1).map((t) => esc(t.destino)).join(", ")}`;
  const puntosEscala = tr.tramos.slice(0, -1).map((_, i) => `<i style="left:${((i + 1) / tr.tramos.length) * 100}%"></i>`).join("");
  const diaSiguiente = t1.llegada.slice(0, 10) > t0.salida.slice(0, 10) ? ' <span class="chip alerta">+1 día</span>' : "";
  return `
    <div class="trayecto-fila">
      <div class="sentido">${etiqueta}<b>${fecha(t0.salida.slice(0, 10))}</b></div>
      <div>
        <div class="linea-vuelo">
          <div class="hora">${horaLocal(t0.salida)}<small>${esc(t0.origen)}</small></div>
          <div class="camino">${duracion}<div class="barra">${puntosEscala}${icono("avion")}</div>${escalas}</div>
          <div class="hora fin">${horaLocal(t1.llegada)}${diaSiguiente}<small>${esc(t1.destino)}</small></div>
        </div>
        <div class="pequeno tenue" style="margin-top:.35rem">${vuelos}</div>
      </div>
    </div>`;
}

function tarjetaVuelo(p, aerolineas, esMejor) {
  const d = p.detalle || {};
  const enlaces = (d.enlaces || []).map((e) =>
    `<a class="boton pequeno primario" href="${esc(e.url)}" target="_blank" rel="noopener">${icono("externo")}${esc(e.aerolinea)}</a>`).join("");
  return `
    <div class="vuelo ${esMejor ? "mejor" : ""}">
      <div class="vuelo-cabecera">
        <div class="total">${eur(p.precio_total)}</div>
        <div class="fila" style="gap:.35rem">
          ${esMejor ? `<span class="chip ok">${icono("check")}La mejor</span>` : ""}
          <span class="chip">${esc(NOMBRE_FUENTE[p.fuente] || p.fuente)}</span>
          ${d.billetes_separados ? `<span class="chip alerta">${icono("aviso")}2 billetes</span>` : ""}
        </div>
      </div>
      ${lineaTrayecto("Ida", d.ida, aerolineas)}
      ${d.vuelta ? lineaTrayecto("Vuelta", d.vuelta, aerolineas) : ""}
      <div class="vuelo-pie">
        <div class="desglose">
          <span>Billetes ${eur(p.precio_billetes)}${Number(p.precio_maletas) ? ` · maletas ${eur(p.precio_maletas)} <span class="chip alerta" title="${esc((d.desglose_maletas || []).join("\n"))}">máx. estimado</span>` : ""}${Number(p.descuento) ? ` · descuento −${eur(p.descuento)}` : ""}</span>
          ${(d.notas || []).map((n) => `<span class="tenue">${esc(n)}</span>`).join("")}
        </div>
        <div class="acciones">${enlaces}
          ${d.google_flights ? `<a class="boton pequeno" href="${esc(d.google_flights)}" target="_blank" rel="noopener">${icono("lupa")}Google Flights</a>` : ""}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Estadísticas y cambios de precio
// ---------------------------------------------------------------------------
function cambiosDePrecio(puntos) {
  const cambios = [];
  for (let i = 1; i < puntos.length; i++) {
    const antes = Number(puntos[i - 1].precio_total);
    const ahora = Number(puntos[i].precio_total);
    if (Math.abs(ahora - antes) >= 0.01) cambios.push({ en: puntos[i].revisado, antes, ahora });
  }
  return cambios.reverse();
}

function filaCambio(c, nuevo = false) {
  const baja = c.ahora < c.antes;
  return `<li class="${baja ? "baja" : "sube"} ${nuevo ? "nuevo" : ""}">
    <span class="icono-cambio">${icono(baja ? "baja" : "sube")}</span>
    <div><b class="num">${eur(c.antes)} → ${eur(c.ahora)}</b><div class="pequeno tenue">${fechaHora(c.en)}</div></div>
    ${deltaHtml(c.ahora - c.antes, { conIcono: false })}
  </li>`;
}

function pintarEstadisticas(cont, puntos) {
  if (!puntos.length) {
    cont.innerHTML = '<p class="suave">Las estadísticas aparecerán tras la primera revisión.</p>';
    return;
  }
  const valores = puntos.map((p) => Number(p.precio_total));
  const actual = valores.at(-1);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  const total = actual - valores[0];
  cont.innerHTML = `
    <div class="estadistica"><div class="etiqueta">Ahora</div><div class="valor">${eur(actual)}</div></div>
    <div class="estadistica"><div class="etiqueta">Mínimo</div><div class="valor" style="color:var(--ok)">${eur(min)}</div></div>
    <div class="estadistica"><div class="etiqueta">Máximo</div><div class="valor" style="color:var(--mal)">${eur(max)}</div></div>
    <div class="estadistica"><div class="etiqueta">Media</div><div class="valor">${eur(media)}</div></div>
    <div class="estadistica"><div class="etiqueta">Desde el inicio</div><div class="valor">${deltaHtml(total) || "—"}</div></div>
    <div class="estadistica"><div class="etiqueta">Revisiones</div><div class="valor">${valores.length}</div></div>`;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------
export async function vistaDetalle(app, id) {
  const [b, historialTodo, opcionesTodas, avisos, listaAerolineas, datos] = await Promise.all([
    api.busqueda(id), api.historial(id), api.ultimasOpciones(id), api.avisos(id), api.aerolineas(), aeropuertos(),
  ]);
  if (!b) throw new Error("Esa búsqueda no existe.");
  const recargar = () => {
    limpiarPantalla();
    return vistaDetalle(app, id);
  };
  // Tras editar el viaje solo cuenta lo nuevo
  const historial = b.historial_desde ? historialTodo.filter((h) => h.revisado >= b.historial_desde) : historialTodo;
  const opciones = b.historial_desde ? opcionesTodas.filter((o) => o.revisado >= b.historial_desde) : opcionesTodas;
  const opcionesAntiguas = opciones.length && b.ultima_revision
    && new Date(b.ultima_revision) - new Date(opciones[0].revisado) > 10 * 60000;
  const aerolineas = new Map(listaAerolineas.map((a) => [a.codigo, a]));
  const info = b.info || {};
  const rechazos = Object.entries(info.rechazos || {});
  const ciudad = (c) => esc(datos.mapa.get(c)?.es || datos.mapa.get(c)?.m || c);
  const presupuesto = b.modo_precio === "presupuesto" ? b.presupuesto : null;
  let periodo = historial.length > 72 ? "7d" : "todo";

  app.innerHTML = `
    <div>
      <section class="tarjeta heroe">
        <div class="fila entre" style="align-items:flex-start">
          <div>
            <span class="etiqueta-superior">${icono(b.modo === "chollo" ? "llama" : "calendario")} ${b.modo === "chollo" ? "Chollo · cualquier fecha" : "Fechas concretas"}</span>
            <h1 style="margin:0">${esc(b.nombre)}</h1>
          </div>
          <div class="acciones">
            <a class="boton" href="#/editar/${b.id}">${icono("editar")}Editar</a>
            <button id="pausar">${icono(b.activa ? "pausa" : "play")}${b.activa ? "Pausar" : "Reanudar"}</button>
            <button id="borrar" class="peligro icono" title="Borrar">${icono("papelera")}</button>
          </div>
        </div>
        <div class="ruta grande" style="margin:1.4rem 0 1.2rem">
          <div class="aeropuerto"><div class="codigo">${esc(b.origen)}</div><div class="ciudad">${ciudad(b.origen)}</div></div>
          <div class="trazo">${icono("avion")}</div>
          <div class="aeropuerto fin"><div class="codigo">${esc(b.destino)}</div><div class="ciudad">${ciudad(b.destino)}</div></div>
        </div>
        <div class="fila" style="gap:.45rem">
          <span class="chip">${icono("calendario")}${esc(fechasTexto(b))}</span>
          <span class="chip">${icono("personas")}${esc(pasajerosTexto(b))}</span>
          <span class="chip">${icono("maleta")}${esc(maletasTexto(b))}</span>
          <span class="chip">${icono("despegue")}${b.escalas_max === 0 ? "Solo directos" : `Máx. ${b.escalas_max} escala${b.escalas_max > 1 ? "s" : ""} de ${b.escala_max_horas} h`}</span>
          ${presupuesto ? `<span class="chip primario">${icono("euro")}Máximo ${eur(presupuesto)}</span>` : `<span class="chip primario">${icono("baja")}Lo más barato</span>`}
          ${b.activa ? "" : `<span class="chip mal">${icono("pausa")}En pausa</span>`}
        </div>
      </section>

      <section class="tarjeta" style="margin-top:1.1rem">
        <div class="tarjeta-titulo">
          <div>
            <h2>${icono("grafica")}Precio en directo</h2>
            <div class="fila pequeno suave" style="margin-top:.35rem;gap:.9rem">
              ${b.activa ? '<span class="vivo"><span class="punto-vivo"></span>En directo</span>' : '<span class="chip mal">En pausa</span>'}
              <span>Próxima revisión <b class="cuenta-atras" id="cuenta">${b.activa ? cuentaAtras(b.proxima_revision) : "—"}</b></span>
              <span id="revisado">${b.ultima_revision ? `Revisado ${hace(b.ultima_revision)}` : "Aún sin revisar"}</span>
            </div>
          </div>
          <div class="fila">
            <div class="precio-grande gigante texto-degradado" id="precio-actual">—</div>
            <span id="delta-actual">${info.variacion != null ? deltaHtml(info.variacion) : ""}</span>
          </div>
        </div>
        <div class="selector" id="selector" style="margin-bottom:.8rem">
          ${Object.keys(PERIODOS).map((p) => `<button type="button" data-periodo="${p}">${p === "24h" ? "24 h" : p === "7d" ? "7 días" : "Todo"}</button>`).join("")}
        </div>
        ${historial.length > 1
          ? '<div class="grafica"><canvas id="grafica" aria-label="Evolución del precio total"></canvas></div>'
          : `<div class="vacio" style="padding:2rem 1rem"><div class="ilustracion">${icono("grafica")}</div>
              <p>La gráfica aparecerá en cuanto el robot haya revisado esta búsqueda dos veces (unos minutos).</p></div>`}
        <div class="estadisticas" id="estadisticas" style="margin-top:1.1rem"></div>
        ${rechazos.length ? `<div class="nota alerta">${icono("aviso")}<span><b>Vuelos descartados por tus filtros:</b> ${rechazos.map(([m, n]) => `${esc(m)} (${n})`).join(" · ")}</span></div>` : ""}
        ${b.estado ? `<div class="nota" style="margin-top:.8rem">${icono("info")}<span id="estado">${esc(b.estado)}</span></div>` : ""}
      </section>

      <div class="rejilla-2" style="margin-top:1.1rem">
        <section class="tarjeta">
          <div class="tarjeta-titulo"><h2>${icono("avion")}Mejores vuelos ahora</h2>
            ${opciones.length ? `<span class="pequeno tenue">${fechaHora(opciones[0].revisado)}</span>` : ""}</div>
          <div id="opciones">
            ${opcionesAntiguas ? `<div class="nota alerta">${icono("aviso")}<span>Son de la revisión del ${fechaHora(opciones[0].revisado)}: en la última no hubo ninguna válida.</span></div>` : ""}
            ${opciones.length
              ? opciones.map((p, i) => tarjetaVuelo(p, aerolineas, i === 0)).join("")
              : '<p class="suave">Todavía no hay resultados. El robot revisa esta búsqueda en unos minutos.</p>'}
          </div>
          ${opciones.length ? `<p class="pequeno tenue" style="margin:.9rem 0 0">Precio total para todos los pasajeros. Compra siempre en la web oficial y comprueba el precio final antes de pagar.</p>` : ""}
        </section>
        <div>
          <section class="tarjeta">
            <div class="tarjeta-titulo"><h2>${icono("baja")}Cambios de precio</h2><span class="chip" id="num-cambios">0</span></div>
            <ul class="cambios" id="cambios"></ul>
          </section>
          <section class="tarjeta">
            <div class="tarjeta-titulo"><h2>${icono("campana")}Avisos enviados</h2></div>
            ${avisos.length ? `<ul class="linea-tiempo">${avisos.map((a) => `
              <li class="${a.entregado ? "ok" : ""}">
                <div class="fila entre"><b>${esc(TIPO_AVISO[a.tipo] || a.tipo)}</b><span class="cuando">${fechaHora(a.enviado)}</span></div>
                <div class="pequeno suave">${eur(a.precio_total)} · ${esc(a.motivo)}</div>
                <div class="pequeno ${a.entregado ? "" : "tenue"}">${a.entregado ? "✓ Enviado a Telegram" : "No enviado (Telegram sin vincular)"}</div>
              </li>`).join("")}</ul>` : '<p class="suave">Aún no hay avisos. Te escribiré por Telegram en cuanto sea buen momento.</p>'}
          </section>
        </div>
      </div>
    </div>`;

  // ---- Precio actual, estadísticas y cambios ----
  const precioEl = $("#precio-actual");
  let precioMostrado = b.precio_actual != null ? Number(b.precio_actual) : null;
  contarHasta(precioEl, precioMostrado);
  pintarEstadisticas($("#estadisticas"), historial);
  const listaCambios = $("#cambios");
  const pintarCambios = () => {
    const cambios = cambiosDePrecio(historial);
    $("#num-cambios").textContent = cambios.length;
    listaCambios.innerHTML = cambios.length
      ? cambios.slice(0, 60).map((c) => filaCambio(c)).join("")
      : '<li class="suave" style="display:block">Sin cambios todavía: el precio se mantiene igual en cada revisión.</li>';
  };
  pintarCambios();

  // ---- Gráfica con periodos ----
  let grafica = null;
  const pintarGrafica = () => {
    grafica?.destruir();
    const canvas = $("#grafica");
    if (!canvas) return;
    const dias = PERIODOS[periodo];
    const desde = dias ? new Date(Date.now() - dias * 86400000).toISOString() : null;
    const puntos = desde ? historial.filter((h) => h.revisado >= desde) : historial;
    grafica = graficaPrecios(canvas, puntos.length > 1 ? puntos : historial, { presupuesto });
    app.querySelectorAll("[data-periodo]").forEach((x) => x.classList.toggle("activo", x.dataset.periodo === periodo));
  };
  pintarGrafica();
  alSalir(() => grafica?.destruir());
  app.querySelectorAll("[data-periodo]").forEach((boton) =>
    boton.addEventListener("click", () => {
      periodo = boton.dataset.periodo;
      pintarGrafica();
    }),
  );

  // ---- Cuenta atrás ----
  let proxima = b.proxima_revision;
  let ultimaRevision = b.ultima_revision;
  const textoRevisado = () => (ultimaRevision ? `Revisado ${hace(ultimaRevision)}` : "Aún sin revisar");
  if (b.activa) cadaSegundos(1, () => { $("#cuenta").textContent = cuentaAtras(proxima); });
  cadaSegundos(30, () => { $("#revisado").textContent = textoRevisado(); });

  // ---- Tiempo real ----
  let tiempoRealActivo = false;
  alSalir(api.suscribir("precios", ({ new: p }) => {
    if (!p || p.busqueda !== id || p.es_mejor === false) return;
    tiempoRealActivo = true;
    const anterior = historial.at(-1);
    historial.push(p);
    if (historial.length === 2) return recargar(); // ya hay datos para la gráfica
    grafica?.añadir(p);
    pintarEstadisticas($("#estadisticas"), historial);
    if (anterior && Math.abs(Number(p.precio_total) - Number(anterior.precio_total)) >= 0.01) {
      pintarCambios();
      listaCambios.firstElementChild?.classList.add("nuevo");
    }
  }, `busqueda=eq.${id}`));
  alSalir(api.suscribir("busquedas", async ({ new: nueva }) => {
    if (!nueva || nueva.id !== id) return;
    tiempoRealActivo = true;
    proxima = nueva.proxima_revision;
    ultimaRevision = nueva.ultima_revision;
    $("#revisado").textContent = textoRevisado();
    if ($("#estado")) $("#estado").textContent = nueva.estado || "";
    const ahora = nueva.precio_actual != null ? Number(nueva.precio_actual) : null;
    if (ahora !== precioMostrado) {
      contarHasta(precioEl, ahora, { desde: precioMostrado ?? ahora ?? 0 });
      if (precioMostrado != null && ahora != null) destello(precioEl.closest(".tarjeta"), ahora - precioMostrado);
      precioMostrado = ahora;
    }
    $("#delta-actual").innerHTML = nueva.info?.variacion != null ? deltaHtml(nueva.info.variacion) : "";
    // Vuelos de la revisión nueva
    const nuevas = await api.ultimasOpciones(id);
    if (nuevas.length) $("#opciones").innerHTML = nuevas.map((p, i) => tarjetaVuelo(p, aerolineas, i === 0)).join("");
  }, `id=eq.${id}`));
  // Respaldo por si el tiempo real no está activado: recargar cada 90 s
  cadaSegundos(90, () => !tiempoRealActivo && recargar());

  // ---- Acciones ----
  $("#pausar").addEventListener("click", async () => {
    await api.actualizarBusqueda(b.id, { activa: !b.activa });
    aviso(b.activa ? "Búsqueda en pausa" : "Búsqueda reanudada: el robot la revisa en un minuto");
    recargar();
  });
  $("#borrar").addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "¿Borrar esta búsqueda?",
      texto: `Se borrarán "${b.nombre}" y todo su historial de precios. No se puede deshacer.`,
      aceptar: "Borrar",
    });
    if (!ok) return;
    try {
      await api.borrarBusqueda(b.id);
      aviso("Búsqueda borrada");
      location.hash = "#/";
    } catch (e) {
      aviso(e.message, "error");
    }
  });
}
