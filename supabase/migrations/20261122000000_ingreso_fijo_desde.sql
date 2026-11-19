-- Mes desde el que se espera el ingreso fijo anotado a mano (primer día del mes); antes de ese mes vale el aprendido.
alter table public.etiqueta
  add column fecha_fijo_desde date;

update public.etiqueta set fecha_fijo_desde = date '2026-11-01'
where monto_fijo is not null and fecha_fijo_desde is null;
