import { api } from "../api.js";
import { icono } from "../iconos.js";
import { $, aviso, conCarga, contarHasta, esc, esHttps } from "../util.js";

const NUMEROS = ["cabina_max", "facturada_nacional_max", "facturada_europa_max", "facturada_largo_max"];

function fila(a) {
  const num = (campo) => `<input type="number" min="0" step="0.01" inputmode="decimal" data-campo="${campo}" value="${a[campo] ?? ""}">`;
  return `
    <tr data-codigo="${esc(a.codigo)}" class="${a.permitida ? "" : "bloqueada"}">
      <td><label class="interruptor" title="Permitida"><input type="checkbox" data-campo="permitida" ${a.permitida ? "checked" : ""}><span class="pista"></span></label></td>
      <td><span class="chip primario" style="font-family:'JetBrains Mono',monospace">${esc(a.codigo)}</span></td>
      <td><input class="ancho" data-campo="nombre" value="${esc(a.nombre)}"></td>
      <td>${num("cabina_max")}</td>
      <td>${num("facturada_nacional_max")}</td>
      <td>${num("facturada_europa_max")}</td>
      <td>${num("facturada_largo_max")}</td>
      <td><select data-campo="cobra_por" style="min-width:9rem">
        <option value="tramo" ${a.cobra_por === "tramo" ? "selected" : ""}>cada vuelo</option>
        <option value="trayecto" ${a.cobra_por === "trayecto" ? "selected" : ""}>cada trayecto</option></select></td>
      <td><input class="ancho" data-campo="web_oficial" value="${esc(a.web_oficial || "")}" placeholder="https://"></td>
      <td class="pequeno suave" style="min-width:16rem;max-width:22rem">${esc(a.criterio || "")}${a.notas ? `<br><span class="tenue">${esc(a.notas)}</span>` : ""}</td>
      <td><button class="icono pequeno" data-guardar title="Guardar los cambios de esta fila">${icono("check")}</button></td>
    </tr>`;
}

