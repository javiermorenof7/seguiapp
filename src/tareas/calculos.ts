// Tareas y recordatorios. Fechas 'AAAA-MM-DD' en hora de Colombia (UTC−5, sin horario de verano); horas 'HH:MM'.

export interface Tarea {
  id_tarea: string
  descripcion: string
  fecha_limite: string | null
  fecha_realizacion: string | null
  estado: 'pendiente' | 'hecho'
}

export type Repeticion = 'unico' | 'diario' | 'semanal' | 'mensual' | 'habiles'
export interface Recordatorio {
  id_recordatorio: string
  descripcion: string
  hora_envio: string
  tipo_repeticion: Repeticion
  dias_semana: number[] | null
  dia_mes: number | null
  fecha_proximo_envio: string | null
  estado: 'activo' | 'pausado' | 'terminado'
}

const DESFASE = 5 * 3600000
const MAX_DIAS = 400

// Fecha de Colombia de un instante (timestamptz o Date).
export const fechaColombia = (instante: string | Date) => new Date(new Date(instante).getTime() - DESFASE).toISOString().slice(0, 10)
export const instanteColombia = (fecha: string, hora: string) => new Date(`${fecha}T${hora.slice(0, 5)}:00-05:00`).toISOString()
export const sumarDias = (fecha: string, n: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
// 1 = lunes … 7 = domingo (ISO), como dias_semana
export const diaSemana = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7

function toca(r: Pick<Recordatorio, 'tipo_repeticion' | 'dias_semana' | 'dia_mes'>, fecha: string) {
  const dia = diaSemana(fecha)
  if (r.tipo_repeticion === 'diario') return true
  if (r.tipo_repeticion === 'habiles') return dia <= 5
  if (r.tipo_repeticion === 'semanal') return !!r.dias_semana?.includes(dia)
  if (r.tipo_repeticion === 'mensual') {
    const ultimo = new Date(Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7), 0)).getUTCDate()
    return +fecha.slice(8, 10) === Math.min(r.dia_mes ?? 1, ultimo)
  }
  return false
}

// Primer día que toca desde "fecha" (incluida); null si no hay en un año.
export function siguienteFecha(r: Pick<Recordatorio, 'tipo_repeticion' | 'dias_semana' | 'dia_mes'>, fecha: string) {
  for (let i = 0; i < MAX_DIAS; i++) {
    const f = sumarDias(fecha, i)
    if (toca(r, f)) return f
  }
  return null
}

// Al crear o reanudar: el próximo envío que aún no pasó. El único usa su propia fecha y, si ya pasó, no envía.
export function proximoEnvio(r: Pick<Recordatorio, 'tipo_repeticion' | 'dias_semana' | 'dia_mes' | 'hora_envio'>, ahora: Date, fechaUnico?: string) {
  if (r.tipo_repeticion === 'unico') {
    const instante = fechaUnico ? instanteColombia(fechaUnico, r.hora_envio) : null
    return instante && Date.parse(instante) > ahora.getTime() ? instante : null
  }
  const hoy = fechaColombia(ahora)
  const primera = siguienteFecha(r, hoy)
  if (!primera) return null
  const instante = instanteColombia(primera, r.hora_envio)
  if (Date.parse(instante) > ahora.getTime()) return instante
  const otra = siguienteFecha(r, sumarDias(primera, 1))
  return otra ? instanteColombia(otra, r.hora_envio) : null
}

// "Listo": pasa al día siguiente que toque después del envío actual (o de hoy, si estaba atrasado). El único termina.
export function despuesDeListo(r: Recordatorio, ahora: Date): { fecha_proximo_envio: string | null; estado: Recordatorio['estado'] } {
  if (r.tipo_repeticion === 'unico' || !r.fecha_proximo_envio) return { fecha_proximo_envio: null, estado: 'terminado' }
  const base = [fechaColombia(r.fecha_proximo_envio), fechaColombia(ahora)].sort()[1]
  const otra = siguienteFecha(r, sumarDias(base, 1))
  return otra ? { fecha_proximo_envio: instanteColombia(otra, r.hora_envio), estado: 'activo' } : { fecha_proximo_envio: null, estado: 'terminado' }
}

// Hoy: vencidas, de hoy y sin fecha (las hechas hoy se ven tachadas) y los recordatorios de hoy o atrasados.
export function deHoy(tareas: Tarea[], recordatorios: Recordatorio[], hoy: string) {
  const pendientes = tareas.filter(t => t.estado === 'pendiente' && (!t.fecha_limite || t.fecha_limite <= hoy))
  const orden = (t: Tarea) => t.fecha_limite ?? '9999'
  return {
    vencidas: pendientes.filter(t => t.fecha_limite && t.fecha_limite < hoy).sort((a, b) => orden(a).localeCompare(orden(b))),
    deHoy: pendientes.filter(t => t.fecha_limite === hoy),
    sinFecha: pendientes.filter(t => !t.fecha_limite),
    hechasHoy: tareas.filter(t => t.estado === 'hecho' && t.fecha_realizacion && fechaColombia(t.fecha_realizacion) === hoy),
    recordatorios: recordatorios.filter(r => r.estado === 'activo' && r.fecha_proximo_envio && fechaColombia(r.fecha_proximo_envio) <= hoy)
      .sort((a, b) => a.fecha_proximo_envio!.localeCompare(b.fecha_proximo_envio!)),
  }
}

// Semana de lunes a domingo: tareas con fecha en la semana y cuántas se hicieron a tiempo.
export function aTiempoSemana(tareas: Tarea[], hoy: string) {
  const lunes = sumarDias(hoy, 1 - diaSemana(hoy))
  const domingo = sumarDias(lunes, 6)
  const conFecha = tareas.filter(t => t.fecha_limite && t.fecha_limite >= lunes && t.fecha_limite <= domingo)
  const aTiempo = conFecha.filter(t => t.estado === 'hecho' && t.fecha_realizacion && fechaColombia(t.fecha_realizacion) <= t.fecha_limite!)
  return { aTiempo: aTiempo.length, total: conFecha.length }
}

// Las últimas n semanas de lunes a domingo: tareas con fecha límite ya cumplida, hechas a tiempo o tarde (o sin hacer).
export function aTiempoPorSemana(tareas: Tarea[], hoy: string, n = 8) {
  const lunes = sumarDias(hoy, 1 - diaSemana(hoy))
  return Array.from({ length: n }, (_, i) => {
    const desde = sumarDias(lunes, -7 * (n - 1 - i)), hasta = sumarDias(desde, 6)
    const vencen = tareas.filter(t => t.fecha_limite && t.fecha_limite >= desde && t.fecha_limite <= hasta)
    const aTiempo = vencen.filter(t => t.estado === 'hecho' && t.fecha_realizacion && fechaColombia(t.fecha_realizacion) <= t.fecha_limite!).length
    // las pendientes que aún no vencen no cuentan todavía
    const tarde = vencen.filter(t => t.fecha_limite! < hoy || t.estado === 'hecho').length - aTiempo
    return { desde, aTiempo, tarde }
  })
}
