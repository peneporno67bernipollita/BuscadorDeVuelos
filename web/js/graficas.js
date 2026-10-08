// Gráficas con Chart.js: evolución del precio (en directo) y minigráficas del panel.
import { eur, fechaHora } from "./util.js";

const css = (variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim();

function degradado(ctx, area, color) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, color.replace("rgb(", "rgba(").replace(")", ", .35)"));
  g.addColorStop(1, color.replace("rgb(", "rgba(").replace(")", ", 0)"));
  return g;
}

/** Convierte un color CSS (#hex o rgb) a "rgb(r, g, b)". */
function aRgb(color) {
  if (color.startsWith("rgb")) return color.replace(/rgba?\(([^,]+),([^,]+),([^,)]+).*\)/, "rgb($1,$2,$3)");
  const h = color.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Gráfica grande del detalle. Devuelve un objeto con .añadir(punto) para el tiempo real. */
export function graficaPrecios(canvas, puntos, { presupuesto = null } = {}) {
  if (!window.Chart) return null;
  const primario = aRgb(css("--primario"));
  const ok = css("--ok");
  const suave = css("--suave");
  const borde = css("--borde");
  const datos = puntos.map((p) => ({ x: new Date(p.revisado).getTime(), y: Number(p.precio_total) }));
  // Solo se resalta la primera vez que se vio el mínimo (si se repite, no se llena de puntos verdes)
  const indiceMinimo = () => datos.reduce((mejor, d, i) => (d.y < datos[mejor].y ? i : mejor), 0);

  const grafica = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Mejor precio total",
          data: datos,
          borderColor: primario,
          borderWidth: 2.5,
          tension: 0.32,
          fill: true,
          backgroundColor: (c) => (c.chart.chartArea ? degradado(c.chart.ctx, c.chart.chartArea, primario) : "transparent"),
          pointRadius: (c) => (datos.length && c.dataIndex === indiceMinimo() ? 5 : c.dataIndex === datos.length - 1 ? 4 : 0),
          pointBackgroundColor: (c) => (datos.length && c.dataIndex === indiceMinimo() ? ok : primario),
          pointBorderColor: css("--superficie-solida"),
          pointBorderWidth: 2,
          pointHoverRadius: 6,
        },
        ...(presupuesto
          ? [{
              label: "Tu presupuesto",
              data: datos.length ? [{ x: datos[0].x, y: Number(presupuesto) }, { x: datos.at(-1).x, y: Number(presupuesto) }] : [],
              borderColor: ok, borderWidth: 1.5, borderDash: [6, 6], pointRadius: 0, fill: false,
            }]
          : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      animation: { duration: 700, easing: "easeOutQuart" },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: Boolean(presupuesto), labels: { color: suave, boxWidth: 12, usePointStyle: true, pointStyle: "line" } },
        tooltip: {
          backgroundColor: css("--superficie-solida"), titleColor: css("--texto"), bodyColor: css("--texto"),
          borderColor: css("--borde-fuerte"), borderWidth: 1, padding: 12, cornerRadius: 12, displayColors: false,
          callbacks: { title: (items) => fechaHora(items[0].parsed.x), label: (c) => `${c.dataset.label}: ${eur(c.parsed.y)}` },
        },
      },
      scales: {
        x: {
          type: "linear", bounds: "data", grid: { display: false }, border: { display: false },
          ticks: { color: suave, maxTicksLimit: 7, maxRotation: 0, callback: (v) => fechaHora(v).replace(",", "") },
        },
        y: {
          grid: { color: borde }, border: { display: false },
          ticks: { color: suave, maxTicksLimit: 6, callback: (v) => eur(v, true) },
        },
      },
    },
  });

  return {
    grafica,
    añadir(punto) {
      datos.push({ x: new Date(punto.revisado).getTime(), y: Number(punto.precio_total) });
      if (presupuesto && grafica.data.datasets[1]) {
        grafica.data.datasets[1].data = [{ x: datos[0].x, y: Number(presupuesto) }, { x: datos.at(-1).x, y: Number(presupuesto) }];
      }
      grafica.update();
    },
    destruir: () => grafica.destroy(),
  };
}

/** Minigráfica sin ejes (tarjetas del panel). */
export function miniGrafica(canvas, puntos, { presupuesto = null } = {}) {
  if (!window.Chart || !canvas || puntos.length < 2) return null;
  const subiendo = Number(puntos.at(-1).precio_total) > Number(puntos[0].precio_total);
  const color = aRgb(subiendo ? css("--mal") : css("--ok"));
  const datos = puntos.map((p) => ({ x: new Date(p.revisado).getTime(), y: Number(p.precio_total) }));
  const grafica = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          data: datos, borderColor: color, borderWidth: 2, tension: 0.35, pointRadius: 0, fill: true,
          backgroundColor: (c) => (c.chart.chartArea ? degradado(c.chart.ctx, c.chart.chartArea, color) : "transparent"),
        },
        ...(presupuesto ? [{ data: [{ x: datos[0].x, y: Number(presupuesto) }, { x: datos.at(-1).x, y: Number(presupuesto) }],
          borderColor: css("--tenue"), borderWidth: 1, borderDash: [3, 4], pointRadius: 0 }] : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false, animation: { duration: 900 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { type: "linear", display: false }, y: { display: false } },
    },
  });
  return {
    añadir(punto) {
      datos.push({ x: new Date(punto.revisado).getTime(), y: Number(punto.precio_total) });
      grafica.update();
    },
    destruir: () => grafica.destroy(),
  };
}


/** Barras de actividad del robot: revisiones y avisos por hora. */
export function graficaActividad(canvas, etiquetas, revisiones, avisos) {
  if (!window.Chart || !canvas) return null;
  const primario = aRgb(css("--primario"));
  const suave = css("--suave");
  const grafica = new Chart(canvas, {
    type: "bar",
    data: {
      labels: etiquetas,
      datasets: [
        { label: "Búsquedas revisadas", data: revisiones, backgroundColor: primario.replace("rgb(", "rgba(").replace(")", ", .7)"),
          hoverBackgroundColor: primario, borderRadius: 6, maxBarThickness: 22 },
        { label: "Avisos enviados", data: avisos, backgroundColor: css("--ok"), borderRadius: 6, maxBarThickness: 22 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 700, easing: "easeOutQuart" },
      plugins: {
        legend: { labels: { color: suave, boxWidth: 10, usePointStyle: true, pointStyle: "rectRounded" } },
        tooltip: {
          backgroundColor: css("--superficie-solida"), titleColor: css("--texto"), bodyColor: css("--texto"),
          borderColor: css("--borde-fuerte"), borderWidth: 1, padding: 10, cornerRadius: 10,
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: suave, maxRotation: 0, autoSkipPadding: 12 } },
        y: { beginAtZero: true, grid: { color: css("--borde") }, border: { display: false }, ticks: { color: suave, precision: 0, maxTicksLimit: 5 } },
      },
    },
  });
  return {
    actualizar(nuevasEtiquetas, nuevasRevisiones, nuevosAvisos) {
      grafica.data.labels = nuevasEtiquetas;
      grafica.data.datasets[0].data = nuevasRevisiones;
      grafica.data.datasets[1].data = nuevosAvisos;
      grafica.update();
    },
    destruir: () => grafica.destroy(),
  };
}
