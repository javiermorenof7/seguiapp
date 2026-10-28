-- Tarea programada de avisos: cada 5 minutos llama a la función "avisos" con una firma que solo existe en Vault.
-- Nadie la ve: se genera aquí, la tarea la lee de Vault y la función la compara con firma_avisos_valida().

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'firma_avisos', 'Firma de la tarea programada de avisos');

-- Solo la usa la función (rol de servicio); la web no puede llamarla.
create function public.firma_avisos_valida(firma text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'firma_avisos' and decrypted_secret = firma);
$$;

revoke execute on function public.firma_avisos_valida(text) from public, anon, authenticated;
grant execute on function public.firma_avisos_valida(text) to service_role;

select cron.schedule('avisos', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://soanuxwzrixrtslsqpyf.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-firma', (select decrypted_secret from vault.decrypted_secrets where name = 'firma_avisos')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
