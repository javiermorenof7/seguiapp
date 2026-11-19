-- Cardio en minutos y, si se quiere, km: una serie de gym es de pesas (series y repeticiones) o de cardio (minutos).
alter table public.serie_gym
  add column minutos      smallint check (minutos between 1 and 600),
  add column distancia_km numeric(5, 2) check (distancia_km > 0 and distancia_km <= 200),
  alter column cantidad_series drop not null,
  alter column cantidad_repeticiones drop not null,
  add constraint serie_gym_pesas_o_cardio check (
    (minutos is not null and cantidad_series is null and cantidad_repeticiones is null and peso_kilogramos is null)
    or (minutos is null and distancia_km is null and cantidad_series is not null and cantidad_repeticiones is not null));
