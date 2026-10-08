import { api } from "../api.js";
import {
  aeropuertos, aviso, esc, eur, fechaHora, fechasTexto, hace, maletasTexto, nombreAeropuerto, pasajerosTexto,
} from "../util.js";

export const LIMITE_MINUTOS = 2000;
// GitHub cobra por minuto empezado e incluye ~1 min de preparación por ronda
export const minutosEstimados = (ejecuciones) =>
  ejecuciones.reduce((s, e) => s + Math.ceil(((e.duracion_s || 0) + 60) / 60), 0);

function miniGrafica(canvas, puntos, presupuesto) {
  if (!window.Chart || puntos.length < 2) return;
  const estilo = getComputedStyle(document.documentElement);
  new Chart(canvas, {
    type: "line",
    data: {
      labels: puntos.map((p) => p.revisado),
      datasets: [
        { data: puntos.map((p) => Number(p.precio_total)), borderColor: estilo.getPropertyValue("--acento").trim(), borderWidth: 2, pointRadius: 0, tension: 0.3 },
        ...(presupuesto ? [{ data: puntos.map(() => Number(presupuesto)), borderColor: estilo.getPropertyValue("--ok").trim(), borderWidth: 1, borderDash: [4, 4], pointRadius: 0 }] : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

function tarjetaBusqueda(b, datos) {
  const ruta = `${nombreAeropuerto(datos, b.origen)} ${b.ida_vuelta ? "⇄" : "→"} ${nombreAeropuerto(datos, b.destino)}`;
  const precio = b.precio_actual != null ? eur(b.precio_actual) : "—";
  const modoPrecio = b.modo_precio === "presupuesto"
    ? `<span class="insignia acento">Máx. ${eur(b.presupuesto)}</span>`
    : '<span class="insignia acento">Lo más barato</span>';
  const tipo = b.modo === "chollo" ? '<span class="insignia alerta">Chollo · cualquier fecha</span>' : '<span class="insignia">Fechas concretas</span>';
  const estado = b.activa ? "" : '<span class="insignia mal">Pausada</span>';
  const ultimoAviso = b.ultimo_aviso_precio != null
    ? `<div class="pequeno">🔔 Último aviso: <b>${eur(b.ultimo_aviso_precio)}</b> ${hace(b.ultimo_aviso_en)}</div>` : "";
  return `
    <article class="tarjeta busqueda ${b.activa ? "" : "pausada"}">
      <div class="fila entre"><a href="#/busqueda/${b.id}" class="ruta" style="text-decoration:none;color:inherit">${esc(b.nombre)}</a>${estado}</div>
      <div class="suave">${esc(ruta)}</div>
      <div class="fila">${tipo}${modoPrecio}</div>
      <div class="pequeno">${esc(fechasTexto(b))}</div>
      <div class="pequeno suave">${esc(pasajerosTexto(b))} · ${esc(maletasTexto(b))}</div>
      <div class="fila entre">
        <div><div class="precio">${precio}</div><div class="pequeno suave">precio total actual${b.mejor_precio != null ? ` · mínimo visto ${eur(b.mejor_precio)}` : ""}</div></div>
      </div>
      <div class="mini-grafica"><canvas data-grafica="${b.id}"></canvas></div>
      ${ultimoAviso}
      <div class="pequeno suave">${esc(b.estado || "Pendiente de la primera revisión")}</div>
      <div class="pequeno suave">Revisado ${hace(b.ultima_revision)} · próxima revisión ${b.activa ? hace(b.proxima_revision) : "en pausa"}</div>
      <div class="acciones">
        <a class="boton pequeno primario" href="#/busqueda/${b.id}">Ver detalle</a>
        <a class="boton pequeno" href="#/editar/${b.id}">Editar</a>
        <button class="pequeno" data-pausar="${b.id}">${b.activa ? "Pausar" : "Reanudar"}</button>
        <a class="boton pequeno" href="#/duplicar/${b.id}">Duplicar</a>
      </div>
    </article>`;
}

export async function vistaPanel(app) {
  const [busquedas, historial, avisos, fuentes, ejecucionesMes, datos] = await Promise.all([
    api.busquedas(), api.historialTodas(), api.avisosRecientes(), api.fuentes(), api.ejecucionesDelMes(), aeropuertos(),
  ]);
  const activas = busquedas.filter((b) => b.activa);
  const semana = Date.now() - 7 * 86400000;
  const avisosSemana = avisos.filter((a) => new Date(a.enviado) > semana).length;
  const minutos = minutosEstimados(ejecucionesMes);
  const fuentesTexto = fuentes
    .map((f) => {
      const bloqueada = f.bloqueada_hasta && new Date(f.bloqueada_hasta) > new Date();
      const clase = !f.activa ? "" : bloqueada ? "mal" : "ok";
      const texto = !f.activa ? "desactivada" : bloqueada ? "bloqueada" : "ok";
      return `<span class="insignia ${clase}">${esc(f.nombre)}: ${texto}</span>`;
    })
    .join(" ");

  app.innerHTML = `
    <div class="titulo-pagina">
      <h1>Tus búsquedas</h1>
      <a class="boton primario" href="#/nueva">＋ Nueva búsqueda</a>
    </div>
    <div class="cifras">
      <div class="cifra"><div class="valor">${activas.length}</div><div class="etiqueta">búsquedas activas</div></div>
      <div class="cifra"><div class="valor">${avisosSemana}</div><div class="etiqueta">avisos en 7 días</div></div>
      <div class="cifra"><div class="valor">${minutos}<span class="suave pequeno"> / ${LIMITE_MINUTOS}</span></div><div class="etiqueta">minutos de GitHub este mes (aprox.; sin límite si el repositorio es público)</div></div>
    </div>
    <p class="fila pequeno">${fuentesTexto} <a href="#/estado">Ver robot</a></p>
    ${busquedas.length
      ? `<div class="rejilla">${busquedas.map((b) => tarjetaBusqueda(b, datos)).join("")}</div>`
      : `<div class="tarjeta"><h2>Aún no vigilas ningún vuelo</h2>
           <p>Crea una búsqueda con tus aeropuertos exactos, fechas, horarios, pasajeros y maletas.
           El robot la revisará cada pocas horas y te avisará por Telegram cuando sea buen momento para comprar.</p>
           <a class="boton primario" href="#/nueva">Crear mi primera búsqueda</a></div>`}
    ${avisos.length ? `
      <section class="tarjeta">
        <h2>🔔 Últimos avisos</h2>
        <div class="tabla-envoltura"><table>
          <thead><tr><th>Cuándo</th><th>Búsqueda</th><th>Motivo</th><th>Total</th><th>Telegram</th></tr></thead>
          <tbody>${avisos.map((a) => {
            const b = busquedas.find((x) => x.id === a.busqueda);
            return `<tr><td>${fechaHora(a.enviado)}</td><td>${b ? `<a href="#/busqueda/${b.id}">${esc(b.nombre)}</a>` : "—"}</td>
              <td>${esc(a.motivo)}</td><td class="num"><b>${eur(a.precio_total)}</b></td>
              <td>${a.entregado ? '<span class="insignia ok">enviado</span>' : '<span class="insignia alerta">sin enviar</span>'}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
      </section>` : ""}`;

  for (const b of busquedas) {
    const canvas = app.querySelector(`[data-grafica="${b.id}"]`);
    // Tras editar el viaje solo cuenta el historial nuevo
    const puntos = historial.filter((h) => h.busqueda === b.id && (!b.historial_desde || h.revisado >= b.historial_desde));
    miniGrafica(canvas, puntos, b.modo_precio === "presupuesto" ? b.presupuesto : null);
  }
  app.querySelectorAll("[data-pausar]").forEach((boton) =>
    boton.addEventListener("click", async () => {
      const b = busquedas.find((x) => x.id === boton.dataset.pausar);
      try {
        await api.actualizarBusqueda(b.id, { activa: !b.activa });
        aviso(b.activa ? "Búsqueda en pausa" : "Búsqueda reanudada: se revisará en la próxima ronda");
        vistaPanel(app);
      } catch (e) {
        aviso(e.message, "error");
      }
    }),
  );
}
