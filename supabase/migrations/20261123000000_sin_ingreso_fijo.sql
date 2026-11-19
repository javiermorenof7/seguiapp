-- Fuente de Ingresos que él marcó como "ya no es fijo": la app no la espera ni la vuelve a aprender hasta que la anote.
alter table public.etiqueta
  add column sin_ingreso_fijo boolean not null default false;
