-- Si la factura pide número de pago: con true y sin número, la app muestra "Sin número de pago".
-- Postgres no admite AFTER: la columna queda al final de public.recibo y no se reordena nada.
alter table public.recibo
  add column requiere_numero_pago boolean not null default false;

comment on column public.recibo.requiere_numero_pago is
  'Indica si la factura requiere número de pago. Si es true y numero_cuenta es null, la app muestra "Sin número de pago".';

-- Valor inicial: true solo donde ya hay número (el trigger también actualiza fecha_actualizacion en esas filas).
update public.recibo
set requiere_numero_pago = true
where numero_cuenta is not null;

create or replace view public.recibo_visible
with (security_invoker = true) as
select
  r.id_recibo,
  r.id_usuario,
  r.nombre_servicio,
  r.nombre_ubicacion,
  r.tipo_recibo,
  r.valor_fijo,
  r.dia_pago,
  case when r.numero_cuenta is null then null
       else '****' || right(r.numero_cuenta, 4) end as numero_cuenta_enmascarado,
  r.estado,
  r.fecha_creacion,
  r.fecha_actualizacion,
  r.requiere_numero_pago
from public.recibo r;

comment on column public.recibo_visible.requiere_numero_pago is
  'Indica si la factura requiere número de pago (copia de recibo.requiere_numero_pago).';

revoke all on public.recibo_visible from anon;
grant select on public.recibo_visible to authenticated;
