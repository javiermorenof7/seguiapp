-- Más ingresos fijos de la misma fuente (otro arriendo, otro sueldo). Cada uno:
-- {clave, nombre, monto (null = ya no es fijo), dia, desde: 'AAAA-MM', historial: [{desde, monto, dia}]}.
-- El primer fijo de la fuente sigue en monto_fijo, dia_fijo, fecha_fijo_desde, sin_ingreso_fijo e historial_fijo.
alter table public.etiqueta
  add column fijos_adicionales jsonb not null default '[]'::jsonb
    check (jsonb_typeof(fijos_adicionales) = 'array' and jsonb_array_length(fijos_adicionales) <= 3 and pg_column_size(fijos_adicionales) <= 32768);
