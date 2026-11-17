-- Unidad en que se escribió cada serie; el peso sigue en kg. Vacío en las anteriores: se muestran en la unidad del ejercicio.
alter table public.serie_gym
  add column unidad_peso text check (unidad_peso in ('kg', 'lb'));
