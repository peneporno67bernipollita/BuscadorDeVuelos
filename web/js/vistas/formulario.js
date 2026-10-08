import { api } from "../api.js";
import { icono } from "../iconos.js";
import {
  $, aeropuertos, aeropuertosCercanos, aviso, bandera, buscarAeropuertos, conCarga, esc, eur, fecha, nombreAeropuerto,
} from "../util.js";

const MAX_EXTRA = 3; // aeropuertos de salida alternativos

const hoyMas = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

const PREDETERMINADA = {
  nombre: "", modo: "fechas", ida_vuelta: true, origen: "", destino: "",
  fecha_ida: hoyMas(45), fecha_vuelta: hoyMas(49), flex_dias: 0,
  chollo_desde: hoyMas(7), chollo_hasta: hoyMas(150), noches_min: 2, noches_max: 5,
  ida_salida_min: 0, ida_salida_max: 24, ida_llegada_min: 0, ida_llegada_max: 24,
  vuelta_salida_min: 0, vuelta_salida_max: 24, vuelta_llegada_min: 0, vuelta_llegada_max: 24,
  adultos: 1, ninos: 0, bebes: 0, maletas_cabina: 0, maletas_20kg: 0, aplicar_descuentos: true,
  escalas_max: 1, escala_max_horas: 6, modo_precio: "mas_barato", presupuesto: null,
};

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------
function montarAeropuerto(contenedor, datos, codigoInicial, alCambiar) {
  contenedor.innerHTML = `
    <div class="autocompletar">
      ${icono("ubicacion", "icono-campo")}
      <input type="text" autocomplete="off" spellcheck="false" placeholder="Ciudad, aeropuerto o código">
      <ul class="sugerencias oculto" role="listbox"></ul>
    </div>
    <div class="elegido"></div>`;
  const input = contenedor.querySelector("input");
  const lista = contenedor.querySelector(".sugerencias");
  const elegido = contenedor.querySelector(".elegido");
  let codigo = codigoInicial || "";
  let resultados = [];
  let activo = -1;

  const mostrarElegido = () => {
    const a = datos.mapa.get(codigo);
    elegido.innerHTML = a ? `${icono("check")}<span class="bandera" style="font-size:1rem">${bandera(a.p)}</span> ${esc(a.c)} · ${esc(a.es || a.n)}` : "";
    if (a) input.value = nombreAeropuerto(datos, codigo);
  };
  const cerrar = () => {
    lista.classList.add("oculto");
    activo = -1;
  };
  const elegir = (a) => {
    codigo = a.c;
    mostrarElegido();
    cerrar();
    alCambiar(codigo);
  };
  const pintar = () => {
    lista.innerHTML = resultados.map((a, i) => `
      <li data-i="${i}" class="${i === activo ? "activa" : ""}" role="option">
        <span class="bandera">${bandera(a.p)}</span><span class="codigo">${a.c}</span>
        <span><span class="nombre">${esc(a.es || a.n)}</span><span class="lugar">${a.es ? esc(a.pn) : `${esc(a.m)}, ${esc(a.pn)}`}</span></span>
      </li>`).join("") || '<li class="suave">Sin resultados</li>';
    lista.classList.remove("oculto");
  };
  input.addEventListener("input", () => {
    codigo = "";
    elegido.innerHTML = "";
    alCambiar("");
    resultados = buscarAeropuertos(datos, input.value);
    activo = resultados.length ? 0 : -1;
    if (input.value.trim().length >= 2) pintar();
    else cerrar();
  });
  input.addEventListener("keydown", (ev) => {
    if (lista.classList.contains("oculto")) return;
    if (ev.key === "ArrowDown") activo = Math.min(activo + 1, resultados.length - 1);
    else if (ev.key === "ArrowUp") activo = Math.max(activo - 1, 0);
    else if (ev.key === "Enter" && resultados[activo]) {
      ev.preventDefault();
      return elegir(resultados[activo]);
    } else if (ev.key === "Escape") return cerrar();
    else return;
    ev.preventDefault();
    pintar();
  });
  lista.addEventListener("mousedown", (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (li) elegir(resultados[Number(li.dataset.i)]);
  });
  input.addEventListener("blur", () => setTimeout(cerrar, 150));
  mostrarElegido();
  return { poner: (c) => { codigo = c; input.value = ""; mostrarElegido(); } };
}

