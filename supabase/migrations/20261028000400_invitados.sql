-- Invitados: el administrador invita, ve la lista y quita el acceso desde la app.
-- Sin tablas ni columnas nuevas: funciones sobre acceso_permitido, que authenticated no puede leer.

-- Lista de invitados; a otra persona no le devuelve nada.
create function public.invitados()
returns table (correo text, estado text, es_administrador boolean, tiene_cuenta boolean, fecha_actualizacion timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.correo, a.estado, a.es_administrador,
         exists (select 1 from auth.users u where lower(u.email) = a.correo),
         a.fecha_actualizacion
    from public.acceso_permitido a
   where public.soy_administrador()
   order by a.estado, a.correo
   limit 500;
$$;

-- Agrega el correo o vuelve a activar uno inactivo.
create function public.invitar(correo_invitado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  limpio text := lower(trim(correo_invitado));
begin
  if not public.soy_administrador() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if limpio is null or limpio !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(limpio) > 254 then
    raise exception 'correo invalido' using errcode = '22023';
  end if;
  insert into public.acceso_permitido (correo) values (limpio)
  on conflict (correo) do update set estado = 'activo';
end;
$$;

-- Borra la cuenta de la persona (todas sus tablas caen en cascada) y deja su correo inactivo para volver a invitarla.
-- El administrador no se quita.
create function public.quitar_invitado(correo_invitado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  limpio text := lower(trim(correo_invitado));
begin
  if not public.soy_administrador() then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  if exists (select 1 from public.acceso_permitido a where a.correo = limpio and a.es_administrador) then
    raise exception 'administrador' using errcode = 'P0001';
  end if;
  update public.acceso_permitido set estado = 'inactivo' where correo = limpio;
  if not found then
    raise exception 'invitado no encontrado' using errcode = 'P0002';
  end if;
  delete from auth.users where lower(email) = limpio;
end;
$$;

revoke execute on function public.invitados(), public.invitar(text), public.quitar_invitado(text) from public, anon;
grant execute on function public.invitados(), public.invitar(text), public.quitar_invitado(text) to authenticated;
