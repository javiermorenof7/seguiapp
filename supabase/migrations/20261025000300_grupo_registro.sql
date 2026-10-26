-- Básico o personal de cada gasto; vacío = el grupo de su etiqueta ("Gasto automático").
alter table public.registro add column grupo text check (grupo in ('basico', 'personal'));
