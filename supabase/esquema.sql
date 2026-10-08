-- =====================================================================
-- Buscador de Vuelos · esquema de base de datos (Supabase / PostgreSQL)
-- No ejecutes este archivo directamente: ejecuta supabase/instalar.sql,
-- que incluye este esquema más la lista blanca de aerolíneas.
-- Se puede ejecutar varias veces sin romper nada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Perfil del usuario (se crea solo al registrarse)
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  familia_numerosa text not null default 'ninguna'
    check (familia_numerosa in ('ninguna', 'general', 'especial')),
  residente text not null default 'ninguno'
    check (residente in ('ninguno', 'canarias', 'baleares', 'melilla')),
  telegram_chat_id text,
  telegram_codigo text,
  telegram_prueba boolean not null default false,
  -- Llamada por Telegram (CallMeBot) en los chollazos
  telegram_usuario text,
  llamar_chollos boolean not null default false,
  llamada_prueba boolean not null default false,
  perfil_completado boolean not null default false,
  creado timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Búsquedas que vigila el robot
-- ---------------------------------------------------------------------
create table if not exists public.busquedas (
  id uuid primary key default gen_random_uuid(),
  usuario uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null,
  modo text not null check (modo in ('fechas', 'chollo')),
  ida_vuelta boolean not null default true,
  origen text not null check (origen ~ '^[A-Z]{3}$'),
  destino text not null check (destino ~ '^[A-Z]{3}$'),
  -- Aeropuertos alternativos (p. ej. salir de Sevilla o de Jerez): vale cualquiera de ellos
  origenes_extra text[] not null default '{}',
  destinos_extra text[] not null default '{}',
  -- modo "fechas": fechas concretas (con margen opcional de ± días)
  fecha_ida date,
  fecha_vuelta date,
  flex_dias int not null default 0 check (flex_dias between 0 and 3),
  -- modo "chollo": cualquier fecha dentro de un rango
  chollo_desde date,
  chollo_hasta date,
  noches_min int check (noches_min between 1 and 60),
  noches_max int check (noches_max between 1 and 60),
  -- franjas horarias en horas (0-24), hora local de cada aeropuerto
  ida_salida_min int not null default 0 check (ida_salida_min between 0 and 24),
  ida_salida_max int not null default 24 check (ida_salida_max between 0 and 24),
  ida_llegada_min int not null default 0 check (ida_llegada_min between 0 and 24),
  ida_llegada_max int not null default 24 check (ida_llegada_max between 0 and 24),
  vuelta_salida_min int not null default 0 check (vuelta_salida_min between 0 and 24),
  vuelta_salida_max int not null default 24 check (vuelta_salida_max between 0 and 24),
  vuelta_llegada_min int not null default 0 check (vuelta_llegada_min between 0 and 24),
  vuelta_llegada_max int not null default 24 check (vuelta_llegada_max between 0 and 24),
  -- pasajeros y equipaje
  adultos int not null default 1 check (adultos between 1 and 9),
  ninos int not null default 0 check (ninos between 0 and 8),
  bebes int not null default 0 check (bebes between 0 and 8),
  maletas_cabina int not null default 0 check (maletas_cabina >= 0),
  maletas_20kg int not null default 0 check (maletas_20kg >= 0),
  -- aplicar los descuentos del perfil (familia numerosa / residente) a estos pasajeros
  aplicar_descuentos boolean not null default true,
  -- preferencias de vuelo
  escalas_max int not null default 1 check (escalas_max between 0 and 2),
  escala_max_horas int not null default 6 check (escala_max_horas between 1 and 24),
  -- precio: 'presupuesto' (total máximo) o 'mas_barato' (decide el algoritmo)
  modo_precio text not null default 'mas_barato' check (modo_precio in ('presupuesto', 'mas_barato')),
  presupuesto numeric(10, 2) check (presupuesto is null or presupuesto > 0),
  -- estado interno del robot
  activa boolean not null default true,
  proxima_revision timestamptz not null default now(),
  ultima_revision timestamptz,
  mejor_precio numeric(10, 2),
  precio_actual numeric(10, 2),
  ultimo_aviso_precio numeric(10, 2),
  ultimo_aviso_en timestamptz,
  aviso_final_enviado boolean not null default false,
  historial_desde timestamptz,
  estado text,
  info jsonb not null default '{}'::jsonb,
  creada timestamptz not null default now(),
  constraint pasajeros_max check (adultos + ninos + bebes <= 9),
  constraint un_bebe_por_adulto check (bebes <= adultos),
  constraint maletas_por_pasajero check (maletas_cabina <= adultos + ninos and maletas_20kg <= adultos + ninos),
  constraint fechas_modo check (
    (modo = 'fechas' and fecha_ida is not null and (not ida_vuelta or fecha_vuelta >= fecha_ida))
    or (modo = 'chollo' and chollo_desde is not null and chollo_hasta >= chollo_desde
        and (not ida_vuelta or (noches_min is not null and noches_max >= noches_min)))
  ),
  constraint presupuesto_si_modo check (modo_precio <> 'presupuesto' or presupuesto is not null),
  constraint aeropuertos_distintos check (origen <> destino),
  constraint busquedas_extras_max check (
    cardinality(origenes_extra) <= 3 and cardinality(destinos_extra) <= 3
    and array_to_string(origenes_extra || destinos_extra, ',') ~ '^([A-Z]{3}(,|$))*$')
);
create index if not exists busquedas_revision_idx on public.busquedas (activa, proxima_revision);

