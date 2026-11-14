-- Cuentas (con qué se paga), extractos bancarios y el vínculo de cada movimiento del extracto con su registro.
-- Solo añade: no cambia ni borra datos. Los registros siguen en pesos enteros; el valor exacto del banco (con centavos) vive en registro_extracto.

create table public.cuenta (
  id_cuenta           uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre              text not null check (char_length(nombre) between 1 and 40),
  -- vacío en Efectivo
  ultimos_digitos     text check (ultimos_digitos ~ '^[0-9]{4}$'),
  estado              text not null default 'activo' check (estado in ('activo', 'eliminado')),
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  -- un nombre por persona; una eliminada se reactiva en vez de crearla otra vez
  unique (id_usuario, nombre),
  unique (id_usuario, id_cuenta)
);

-- Quitar una cuenta deja sus registros sin cuenta, no los borra.
alter table public.registro
  add column id_cuenta uuid,
  add constraint registro_cuenta_fkey foreign key (id_usuario, id_cuenta) references public.cuenta (id_usuario, id_cuenta) on delete set null (id_cuenta);

create index registro_usuario_cuenta_fecha_idx on public.registro (id_usuario, id_cuenta, fecha_registro) where id_cuenta is not null;

create table public.extracto (
  id_extracto         uuid primary key default gen_random_uuid(),
  id_usuario          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_cuenta           uuid not null,
  fecha_desde         date not null,
  fecha_hasta         date not null,
  valor_saldo_inicial numeric(14,2) not null,
  valor_saldo_final   numeric(14,2) not null,
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  check (fecha_hasta >= fecha_desde),
  foreign key (id_usuario, id_cuenta) references public.cuenta (id_usuario, id_cuenta) on delete cascade,
  -- subir otra vez el mismo período de la misma cuenta actualiza el que ya está
  unique (id_usuario, id_cuenta, fecha_desde, fecha_hasta),
  unique (id_usuario, id_extracto)
);

create table public.registro_extracto (
  id_registro_extracto uuid primary key default gen_random_uuid(),
  id_usuario           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_extracto          uuid not null,
  -- vacío en los movimientos de centavos, que no llegan a un peso y no crean registro
  id_registro          uuid,
  -- fecha, valor y saldo de la fila en el extracto: distingue dos movimientos iguales del mismo día
  huella               text not null check (char_length(huella) between 1 and 80),
  fecha_movimiento     date not null,
  -- con signo y centavos: positivo entra a la cuenta, negativo sale
  valor_banco          numeric(14,2) not null,
  -- true si el registro lo creó la carga del extracto; false si ya estaba anotado y solo se emparejó
  creado_por_carga     boolean not null default false,
  fecha_creacion       timestamptz not null default now(),
  fecha_actualizacion  timestamptz not null default now(),
  foreign key (id_usuario, id_extracto) references public.extracto (id_usuario, id_extracto) on delete cascade,
  foreign key (id_usuario, id_registro) references public.registro (id_usuario, id_registro) on delete set null (id_registro),
  unique (id_usuario, id_extracto, huella),
  unique (id_usuario, id_registro)
);

create trigger cuenta_fecha_actualizacion            before update on public.cuenta            for each row execute function public.fijar_fecha_actualizacion();
create trigger extracto_fecha_actualizacion          before update on public.extracto          for each row execute function public.fijar_fecha_actualizacion();
create trigger registro_extracto_fecha_actualizacion before update on public.registro_extracto for each row execute function public.fijar_fecha_actualizacion();

comment on column public.cuenta.ultimos_digitos is 'sensible: últimos 4 dígitos del número de la cuenta';

revoke truncate, references, trigger on public.cuenta, public.extracto, public.registro_extracto from authenticated;
grant select, insert, update, delete on public.cuenta, public.extracto, public.registro_extracto to authenticated;

alter table public.cuenta enable row level security;
alter table public.cuenta force row level security;

create policy cuenta_select on public.cuenta for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy cuenta_insert on public.cuenta for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy cuenta_update on public.cuenta for update to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy cuenta_delete on public.cuenta for delete to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));

alter table public.extracto enable row level security;
alter table public.extracto force row level security;

create policy extracto_select on public.extracto for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy extracto_insert on public.extracto for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy extracto_update on public.extracto for update to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy extracto_delete on public.extracto for delete to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));

alter table public.registro_extracto enable row level security;
alter table public.registro_extracto force row level security;

create policy registro_extracto_select on public.registro_extracto for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy registro_extracto_insert on public.registro_extracto for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy registro_extracto_update on public.registro_extracto for update to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy registro_extracto_delete on public.registro_extracto for delete to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));

-- Lo aprendido de los extractos: qué descripciones son traslados entre cuentas propias y qué es cada columna de un formato.
alter table public.alias
  drop constraint alias_tipo_check,
  add constraint alias_tipo_check check (tipo in ('categoria', 'ejercicio', 'habito', 'traslado', 'formato_extracto'));

-- Efectivo para quien ya usa Finanzas; a los demás se les crea al activarla.
insert into public.cuenta (id_usuario, nombre)
select id_usuario, 'Efectivo' from public.plantilla_activa where codigo_plantilla = 'finanzas' and estado = 'activo'
on conflict (id_usuario, nombre) do nothing;
