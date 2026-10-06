import { api } from "../api.js";
import { $, aeropuertos, aviso, buscarAeropuertos, esc, nombreAeropuerto } from "../util.js";

const hoyMas = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const opcionesHoras = (seleccion, esFin) =>
  Array.from({ length: 25 }, (_, h) => {
    const texto = esFin && h === 24 ? "sin límite" : !esFin && h === 0 ? "sin límite" : `${String(h).padStart(2, "0")}:00`;
    return `<option value="${h}" ${Number(seleccion) === h ? "selected" : ""}>${texto}</option>`;
  }).join("");

const opcionesNumero = (desde, hasta, seleccion) =>
  Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
    .map((n) => `<option value="${n}" ${Number(seleccion) === n ? "selected" : ""}>${n}</option>`)
    .join("");

const PREDETERMINADA = {
  nombre: "", modo: "fechas", ida_vuelta: true, origen: "", destino: "",
  fecha_ida: hoyMas(45), fecha_vuelta: hoyMas(49), flex_dias: 0,
  chollo_desde: hoyMas(7), chollo_hasta: hoyMas(150), noches_min: 2, noches_max: 5,
  ida_salida_min: 0, ida_salida_max: 24, ida_llegada_min: 0, ida_llegada_max: 24,
  vuelta_salida_min: 0, vuelta_salida_max: 24, vuelta_llegada_min: 0, vuelta_llegada_max: 24,
  adultos: 1, ninos: 0, bebes: 0, maletas_cabina: 0, maletas_20kg: 0, aplicar_descuentos: true,
  escalas_max: 1, escala_max_horas: 6, modo_precio: "mas_barato", presupuesto: null,
};

