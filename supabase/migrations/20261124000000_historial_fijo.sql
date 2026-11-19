-- Historial del ingreso fijo de cada fuente, para que los meses pasados conserven lo que se esperaba entonces.
-- Cada tramo: {desde: 'AAAA-MM' (vacío = antes del primer cambio), monto (null = ya no es fijo), dia}.
alter table public.etiqueta
  add column historial_fijo jsonb not null default '[]'::jsonb
    check (jsonb_typeof(historial_fijo) = 'array' and jsonb_array_length(historial_fijo) <= 120);

update public.etiqueta set historial_fijo = jsonb_build_array(jsonb_build_object('desde', '2026-11', 'monto', null, 'dia', null))
where sin_ingreso_fijo and historial_fijo = '[]'::jsonb;