-- ---------------------------------------------------------------------
-- Historial de precios (las mejores opciones de cada revisión)
-- ---------------------------------------------------------------------
create table if not exists public.precios (
  id bigint generated always as identity primary key,
  busqueda uuid not null references public.busquedas(id) on delete cascade,
  usuario uuid not null references auth.users(id) on delete cascade,
  revisado timestamptz not null default now(),
  fuente text not null,
  fecha_ida date,
  fecha_vuelta date,
  precio_billetes numeric(10, 2) not null,
  precio_maletas numeric(10, 2) not null default 0,
  descuento numeric(10, 2) not null default 0,
  precio_total numeric(10, 2) not null,
  maletas_estimadas boolean not null default false,
  es_mejor boolean not null default false,
  detalle jsonb not null default '{}'::jsonb
);
create index if not exists precios_busqueda_idx on public.precios (busqueda, revisado desc);
create index if not exists precios_grafica_idx on public.precios (busqueda, es_mejor, revisado);

-- ---------------------------------------------------------------------
-- Avisos enviados por Telegram
-- ---------------------------------------------------------------------
create table if not exists public.avisos (
  id bigint generated always as identity primary key,
  busqueda uuid references public.busquedas(id) on delete cascade,
  usuario uuid not null references auth.users(id) on delete cascade,
  enviado timestamptz not null default now(),
  tipo text,
  motivo text,
  precio_total numeric(10, 2),
  mensaje text,
  entregado boolean not null default false
);
create index if not exists avisos_busqueda_idx on public.avisos (busqueda, enviado desc);

-- ---------------------------------------------------------------------
-- Lista blanca de aerolíneas (solo se aceptan vuelos de las permitidas)
-- Los precios de maletas son el MÁXIMO estimado por unidad, en euros.
-- ---------------------------------------------------------------------
create table if not exists public.aerolineas (
  codigo text primary key check (codigo ~ '^[A-Z0-9]{2}$'),
  nombre text not null,
  permitida boolean not null default true,
  criterio text,
  web_oficial text,
  cabina_max numeric(7, 2) not null default 60,
  facturada_nacional_max numeric(7, 2) not null default 130,
  facturada_europa_max numeric(7, 2) not null default 130,
  facturada_largo_max numeric(7, 2) not null default 150,
  cobra_por text not null default 'tramo' check (cobra_por in ('tramo', 'trayecto')),
  bebe_tasa numeric(7, 2),
  notas text,
  actualizada timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Estado de cada web consultada (ritmo, bloqueos, errores)
-- ---------------------------------------------------------------------
create table if not exists public.estado_fuentes (
  fuente text primary key,
  nombre text not null,
  activa boolean not null default true,
  intervalo_min int not null,
  pausa_min_s int not null,
  pausa_max_s int not null,
  max_peticiones int not null default 50,
  ultima_ronda timestamptz,
  ultima_ok timestamptz,
  bloqueada_hasta timestamptz,
  bloqueos_seguidos int not null default 0,
  ultimo_error text,
  descripcion text
);

-- ---------------------------------------------------------------------
-- Ejecuciones del robot (para el panel y el consumo de minutos)
-- ---------------------------------------------------------------------
create table if not exists public.ejecuciones (
  id bigint generated always as identity primary key,
  inicio timestamptz not null default now(),
  fin timestamptz,
  duracion_s int,
  resumen jsonb not null default '{}'::jsonb
);
create index if not exists ejecuciones_inicio_idx on public.ejecuciones (inicio desc);

-- Ajustes internos del robot (p. ej. último mensaje leído de Telegram)
create table if not exists public.ajustes (
  clave text primary key,
  valor jsonb
);

-- =====================================================================
-- Registro: un solo usuario y creación automática del perfil
-- =====================================================================
create or replace function public.solo_un_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'Registro cerrado: esta web es de un solo usuario.';
  end if;
  return new;
end;
$$;


create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

-- Supabase no deja borrar triggers de auth.users (no somos sus dueños), así que
-- solo se crean si todavía no existen: el script se puede ejecutar varias veces.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'solo_un_usuario' and tgrelid = 'auth.users'::regclass) then
    create trigger solo_un_usuario before insert on auth.users
      for each row execute function public.solo_un_usuario();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crear_perfil' and tgrelid = 'auth.users'::regclass) then
    create trigger crear_perfil after insert on auth.users
      for each row execute function public.crear_perfil();
  end if;
