-- Recordatorios que aprenden: preferencias nuevas en preferencia_aviso y registro de los avisos enviados.
-- Postgres no admite AFTER: las seis columnas nuevas quedan al final, detrás de las columnas de control fecha_ultimo_*.
alter table public.preferencia_aviso
  add column recibir_recordatorio_no_registrado boolean not null default true,
  add column modulos_recordatorio_apagados text[] not null default '{}'::text[]
    check (modulos_recordatorio_apagados <@ array['gastos','gym','habitos']::text[]),
  add column cantidad_maxima_recordatorios_dia smallint not null default 2
    check (cantidad_maxima_recordatorios_dia between 1 and 3),
  add column hora_inicio_silencio time not null default '22:00',
  add column hora_fin_silencio time not null default '06:00',
  add column recibir_aviso_inactividad boolean not null default true;

comment on column public.preferencia_aviso.recibir_recordatorio_no_registrado is 'Interruptor general: recordar a la persona lo que no ha registrado en el día.';
comment on column public.preferencia_aviso.modulos_recordatorio_apagados is 'Módulos sin recordatorio de registro: subconjunto de gastos, gym y habitos. Vacío = todos activos.';
comment on column public.preferencia_aviso.cantidad_maxima_recordatorios_dia is 'Máximo de recordatorios de registro que se envían al día (1 a 3).';
comment on column public.preferencia_aviso.hora_inicio_silencio is 'Hora local (Colombia) desde la que no se envían avisos. Puede cruzar la medianoche.';
comment on column public.preferencia_aviso.hora_fin_silencio is 'Hora local (Colombia) en la que termina el silencio.';
comment on column public.preferencia_aviso.recibir_aviso_inactividad is 'Interruptor del aviso que se envía cuando la persona deja de usar la app varios días.';

grant insert (recibir_recordatorio_no_registrado, modulos_recordatorio_apagados, cantidad_maxima_recordatorios_dia,
              hora_inicio_silencio, hora_fin_silencio, recibir_aviso_inactividad),
      update (recibir_recordatorio_no_registrado, modulos_recordatorio_apagados, cantidad_maxima_recordatorios_dia,
              hora_inicio_silencio, hora_fin_silencio, recibir_aviso_inactividad)
  on public.preferencia_aviso to authenticated;

-- Avisos enviados: solo los escribe la función de envío (service_role); la persona solo lee los suyos.
create table public.aviso_enviado (
  id_aviso_enviado uuid primary key default gen_random_uuid(),
  id_usuario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  codigo_aviso text not null
    check (codigo_aviso in ('registro_gastos','registro_gym','registro_habitos','inactividad')),
  fecha_aviso date not null default ((now() at time zone 'America/Bogota')::date),
  fecha_creacion timestamptz not null default now()
);

comment on table public.aviso_enviado is 'Registro de los avisos enviados a cada persona. Sirve para respetar el máximo diario y no repetir avisos.';
comment on column public.aviso_enviado.id_aviso_enviado is 'Identificador del aviso enviado.';
comment on column public.aviso_enviado.id_usuario is 'Persona que recibió el aviso. Se borra en cascada al borrar su cuenta.';
comment on column public.aviso_enviado.codigo_aviso is 'Tipo de aviso: registro_gastos, registro_gym, registro_habitos o inactividad.';
comment on column public.aviso_enviado.fecha_aviso is 'Día del aviso en hora de Colombia (America/Bogota).';
comment on column public.aviso_enviado.fecha_creacion is 'Momento exacto en que se registró el envío.';

-- único: si la función se reintenta, el mismo aviso no queda dos veces el mismo día
create unique index aviso_enviado_usuario_codigo_fecha_idx
  on public.aviso_enviado (id_usuario, codigo_aviso, fecha_aviso);

alter table public.aviso_enviado enable row level security;
alter table public.aviso_enviado force row level security;

revoke all on table public.aviso_enviado from public, anon, authenticated;
grant select on table public.aviso_enviado to authenticated;
grant insert, select on table public.aviso_enviado to service_role;

create policy aviso_enviado_select_propio on public.aviso_enviado
  for select to authenticated
  using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