/** Fila de una salida alternativa: su aeropuerto (editable) y la llegada, que es siempre la misma. */
function filaSalida(i) {
  return `
    <div class="fila-salida" data-fila="${i}">
      <div class="campo salida-alt"><label>Otra salida</label><div class="campo-salida"></div></div>
      <span class="flecha-salida">${icono("flecha")}</span>
      <div class="campo llegada-alt"><label>Llegada</label><div class="llegada-fija" data-llegada></div></div>
      <button type="button" class="icono pequeno fantasma quitar-fila" data-quitar-fila="${i}" title="Quitar esta salida">${icono("cruz")}</button>
    </div>`;
}

function rangoDoble(nombre, titulo, min, max) {
  return `
    <div class="franja" data-rango="${nombre}">
      <div class="franja-cabecera"><span>${titulo}</span><span class="valor-franja"></span></div>
      <div class="rango-doble">
        <div class="riel"></div><div class="relleno"></div>
        <input type="range" min="0" max="24" step="1" value="${min}" name="${nombre}_min" aria-label="${titulo}: desde">
        <input type="range" min="0" max="24" step="1" value="${max}" name="${nombre}_max" aria-label="${titulo}: hasta">
      </div>
      <div class="marcas-horas"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    </div>`;
}

function activarRango(el) {
  const [a, b] = el.querySelectorAll("input");
  const relleno = el.querySelector(".relleno");
  const valor = el.querySelector(".valor-franja");
  const pintar = (movido) => {
    let min = Number(a.value);
    let max = Number(b.value);
    if (min >= max) {
      // Los dos tiradores no pueden cruzarse: se separan una hora
      if (movido === a) { min = Math.min(min, 23); a.value = min; max = min + 1; b.value = max; } else { max = Math.max(max, 1); b.value = max; min = max - 1; a.value = min; }
    }
    relleno.style.left = `${(min / 24) * 100}%`;
    relleno.style.right = `${100 - (max / 24) * 100}%`;
    valor.textContent = min === 0 && max === 24 ? "Cualquier hora" : `${hh(min)} – ${max === 24 ? "24:00" : hh(max)}`;
  };
  a.addEventListener("input", () => pintar(a));
  b.addEventListener("input", () => pintar(b));
  pintar();
}

