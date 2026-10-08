import { api } from "../api.js";
import {
  aeropuertos, aviso, esc, eur, fecha, fechaHora, fechasTexto, hace, horaLocal, maletasTexto, nombreAeropuerto,
  pasajerosTexto,
} from "../util.js";

const NOMBRE_FUENTE = { google_flights: "Google Flights", ryanair: "Ryanair", skyscanner: "Skyscanner" };
const TIPO_AVISO = {
  presupuesto: "Dentro de presupuesto", buen_momento: "Buen momento", proximo: "Viaje próximo", final: "Último aviso",
  bajada: "Ha bajado más", chollo: "Chollo", sin_presupuesto: "Nada dentro de presupuesto",
};

function textoTrayecto(tr, aerolineas) {
  if (!tr) return "";
  const t0 = tr.tramos[0];
  const t1 = tr.tramos[tr.tramos.length - 1];
  const vuelos = tr.tramos.map((t) => {
    const vende = aerolineas.get(t.aerolinea)?.nombre || t.aerolinea;
    const opera = t.operadora && t.operadora !== t.aerolinea ? ` (opera ${aerolineas.get(t.operadora)?.nombre || t.operadora})` : "";
    return `${esc(vende)} ${esc(t.aerolinea)}${esc(t.numero)}${esc(opera)}`;
  }).join(" + ");
  const escalas = tr.tramos.length === 1 ? "directo" : `${tr.tramos.length - 1} escala${tr.tramos.length > 2 ? "s" : ""} (${tr.tramos.slice(0, -1).map((t) => esc(t.destino)).join(", ")})`;
  const diaSiguiente = t1.llegada.slice(0, 10) > t0.salida.slice(0, 10) ? " <span class='insignia alerta'>+1 día</span>" : "";
  return `${fecha(t0.salida.slice(0, 10))} · <b>${horaLocal(t0.salida)}</b> ${esc(t0.origen)} → <b>${horaLocal(t1.llegada)}</b>${diaSiguiente} ${esc(t1.destino)}
    <div class="pequeno suave">${vuelos} · ${escalas}</div>`;
}

function tarjetaOpcion(p, aerolineas, esMejor) {
  const d = p.detalle || {};
  const maletas = Number(p.precio_maletas)
    ? `<div>Maletas: ${eur(p.precio_maletas)} <span class="insignia alerta">máximo estimado</span></div>
       ${(d.desglose_maletas || []).map((x) => `<div class="pequeno">· ${esc(x)}</div>`).join("")}` : "";
  const descuento = Number(p.descuento) ? `<div>Descuento: −${eur(p.descuento)} <span class="pequeno">(${esc(d.descuento_detalle || "")})</span></div>` : "";
  const enlaces = (d.enlaces || []).map((e) => `<a class="boton pequeno primario" href="${esc(e.url)}" target="_blank" rel="noopener">🛒 ${esc(e.aerolinea)} (web oficial)</a>`).join("");
  return `
    <div class="vuelo ${esMejor ? "mejor" : ""}">
      <div class="fila entre">
        <div class="total">${eur(p.precio_total)}</div>
        <div class="fila">${esMejor ? '<span class="insignia ok">La mejor</span>' : ""}
          <span class="insignia">${esc(NOMBRE_FUENTE[p.fuente] || p.fuente)}</span>
          ${d.billetes_separados ? '<span class="insignia alerta">2 billetes separados</span>' : ""}</div>
      </div>
      <div class="trayecto"><span class="que">Ida</span><div>${textoTrayecto(d.ida, aerolineas)}</div>
        ${d.vuelta ? `<span class="que">Vuelta</span><div>${textoTrayecto(d.vuelta, aerolineas)}</div>` : ""}</div>
      <div class="desglose"><div>Billetes: ${eur(p.precio_billetes)}</div>${maletas}${descuento}
        ${(d.notas || []).map((n) => `<div class="pequeno">ℹ️ ${esc(n)}</div>`).join("")}</div>
      <div class="enlaces">${enlaces}
        ${d.google_flights ? `<a class="boton pequeno" href="${esc(d.google_flights)}" target="_blank" rel="noopener">🔎 Ver en Google Flights</a>` : ""}</div>
    </div>`;
}

