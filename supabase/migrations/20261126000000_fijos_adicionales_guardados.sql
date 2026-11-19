-- Los fijos adicionales que ya no son fijos se guardan por su historial: el cupo de 3 activos lo cuenta la app
-- y la columna admite hasta 8 en total. Solo cambia la regla; no toca datos.
alter table public.etiqueta drop constraint if exists etiqueta_fijos_adicionales_check;
alter table public.etiqueta add constraint etiqueta_fijos_adicionales_check
  check (jsonb_typeof(fijos_adicionales) = 'array' and jsonb_array_length(fijos_adicionales) <= 8 and pg_column_size(fijos_adicionales) <= 65536);