end;
$$;

-- Al cambiar algo de una búsqueda desde la web, se revisa en la siguiente ronda.
-- Si cambia el viaje en sí (ruta, fechas, pasajeros, maletas, filtros), el historial
-- anterior deja de compararse y los avisos empiezan de cero.
create or replace function public.reprogramar_busqueda()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.proxima_revision := now();
    if (new.modo, new.ida_vuelta, new.origen, new.destino, new.origenes_extra, new.destinos_extra, new.fecha_ida, new.fecha_vuelta, new.flex_dias,
        new.chollo_desde, new.chollo_hasta, new.noches_min, new.noches_max,
        new.ida_salida_min, new.ida_salida_max, new.ida_llegada_min, new.ida_llegada_max,
        new.vuelta_salida_min, new.vuelta_salida_max, new.vuelta_llegada_min, new.vuelta_llegada_max,
        new.adultos, new.ninos, new.bebes, new.maletas_cabina, new.maletas_20kg, new.aplicar_descuentos,
        new.escalas_max, new.escala_max_horas)
       is distinct from
       (old.modo, old.ida_vuelta, old.origen, old.destino, old.origenes_extra, old.destinos_extra, old.fecha_ida, old.fecha_vuelta, old.flex_dias,
        old.chollo_desde, old.chollo_hasta, old.noches_min, old.noches_max,
        old.ida_salida_min, old.ida_salida_max, old.ida_llegada_min, old.ida_llegada_max,
        old.vuelta_salida_min, old.vuelta_salida_max, old.vuelta_llegada_min, old.vuelta_llegada_max,
        old.adultos, old.ninos, old.bebes, old.maletas_cabina, old.maletas_20kg, old.aplicar_descuentos,
        old.escalas_max, old.escala_max_horas) then
      new.historial_desde := now();
      new.mejor_precio := null;
      new.precio_actual := null;
      new.ultimo_aviso_precio := null;
      new.aviso_final_enviado := false;
      new.estado := 'Cambios guardados: pendiente de revisión';
      new.info := '{}'::jsonb;
    elsif new.modo_precio is distinct from old.modo_precio
       or new.presupuesto is distinct from old.presupuesto then
      new.ultimo_aviso_precio := null;
      new.aviso_final_enviado := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reprogramar_busqueda on public.busquedas;
create trigger reprogramar_busqueda before update on public.busquedas
  for each row execute function public.reprogramar_busqueda();

-- =====================================================================
-- Seguridad: cada usuario solo ve lo suyo. El robot usa la clave
-- "service_role", que se salta estas reglas.
-- =====================================================================
alter table public.perfiles enable row level security;
alter table public.busquedas enable row level security;
alter table public.precios enable row level security;
alter table public.avisos enable row level security;
alter table public.aerolineas enable row level security;
alter table public.estado_fuentes enable row level security;
alter table public.ejecuciones enable row level security;
alter table public.ajustes enable row level security;

drop policy if exists "perfil propio: leer" on public.perfiles;
create policy "perfil propio: leer" on public.perfiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "perfil propio: editar" on public.perfiles;
create policy "perfil propio: editar" on public.perfiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "busquedas propias" on public.busquedas;
create policy "busquedas propias" on public.busquedas
  for all to authenticated using (usuario = auth.uid()) with check (usuario = auth.uid());