function grafica(canvas, historial, presupuesto) {
  if (!window.Chart || !historial.length) return;
  const estilo = getComputedStyle(document.documentElement);
  const color = (v) => estilo.getPropertyValue(v).trim();
  new Chart(canvas, {
    type: "line",
    data: {
      labels: historial.map((h) => fechaHora(h.revisado)),
      datasets: [
        { label: "Mejor precio total", data: historial.map((h) => Number(h.precio_total)), borderColor: color("--acento"),
          backgroundColor: color("--acento-suave"), fill: true, tension: 0.25, pointRadius: 3 },
        ...(presupuesto ? [{ label: "Tu presupuesto", data: historial.map(() => Number(presupuesto)), borderColor: color("--ok"),
          borderDash: [6, 4], pointRadius: 0, fill: false }] : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: color("--suave") } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${eur(c.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: color("--suave"), maxTicksLimit: 8 }, grid: { color: color("--borde") } },
        y: { ticks: { color: color("--suave"), callback: (v) => eur(v) }, grid: { color: color("--borde") } },
      },
    },
  });
}

export async function vistaDetalle(app, id) {
  const [b, historialTodo, opcionesTodas, avisos, listaAerolineas, datos] = await Promise.all([
    api.busqueda(id), api.historial(id), api.ultimasOpciones(id), api.avisos(id), api.aerolineas(), aeropuertos(),
  ]);
  if (!b) throw new Error("Esa búsqueda no existe.");
  const historial = b.historial_desde ? historialTodo.filter((h) => h.revisado >= b.historial_desde) : historialTodo;
  // Tras editar el viaje, las opciones guardadas antes ya no valen
  const opciones = b.historial_desde ? opcionesTodas.filter((o) => o.revisado >= b.historial_desde) : opcionesTodas;
  // Si la última revisión no dejó opciones válidas, las guardadas son de una revisión anterior
  const opcionesAntiguas = opciones.length && b.ultima_revision
    && new Date(b.ultima_revision) - new Date(opciones[0].revisado) > 10 * 60000;
  const aerolineas = new Map(listaAerolineas.map((a) => [a.codigo, a]));
  const info = b.info || {};
  const rechazos = Object.entries(info.rechazos || {});
  const ruta = `${nombreAeropuerto(datos, b.origen)} ${b.ida_vuelta ? "⇄" : "→"} ${nombreAeropuerto(datos, b.destino)}`;

  app.innerHTML = `
    <div class="titulo-pagina">
      <div><h1>${esc(b.nombre)}</h1><div class="suave">${esc(ruta)}</div></div>
      <div class="fila">
        <a class="boton" href="#/editar/${b.id}">Editar</a>
        <button id="pausar">${b.activa ? "Pausar" : "Reanudar"}</button>
        <button id="borrar" class="peligro">Borrar</button>
      </div>
    </div>

    <div class="cifras">
      <div class="cifra"><div class="valor">${eur(b.precio_actual)}</div><div class="etiqueta">precio total actual</div></div>
      <div class="cifra"><div class="valor">${eur(b.mejor_precio)}</div><div class="etiqueta">mínimo visto</div></div>
      <div class="cifra"><div class="valor">${b.modo_precio === "presupuesto" ? eur(b.presupuesto) : "—"}</div><div class="etiqueta">${b.modo_precio === "presupuesto" ? "tu presupuesto" : "modo: lo más barato"}</div></div>
      <div class="cifra"><div class="valor">${info.habitual ? `${info.habitual[0]}-${info.habitual[1]} €` : "—"}</div><div class="etiqueta">billetes habituales (fechas cercanas)</div></div>
    </div>

    <section class="tarjeta">
      <div class="fila" style="gap:.5rem">
        ${b.activa ? '<span class="insignia ok">Activa</span>' : '<span class="insignia mal">Pausada</span>'}
        <span class="insignia">${b.modo === "chollo" ? "Chollo · cualquier fecha" : "Fechas concretas"}</span>
        <span class="insignia">${esc(fechasTexto(b))}</span>
      </div>
      <p class="pequeno" style="margin-top:.6rem">${esc(pasajerosTexto(b))} · ${esc(maletasTexto(b))} ·
        ${b.escalas_max === 0 ? "solo directos" : `máx. ${b.escalas_max} escala${b.escalas_max > 1 ? "s" : ""} de ${b.escala_max_horas} h`}</p>
      <p class="pequeno suave">${esc(b.estado || "Pendiente de la primera revisión")} · revisada ${hace(b.ultima_revision)} ·
        próxima ${b.activa ? hace(b.proxima_revision) : "en pausa"}</p>
      ${rechazos.length ? `<div class="nota alerta"><b>Vuelos descartados por tus filtros:</b> ${rechazos.map(([m, n]) => `${esc(m)} (${n})`).join(" · ")}</div>` : ""}
    </section>

    <section class="tarjeta">
      <h2>📈 Evolución del precio</h2>
      ${historial.length > 1 ? '<div class="grafica"><canvas id="grafica"></canvas></div>'
        : '<p class="suave">La gráfica aparecerá cuando el robot haya revisado esta búsqueda al menos dos veces.</p>'}
    </section>

    <section class="tarjeta">
      <h2>✈️ Mejores opciones de la última revisión</h2>
      ${opciones.length
        ? `${opcionesAntiguas ? `<div class="nota alerta">Ojo: estas opciones son de la revisión del ${fechaHora(opciones[0].revisado)}.
             En la última revisión (${fechaHora(b.ultima_revision)}) no hubo ninguna válida: ${esc(b.estado || "")}</div>` : ""}
           <p class="pequeno suave">Revisado el ${fechaHora(opciones[0].revisado)}. Precio total para todos los pasajeros. Compra siempre en la web oficial
           y comprueba el precio final antes de pagar.</p>${opciones.map((p, i) => tarjetaOpcion(p, aerolineas, i === 0)).join("")}`
        : '<p class="suave">Todavía no hay resultados. El robot revisará esta búsqueda en su próxima ronda (cada 3 horas).</p>'}
    </section>

    <section class="tarjeta">
      <h2>🔔 Avisos enviados</h2>
      ${avisos.length ? `<div class="tabla-envoltura"><table>
        <thead><tr><th>Cuándo</th><th>Tipo</th><th>Motivo</th><th>Total</th><th>Telegram</th></tr></thead>
        <tbody>${avisos.map((a) => `<tr><td>${fechaHora(a.enviado)}</td><td>${esc(TIPO_AVISO[a.tipo] || a.tipo)}</td>
          <td>${esc(a.motivo)}</td><td class="num"><b>${eur(a.precio_total)}</b></td>
          <td>${a.entregado ? '<span class="insignia ok">enviado</span>' : '<span class="insignia alerta">sin enviar</span>'}</td></tr>`).join("")}</tbody>
      </table></div>` : '<p class="suave">Aún no hay avisos para esta búsqueda.</p>'}
    </section>`;

  if (historial.length > 1) grafica(app.querySelector("#grafica"), historial, b.modo_precio === "presupuesto" ? b.presupuesto : null);

  app.querySelector("#pausar").addEventListener("click", async () => {
    await api.actualizarBusqueda(b.id, { activa: !b.activa });
    aviso(b.activa ? "Búsqueda en pausa" : "Búsqueda reanudada");
    vistaDetalle(app, id);
  });
  app.querySelector("#borrar").addEventListener("click", async () => {
    if (!confirm(`¿Borrar "${b.nombre}" y todo su historial? No se puede deshacer.`)) return;
    try {
      await api.borrarBusqueda(b.id);
      aviso("Búsqueda borrada");
      location.hash = "#/";
    } catch (e) {
      aviso(e.message, "error");
    }
  });
}
