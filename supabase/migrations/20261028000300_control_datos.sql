-- Control de los datos: administrador, mensajes de contacto, borrar la cuenta y aviso mensual para descargar los datos.
-- No borra ni sobrescribe nada: solo agrega columnas, una tabla y funciones.

-- ============================================================================
-- 1. Administrador
-- ============================================================================

-- Postgres no permite ubicar la columna: queda al final de la tabla.
alter table public.acceso_permitido add column es_administrador boolean not null default false;

-- Responde solo por el correo del propio jwt. security definer porque authenticated no puede leer acceso_permitido.
create function public.soy_administrador()
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
       and a.es_administrador
  );
$$;

revoke execute on function public.soy_administrador() from public, anon;
grant execute on function public.soy_administrador() to authenticated;

-- La función "avisos" (rol de servicio) la usa para saber a quién avisar de un mensaje nuevo.
create function public.ids_administradores()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
    join public.acceso_permitido a on a.correo = lower(u.email)
   where a.es_administrador and a.estado = 'activo';
$$;

revoke execute on function public.ids_administradores() from public, anon, authenticated;
grant execute on function public.ids_administradores() to service_role;

-- ============================================================================
-- 2. Mensajes de contacto
-- ============================================================================

create table public.mensaje_contacto (
  id_mensaje_contacto       uuid primary key default gen_random_uuid(),
  id_usuario                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  motivo                    text not null check (motivo in ('duda', 'mis_datos', 'error', 'otro')),
  mensaje                   text not null check (char_length(mensaje) between 1 and 1000),
  respuesta                 text check (char_length(respuesta) between 1 and 2000),
  fecha_respuesta           timestamptz,
  estado                    text not null default 'nuevo' check (estado in ('nuevo', 'respondido')),
  fecha_creacion            timestamptz not null default now(),
  fecha_actualizacion       timestamptz not null default now(),
  -- control: la llena la función que envía al avisarle al administrador
  fecha_aviso_administrador timestamptz,
  -- respondido siempre con respuesta
  check (estado = 'nuevo' or respuesta is not null)
);

comment on column public.mensaje_contacto.mensaje   is 'sensible: texto libre de la persona';
comment on column public.mensaje_contacto.respuesta is 'sensible: texto libre del administrador';

-- mensajes de una persona (llave foránea y límite diario)
create index mensaje_contacto_usuario_idx on public.mensaje_contacto (id_usuario, fecha_creacion);
-- los que faltan por avisar al administrador
create index mensaje_contacto_sin_aviso_idx on public.mensaje_contacto (fecha_creacion) where fecha_aviso_administrador is null;

create trigger mensaje_contacto_fecha_actualizacion before update on public.mensaje_contacto for each row execute function public.fijar_fecha_actualizacion();

-- Máximo 5 mensajes por persona en 24 horas. Corre con el rol de quien escribe: la RLS ya le deja ver solo los suyos.
create function privado.limitar_mensajes_contacto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.mensaje_contacto
       where id_usuario = new.id_usuario and fecha_creacion > now() - interval '1 day') >= 5 then
    raise exception 'limite de mensajes' using errcode = 'P0001', hint = 'Ya enviaste 5 mensajes hoy. Inténtalo mañana.';
  end if;
  return new;
end;
$$;

create trigger mensaje_contacto_limite before insert on public.mensaje_contacto for each row execute function privado.limitar_mensajes_contacto();

-- La persona envía y lee los suyos; no edita ni borra (se borran con su cuenta). La respuesta solo la escribe el administrador.
revoke all on public.mensaje_contacto from anon, authenticated;
grant select on public.mensaje_contacto to authenticated;
grant insert (id_usuario, motivo, mensaje) on public.mensaje_contacto to authenticated;

alter table public.mensaje_contacto enable row level security;
alter table public.mensaje_contacto force row level security;
create policy mensaje_contacto_select on public.mensaje_contacto for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy mensaje_contacto_insert on public.mensaje_contacto for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));

-- Pantalla de administración: todos los mensajes con el correo de quien escribe; a otra persona no le devuelve nada.
create function public.mensajes_contacto_recibidos()
returns table (id_mensaje_contacto uuid, correo text, motivo text, mensaje text, respuesta text, fecha_respuesta timestamptz, estado text, fecha_creacion timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id_mensaje_contacto, u.email::text, m.motivo, m.mensaje, m.respuesta, m.fecha_respuesta, m.estado, m.fecha_creacion
    from public.mensaje_contacto m
    join auth.users u on u.id = m.id_usuario
   where public.soy_administrador()
   order by m.estado = 'respondido', m.fecha_creacion desc
   limit 200;
$$;

create function public.responder_mensaje_contacto(id_mensaje uuid, texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.soy_administrador() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if nullif(trim(texto), '') is null then
    raise exception 'respuesta vacia' using errcode = '22023';
  end if;
  update public.mensaje_contacto
     set respuesta = trim(texto), fecha_respuesta = now(), estado = 'respondido'
   where id_mensaje_contacto = id_mensaje;
  if not found then
    raise exception 'mensaje no encontrado' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.mensajes_contacto_recibidos(), public.responder_mensaje_contacto(uuid, text) from public, anon;
grant execute on function public.mensajes_contacto_recibidos(), public.responder_mensaje_contacto(uuid, text) to authenticated;

-- La función "avisos" solo ve qué mensajes faltan por avisar y los marca.
grant select (id_mensaje_contacto, fecha_aviso_administrador) on public.mensaje_contacto to service_role;
grant update (fecha_aviso_administrador) on public.mensaje_contacto to service_role;

-- ============================================================================
-- 3. Borrar la cuenta
-- ============================================================================

-- Borra solo a quien la llama: su usuario (todas sus tablas caen en cascada) y su correo de la lista de invitados.
-- El administrador no se borra desde la app.
create function public.borrar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_sesion uuid := auth.uid();
begin
  if id_sesion is null then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if public.soy_administrador() then
    raise exception 'administrador' using errcode = 'P0001', hint = 'La cuenta del administrador no se borra desde la app.';
  end if;
  -- el correo sale de la cuenta, no del token: si cambió, el token puede traer el viejo
  delete from public.acceso_permitido where correo = (select lower(u.email) from auth.users u where u.id = id_sesion);
  delete from auth.users where id = id_sesion;
end;
$$;

revoke execute on function public.borrar_mi_cuenta() from public, anon;
grant execute on function public.borrar_mi_cuenta() to authenticated;

-- ============================================================================
-- 4. Aviso mensual para descargar los datos
-- ============================================================================

-- Postgres no permite ubicar las columnas: quedan al final de la tabla.
alter table public.preferencia_aviso add column recibir_aviso_descarga boolean not null default true;
-- control: la llena solo la función que envía
alter table public.preferencia_aviso add column fecha_ultimo_aviso_descarga date;

grant insert (recibir_aviso_descarga), update (recibir_aviso_descarga) on public.preferencia_aviso to authenticated;
grant update (fecha_ultimo_aviso_descarga) on public.preferencia_aviso to service_role;