function contador(id, titulo, subtitulo, valor, min, max) {
  return `
    <div class="contador">
      <div class="texto"><b>${titulo}</b><small>${subtitulo}</small></div>
      <div class="control">
        <button type="button" data-restar="${id}" aria-label="Quitar">−</button>
        <output id="${id}" data-min="${min}" data-max="${max}">${valor}</output>
        <button type="button" data-sumar="${id}" aria-label="Añadir">+</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------
export async function vistaFormulario(app, id, duplicar = false) {
  const [datos, perfil] = await Promise.all([aeropuertos(), api.perfil()]);
  let b = { ...PREDETERMINADA };
  if (id) {
    const existente = await api.busqueda(id);
    if (!existente) throw new Error("No existe esa búsqueda.");
    b = { ...b, ...existente };
    if (duplicar) b.nombre = `${b.nombre} (copia)`;
  }
  const editando = id && !duplicar;
  const tieneDescuento = (perfil.familia_numerosa || "ninguna") !== "ninguna" || (perfil.residente || "ninguno") !== "ninguno";
  const opcionNumero = (desde, hasta, sel) =>
    Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i).map((n) => `<option value="${n}" ${Number(sel) === n ? "selected" : ""}>${n}</option>`).join("");

  app.innerHTML = `
    <div>
      <div class="cabecera-pagina">
        <div>
          <h1>${editando ? "Ajusta tu búsqueda" : "¿Adónde quieres volar?"}</h1>
          <p class="subtitulo">El robot la revisará sin parar y te avisará por Telegram en el mejor momento.</p>
        </div>
      </div>
      <form id="form-busqueda" class="rejilla-2" novalidate>
        <div class="escalonado">
          <section class="tarjeta seccion-form">
            <div class="tarjeta-titulo"><h2><span class="numero">1</span>Qué vigilar</h2></div>
            <div class="opciones-tarjeta" style="margin-bottom:1rem">
              <label class="opcion-tarjeta"><input type="radio" name="modo" value="fechas" ${b.modo === "fechas" ? "checked" : ""}>
                <span class="icono-opcion">${icono("calendario")}</span><span><b>Fechas concretas</b><small>Te aviso del mejor momento para comprar esas fechas.</small></span></label>
              <label class="opcion-tarjeta"><input type="radio" name="modo" value="chollo" ${b.modo === "chollo" ? "checked" : ""}>
                <span class="icono-opcion">${icono("llama")}</span><span><b>Chollo</b><small>Cualquier fecha de un periodo, si aparece un precio muy por debajo de lo normal.</small></span></label>
            </div>
            <div class="segmentado">
              <label><input type="radio" name="ida_vuelta" value="1" ${b.ida_vuelta ? "checked" : ""}>${icono("intercambiar")}Ida y vuelta</label>
              <label><input type="radio" name="ida_vuelta" value="0" ${!b.ida_vuelta ? "checked" : ""}>${icono("flecha")}Solo ida</label>
            </div>
          </section>

          <section class="tarjeta seccion-form">
            <div class="tarjeta-titulo"><h2><span class="numero">2</span>Aeropuertos</h2></div>
            <div class="aeropuertos">
              <div class="campo"><label>Salida</label><div id="origen"></div></div>
              <button type="button" class="icono intercambiar" id="intercambiar" title="Intercambiar origen y destino">${icono("intercambiar")}</button>
              <div class="campo"><label>Llegada</label><div id="destino"></div></div>
            </div>
            <div id="salidas-extra"></div>
            <button type="button" class="fantasma pequeno" id="anadir-salida" style="margin-top:.5rem">${icono("mas")}Añadir otro aeropuerto de salida</button>
            <div class="cercanos" id="cercanos"></div>
            <div class="nota" id="nota-vuelta">${icono("info")}<span></span></div>
            <p class="ayuda">¿Te vale salir de varios sitios (p. ej. Jerez o Sevilla)? Añade hasta ${MAX_EXTRA} aeropuertos de salida más:
              el robot busca desde todos a la vez hacia tu llegada. Solo se aceptan vuelos de los aeropuertos que elijas
              (ojo: París tiene CDG, Orly y Beauvais, a 85 km); las escalas intermedias dan igual.</p>
          </section>

          <section class="tarjeta seccion-form">
            <div class="tarjeta-titulo"><h2><span class="numero">3</span>Fechas</h2></div>
            <div id="bloque-fechas" class="columnas">
              <div class="campo"><label for="fecha_ida">Ida</label><input type="date" id="fecha_ida" value="${b.fecha_ida || ""}"></div>
              <div class="campo con-vuelta"><label for="fecha_vuelta">Vuelta</label><input type="date" id="fecha_vuelta" value="${b.fecha_vuelta || ""}"></div>
              <div class="campo"><label for="flex_dias">Margen</label>
                <select id="flex_dias">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${b.flex_dias === n ? "selected" : ""}>${n ? `± ${n} día${n > 1 ? "s" : ""}` : "Fechas exactas"}</option>`).join("")}</select>
                <div class="ayuda">Mueve ida y vuelta juntas para encontrar el día más barato.</div></div>
            </div>
            <div id="bloque-chollo" class="columnas">
              <div class="campo"><label for="chollo_desde">Desde</label><input type="date" id="chollo_desde" value="${b.chollo_desde || ""}"></div>
              <div class="campo"><label for="chollo_hasta">Hasta</label><input type="date" id="chollo_hasta" value="${b.chollo_hasta || ""}">
                <div class="ayuda">Google busca hasta unos 10 meses vista.</div></div>
              <div class="campo con-vuelta"><label>Noches de estancia</label>
                <div class="fila" style="flex-wrap:nowrap"><select id="noches_min">${opcionNumero(1, 30, b.noches_min)}</select><span class="suave">a</span>
                <select id="noches_max">${opcionNumero(1, 30, b.noches_max)}</select></div></div>
            </div>
          </section>

          <section class="tarjeta seccion-form">
            <div class="tarjeta-titulo"><h2><span class="numero">4</span>Horarios</h2><span class="pequeno tenue">hora local de cada aeropuerto</span></div>
            ${rangoDoble("ida_salida", "Ida · salida", b.ida_salida_min, b.ida_salida_max)}
            ${rangoDoble("ida_llegada", "Ida · llegada", b.ida_llegada_min, b.ida_llegada_max)}
            <div class="con-vuelta">
              ${rangoDoble("vuelta_salida", "Vuelta · salida", b.vuelta_salida_min, b.vuelta_salida_max)}
              ${rangoDoble("vuelta_llegada", "Vuelta · llegada", b.vuelta_llegada_min, b.vuelta_llegada_max)}
            </div>
            <p class="ayuda">Si no puedes salir antes de las 9 ni llegar después de las 22, ajusta los tiradores. Una llegada pasada la medianoche cuenta como más tarde de las 24:00.</p>
          </section>

          <section class="tarjeta seccion-form">
            <div class="tarjeta-titulo"><h2><span class="numero">5</span>Pasajeros y maletas</h2><span class="pequeno tenue">máximo 9 personas</span></div>
            <div class="rejilla-contadores">
              ${contador("adultos", "Adultos", "12 años o más", b.adultos, 1, 9)}
              ${contador("ninos", "Niños", "de 2 a 11 años", b.ninos, 0, 8)}
              ${contador("bebes", "Bebés", "menos de 2, en brazos", b.bebes, 0, 8)}
            </div>
            <div class="rejilla-contadores" style="margin-top:.7rem">
              ${contador("maletas_cabina", "Maleta de cabina", "10 kg · ¿cuántos la llevan?", b.maletas_cabina, 0, 9)}
              ${contador("maletas_20kg", "Maleta facturada", "20 kg · ¿cuántos facturan?", b.maletas_20kg, 0, 9)}
            </div>
            <p class="ayuda">Las tarifas básicas de las low cost solo incluyen un bolso bajo el asiento. El robot suma cada maleta en cada vuelo; si no sabe el precio exacto usa el máximo de esa aerolínea, así el total nunca sale por debajo del real.</p>
            <label class="interruptor ${tieneDescuento ? "" : "oculto"}" style="margin-top:.6rem"><input type="checkbox" id="aplicar_descuentos" ${b.aplicar_descuentos !== false ? "checked" : ""}><span class="pista"></span>
              Aplicar mis descuentos (familia numerosa / residente)</label>
          </section>

          <section class="tarjeta seccion-form">
            <div class="tarjeta-titulo"><h2><span class="numero">6</span>Escalas</h2></div>
            <div class="segmentado" style="margin-bottom:1rem">
              <label><input type="radio" name="escalas_max" value="0" ${b.escalas_max === 0 ? "checked" : ""}>Solo directos</label>
              <label><input type="radio" name="escalas_max" value="1" ${b.escalas_max === 1 ? "checked" : ""}>Máx. 1 escala</label>
              <label><input type="radio" name="escalas_max" value="2" ${b.escalas_max === 2 ? "checked" : ""}>Máx. 2 escalas</label>
            </div>
            <div class="franja" id="bloque-espera">
              <div class="franja-cabecera"><span>Espera máxima en cada escala</span><span class="valor-franja" id="valor-espera"></span></div>
              <input type="range" id="escala_max_horas" min="1" max="24" step="1" value="${b.escala_max_horas}" style="padding:0;height:32px;accent-color:var(--primario)">
              <div class="ayuda">Las escalas con billetes separados (self-transfer) se descartan siempre.</div>
            </div>
          </section>

          <section class="tarjeta seccion-form">
            <div class="tarjeta-titulo"><h2><span class="numero">7</span>Precio</h2></div>
            <div class="opciones-tarjeta">
              <label class="opcion-tarjeta"><input type="radio" name="modo_precio" value="mas_barato" ${b.modo_precio === "mas_barato" ? "checked" : ""}>
                <span class="icono-opcion">${icono("baja")}</span><span><b>Lo más barato posible</b><small>El robot decide: mínimo de varias horas en la ventana más barata, chollos y un último aviso antes de las 3 semanas finales.</small></span></label>
              <label class="opcion-tarjeta"><input type="radio" name="modo_precio" value="presupuesto" ${b.modo_precio === "presupuesto" ? "checked" : ""}>
                <span class="icono-opcion">${icono("euro")}</span><span><b>Tengo un objetivo de precio</b><small>Te aviso cuando el total (billetes + maletas − descuentos) no lo supere, y antes si se queda cerca: hasta un 20 % más caro (con 30 € de objetivo, hasta 36 €).</small></span></label>
            </div>
            <div class="campo" id="bloque-presupuesto" style="max-width:300px;margin-top:1rem">
              <label for="presupuesto">Total máximo para todos</label>
              <input type="number" id="presupuesto" min="1" step="1" inputmode="decimal" value="${b.presupuesto ?? ""}" placeholder="p. ej. 200 €">
            </div>
          </section>
        </div>

        <aside class="resumen-lateral">
          <section class="tarjeta resaltada">
            <div class="tarjeta-titulo"><h2>${icono("chispas")}Resumen</h2></div>
            <ul id="resumen"></ul>
            <div class="campo"><label for="nombre">Nombre de la búsqueda</label>
              <input id="nombre" maxlength="80" value="${esc(b.nombre)}" placeholder="p. ej. Puente en París"></div>
            <div id="errores" class="error-form" role="alert"></div>
            <button class="primario grande bloque" type="submit">${icono(editando ? "check" : "rayo")}${editando ? "Guardar cambios" : "Empezar a vigilar"}</button>
            <a class="boton fantasma bloque" style="margin-top:.5rem" href="${editando ? `#/busqueda/${id}` : "#/"}">Cancelar</a>
          </section>
        </aside>
      </form>
    </div>`;

  const form = $("#form-busqueda");
  const valorRadio = (nombre) => form.querySelector(`input[name="${nombre}"]:checked`)?.value;
  const num = (idCampo) => Number($(`#${idCampo}`).value ?? $(`#${idCampo}`).textContent);
  let origen = b.origen;
  let destino = b.destino;
  // Salidas alternativas: la llegada es siempre la misma. "" = fila recién añadida, todavía sin elegir
  let salidas = [...(b.origenes_extra || [])];
  const salidasValidas = () => [...new Set(salidas.filter((c) => c && c !== origen && c !== destino))];
  const todasSalidas = () => [origen, ...salidasValidas()].filter(Boolean);
  const nombresSalida = () => todasSalidas().map((c) => nombreAeropuerto(datos, c)).join(" o ");

  form.querySelectorAll("[data-rango]").forEach(activarRango);

  const pintarLlegadas = () => form.querySelectorAll("[data-llegada]").forEach((el) => {
    el.innerHTML = destino ? `${icono("avion")}${esc(nombreAeropuerto(datos, destino))}` : '<span class="tenue">Elige la llegada arriba</span>';
  });
  const pintarCercanos = () => {
    const caben = Boolean(origen) && salidas.length < MAX_EXTRA;
    $("#anadir-salida").classList.toggle("oculto", !caben);
    const cerca = caben ? aeropuertosCercanos(datos, origen, { excluir: [origen, destino, ...salidas] }) : [];
    $("#cercanos").innerHTML = cerca.length
      ? `<span class="tenue">Cerca de ${esc(nombreAeropuerto(datos, origen, false))}:</span>${cerca.map(({ aeropuerto: a, km }) =>
        `<button type="button" class="chip" data-cercano="${a.c}">${icono("mas")}${esc(a.es || a.m || a.n)} (${a.c}) · ${km} km</button>`).join("")}`
      : "";
  };
  const pintarSalidas = (enfocar = -1) => {
    $("#salidas-extra").innerHTML = salidas.map((_, i) => filaSalida(i)).join("");
    salidas.forEach((codigo, i) => {
      const caja = $(`[data-fila="${i}"] .campo-salida`);
      montarAeropuerto(caja, datos, codigo, (c) => {
        salidas[i] = c;
        pintarCercanos();
        actualizar();
      });
      if (i === enfocar) caja.querySelector("input").focus();
    });
    pintarLlegadas();
    pintarCercanos();
  };
  const anadirSalida = (codigo = "") => {
    const vacia = salidas.indexOf("");
    if (codigo && vacia >= 0) salidas[vacia] = codigo; // una sugerencia rellena la fila vacía que haya
    else if (salidas.length < MAX_EXTRA) salidas.push(codigo);
    else return;
    pintarSalidas(codigo ? -1 : salidas.length - 1);
    actualizar();
  };
  form.addEventListener("click", (ev) => {
    const quitar = ev.target.closest("[data-quitar-fila]");
    const cercano = ev.target.closest("[data-cercano]");
    if (quitar) {
      salidas.splice(Number(quitar.dataset.quitarFila), 1);
      pintarSalidas();
      actualizar();
    } else if (cercano) {
      anadirSalida(cercano.dataset.cercano);
    } else if (ev.target.closest("#anadir-salida")) {
      anadirSalida();
    }
  });

  const campoOrigen = montarAeropuerto($("#origen"), datos, origen, (c) => {
    origen = c;
    pintarCercanos();
    actualizar();
  });
  const campoDestino = montarAeropuerto($("#destino"), datos, destino, (c) => {
    destino = c;
    pintarLlegadas();
    pintarCercanos();
    actualizar();
  });
  $("#intercambiar").addEventListener("click", () => {
    [origen, destino] = [destino, origen];
    campoOrigen.poner(origen);
    campoDestino.poner(destino);
    if (salidas.length) {
      salidas = []; // las salidas alternativas no tienen sentido al darle la vuelta al viaje
      aviso("Al intercambiar se han quitado las salidas alternativas");
    }
    pintarSalidas();
    actualizar();
  });

  // Contadores +/-
  form.addEventListener("click", (ev) => {
    const boton = ev.target.closest("[data-sumar], [data-restar]");
    if (!boton) return;
    const salida = $(`#${boton.dataset.sumar || boton.dataset.restar}`);
    const valor = Number(salida.textContent) + (boton.dataset.sumar ? 1 : -1);
    salida.textContent = Math.max(Number(salida.dataset.min), Math.min(Number(salida.dataset.max), valor));
    actualizar();
  });

  function actualizar() {
    const modo = valorRadio("modo");
    const idaVuelta = valorRadio("ida_vuelta") === "1";
    $("#bloque-fechas").classList.toggle("oculto", modo !== "fechas");
    $("#bloque-chollo").classList.toggle("oculto", modo !== "chollo");
    form.querySelectorAll(".con-vuelta").forEach((el) => el.classList.toggle("oculto", !idaVuelta));
    $("#bloque-presupuesto").classList.toggle("oculto", valorRadio("modo_precio") !== "presupuesto");
    $("#bloque-espera").classList.toggle("oculto", valorRadio("escalas_max") === "0");
    $("#valor-espera").textContent = `${$("#escala_max_horas").value} h`;
    const nota = $("#nota-vuelta");
    nota.classList.toggle("oculto", !(origen && destino));
    if (origen && destino) {
      const salidasTxt = todasSalidas().map(esc).join(" o ");
      nota.querySelector("span").innerHTML = !idaVuelta
        ? `Solo ida <b>${salidasTxt} → ${esc(destino)}</b>.`
        : todasSalidas().length > 1
          ? `Ida <b>${salidasTxt} → ${esc(destino)}</b> · vuelta <b>${esc(destino)} → al mismo aeropuerto del que salgas</b>.
             Si volver al otro sale más barato, también te lo enseño, bien marcado.`
          : `Ida <b>${esc(origen)} → ${esc(destino)}</b> · vuelta <b>${esc(destino)} → ${esc(origen)}</b>: siempre a los mismos aeropuertos.`;
    }
    // Resumen en vivo
    const pax = num("adultos") + num("ninos") + num("bebes");
    const fechas = modo === "fechas"
      ? `${fecha($("#fecha_ida").value) || "—"}${idaVuelta ? ` → ${fecha($("#fecha_vuelta").value) || "—"}` : ""}${num("flex_dias") ? ` (±${num("flex_dias")} d)` : ""}`
      : `Del ${fecha($("#chollo_desde").value) || "—"} al ${fecha($("#chollo_hasta").value) || "—"}`;
    const precio = valorRadio("modo_precio") === "presupuesto"
      ? `Avisar si baja de ${$("#presupuesto").value ? eur($("#presupuesto").value) : "…"}`
      : "Avisar en el mejor momento";
    $("#resumen").innerHTML = `
      <li>${icono("avion")}<span><b>${origen ? esc(nombresSalida()) : "Elige salida"}</b><br>${destino ? esc(nombreAeropuerto(datos, destino)) : "Elige llegada"}${idaVuelta ? " · ida y vuelta" : " · solo ida"}</span></li>
      <li>${icono("calendario")}<span>${esc(fechas)}</span></li>
      <li>${icono("personas")}<span>${pax} pasajero${pax !== 1 ? "s" : ""} · ${num("maletas_cabina")} cabina · ${num("maletas_20kg")} facturada${num("maletas_20kg") !== 1 ? "s" : ""}</span></li>
      <li>${icono("despegue")}<span>${valorRadio("escalas_max") === "0" ? "Solo directos" : `Hasta ${valorRadio("escalas_max")} escala${valorRadio("escalas_max") === "2" ? "s" : ""} de ${$("#escala_max_horas").value} h`}</span></li>
      <li>${icono("euro")}<span>${esc(precio)}</span></li>`;
  }
  form.addEventListener("input", actualizar);
  form.addEventListener("change", actualizar);
  pintarSalidas();
  actualizar();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const modo = valorRadio("modo");
    const idaVuelta = valorRadio("ida_vuelta") === "1";
    const d = {
      modo, ida_vuelta: idaVuelta, origen, destino,
      adultos: num("adultos"), ninos: num("ninos"), bebes: num("bebes"),
      maletas_cabina: num("maletas_cabina"), maletas_20kg: num("maletas_20kg"),
      escalas_max: Number(valorRadio("escalas_max")), escala_max_horas: num("escala_max_horas"),
      modo_precio: valorRadio("modo_precio"),
      presupuesto: valorRadio("modo_precio") === "presupuesto" ? Number($("#presupuesto").value) || null : null,
      aplicar_descuentos: $("#aplicar_descuentos").checked,
      fecha_ida: null, fecha_vuelta: null, flex_dias: 0, chollo_desde: null, chollo_hasta: null, noches_min: null, noches_max: null,
    };
    for (const s of ["ida", "vuelta"]) {
      for (const c of ["salida", "llegada"]) {
        const usar = s === "ida" || idaVuelta;
        d[`${s}_${c}_min`] = usar ? Number(form.querySelector(`[name="${s}_${c}_min"]`).value) : 0;
        d[`${s}_${c}_max`] = usar ? Number(form.querySelector(`[name="${s}_${c}_max"]`).value) : 24;
      }
    }
    if (modo === "fechas") {
      d.fecha_ida = $("#fecha_ida").value || null;
      d.fecha_vuelta = idaVuelta ? $("#fecha_vuelta").value || null : null;
      d.flex_dias = num("flex_dias");
    } else {
      d.chollo_desde = $("#chollo_desde").value || null;
      d.chollo_hasta = $("#chollo_hasta").value || null;
      if (idaVuelta) {
        d.noches_min = num("noches_min");
        d.noches_max = num("noches_max");
      }
    }

    const errores = [];
    const hoy = hoyMas(0);
    if (!origen || !destino) errores.push("Elige los dos aeropuertos de la lista.");
    if (origen && origen === destino) errores.push("El aeropuerto de salida y el de llegada no pueden ser el mismo.");
    if (modo === "fechas") {
      if (!d.fecha_ida) errores.push("Pon la fecha de ida.");
      else if (d.fecha_ida < hoy) errores.push("La fecha de ida ya ha pasado.");
      if (idaVuelta && (!d.fecha_vuelta || d.fecha_vuelta < d.fecha_ida)) errores.push("La vuelta debe ser el mismo día o después de la ida.");
    } else {
      if (!d.chollo_desde || !d.chollo_hasta || d.chollo_hasta < d.chollo_desde) errores.push("Revisa el periodo del chollo (desde / hasta).");
      if (d.chollo_hasta && d.chollo_hasta < hoy) errores.push("El periodo del chollo ya ha pasado.");
      if (idaVuelta && d.noches_max < d.noches_min) errores.push("Las noches máximas deben ser al menos las mínimas.");
    }
    const pasajeros = d.adultos + d.ninos + d.bebes;
    if (pasajeros > 9) errores.push(`Máximo 9 pasajeros en total (ahora hay ${pasajeros}).`);
    if (d.bebes > d.adultos) errores.push("Como máximo un bebé por adulto.");
    if (d.maletas_cabina > d.adultos + d.ninos || d.maletas_20kg > d.adultos + d.ninos)
      errores.push("Como máximo una maleta de cada tipo por adulto o niño.");
    if (d.modo_precio === "presupuesto" && !(d.presupuesto > 0)) errores.push("Escribe tu presupuesto máximo.");

    $("#errores").innerHTML = errores.map(esc).join("<br>");
    if (errores.length) return;

    // Solo se envían si se usan (así no hace falta haber actualizado la base de datos si no los usas)
    if (salidasValidas().length || "origenes_extra" in b) d.origenes_extra = salidasValidas();
    if ("destinos_extra" in b) d.destinos_extra = []; // la llegada es siempre una
    d.nombre = $("#nombre").value.trim() || `${nombreAeropuerto(datos, origen, false)} → ${nombreAeropuerto(datos, destino, false)}`;
    try {
      const guardada = await conCarga(ev.submitter, editando ? api.actualizarBusqueda(id, d) : api.crearBusqueda(d));
      aviso(editando ? "Cambios guardados: el robot la revisa en un minuto" : "¡Búsqueda creada! El robot la revisa en un minuto");
      location.hash = `#/busqueda/${guardada.id}`;
    } catch (e) {
      $("#errores").textContent = e.message;
    }
  });
}
