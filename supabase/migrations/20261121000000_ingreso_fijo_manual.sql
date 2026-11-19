-- Ingreso fijo anotado a mano en una fuente de Ingresos: monto y día de pago; manda sobre el que aprende la app.
alter table public.etiqueta
  add column monto_fijo numeric(14, 0) check (monto_fijo > 0 and monto_fijo <= 1000000000),
  add column dia_fijo   smallint check (dia_fijo between 1 and 31),
  add constraint etiqueta_fijo_completo check ((monto_fijo is null) = (dia_fijo is null));
