-- La función "avisos" lee la base con el rol de servicio (solo existe dentro de Supabase, nunca en la web).
-- El proyecto no da permisos automáticos a las tablas: se le da solo lo que el envío necesita.

grant select on
  public.preferencia_aviso, public.suscripcion_push, public.tarea, public.recordatorio, public.recibo,
  public.pago_recibo, public.seguimiento, public.etiqueta, public.meta, public.registro
  to service_role;

-- lo único que cambia: fechas del último envío y la próxima fecha de cada recordatorio
grant update (fecha_ultimo_resumen_diario, fecha_ultimo_resumen_semanal, fecha_ultimo_cierre_mes) on public.preferencia_aviso to service_role;
grant update (fecha_ultimo_envio) on public.suscripcion_push to service_role;
grant update (fecha_proximo_envio, estado) on public.recordatorio to service_role;
