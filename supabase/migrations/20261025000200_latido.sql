-- Consulta mínima que mantiene activo el proyecto gratis; la llama una Action semanal.
-- No lee ninguna tabla: es lo único que puede ejecutar quien no ha iniciado sesión.
create function public.latido()
returns integer
language sql
stable
set search_path = ''
as $$
  select 1;
$$;

revoke execute on function public.latido() from public, authenticated;
grant execute on function public.latido() to anon;