drop policy if exists "precios propios" on public.precios;
create policy "precios propios" on public.precios
  for select to authenticated using (usuario = auth.uid());

drop policy if exists "avisos propios" on public.avisos;
create policy "avisos propios" on public.avisos
  for select to authenticated using (usuario = auth.uid());

drop policy if exists "aerolineas: leer" on public.aerolineas;
create policy "aerolineas: leer" on public.aerolineas
  for select to authenticated using (true);
drop policy if exists "aerolineas: editar" on public.aerolineas;
create policy "aerolineas: editar" on public.aerolineas
  for all to authenticated using (true) with check (true);

drop policy if exists "fuentes: leer" on public.estado_fuentes;
create policy "fuentes: leer" on public.estado_fuentes
  for select to authenticated using (true);
drop policy if exists "fuentes: editar" on public.estado_fuentes;
create policy "fuentes: editar" on public.estado_fuentes
  for update to authenticated using (true) with check (true);

drop policy if exists "ejecuciones: leer" on public.ejecuciones;
create policy "ejecuciones: leer" on public.ejecuciones
  for select to authenticated using (true);

-- =====================================================================
-- Webs consultadas. intervalo_min = referencia + 20 minutos de margen.
-- =====================================================================
insert into public.estado_fuentes
  (fuente, nombre, activa, intervalo_min, pausa_min_s, pausa_max_s, max_peticiones, descripcion)
values
  ('google_flights', 'Google Flights', true, 5, 6, 16, 60,
   'Fuente principal: compara casi todas las aerolíneas (Ryanair, Vueling, Iberia, easyJet...). Cada búsqueda se revisa cada 20-90 min según lo cerca que esté el viaje; 6-16 s entre peticiones.'),
  ('ryanair', 'Ryanair (web oficial)', true, 30, 120, 140, 3,
   'Confirma el precio en la propia Ryanair. Una ronda cada 30 min como mucho; 2 min entre peticiones (el doble de lo recomendado).'),
  ('skyscanner', 'Skyscanner', false, 740, 30, 60, 2,
   'Desactivada: Skyscanner bloquea a los robots desde la primera petición (prueba del 6/10/2026). Puedes activarla para reintentar; si bloquea, el robot la deja descansar.')
on conflict (fuente) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion;

-- =====================================================================
-- Actualización v2 (robot continuo y web en tiempo real).
-- Sirve también para instalaciones anteriores: se puede ejecutar varias veces.
-- =====================================================================
alter table public.perfiles add column if not exists telegram_prueba boolean not null default false;

-- La web puede leer la "señal de vida" del robot (nada más de la tabla de ajustes)
drop policy if exists "ajustes: latido" on public.ajustes;
create policy "ajustes: latido" on public.ajustes
  for select to authenticated using (clave = 'latido');

-- Tiempo real: la web recibe al momento los precios nuevos y los cambios de las búsquedas
do $$
declare
  tabla text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tabla in array array['precios', 'busquedas', 'avisos', 'ejecuciones', 'estado_fuentes'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tabla
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tabla);
      end if;
    end loop;
  end if;
end;
$$;

-- =====================================================================
-- Actualización v3: varios aeropuertos de salida y de llegada por búsqueda
-- =====================================================================
alter table public.busquedas add column if not exists origenes_extra text[] not null default '{}';
alter table public.busquedas add column if not exists destinos_extra text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'busquedas_extras_max') then
    alter table public.busquedas add constraint busquedas_extras_max check (
      cardinality(origenes_extra) <= 3 and cardinality(destinos_extra) <= 3
    and array_to_string(origenes_extra || destinos_extra, ',') ~ '^([A-Z]{3}(,|$))*$');
  end if;
end;
$$;

-- =====================================================================
-- Actualización v4: llamada por Telegram en los chollazos
-- =====================================================================
alter table public.perfiles add column if not exists telegram_usuario text;
alter table public.perfiles add column if not exists llamar_chollos boolean not null default false;
alter table public.perfiles add column if not exists llamada_prueba boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfiles_telegram_usuario_formato') then
    alter table public.perfiles add constraint perfiles_telegram_usuario_formato check (
      telegram_usuario is null or telegram_usuario ~ '^(@[A-Za-z0-9_]{4,32}|\+[0-9]{6,15})$');
  end if;
end;
$$;

-- Que la API de Supabase vea al momento las columnas nuevas
notify pgrst, 'reload schema';
