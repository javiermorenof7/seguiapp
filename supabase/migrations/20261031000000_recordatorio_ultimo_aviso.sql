-- El aviso de un recordatorio sale una sola vez por envío y el recordatorio sigue en Hoy hasta que la persona lo marca "Listo".
-- La función de avisos ya no mueve fecha_proximo_envio: anota cuándo avisó.
alter table public.recordatorio add column fecha_ultimo_aviso timestamptz;

comment on column public.recordatorio.fecha_ultimo_aviso is 'Instante (UTC) del último aviso enviado al celular. Si es anterior a fecha_proximo_envio, el envío actual aún no se avisa.';

grant update (fecha_ultimo_aviso) on public.recordatorio to service_role;
