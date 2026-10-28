-- Préstamos: el préstamo y sus movimientos (cuotas, abonos, cambios de tasa y cuadres con el extracto), con RLS.

-- ============================================================================
-- 1. Tablas
-- ============================================================================

create table public.prestamo (
  id_prestamo          uuid primary key default gen_random_uuid(),
  id_usuario           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre_entidad       text not null check (char_length(nombre_entidad) between 1 and 60),
  nombre_prestamo      text check (char_length(nombre_prestamo) between 1 and 60),
  -- saldo antes de la primera cuota que falta por pagar
  valor_saldo_inicial  numeric(14,0) not null check (valor_saldo_inicial > 0),
  -- primera cuota que falta: la primera del préstamo si se registra desde el desembolso, o la próxima si ya iba en curso
  fecha_primera_cuota  date not null,
  -- cuotas que faltan desde fecha_primera_cuota (incluida)
  cantidad_cuotas      smallint not null check (cantidad_cuotas between 1 and 600),
  -- en porcentaje (12.6825 = 12,6825 % E.A.)
  tasa_efectiva_anual  numeric(7,4) not null check (tasa_efectiva_anual between 0 and 200),
  valor_seguro_mensual numeric(14,0) not null default 0 check (valor_seguro_mensual >= 0),
  -- 31 en un mes corto = último día
  dia_pago             smallint not null check (dia_pago between 1 and 31),
  estado               text not null default 'activo' check (estado in ('activo', 'pagado', 'eliminado')),
  fecha_creacion       timestamptz not null default now(),
  fecha_actualizacion  timestamptz not null default now(),
  unique (id_usuario, id_prestamo)
);

-- Deshacer una cuota o un abono borra la fila (como pago_recibo).
create table public.movimiento_prestamo (
  id_movimiento_prestamo uuid primary key default gen_random_uuid(),
  id_usuario             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id_prestamo            uuid not null,
  -- gasto creado al pagar la cuota o el abono
  id_registro            uuid,
  tipo_movimiento        text not null check (tipo_movimiento in ('cuota', 'abono', 'cambio_tasa', 'cuadre')),
  fecha_movimiento       date not null,
  numero_cuota           smallint check (numero_cuota between 1 and 600),
  -- valor pagado (cuota, abono) o saldo del extracto (cuadre)
  valor                  numeric(14,0) check (valor >= 0),
  -- nueva tasa, en porcentaje
  tasa_efectiva_anual    numeric(7,4) check (tasa_efectiva_anual between 0 and 200),
  tipo_abono             text check (tipo_abono in ('reduce_plazo', 'reduce_cuota')),
  fecha_creacion         timestamptz not null default now(),
  fecha_actualizacion    timestamptz not null default now(),
  -- cada campo solo y obligatorio en su tipo
  check ((tipo_movimiento = 'cuota') = (numero_cuota is not null)),
  check ((tipo_movimiento = 'abono') = (tipo_abono is not null)),
  check ((tipo_movimiento = 'cambio_tasa') = (tasa_efectiva_anual is not null)),
  check ((tipo_movimiento = 'cambio_tasa') = (valor is null)),
  check (tipo_movimiento not in ('cuota', 'abono') or valor > 0),
  -- solo cuotas y abonos crean gasto
  check (tipo_movimiento in ('cuota', 'abono') or id_registro is null),
  foreign key (id_usuario, id_prestamo) references public.prestamo (id_usuario, id_prestamo) on delete cascade,
  foreign key (id_usuario, id_registro) references public.registro (id_usuario, id_registro) on delete set null (id_registro),
  -- una cuota por número y préstamo (numero_cuota es null fuera de 'cuota')
  unique (id_usuario, id_prestamo, numero_cuota),
  unique (id_usuario, id_registro)
);

-- ---------- Columnas sensibles (no salen en logs, correos ni errores) -------

comment on column public.prestamo.nombre_entidad  is 'sensible: texto libre de la persona';
comment on column public.prestamo.nombre_prestamo is 'sensible: texto libre de la persona';

-- ============================================================================
-- 2. Índices (el único de numero_cuota ya cubre la llave foránea del préstamo)
-- ============================================================================

-- movimientos de un préstamo por fecha (saldo, tabla de cuotas)
create index movimiento_prestamo_usuario_prestamo_fecha_idx on public.movimiento_prestamo (id_usuario, id_prestamo, fecha_movimiento);

-- ============================================================================
-- 3. fecha_actualizacion automática
-- ============================================================================

create trigger prestamo_fecha_actualizacion            before update on public.prestamo            for each row execute function public.fijar_fecha_actualizacion();
create trigger movimiento_prestamo_fecha_actualizacion before update on public.movimiento_prestamo for each row execute function public.fijar_fecha_actualizacion();

-- ============================================================================
-- 4. Permisos y RLS
-- ============================================================================

-- truncate se salta RLS (Supabase lo da por defecto en tablas nuevas)
revoke truncate, references, trigger on public.prestamo, public.movimiento_prestamo from authenticated;
grant select, insert, update, delete on public.prestamo, public.movimiento_prestamo to authenticated;

alter table public.prestamo enable row level security;
alter table public.prestamo force row level security;
create policy prestamo_select on public.prestamo for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy prestamo_insert on public.prestamo for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy prestamo_update on public.prestamo for update to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy prestamo_delete on public.prestamo for delete to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));

alter table public.movimiento_prestamo enable row level security;
alter table public.movimiento_prestamo force row level security;
create policy movimiento_prestamo_select on public.movimiento_prestamo for select to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy movimiento_prestamo_insert on public.movimiento_prestamo for insert to authenticated with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy movimiento_prestamo_update on public.movimiento_prestamo for update to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado())) with check ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
create policy movimiento_prestamo_delete on public.movimiento_prestamo for delete to authenticated using ((select auth.uid()) = id_usuario and (select privado.esta_invitado()));
