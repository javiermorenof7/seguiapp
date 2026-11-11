-- Pagar una factura en un solo paso: el gasto (si descuenta del saldo) y el pago del período entran juntos o no entra ninguno.
-- security invoker: valen las políticas RLS de quien llama; id_usuario sale de auth.uid() por el default de cada tabla.
-- Sin p_id_seguimiento no se crea gasto (factura que no descuenta del saldo).
create function public.pagar_recibo(
  p_id_recibo      uuid,
  p_fecha_periodo  date,
  p_valor          numeric,
  p_fecha_pago     date,
  p_id_seguimiento uuid default null,
  p_id_etiqueta    uuid default null,
  p_grupo          text default null,
  p_nota           text default null,
  p_fecha_gasto    date default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id_registro uuid;
begin
  if p_id_seguimiento is not null then
    insert into public.registro (id_seguimiento, id_etiqueta, grupo, nota, fecha_registro, valor)
    values (p_id_seguimiento, p_id_etiqueta, p_grupo, p_nota, coalesce(p_fecha_gasto, p_fecha_pago), p_valor)
    returning id_registro into v_id_registro;
  end if;

  insert into public.pago_recibo (id_recibo, fecha_periodo, valor, fecha_pago, estado, id_registro)
  values (p_id_recibo, p_fecha_periodo, p_valor, p_fecha_pago, 'pagado', v_id_registro)
  on conflict (id_usuario, id_recibo, fecha_periodo) do update
    set valor = excluded.valor, fecha_pago = excluded.fecha_pago, estado = 'pagado', id_registro = excluded.id_registro;
end;
$$;

comment on function public.pagar_recibo(uuid, date, numeric, date, uuid, uuid, text, text, date) is
  'Marca pagado el período de una factura y, si descuenta del saldo, crea su gasto en la misma transacción.';

revoke execute on function public.pagar_recibo(uuid, date, numeric, date, uuid, uuid, text, text, date) from public, anon;
grant execute on function public.pagar_recibo(uuid, date, numeric, date, uuid, uuid, text, text, date) to authenticated;
