-- Funciones internas fuera del esquema que expone la API.

-- esta_invitado() la usan las políticas; en un esquema privado nadie puede llamarla por la API.
-- Las políticas apuntan a la función, no a su nombre: siguen funcionando tras moverla.
create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated;
alter function public.esta_invitado() set schema privado;

-- La crea Supabase al activar la RLS automática; la llama el sistema, no las personas.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
