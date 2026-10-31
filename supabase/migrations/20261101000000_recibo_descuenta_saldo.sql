-- Si pagar la factura crea un gasto. Con false queda pagada sin tocar saldo ni presupuesto.
-- Postgres no admite AFTER: la columna queda al final de public.recibo y no se reordena nada.
alter table public.recibo
  add column descuenta_saldo boolean not null default true;

comment on column public.recibo.descuenta_saldo is
  'Indica si pagar la factura crea un gasto. Con false queda pagada sin tocar saldo ni presupuesto.';

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
  r.requiere_numero_pago,
  r.descuenta_saldo
from public.recibo r;

comment on column public.recibo_visible.descuenta_saldo is
  'Indica si pagar la factura crea un gasto (copia de recibo.descuenta_saldo).';

revoke all on public.recibo_visible from anon;
grant select on public.recibo_visible to authenticated;
