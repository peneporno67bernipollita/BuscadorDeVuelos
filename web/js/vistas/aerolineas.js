import { api } from "../api.js";
import { $, aviso, esc } from "../util.js";

const NUMEROS = ["cabina_max", "facturada_nacional_max", "facturada_europa_max", "facturada_largo_max"];

function fila(a) {
  const num = (campo) => `<input type="number" min="0" step="0.01" data-campo="${campo}" value="${a[campo] ?? ""}">`;
  return `
    <tr data-codigo="${esc(a.codigo)}">
      <td><input type="checkbox" data-campo="permitida" ${a.permitida ? "checked" : ""} title="Permitida"></td>
      <td><b>${esc(a.codigo)}</b></td>
      <td><input class="ancho" data-campo="nombre" value="${esc(a.nombre)}"></td>
      <td>${num("cabina_max")}</td>
      <td>${num("facturada_nacional_max")}</td>
      <td>${num("facturada_europa_max")}</td>
      <td>${num("facturada_largo_max")}</td>
      <td><select data-campo="cobra_por">
        <option value="tramo" ${a.cobra_por === "tramo" ? "selected" : ""}>cada vuelo</option>
        <option value="trayecto" ${a.cobra_por === "trayecto" ? "selected" : ""}>cada trayecto</option></select></td>
      <td><input class="ancho" data-campo="web_oficial" value="${esc(a.web_oficial || "")}"></td>
      <td class="pequeno suave" style="min-width:16rem">${esc(a.criterio || "")}${a.notas ? `<br>${esc(a.notas)}` : ""}</td>
      <td><button class="pequeno" data-guardar>Guardar</button></td>
    </tr>`;
}

export async function vistaAerolineas(app) {
  const lista = await api.aerolineas();
  app.innerHTML = `
    <div class="titulo-pagina"><h1>Aerolíneas de confianza</h1></div>
    <section class="tarjeta">
      <p>Es una <b>lista blanca</b>: el robot solo acepta vuelos en los que tanto la aerolínea que vende como la que
        <b>opera</b> el avión están aquí y marcadas como permitidas. Una aerolínea que no esté en la lista queda fuera.</p>
      <p class="pequeno suave">Criterio inicial (investigación de octubre de 2026): top 25 de seguridad de AirlineRatings 2026 (tradicionales y low cost),
        aerolíneas con 7/7 en seguridad, y aerolíneas certificadas en la UE con auditoría de seguridad IOSA de IATA.
        Las 154 aerolíneas de la lista negra de la UE no están. Los enlaces de compra van siempre a la web oficial, nunca a agencias.</p>
      <div class="nota alerta pequeno">Los precios de maletas son el <b>máximo estimado por unidad</b> (en euros) según lo publicado en 2026.
        Si al comprar ves que una aerolínea cobra distinto, ajústalo aquí: el robot lo usará en la siguiente ronda.
        "Cada vuelo" = se paga en cada despegue; "cada trayecto" = una vez por la ida y otra por la vuelta.</div>
      <div class="fila">
        <input id="filtro" placeholder="Filtrar por nombre o código" style="max-width:280px">
        <span class="suave pequeno" id="contador"></span>
      </div>
    </section>
    <section class="tarjeta">
      <div class="tabla-envoltura"><table>
        <thead><tr><th>Sí</th><th>Cód.</th><th>Nombre</th><th>Cabina €</th><th>20 kg España €</th><th>20 kg Europa €</th>
          <th>20 kg largo €</th><th>Cobra por</th><th>Web oficial</th><th>Criterio</th><th></th></tr></thead>
        <tbody id="filas">${lista.map(fila).join("")}</tbody>
      </table></div>
    </section>
    <section class="tarjeta">
      <h2>Añadir aerolínea</h2>
      <p class="pequeno suave">Antes de añadirla, comprueba su seguridad (p. ej. airlineratings.com: 7/7) y que no esté en la lista negra de la UE.</p>
      <form id="nueva" class="columnas">
        <div class="campo"><label>Código IATA (2 caracteres)</label><input id="n-codigo" maxlength="2" required></div>
        <div class="campo"><label>Nombre</label><input id="n-nombre" required></div>
        <div class="campo"><label>Web oficial</label><input id="n-web" placeholder="https://"></div>
        <div class="campo"><label>Por qué es de confianza</label><input id="n-criterio"></div>
        <div class="campo" style="align-self:end"><button class="primario" type="submit">Añadir</button></div>
      </form>
    </section>`;

  const contador = () => {
    const visibles = app.querySelectorAll("#filas tr:not(.oculto)").length;
    const permitidas = app.querySelectorAll('#filas input[data-campo="permitida"]:checked').length;
    $("#contador").textContent = `${visibles} mostradas · ${permitidas} permitidas`;
  };
  contador();

  $("#filtro").addEventListener("input", (ev) => {
    const q = ev.target.value.toLowerCase();
    app.querySelectorAll("#filas tr").forEach((tr) => {
      const texto = tr.dataset.codigo.toLowerCase() + " " + tr.querySelector('[data-campo="nombre"]').value.toLowerCase();
      tr.classList.toggle("oculto", !texto.includes(q));
    });
    contador();
  });

  $("#filas").addEventListener("click", async (ev) => {
    if (!ev.target.matches("[data-guardar]")) return;
    const tr = ev.target.closest("tr");
    const datos = { codigo: tr.dataset.codigo };
    tr.querySelectorAll("[data-campo]").forEach((el) => {
      const c = el.dataset.campo;
      datos[c] = el.type === "checkbox" ? el.checked : NUMEROS.includes(c) ? Number(el.value || 0) : el.value.trim();
    });
    try {
      await api.guardarAerolinea(datos);
      aviso(`${datos.nombre} guardada`);
      contador();
    } catch (e) {
      aviso(e.message, "error");
    }
  });
  $("#filas").addEventListener("change", (ev) => {
    if (ev.target.dataset.campo === "permitida") ev.target.closest("tr").querySelector("[data-guardar]").click();
  });

  $("#nueva").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const codigo = $("#n-codigo").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(codigo)) return aviso("El código IATA son 2 letras o números (p. ej. IB)", "error");
    if (lista.some((a) => a.codigo === codigo)) return aviso("Esa aerolínea ya está en la lista", "error");
    try {
      await api.guardarAerolinea({
        codigo, nombre: $("#n-nombre").value.trim() || codigo, permitida: true,
        web_oficial: $("#n-web").value.trim() || null, criterio: $("#n-criterio").value.trim() || "Añadida por ti",
        cabina_max: 60, facturada_nacional_max: 130, facturada_europa_max: 130, facturada_largo_max: 150, cobra_por: "tramo",
      });
      aviso("Aerolínea añadida con precios de maletas prudentes: ajústalos si los conoces");
      vistaAerolineas(app);
    } catch (e) {
      aviso(e.message, "error");
    }
  });
}
