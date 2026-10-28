-- Avisos push: los equipos suscritos de cada persona y sus preferencias de aviso, con RLS.

-- ============================================================================
-- 1. Tablas
-- ============================================================================

-- Una fila por equipo o navegador; desactivar los avisos borra la fila.
create table public.suscripcion_push (
  id_suscripcion_push uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint            text not null unique check (char_length(endpoint) <= 1000 and endpoint ~ '^https://[^[:space:]]+$'),
  -- llaves del navegador en base64 (url)
  llave_p256dh        text not null check (char_length(llave_p256dh) between 1 and 200 and llave_p256dh ~ '^[A-Za-z0-9+/_-]+={0,2}$'),
  llave_auth          text not null check (char_length(llave_auth) between 1 and 100 and llave_auth ~ '^[A-Za-z0-9+/_-]+={0,2}$'),
  -- 'iPhone', 'Android', 'Computador'
  nombre_equipo       text not null check (char_length(nombre_equipo) between 1 and 40),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  -- control: la llena la función que envía
  fecha_ultimo_envio  timestamptz
);

-- Una fila por persona.
create table public.preferencia_aviso (
  id_preferencia_aviso         uuid primary key default gen_random_uuid(),
  id_usuario                   uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  recibir_resumen_diario       boolean not null default true,
  frecuencia_resumen_diario    text not null default 'diario' check (frecuencia_resumen_diario in ('diario', 'habiles')),
  hora_resumen_diario          time not null default '09:00',
  recibir_resumen_semanal      boolean not null default true,
  -- ISO: 1 = lunes, 7 = domingo
  dia_resumen_semanal          smallint not null default 7 check (dia_resumen_semanal between 1 and 7),
  hora_resumen_semanal         time not null default '19:00',
  recibir_cierre_mes           boolean not null default true,
  hora_cierre_mes              time not null default '20:00',
  recibir_recordatorios        boolean not null default true,
  -- subconjunto de las repeticiones del recordatorio; vacío = ninguna (<@ también rechaza nulos)
  tipos_recordatorio           text[] not null default '{unico,diario,habiles,semanal,mensual}'
                               check (tipos_recordatorio <@ array['unico', 'diario', 'habiles', 'semanal', 'mensual']::text[]),
  -- texto del aviso en la pantalla de bloqueo
  mostrar_descripcion          boolean not null default false,
  -- interruptor general
  estado                       text not null default 'activo' check (estado in ('activo', 'pausado')),
  fecha_creacion               timestamptz not null default now(),
  fecha_actualizacion          timestamptz not null default now(),
  -- control: las llena solo la función que envía (service role)
  fecha_ultimo_resumen_diario  date,
  fecha_ultimo_resumen_semanal date,
  fecha_ultimo_cierre_mes      date
);

-- ---------- Columnas sensibles (no salen en logs, correos ni errores) -------

comment on column public.suscripcion_push.endpoint     is 'sensible: dirección de envío del navegador';
comment on column public.suscripcion_push.llave_p256dh is 'sensible: llave de cifrado del navegador';
comment on column public.suscripcion_push.llave_auth   is 'sensible: secreto de autenticación del navegador';

-- ============================================================================
-- 2. Índices (los únicos de endpoint e id_usuario ya cubren el upsert y la preferencia de cada persona)
-- ============================================================================

-- equipos de una persona (llave foránea, envío y conteo en la pantalla)
create index suscripcion_push_usuario_idx on public.suscripcion_push (id_usuario);
-- preferencias activas que recorre la función que envía
create index preferencia_aviso_activo_idx on public.preferencia_aviso (id_usuario) where estado = 'activo';

-- ============================================================================
-- 3. fecha_actualizacion automática
-- ============================================================================

create trigger suscripcion_push_fecha_actualizacion  before update on public.suscripcion_push  for each row execute function public.fijar_fecha_actualizacion();
create trigger preferencia_aviso_fecha_actualizacion before update on public.preferencia_aviso for each row execute function public.fijar_fecha_actualizacion();

-- ============================================================================
-- 4. Permisos y RLS
-- ============================================================================

-- truncate se salta RLS (Supabase lo da por defecto en tablas nuevas).
-- insert y update se quitan de toda la tabla y se dan por columnas: las de control solo las escribe la función que envía.
revoke insert, update, truncate, references, trigger on public.suscripcion_push, public.preferencia_aviso from authenticated;
grant select, delete on public.suscripcion_push, public.preferencia_aviso to authenticated;
grant insert (id_usuario, endpoint, llave_p256dh, llave_auth, nombre_equipo) on public.suscripcion_push to authenticated;
grant update (endpoint, llave_p256dh, llave_auth, nombre_equipo) on public.suscripcion_push to authenticated;
grant insert (id_usuario, recibir_resumen_diario, frecuencia_resumen_diario, hora_resumen_diario, recibir_resumen_semanal, dia_resumen_semanal,
              hora_resumen_semanal, recibir_cierre_mes, hora_cierre_mes, recibir_recordatorios, tipos_recordatorio, mostrar_descripcion, estado)
  on public.preferencia_aviso to authenticated;
grant update (recibir_resumen_diario, frecuencia_resumen_diario, hora_resumen_diario, recibir_resumen_semanal, dia_resumen_semanal,
              hora_resumen_semanal, recibir_cierre_mes, hora_cierre_mes, recibir_recordatorios, tipos_recordatorio, mostrar_descripcion, estado)
  on public.preferencia_aviso to authenticated;

alter table public.suscripcion_push enable row level security;
alter table public.suscripcion_push force row level security;
create policy suscripcion_push_select on public.suscripcion_push for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy suscripcion_push_insert on public.suscripcion_push for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy suscripcion_push_update on public.suscripcion_push for update to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy suscripcion_push_delete on public.suscripcion_push for delete to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));

alter table public.preferencia_aviso enable row level security;
alter table public.preferencia_aviso force row level security;
create policy preferencia_aviso_select on public.preferencia_aviso for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy preferencia_aviso_insert on public.preferencia_aviso for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy preferencia_aviso_update on public.preferencia_aviso for update to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy preferencia_aviso_delete on public.preferencia_aviso for delete to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
