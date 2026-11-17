-- Cuánto dijo la persona que tenía (según su banco) y a qué fecha: el acumulado del año parte de ahí.
alter table public.perfil
  add column valor_ajuste_saldo numeric(14, 2) check (abs(valor_ajuste_saldo) < 1e12),
  add column fecha_ajuste_saldo date;
