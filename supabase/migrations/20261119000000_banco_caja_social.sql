-- Bancos que puede tener una cuenta: entra Banco Caja Social (su extracto ya se lee) y sale Bancolombia (ninguna cuenta lo usa).
alter table public.cuenta drop constraint cuenta_banco_check;
alter table public.cuenta add constraint cuenta_banco_check
  check (banco in ('Davivienda', 'Nequi', 'Banco Falabella', 'Banco Caja Social', 'Otro'));