export async function vistaAerolineas(app) {
  const lista = await api.aerolineas();
  app.innerHTML = `
    <div>
      <div class="cabecera-pagina">
        <div>
          <h1>Aerolíneas de confianza</h1>
          <p class="subtitulo">Solo se aceptan vuelos vendidos <b>y operados</b> por aerolíneas de esta lista.</p>
        </div>
      </div>

      <div class="kpis escalonado">
        <div class="tarjeta kpi"><div class="kpi-icono">${icono("avion")}</div>
          <div><div class="valor" id="k-total">0</div><div class="etiqueta">en la lista</div></div></div>
        <div class="tarjeta kpi"><div class="kpi-icono ok">${icono("escudo")}</div>
          <div><div class="valor" id="k-permitidas">0</div><div class="etiqueta">permitidas</div></div></div>
        <div class="tarjeta kpi"><div class="kpi-icono mal">${icono("cruz")}</div>
          <div><div class="valor" id="k-bloqueadas">0</div><div class="etiqueta">desactivadas por ti</div></div></div>
      </div>

      <section class="tarjeta">
        <div class="tarjeta-titulo"><h2>${icono("info")}Cómo funciona</h2></div>
        <p>Es una <b>lista blanca</b>: si la aerolínea que vende el billete o la que <b>opera</b> el avión no está aquí (o la desactivas),
          el vuelo se descarta. Los enlaces de compra van siempre a la web oficial, nunca a agencias.</p>
        <p class="pequeno suave">Criterio inicial (octubre de 2026): top 25 de seguridad de AirlineRatings 2026 (tradicionales y low cost),
          aerolíneas con 7/7 en seguridad y aerolíneas certificadas en la UE con auditoría IOSA de IATA. Ninguna de las de la lista negra de la UE.</p>
        <div class="nota alerta">${icono("maleta")}<span>Los precios de maletas son el <b>máximo estimado por unidad</b> en euros.
          Si al comprar ves que una aerolínea cobra distinto, cámbialo aquí y pulsa ${icono("check")}: el robot lo usa en su siguiente vuelta.
          «Cada vuelo» se paga en cada despegue; «cada trayecto», una vez a la ida y otra a la vuelta.</span></div>
      </section>

      <section class="tarjeta">
        <div class="fila entre" style="margin-bottom:1rem">
          <div class="autocompletar" style="flex:1;min-width:220px;max-width:360px">
            ${icono("lupa", "icono-campo")}<input id="filtro" placeholder="Buscar por nombre o código" autocomplete="off">
          </div>
          <div class="segmentado" id="vista-filtro">
            <label><input type="radio" name="ver" value="todas" checked>Todas</label>
            <label><input type="radio" name="ver" value="si">Permitidas</label>
            <label><input type="radio" name="ver" value="no">Desactivadas</label>
          </div>
        </div>
        <div class="tabla-envoltura"><table>
          <thead><tr><th>Usar</th><th>Cód.</th><th>Nombre</th><th>Cabina €</th><th>20 kg España €</th><th>20 kg Europa €</th>
            <th>20 kg largo €</th><th>Cobra por</th><th>Web oficial</th><th>Por qué es de confianza</th><th></th></tr></thead>
          <tbody id="filas">${lista.map(fila).join("")}</tbody>
        </table></div>
        <p class="pequeno tenue oculto" id="sin-resultados" style="text-align:center;margin:1rem 0 0">Ninguna aerolínea coincide con la búsqueda.</p>
      </section>

      <section class="tarjeta">
        <div class="tarjeta-titulo"><h2>${icono("mas")}Añadir aerolínea</h2></div>
        <p class="pequeno suave">Antes de añadirla, comprueba su seguridad (por ejemplo en airlineratings.com: 7/7) y que no esté en la lista negra de la UE.</p>
        <form id="nueva" class="columnas" novalidate>
          <div class="campo"><label for="n-codigo">Código IATA</label><input id="n-codigo" maxlength="2" placeholder="p. ej. IB" style="text-transform:uppercase"></div>
          <div class="campo"><label for="n-nombre">Nombre</label><input id="n-nombre" placeholder="Iberia"></div>
          <div class="campo"><label for="n-web">Web oficial</label><input id="n-web" placeholder="https://"></div>
          <div class="campo"><label for="n-criterio">Por qué es de confianza</label><input id="n-criterio" placeholder="AirlineRatings 7/7"></div>
          <div class="campo" style="align-self:end"><button class="primario bloque" type="submit">${icono("mas")}Añadir</button></div>
        </form>
      </section>
    </div>`;

  const contadores = () => {
    const permitidas = app.querySelectorAll('#filas input[data-campo="permitida"]:checked').length;
    contarHasta($("#k-total"), lista.length, { formato: (n) => String(Math.round(n)), duracion: 500 });
    contarHasta($("#k-permitidas"), permitidas, { formato: (n) => String(Math.round(n)), duracion: 500 });
    contarHasta($("#k-bloqueadas"), lista.length - permitidas, { formato: (n) => String(Math.round(n)), duracion: 500 });
  };
  const filtrar = () => {
    const q = $("#filtro").value.trim().toLowerCase();
    const ver = app.querySelector('input[name="ver"]:checked').value;
    let visibles = 0;
    app.querySelectorAll("#filas tr").forEach((tr) => {
      const texto = `${tr.dataset.codigo} ${tr.querySelector('[data-campo="nombre"]').value}`.toLowerCase();
      const permitida = tr.querySelector('[data-campo="permitida"]').checked;
      const mostrar = texto.includes(q) && (ver === "todas" || (ver === "si") === permitida);
      tr.classList.toggle("oculto", !mostrar);
      visibles += mostrar;
    });
    $("#sin-resultados").classList.toggle("oculto", visibles > 0);
  };
  contadores();
  $("#filtro").addEventListener("input", filtrar);
  $("#vista-filtro").addEventListener("change", filtrar);

  const guardarFila = async (tr) => {
    const datos = { codigo: tr.dataset.codigo };
    tr.querySelectorAll("[data-campo]").forEach((el) => {
      const c = el.dataset.campo;
      datos[c] = el.type === "checkbox" ? el.checked : NUMEROS.includes(c) ? Number(el.value || 0) : el.value.trim();
    });
    datos.web_oficial = datos.web_oficial || null;
    if (datos.web_oficial && !esHttps(datos.web_oficial)) return aviso("La web oficial tiene que empezar por https://", "error");
    const boton = tr.querySelector("[data-guardar]");
    try {
      await conCarga(boton, api.guardarAerolinea(datos));
      boton.classList.remove("primario");
      tr.classList.toggle("bloqueada", !datos.permitida);
      aviso(`${datos.nombre} guardada${datos.permitida ? "" : " (desactivada)"}`);
      contadores();
    } catch (e) {
      aviso(e.message, "error");
    }
  };
  $("#filas").addEventListener("click", (ev) => {
    const boton = ev.target.closest("[data-guardar]");
    if (boton) guardarFila(boton.closest("tr"));
  });
  $("#filas").addEventListener("input", (ev) => {
    // Hay cambios sin guardar en la fila: se resalta su botón
    if (ev.target.dataset.campo !== "permitida") ev.target.closest("tr").querySelector("[data-guardar]").classList.add("primario");
  });
  $("#filas").addEventListener("change", (ev) => {
    if (ev.target.dataset.campo === "permitida") guardarFila(ev.target.closest("tr"));
  });

  $("#nueva").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const codigo = $("#n-codigo").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(codigo)) return aviso("El código IATA son 2 letras o números (p. ej. IB)", "error");
    if (lista.some((a) => a.codigo === codigo)) return aviso("Esa aerolínea ya está en la lista", "error");
    const web = $("#n-web").value.trim();
    if (web && !esHttps(web)) return aviso("La web oficial tiene que empezar por https://", "error");
    try {
      await conCarga(ev.submitter, api.guardarAerolinea({
        codigo, nombre: $("#n-nombre").value.trim() || codigo, permitida: true,
        web_oficial: web || null, criterio: $("#n-criterio").value.trim() || "Añadida por ti",
        cabina_max: 60, facturada_nacional_max: 130, facturada_europa_max: 130, facturada_largo_max: 150, cobra_por: "tramo",
      }));
      aviso("Aerolínea añadida con precios de maletas prudentes: ajústalos si los conoces");
      vistaAerolineas(app);
    } catch (e) {
      aviso(e.message, "error");
    }
  });
}
