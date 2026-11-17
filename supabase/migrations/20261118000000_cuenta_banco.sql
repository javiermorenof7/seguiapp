-- Banco de cada cuenta (para reconocer su extracto) y lo que la persona dijo de ella en el último ajuste.
alter table public.cuenta
  add column banco              text check (banco in ('Davivienda', 'Nequi', 'Banco Falabella', 'Bancolombia', 'Otro')),
  add column valor_ajuste_saldo numeric(14, 2) check (abs(valor_ajuste_saldo) < 1e12);