function montarAeropuerto(contenedor, datos, codigoInicial, alCambiar) {
  contenedor.innerHTML = `
    <div class="autocompletar">
      <input type="text" autocomplete="off" placeholder="Ciudad, aeropuerto o código (p. ej. Sevilla, Orly, BVA)">
      <ul class="sugerencias oculto"></ul>
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
    elegido.textContent = a ? `✓ ${a.c} · ${a.n}, ${a.m} (${a.pn})` : "";
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
    lista.innerHTML = resultados
      .map((a, i) => `<li data-i="${i}" class="${i === activo ? "activa" : ""}"><span class="codigo">${a.c}</span>${esc(a.es || a.n)}
        <span class="suave pequeno"> · ${esc(a.m)}, ${esc(a.pn)}</span></li>`)
      .join("") || '<li class="suave">Sin resultados</li>';
    lista.classList.remove("oculto");
  };
  input.addEventListener("input", () => {
    codigo = "";
    elegido.textContent = "";
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
}

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
  const tieneDescuento = perfil.familia_numerosa !== "ninguna" || perfil.residente !== "ninguno";

  const franja = (sentido, etiqueta) => `
    <div class="franjas" data-sentido="${sentido}">
      <span class="cabeza"></span><span class="cabeza">Salida</span><span class="cabeza">Llegada</span>
      <b>${etiqueta}</b>
      <div class="par-horas"><span class="pequeno suave">de</span>
        <select name="${sentido}_salida_min">${opcionesHoras(b[`${sentido}_salida_min`], false)}</select>
        <span class="pequeno suave">a</span>
        <select name="${sentido}_salida_max">${opcionesHoras(b[`${sentido}_salida_max`], true)}</select></div>
      <div class="par-horas"><span class="pequeno suave">de</span>
        <select name="${sentido}_llegada_min">${opcionesHoras(b[`${sentido}_llegada_min`], false)}</select>
        <span class="pequeno suave">a</span>
        <select name="${sentido}_llegada_max">${opcionesHoras(b[`${sentido}_llegada_max`], true)}</select></div>
    </div>`;

  app.innerHTML = `
    <div class="titulo-pagina"><h1>${editando ? "Editar búsqueda" : "Nueva búsqueda"}</h1></div>
    <form id="form-busqueda" novalidate>
      <section class="tarjeta">
        <fieldset>
          <legend>1. ¿Qué quieres vigilar?</legend>
          <div class="opciones-radio campo">
            <label><input type="radio" name="modo" value="fechas" ${b.modo === "fechas" ? "checked" : ""}>📅 Fechas concretas</label>
            <label><input type="radio" name="modo" value="chollo" ${b.modo === "chollo" ? "checked" : ""}>🔥 Chollo: cualquier fecha de un periodo</label>
          </div>
          <div class="opciones-radio campo">
            <label><input type="radio" name="ida_vuelta" value="1" ${b.ida_vuelta ? "checked" : ""}>Ida y vuelta</label>
            <label><input type="radio" name="ida_vuelta" value="0" ${!b.ida_vuelta ? "checked" : ""}>Solo ida</label>
          </div>
          <p class="ayuda" id="ayuda-modo"></p>
        </fieldset>
      </section>

      <section class="tarjeta">
        <fieldset>
          <legend>2. Aeropuertos exactos</legend>
          <div class="columnas">
            <div class="campo"><label>Aeropuerto de salida</label><div id="origen"></div></div>
            <div class="campo"><label>Aeropuerto de llegada</label><div id="destino"></div></div>
          </div>
          <div class="nota" id="nota-vuelta"></div>
          <p class="ayuda">Ojo con las ciudades con varios aeropuertos: París tiene CDG, Orly (ORY) y Beauvais (BVA, a 85 km);
            Londres tiene seis. El robot solo acepta vuelos del aeropuerto exacto que elijas. Las escalas intermedias dan igual.</p>
        </fieldset>
      </section>

      <section class="tarjeta">
        <fieldset>
          <legend>3. Fechas</legend>
          <div id="bloque-fechas" class="columnas">
            <div class="campo"><label for="fecha_ida">Ida</label><input type="date" id="fecha_ida" value="${b.fecha_ida || ""}"></div>
            <div class="campo con-vuelta"><label for="fecha_vuelta">Vuelta</label><input type="date" id="fecha_vuelta" value="${b.fecha_vuelta || ""}"></div>
            <div class="campo"><label for="flex_dias">Margen de días</label>
              <select id="flex_dias">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${b.flex_dias === n ? "selected" : ""}>${n ? `± ${n} día${n > 1 ? "s" : ""}` : "Fechas exactas"}</option>`).join("")}</select>
              <div class="ayuda">Mueve ida y vuelta juntas para encontrar el día más barato.</div></div>
          </div>
          <div id="bloque-chollo" class="columnas">
            <div class="campo"><label for="chollo_desde">Desde</label><input type="date" id="chollo_desde" value="${b.chollo_desde || ""}"></div>
            <div class="campo"><label for="chollo_hasta">Hasta</label><input type="date" id="chollo_hasta" value="${b.chollo_hasta || ""}">
              <div class="ayuda">Google busca hasta unos 10 meses vista.</div></div>
            <div class="campo con-vuelta"><label>Noches de estancia</label>
              <div class="par-horas"><select id="noches_min">${opcionesNumero(1, 30, b.noches_min)}</select><span class="suave">a</span>
              <select id="noches_max">${opcionesNumero(1, 30, b.noches_max)}</select></div></div>
          </div>
        </fieldset>
      </section>

      <section class="tarjeta">
        <fieldset>
          <legend>4. Horarios (hora local de cada aeropuerto)</legend>
          ${franja("ida", "Ida")}
          <div class="con-vuelta" style="margin-top:.5rem">${franja("vuelta", "Vuelta")}</div>
          <p class="ayuda">Ejemplo: si no puedes salir antes de las 9 ni llegar después de las 22, pon salida "de 09:00" y llegada "a 22:00".
            Una llegada pasada la medianoche cuenta como más tarde de las 24:00.</p>
        </fieldset>
      </section>

      <section class="tarjeta">
        <fieldset>
          <legend>5. Pasajeros y maletas</legend>
          <div class="columnas">
            <div class="campo"><label for="adultos">Adultos (12+ años)</label><select id="adultos">${opcionesNumero(1, 9, b.adultos)}</select></div>
            <div class="campo"><label for="ninos">Niños (2-11)</label><select id="ninos">${opcionesNumero(0, 8, b.ninos)}</select></div>
            <div class="campo"><label for="bebes">Bebés (menos de 2)</label><select id="bebes">${opcionesNumero(0, 8, b.bebes)}</select>
              <div class="ayuda">Viajan en brazos: máximo uno por adulto.</div></div>
          </div>
          <div class="columnas">
            <div class="campo"><label for="maletas_cabina">¿Cuántos llevan maleta de cabina (10 kg)?</label><select id="maletas_cabina">${opcionesNumero(0, 9, b.maletas_cabina)}</select></div>
            <div class="campo"><label for="maletas_20kg">¿Cuántos facturan maleta de 20 kg?</label><select id="maletas_20kg">${opcionesNumero(0, 9, b.maletas_20kg)}</select></div>
          </div>
          <p class="ayuda">Las tarifas básicas de las low cost solo incluyen un bolso bajo el asiento. El robot suma la maleta de cada
            pasajero en cada vuelo; si no sabe el precio exacto usa el máximo de esa aerolínea, para que el total nunca salga por debajo del real.</p>
          <label class="check ${tieneDescuento ? "" : "oculto"}"><input type="checkbox" id="aplicar_descuentos" ${b.aplicar_descuentos !== false ? "checked" : ""}>
            Aplicar mis descuentos (familia numerosa / residente) a estos pasajeros</label>
        </fieldset>
      </section>

      <section class="tarjeta">
        <fieldset>
          <legend>6. Escalas</legend>
          <div class="columnas">
            <div class="campo"><label for="escalas_max">Número de escalas</label>
              <select id="escalas_max">
                <option value="0" ${b.escalas_max === 0 ? "selected" : ""}>Solo vuelos directos</option>
                <option value="1" ${b.escalas_max === 1 ? "selected" : ""}>Máximo 1 escala</option>
                <option value="2" ${b.escalas_max === 2 ? "selected" : ""}>Máximo 2 escalas</option>
              </select></div>
            <div class="campo"><label for="escala_max_horas">Espera máxima en cada escala</label>
              <select id="escala_max_horas">${opcionesNumero(1, 24, b.escala_max_horas)}</select>
              <div class="ayuda">En horas. Las escalas con billetes separados (self-transfer) se descartan siempre.</div></div>
          </div>
        </fieldset>
      </section>

      <section class="tarjeta">
        <fieldset>
          <legend>7. Precio</legend>
          <div class="opciones-radio campo">
            <label><input type="radio" name="modo_precio" value="mas_barato" ${b.modo_precio === "mas_barato" ? "checked" : ""}>📉 Lo más barato posible</label>
            <label><input type="radio" name="modo_precio" value="presupuesto" ${b.modo_precio === "presupuesto" ? "checked" : ""}>💶 Tengo un presupuesto máximo</label>
          </div>
          <div class="campo" id="bloque-presupuesto" style="max-width:280px">
            <label for="presupuesto">Total máximo para todos (con maletas)</label>
            <input type="number" id="presupuesto" min="1" step="1" inputmode="decimal" value="${b.presupuesto ?? ""}" placeholder="p. ej. 200">
          </div>
          <p class="ayuda" id="ayuda-precio"></p>
        </fieldset>
      </section>

      <section class="tarjeta">
        <div class="campo"><label for="nombre">Nombre de la búsqueda</label>
          <input id="nombre" maxlength="80" value="${esc(b.nombre)}" placeholder="p. ej. Puente en París"></div>
        <div id="errores" class="error-form"></div>
        <div class="fila">
          <button class="primario" type="submit">${editando ? "Guardar cambios" : "Empezar a vigilar"}</button>
          <a class="boton" href="${editando ? `#/busqueda/${id}` : "#/"}">Cancelar</a>
        </div>
      </section>
    </form>`;

  const form = $("#form-busqueda");
  const valorRadio = (nombre) => form.querySelector(`input[name="${nombre}"]:checked`)?.value;
  let origen = b.origen;
  let destino = b.destino;

  const actualizar = () => {
    const modo = valorRadio("modo");
    const idaVuelta = valorRadio("ida_vuelta") === "1";
    $("#bloque-fechas").classList.toggle("oculto", modo !== "fechas");
    $("#bloque-chollo").classList.toggle("oculto", modo !== "chollo");
    form.querySelectorAll(".con-vuelta").forEach((el) => el.classList.toggle("oculto", !idaVuelta));
    $("#bloque-presupuesto").classList.toggle("oculto", valorRadio("modo_precio") !== "presupuesto");
    $("#ayuda-modo").textContent = modo === "fechas"
      ? "Vigila unas fechas concretas y te avisa del mejor momento para comprar (o en cuanto baje de tu presupuesto)."
      : "Revisa todas las fechas del periodo y te avisa si aparece un precio muy por debajo de lo normal (o por debajo de tu presupuesto).";
    $("#ayuda-precio").textContent = valorRadio("modo_precio") === "presupuesto"
      ? "Te avisa en cuanto haya una opción que no pase de este total (billetes + maletas − descuentos, para todos). Si después baja más, te vuelve a avisar."
      : "El robot decide cuándo avisar: precio más bajo visto en la ventana más barata (unas 3-10 semanas antes según la ruta), chollos excepcionales y siempre un último aviso antes de las 3 semanas finales.";
    const nota = $("#nota-vuelta");
    nota.classList.toggle("oculto", !(origen && destino && idaVuelta));
    if (origen && destino) {
      nota.innerHTML = `Ida: <b>${esc(nombreAeropuerto(datos, origen))} → ${esc(nombreAeropuerto(datos, destino))}</b> ·
        Vuelta: <b>${esc(nombreAeropuerto(datos, destino))} → ${esc(nombreAeropuerto(datos, origen))}</b> (mismos aeropuertos)`;
    }
  };
  montarAeropuerto($("#origen"), datos, origen, (c) => { origen = c; actualizar(); });
  montarAeropuerto($("#destino"), datos, destino, (c) => { destino = c; actualizar(); });
  form.addEventListener("change", actualizar);
  actualizar();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const n = (sel) => Number($(sel).value);
    const modo = valorRadio("modo");
    const idaVuelta = valorRadio("ida_vuelta") === "1";
    const d = {
      modo, ida_vuelta: idaVuelta, origen, destino,
      adultos: n("#adultos"), ninos: n("#ninos"), bebes: n("#bebes"),
      maletas_cabina: n("#maletas_cabina"), maletas_20kg: n("#maletas_20kg"),
      escalas_max: n("#escalas_max"), escala_max_horas: n("#escala_max_horas"),
      modo_precio: valorRadio("modo_precio"),
      presupuesto: valorRadio("modo_precio") === "presupuesto" ? Number($("#presupuesto").value) || null : null,
      aplicar_descuentos: $("#aplicar_descuentos").checked,
      fecha_ida: null, fecha_vuelta: null, flex_dias: 0, chollo_desde: null, chollo_hasta: null, noches_min: null, noches_max: null,
    };
    for (const s of ["ida", "vuelta"]) {
      for (const c of ["salida_min", "salida_max", "llegada_min", "llegada_max"]) {
        d[`${s}_${c}`] = s === "vuelta" && !idaVuelta ? (c.endsWith("max") ? 24 : 0) : Number(form.querySelector(`[name="${s}_${c}"]`).value);
      }
    }
    if (modo === "fechas") {
      d.fecha_ida = $("#fecha_ida").value || null;
      d.fecha_vuelta = idaVuelta ? $("#fecha_vuelta").value || null : null;
      d.flex_dias = n("#flex_dias");
    } else {
      d.chollo_desde = $("#chollo_desde").value || null;
      d.chollo_hasta = $("#chollo_hasta").value || null;
      if (idaVuelta) {
        d.noches_min = n("#noches_min");
        d.noches_max = n("#noches_max");
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
    for (const s of idaVuelta ? ["ida", "vuelta"] : ["ida"]) {
      if (d[`${s}_salida_min`] >= d[`${s}_salida_max`]) errores.push(`Franja de salida de la ${s}: "de" debe ser antes que "a".`);
      if (d[`${s}_llegada_min`] >= d[`${s}_llegada_max`]) errores.push(`Franja de llegada de la ${s}: "de" debe ser antes que "a".`);
    }
    const pasajeros = d.adultos + d.ninos + d.bebes;
    if (pasajeros > 9) errores.push(`Máximo 9 pasajeros en total (ahora hay ${pasajeros}).`);
    if (d.bebes > d.adultos) errores.push("Como máximo un bebé por adulto.");
    if (d.maletas_cabina > d.adultos + d.ninos || d.maletas_20kg > d.adultos + d.ninos)
      errores.push("Como máximo una maleta de cada tipo por adulto o niño.");
    if (d.modo_precio === "presupuesto" && !(d.presupuesto > 0)) errores.push("Escribe tu presupuesto máximo.");

    $("#errores").innerHTML = errores.map(esc).join("<br>");
    if (errores.length) return;

    d.nombre = $("#nombre").value.trim()
      || `${nombreAeropuerto(datos, origen, false)} → ${nombreAeropuerto(datos, destino, false)}`;
    const boton = ev.submitter;
    boton.disabled = true;
    try {
      const guardada = editando ? await api.actualizarBusqueda(id, d) : await api.crearBusqueda(d);
      aviso(editando ? "Cambios guardados: se revisará en la próxima ronda" : "¡Búsqueda creada! El robot la revisará en su próxima ronda (máx. 3 h).");
      location.hash = `#/busqueda/${guardada.id}`;
    } catch (e) {
      $("#errores").textContent = e.message;
    } finally {
      boton.disabled = false;
    }
  });
}
