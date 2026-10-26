-- Núcleo del motor de seguimiento y tablas de las plantillas, con RLS.

-- ============================================================================
-- 1. Tablas
-- ============================================================================

-- ---------- Núcleo ----------------------------------------------------------

-- Lista de invitados (puerta 2). Sin id_usuario: existe antes de que la persona tenga cuenta.
create table public.acceso_permitido (
  id_acceso_permitido uuid primary key default gen_random_uuid(),
  correo              text not null unique
                      -- se guarda en minúsculas para comparar sin ambigüedad
                      check (correo = lower(correo) and char_length(correo) between 3 and 254 and position('@' in correo) > 1),
  estado              text not null default 'activo' check (estado in ('activo', 'inactivo')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now()
);

create table public.perfil (
  id_usuario          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nombre              text check (char_length(nombre) <= 100),
  zona_horaria        text not null default 'America/Bogota' check (char_length(zona_horaria) <= 64),
  aviso_diario        boolean not null default true,
  aviso_semanal       boolean not null default true,
  aviso_mensual       boolean not null default true,
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now()
);

create table public.plantilla_activa (
  id_plantilla_activa uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  codigo_plantilla    text not null check (codigo_plantilla in ('finanzas', 'recibos', 'gym', 'cuerpo', 'habitos', 'tareas', 'libre')),
  estado              text not null default 'activo' check (estado in ('activo', 'inactivo')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  unique (id_usuario, codigo_plantilla)
);

create table public.seguimiento (
  id_seguimiento      uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre              text not null check (char_length(nombre) between 1 and 60),
  -- null = seguimiento libre (por eso 'libre' no está en la lista)
  codigo_plantilla    text check (codigo_plantilla in ('finanzas', 'recibos', 'gym', 'cuerpo', 'habitos', 'tareas')),
  tipo_medida         text not null check (tipo_medida in ('dinero', 'numero', 'si_no', 'duracion', 'escala')),
  unidad              text check (char_length(unidad) <= 20),
  frecuencia          text not null check (frecuencia in ('registro', 'dia', 'semana', 'mes')),
  estado              text not null default 'activo' check (estado in ('activo', 'archivado', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  -- un nombre por persona; uno eliminado se reactiva en vez de crearlo otra vez
  unique (id_usuario, nombre),
  -- destino de las llaves compuestas que garantizan que hijo y padre son del mismo usuario
  unique (id_usuario, id_seguimiento)
);

create table public.etiqueta (
  id_etiqueta         uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_seguimiento      uuid not null,
  nombre              text not null check (char_length(nombre) between 1 and 60),
  grupo               text check (grupo in ('basico', 'personal')),
  palabras_clave      text[] not null default '{}'
                      check (cardinality(palabras_clave) <= 100 and char_length(array_to_string(palabras_clave, ',')) <= 2000),
  estado              text not null default 'activo' check (estado in ('activo', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  foreign key (id_usuario, id_seguimiento) references public.seguimiento (id_usuario, id_seguimiento) on delete cascade,
  unique (id_seguimiento, nombre),
  unique (id_seguimiento, id_etiqueta)
);

-- Con id_etiqueta es un presupuesto por categoría.
create table public.meta (
  id_meta             uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_seguimiento      uuid not null,
  id_etiqueta         uuid,
  -- admite negativos (p. ej. temperatura); el rango por tipo lo da el seguimiento
  valor               numeric(14,2) not null,
  direccion           text not null check (direccion in ('mas_es_mejor', 'menos_es_mejor')),
  periodo             text not null check (periodo in ('dia', 'semana', 'mes', 'ano')),
  fecha_inicio        date not null default current_date,
  fecha_fin           date,
  estado              text not null default 'activo' check (estado in ('activo', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  check (fecha_fin is null or fecha_fin >= fecha_inicio),
  foreign key (id_usuario, id_seguimiento) references public.seguimiento (id_usuario, id_seguimiento) on delete cascade,
  -- la etiqueta tiene que ser del mismo seguimiento
  foreign key (id_seguimiento, id_etiqueta) references public.etiqueta (id_seguimiento, id_etiqueta) on delete cascade
);

-- id_registro lo puede generar el cliente: reenviar la cola sin conexión con
-- "on conflict (id_registro) do nothing" no duplica.
create table public.registro (
  id_registro         uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_seguimiento      uuid not null,
  id_etiqueta         uuid,
  fecha_registro      date not null default current_date,
  precision_fecha     text not null default 'dia' check (precision_fecha in ('dia', 'mes')),
  -- admite negativos en 'numero'; el rango por tipo_medida lo valida el trigger validar_registro
  valor               numeric(14,2) not null,
  nota                text check (char_length(nota) <= 500),
  estado              text not null default 'activo' check (estado in ('activo', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  -- lo migrado sin día queda el día 1
  check (precision_fecha = 'dia' or extract(day from fecha_registro) = 1),
  foreign key (id_usuario, id_seguimiento) references public.seguimiento (id_usuario, id_seguimiento) on delete cascade,
  -- borrar la etiqueta deja el registro sin etiqueta, no lo borra
  foreign key (id_seguimiento, id_etiqueta) references public.etiqueta (id_seguimiento, id_etiqueta) on delete set null (id_etiqueta),
  unique (id_usuario, id_registro)
);

-- Lo aprendido. El texto se guarda normalizado en minúsculas para que el único funcione.
create table public.alias (
  id_alias            uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo                text not null check (tipo in ('categoria', 'ejercicio', 'habito')),
  texto_escrito       text not null check (texto_escrito = lower(texto_escrito) and char_length(texto_escrito) between 1 and 100),
  -- un "no" a "¿quisiste decir…?" se guarda con el mismo texto escrito
  texto_correcto      text not null check (char_length(texto_correcto) between 1 and 100),
  veces_usado         integer not null default 1 check (veces_usado >= 0),
  estado              text not null default 'activo' check (estado in ('activo', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  unique (id_usuario, tipo, texto_escrito)
);

-- ---------- Plantilla recibos -----------------------------------------------

create table public.recibo (
  id_recibo           uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre_servicio     text not null check (char_length(nombre_servicio) between 1 and 60),
  nombre_ubicacion    text check (char_length(nombre_ubicacion) between 1 and 60),
  tipo_recibo         text not null check (tipo_recibo in ('hogar', 'personal')),
  valor_fijo          numeric(14,0) check (valor_fijo >= 0),
  -- día aprendido (mediana de los pagos); null mientras no hay pagos
  dia_pago            smallint check (dia_pago between 1 and 31),
  numero_cuenta       text check (char_length(numero_cuenta) <= 40),
  estado              text not null default 'activo' check (estado in ('activo', 'no_se_paga', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  -- la ubicación solo aplica a los de hogar
  check (tipo_recibo = 'personal' or nombre_ubicacion is not null),
  unique nulls not distinct (id_usuario, nombre_servicio, nombre_ubicacion),
  unique (id_usuario, id_recibo)
);

create table public.pago_recibo (
  id_pago_recibo      uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_recibo           uuid not null,
  -- gasto creado al pagar; deshacer el pago lo quita
  id_registro         uuid,
  -- primer día del mes del período
  fecha_periodo       date not null check (extract(day from fecha_periodo) = 1),
  valor               numeric(14,0) not null check (valor >= 0),
  fecha_pago          date,
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'vencido', 'cancelado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  check (estado <> 'pagado' or fecha_pago is not null),
  foreign key (id_usuario, id_recibo) references public.recibo (id_usuario, id_recibo) on delete cascade,
  foreign key (id_usuario, id_registro) references public.registro (id_usuario, id_registro) on delete set null (id_registro),
  -- un pago por recibo y período (id_usuario al frente para cubrir la llave foránea)
  unique (id_usuario, id_recibo, fecha_periodo),
  unique (id_usuario, id_registro)
);

-- ---------- Plantilla gym ---------------------------------------------------

-- Detalle 1:1 de un registro de Gym. Sin estado propio: sigue el del registro.
create table public.serie_gym (
  id_serie_gym          uuid primary key default gen_random_uuid(),
  id_usuario            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_registro           uuid not null,
  cantidad_series       smallint not null check (cantidad_series between 1 and 100),
  cantidad_repeticiones smallint not null check (cantidad_repeticiones between 1 and 1000),
  -- null = propio cuerpo
  peso_kilogramos       numeric(6,2) check (peso_kilogramos > 0),
  fecha_creacion        timestamptz not null default now(),
  fecha_actualizacion   timestamptz not null default now(),
  foreign key (id_usuario, id_registro) references public.registro (id_usuario, id_registro) on delete cascade,
  unique (id_usuario, id_registro)
);

-- ---------- Plantilla tareas ------------------------------------------------

create table public.tarea (
  id_tarea            uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  descripcion         text not null check (char_length(descripcion) between 1 and 300),
  fecha_limite        date,
  fecha_realizacion   timestamptz,
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'hecho', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  check (estado <> 'hecho' or fecha_realizacion is not null)
);

create table public.recordatorio (
  id_recordatorio     uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  descripcion         text not null check (char_length(descripcion) between 1 and 300),
  hora_envio          time not null,
  tipo_repeticion     text not null check (tipo_repeticion in ('unico', 'diario', 'semanal', 'mensual', 'habiles')),
  -- 1 = lunes … 7 = domingo (ISO)
  dias_semana         smallint[] check (dias_semana <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- 31 en un mes corto = último día (lo resuelve proximoEnvio)
  dia_mes             smallint check (dia_mes between 1 and 31),
  -- null cuando ya no hay más envíos
  fecha_proximo_envio timestamptz,
  estado              text not null default 'activo' check (estado in ('activo', 'pausado', 'terminado', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  check (tipo_repeticion <> 'semanal' or coalesce(cardinality(dias_semana), 0) > 0),
  check (tipo_repeticion <> 'mensual' or dia_mes is not null)
);

-- ---------- Columnas sensibles (no salen en logs, correos ni errores) -------

comment on column public.acceso_permitido.correo     is 'sensible: correo de la persona invitada';
comment on column public.perfil.nombre               is 'sensible: nombre de la persona';
comment on column public.recibo.numero_cuenta        is 'sensible: número de cuenta del servicio; mostrar solo enmascarado (recibo_visible)';
comment on column public.registro.nota               is 'sensible: texto libre de la persona';
comment on column public.tarea.descripcion           is 'sensible: texto libre de la persona';
comment on column public.recordatorio.descripcion    is 'sensible: texto libre de la persona';

-- ============================================================================
-- 2. Índices (los únicos de arriba ya cubren varias llaves foráneas)
-- ============================================================================

-- registros de un seguimiento por fecha (gráficos, totales, rachas)
create index registro_usuario_seguimiento_fecha_idx on public.registro (id_usuario, id_seguimiento, fecha_registro);
create index registro_seguimiento_etiqueta_idx      on public.registro (id_seguimiento, id_etiqueta);
-- pagos y pendientes del mes
create index pago_recibo_usuario_periodo_idx        on public.pago_recibo (id_usuario, fecha_periodo);
-- lo que Cron tiene que enviar
create index recordatorio_activo_proximo_envio_idx  on public.recordatorio (fecha_proximo_envio) where estado = 'activo';
create index recordatorio_usuario_idx               on public.recordatorio (id_usuario);
create index tarea_usuario_estado_limite_idx        on public.tarea (id_usuario, estado, fecha_limite);
-- llaves foráneas sin índice (las pide el asesor de rendimiento)
create index etiqueta_usuario_seguimiento_idx       on public.etiqueta (id_usuario, id_seguimiento);
create index meta_usuario_seguimiento_idx           on public.meta (id_usuario, id_seguimiento);
create index meta_seguimiento_etiqueta_idx          on public.meta (id_seguimiento, id_etiqueta);

-- ============================================================================
-- 3. fecha_actualizacion automática
-- ============================================================================

create function public.fijar_fecha_actualizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.fecha_actualizacion := now();
  return new;
end;
$$;

revoke execute on function public.fijar_fecha_actualizacion() from public, anon, authenticated;

-- Escritos uno por uno: sin SQL armado con texto.
create trigger acceso_permitido_fecha_actualizacion before update on public.acceso_permitido for each row execute function public.fijar_fecha_actualizacion();
create trigger perfil_fecha_actualizacion           before update on public.perfil           for each row execute function public.fijar_fecha_actualizacion();
create trigger plantilla_activa_fecha_actualizacion before update on public.plantilla_activa for each row execute function public.fijar_fecha_actualizacion();
create trigger seguimiento_fecha_actualizacion      before update on public.seguimiento      for each row execute function public.fijar_fecha_actualizacion();
create trigger etiqueta_fecha_actualizacion         before update on public.etiqueta         for each row execute function public.fijar_fecha_actualizacion();
create trigger meta_fecha_actualizacion             before update on public.meta             for each row execute function public.fijar_fecha_actualizacion();
create trigger registro_fecha_actualizacion         before update on public.registro         for each row execute function public.fijar_fecha_actualizacion();
create trigger alias_fecha_actualizacion            before update on public.alias            for each row execute function public.fijar_fecha_actualizacion();
create trigger recibo_fecha_actualizacion           before update on public.recibo           for each row execute function public.fijar_fecha_actualizacion();
create trigger pago_recibo_fecha_actualizacion      before update on public.pago_recibo      for each row execute function public.fijar_fecha_actualizacion();
create trigger serie_gym_fecha_actualizacion        before update on public.serie_gym        for each row execute function public.fijar_fecha_actualizacion();
create trigger tarea_fecha_actualizacion            before update on public.tarea            for each row execute function public.fijar_fecha_actualizacion();
create trigger recordatorio_fecha_actualizacion     before update on public.recordatorio     for each row execute function public.fijar_fecha_actualizacion();

-- ============================================================================
-- 4. Validación de registro según el tipo de medida
-- ============================================================================

-- Rango de cada tipo de medida; 'numero' es libre (admite negativos).
create function public.valor_valido(p_tipo_medida text, p_valor numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_tipo_medida
    when 'dinero'   then p_valor >= 0 and p_valor = trunc(p_valor)
    when 'duracion' then p_valor >= 0
    when 'si_no'    then p_valor = 1
    when 'escala'   then p_valor between 1 and 10 and p_valor = trunc(p_valor)
    else true
  end;
$$;

-- Las llaves compuestas ya impiden mezclar usuarios; aquí se revisa otra vez
-- (barato) y se valida el valor, que depende de otra tabla.
-- Mensajes genéricos: nunca incluyen el valor ni la nota.
create function public.validar_registro()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tipo_medida text;
begin
  select s.tipo_medida
    into v_tipo_medida
    from public.seguimiento s
   where s.id_seguimiento = new.id_seguimiento
     and s.id_usuario = new.id_usuario;

  if not found then
    raise exception 'Seguimiento no válido' using errcode = '23503';
  end if;

  if new.id_etiqueta is not null and not exists (
       select 1 from public.etiqueta e
        where e.id_etiqueta = new.id_etiqueta
          and e.id_seguimiento = new.id_seguimiento
          and e.id_usuario = new.id_usuario) then
    raise exception 'Etiqueta no válida' using errcode = '23503';
  end if;

  if not public.valor_valido(v_tipo_medida, new.valor) then
    raise exception 'Valor fuera de rango para el tipo de medida' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_registro() from public, anon, authenticated;

create trigger registro_validar
  before insert or update of id_seguimiento, id_etiqueta, valor, id_usuario on public.registro
  for each row execute function public.validar_registro();

-- Cambiar el tipo de medida se permite solo si todos sus registros siguen siendo válidos.
create function public.validar_cambio_tipo_medida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
       select 1 from public.registro r
        where r.id_seguimiento = new.id_seguimiento
          and r.id_usuario = new.id_usuario
          and not public.valor_valido(new.tipo_medida, r.valor)) then
    raise exception 'Hay registros que no sirven para el nuevo tipo de medida' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.validar_cambio_tipo_medida() from public, anon, authenticated;

create trigger seguimiento_validar_tipo_medida
  before update of tipo_medida on public.seguimiento
  for each row when (old.tipo_medida is distinct from new.tipo_medida)
  execute function public.validar_cambio_tipo_medida();

-- ============================================================================
-- 5. Acceso: regla Before User Created y esta_invitado()
-- ============================================================================

-- Hook de Supabase Auth (Authentication > Hooks > Before User Created > Postgres).
-- {} deja crear el usuario; {"error": {...}} lo rechaza.
create function public.acceso_permitido_o_rechazo(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correo text := lower(event -> 'user' ->> 'email');
begin
  if v_correo is not null and exists (
       select 1 from public.acceso_permitido a
        where a.correo = v_correo
          and a.estado = 'activo') then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Acceso no permitido')
  );
end;
$$;

revoke execute on function public.acceso_permitido_o_rechazo(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.acceso_permitido_o_rechazo(jsonb) to supabase_auth_admin;

-- Las políticas la llaman: quitar a alguien de la lista le corta el acceso
-- aunque su sesión siga abierta. security definer porque authenticated no
-- puede leer acceso_permitido; solo responde por el correo del propio jwt.
create function public.esta_invitado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.acceso_permitido a
     where a.correo = lower(auth.jwt() ->> 'email')
       and a.estado = 'activo'
  );
$$;

revoke execute on function public.esta_invitado() from public, anon;
-- authenticated la necesita: las políticas se evalúan con su rol
grant execute on function public.esta_invitado() to authenticated;

-- ============================================================================
-- 6. Permisos y RLS
-- ============================================================================

-- Supabase da todo a anon y authenticated por defecto: se quita.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
-- truncate se salta RLS
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- solo service role (y las funciones security definer)
revoke all on public.acceso_permitido from authenticated;
-- El proyecto no expone tablas nuevas solo: se da lo justo a authenticated (la RLS filtra por dueño).
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.perfil, public.plantilla_activa, public.seguimiento, public.etiqueta, public.meta,
  public.registro, public.alias, public.recibo, public.pago_recibo, public.serie_gym,
  public.tarea, public.recordatorio
  to authenticated;
-- la usan los triggers de validación, que corren con el rol de quien escribe
grant execute on function public.valor_valido(text, numeric) to authenticated;

alter table public.acceso_permitido enable row level security;
-- Sin force y sin políticas: nadie la lee desde la web (anon y authenticated sin permisos);
-- solo su dueño, que es quien corre la regla de acceso y esta_invitado().

-- Tablas con datos: solo el dueño, y solo mientras siga invitado.
-- (select …) hace que auth.uid() y esta_invitado() se evalúen una vez por consulta.

alter table public.perfil enable row level security;
alter table public.perfil force row level security;
create policy perfil_select on public.perfil for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy perfil_insert on public.perfil for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy perfil_update on public.perfil for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy perfil_delete on public.perfil for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.plantilla_activa enable row level security;
alter table public.plantilla_activa force row level security;
create policy plantilla_activa_select on public.plantilla_activa for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy plantilla_activa_insert on public.plantilla_activa for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy plantilla_activa_update on public.plantilla_activa for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy plantilla_activa_delete on public.plantilla_activa for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.seguimiento enable row level security;
alter table public.seguimiento force row level security;
create policy seguimiento_select on public.seguimiento for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy seguimiento_insert on public.seguimiento for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy seguimiento_update on public.seguimiento for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy seguimiento_delete on public.seguimiento for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.etiqueta enable row level security;
alter table public.etiqueta force row level security;
create policy etiqueta_select on public.etiqueta for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy etiqueta_insert on public.etiqueta for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy etiqueta_update on public.etiqueta for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy etiqueta_delete on public.etiqueta for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.meta enable row level security;
alter table public.meta force row level security;
create policy meta_select on public.meta for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy meta_insert on public.meta for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy meta_update on public.meta for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy meta_delete on public.meta for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.registro enable row level security;
alter table public.registro force row level security;
create policy registro_select on public.registro for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy registro_insert on public.registro for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy registro_update on public.registro for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy registro_delete on public.registro for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.alias enable row level security;
alter table public.alias force row level security;
create policy alias_select on public.alias for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy alias_insert on public.alias for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy alias_update on public.alias for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy alias_delete on public.alias for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.recibo enable row level security;
alter table public.recibo force row level security;
create policy recibo_select on public.recibo for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy recibo_insert on public.recibo for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy recibo_update on public.recibo for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy recibo_delete on public.recibo for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.pago_recibo enable row level security;
alter table public.pago_recibo force row level security;
create policy pago_recibo_select on public.pago_recibo for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy pago_recibo_insert on public.pago_recibo for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy pago_recibo_update on public.pago_recibo for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy pago_recibo_delete on public.pago_recibo for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.serie_gym enable row level security;
alter table public.serie_gym force row level security;
create policy serie_gym_select on public.serie_gym for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy serie_gym_insert on public.serie_gym for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy serie_gym_update on public.serie_gym for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy serie_gym_delete on public.serie_gym for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.tarea enable row level security;
alter table public.tarea force row level security;
create policy tarea_select on public.tarea for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy tarea_insert on public.tarea for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy tarea_update on public.tarea for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy tarea_delete on public.tarea for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

alter table public.recordatorio enable row level security;
alter table public.recordatorio force row level security;
create policy recordatorio_select on public.recordatorio for select to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy recordatorio_insert on public.recordatorio for insert to authenticated with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy recordatorio_update on public.recordatorio for update to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select public.esta_invitado()));
create policy recordatorio_delete on public.recordatorio for delete to authenticated using ((select auth.uid()) = id_usuario and (select public.esta_invitado()));

-- ============================================================================
-- 7. Vista con el número de cuenta enmascarado
-- ============================================================================

-- La app lista recibos desde aquí; el número completo se lee de recibo solo al tocar "ver".
-- security_invoker: aplica la RLS de quien consulta, no la del dueño de la vista.
create view public.recibo_visible
with (security_invoker = true)
as
select
  r.id_recibo,
  r.id_usuario,
  r.nombre_servicio,
  r.nombre_ubicacion,
  r.tipo_recibo,
  r.valor_fijo,
  r.dia_pago,
  case when r.numero_cuenta is null then null
       else '****' || right(r.numero_cuenta, 4)
  end as numero_cuenta_enmascarado,
  r.estado,
  r.fecha_creacion,
  r.fecha_actualizacion
from public.recibo r;

revoke all on public.recibo_visible from anon;
revoke all on public.recibo_visible from authenticated;
grant select on public.recibo_visible to authenticated;

