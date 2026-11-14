-- Parte del cuerpo y unidad en que se escribe el peso de cada ejercicio del gym. El peso se guarda siempre en kg.
alter table public.etiqueta
  add column parte_cuerpo text check (parte_cuerpo in ('pecho', 'espalda', 'hombros', 'biceps', 'triceps', 'abdomen', 'piernas', 'gluteos', 'pantorrillas', 'cardio')),
  add column unidad_peso  text check (unidad_peso in ('kg', 'lb'));
