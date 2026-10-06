import { api } from "../api.js";
import { aviso, esc, fechaHora, hace } from "../util.js";
import { LIMITE_MINUTOS, minutosEstimados } from "./panel.js";

function tarjetaFuente(f) {
  const bloqueada = f.bloqueada_hasta && new Date(f.bloqueada_hasta) > new Date();
  const estado = !f.activa ? '<span class="insignia">Desactivada</span>'
    : bloqueada ? `<span class="insignia mal">Bloqueada hasta ${fechaHora(f.bloqueada_hasta)}</span>`
    : '<span class="insignia ok">Funcionando</span>';
  return `
    <article class="tarjeta">
      <div class="fila entre"><h3 style="margin:0">${esc(f.nombre)}</h3>${estado}</div>
      <p class="pequeno suave" style="margin-top:.4rem">${esc(f.descripcion || "")}</p>
      <div class="pequeno">Una ronda como mucho cada <b>${Math.floor(f.intervalo_min / 60)} h ${f.intervalo_min % 60} min</b>
        (referencia + 20 min de margen) · ${f.pausa_min_s}-${f.pausa_max_s} s entre peticiones · máx. ${f.max_peticiones} por ronda</div>
      <div class="pequeno">Última ronda: ${hace(f.ultima_ronda)} · última correcta: ${hace(f.ultima_ok)}
        ${f.bloqueos_seguidos ? ` · bloqueos seguidos: ${f.bloqueos_seguidos}` : ""}</div>
      ${f.ultimo_error ? `<div class="nota mal pequeno">${esc(f.ultimo_error)}</div>` : ""}
      <label class="check" style="margin-top:.6rem"><input type="checkbox" data-fuente="${esc(f.fuente)}" ${f.activa ? "checked" : ""}> Usar esta web</label>
    </article>`;
}

export async function vistaEstado(app) {
  const [fuentes, ejecuciones, mes] = await Promise.all([api.fuentes(), api.ejecuciones(30), api.ejecucionesDelMes()]);
  const minutos = minutosEstimados(mes);
  const pct = Math.min(100, Math.round((minutos / LIMITE_MINUTOS) * 100));

  app.innerHTML = `
    <div class="titulo-pagina"><h1>Robot</h1></div>
    <section class="tarjeta">
      <p>El robot se ejecuta en GitHub Actions <b>cada 3 horas</b>. En cada ronda solo consulta las webs a las que les toca
        (cada una tiene su propio ritmo) y solo revisa las búsquedas que lo necesitan: cada 3 h si el viaje es en menos de 3 semanas,
        cada 6 h si faltan menos de 2 meses y cada 12 h si falta más (o si es un chollo).</p>
      <p>Cada búsqueda se hace en una <b>sesión privada nueva</b>, sin cookies guardadas, en una máquina recién creada.
        Si una web pide verificación anti-robots, no se intenta saltar: se deja descansar el doble de tiempo cada vez.</p>
      <div class="pequeno"><b>Minutos de GitHub este mes (aprox.): ${minutos} de ${LIMITE_MINUTOS}</b> (${pct} %)</div>
      <div style="background:var(--superficie-2);border-radius:999px;height:8px;margin-top:.3rem;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${pct > 85 ? "var(--mal)" : "var(--acento)"}"></div></div>
    </section>
    <div class="rejilla">${fuentes.map(tarjetaFuente).join("")}</div>
    <section class="tarjeta">
      <h2>Últimas rondas</h2>
      ${ejecuciones.length ? `<div class="tabla-envoltura"><table>
        <thead><tr><th>Inicio</th><th>Duración</th><th>Webs</th><th>Revisadas</th><th>Avisos</th><th>Incidencias</th></tr></thead>
        <tbody>${ejecuciones.map((e) => {
          const r = e.resumen || {};
          const errores = [...(r.errores || []), ...Object.entries(r.fuentes || {}).flatMap(([n, f]) => (f.bloqueo ? [`${n}: ${f.bloqueo}`] : []))];
          return `<tr><td>${fechaHora(e.inicio)}${r.forzada ? ' <span class="insignia">manual</span>' : ""}</td>
            <td class="num">${e.duracion_s != null ? `${Math.floor(e.duracion_s / 60)} min ${e.duracion_s % 60} s` : "en curso"}</td>
            <td class="pequeno">${esc((r.fuentes_en_ronda || []).join(", ") || "—")}</td>
            <td class="num">${r.revisadas ?? 0}</td><td class="num">${r.avisos ?? 0}</td>
            <td class="pequeno">${errores.length ? esc(errores.join(" · ")) : '<span class="suave">—</span>'}</td></tr>`;
        }).join("")}</tbody>
      </table></div>` : '<p class="suave">El robot todavía no se ha ejecutado. Mira docs/INSTALACION.md, paso 6.</p>'}
    </section>`;

  app.querySelectorAll("[data-fuente]").forEach((caja) =>
    caja.addEventListener("change", async () => {
      try {
        await api.actualizarFuente(caja.dataset.fuente, { activa: caja.checked });
        aviso(caja.checked ? "Web activada" : "Web desactivada");
        vistaEstado(app);
      } catch (e) {
        aviso(e.message, "error");
      }
    }),
  );
}
