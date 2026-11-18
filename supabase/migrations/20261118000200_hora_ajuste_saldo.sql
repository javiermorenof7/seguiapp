-- Cuándo se hizo el ajuste al banco: lo anotado ese mismo día después de ajustar sí mueve el acumulado.
alter table public.perfil
  add column fecha_hora_ajuste_saldo timestamptz;

-- Ajustes guardados antes de esta columna: perfil solo se actualiza al ajustar, así que su fecha_actualizacion es la hora del ajuste.
update public.perfil
   set fecha_hora_ajuste_saldo = fecha_actualizacion
 where fecha_ajuste_saldo is not null and fecha_hora_ajuste_saldo is null;
