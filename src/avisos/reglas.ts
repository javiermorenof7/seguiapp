// Cuándo toca cada aviso y qué dice. Sin DOM: la usa la pantalla y la usará la función que envía. Hora de Colombia.
import { diaSemana, fechaColombia, sumarDias, type Recordatorio, type Repeticion } from '../tareas/calculos'

export interface PreferenciaAviso {
  estado: 'activo' | 'pausado'
  recibir_resumen_diario: boolean
  frecuencia_resumen_diario: 'diario' | 'habiles'
  hora_resumen_diario: string
  recibir_resumen_semanal: boolean
  dia_resumen_semanal: number
  hora_resumen_semanal: string
  recibir_cierre_mes: boolean
  hora_cierre_mes: string
  recibir_recordatorios: boolean
  tipos_recordatorio: Repeticion[]
  mostrar_descripcion: boolean
  recibir_aviso_descarga: boolean
  recibir_recordatorio_no_registrado: boolean
  modulos_recordatorio_apagados: ('gastos' | 'gym' | 'habitos')[]
  cantidad_maxima_recordatorios_dia: number
  hora_inicio_silencio: string
  hora_fin_silencio: string
  recibir_aviso_inactividad: boolean
  fecha_ultimo_resumen_diario: string | null
  fecha_ultimo_resumen_semanal: string | null
  fecha_ultimo_cierre_mes: string | null
  fecha_ultimo_aviso_descarga: string | null
}

export const TIPOS_RECORDATORIO: Repeticion[] = ['unico', 'diario', 'habiles', 'semanal', 'mensual']

// Lo que queda al activar por primera vez.
export const PREFERENCIA_INICIAL: PreferenciaAviso = {
  estado: 'activo',
  recibir_resumen_diario: true, frecuencia_resumen_diario: 'diario', hora_resumen_diario: '09:00',
  recibir_resumen_semanal: true, dia_resumen_semanal: 7, hora_resumen_semanal: '19:00',
  recibir_cierre_mes: true, hora_cierre_mes: '20:00',
  recibir_recordatorios: true, tipos_recordatorio: TIPOS_RECORDATORIO,
  mostrar_descripcion: false,
  recibir_aviso_descarga: true,
  recibir_recordatorio_no_registrado: true, modulos_recordatorio_apagados: [], cantidad_maxima_recordatorios_dia: 2,
  hora_inicio_silencio: '22:00', hora_fin_silencio: '06:00', recibir_aviso_inactividad: true,
  fecha_ultimo_resumen_diario: null, fecha_ultimo_resumen_semanal: null, fecha_ultimo_cierre_mes: null, fecha_ultimo_aviso_descarga: null,
}

export interface Momento { fecha: string; hora: string; dia: number }
export const momentoColombia = (ahora: Date): Momento => {
  const fecha = fechaColombia(ahora)
  const hora = new Date(ahora.getTime() - 5 * 3600000).toISOString().slice(11, 16)
  return { fecha, hora, dia: diaSemana(fecha) }
}
const yaEsHora = (m: Momento, hora: string) => m.hora >= hora.slice(0, 5)

// Si la tarea programada estuvo detenida, sale una vez al volver (mientras sea el mismo día).
export function tocaResumenDiario(p: PreferenciaAviso, m: Momento) {
  return p.estado === 'activo' && p.recibir_resumen_diario && (p.frecuencia_resumen_diario === 'diario' || m.dia <= 5)
    && yaEsHora(m, p.hora_resumen_diario) && p.fecha_ultimo_resumen_diario !== m.fecha
}

export function tocaResumenSemanal(p: PreferenciaAviso, m: Momento) {
  return p.estado === 'activo' && p.recibir_resumen_semanal && m.dia === p.dia_resumen_semanal
    && yaEsHora(m, p.hora_resumen_semanal) && p.fecha_ultimo_resumen_semanal !== m.fecha
}

export function tocaCierreMes(p: PreferenciaAviso, m: Momento) {
  const ultimoDia = sumarDias(m.fecha, 1).slice(8, 10) === '01'
  return p.estado === 'activo' && p.recibir_cierre_mes && ultimoDia && yaEsHora(m, p.hora_cierre_mes) && p.fecha_ultimo_cierre_mes !== m.fecha
}

// El día 1, a la hora del resumen diario.
export function tocaAvisoDescarga(p: PreferenciaAviso, m: Momento) {
  return p.estado === 'activo' && p.recibir_aviso_descarga && m.fecha.endsWith('-01')
    && yaEsHora(m, p.hora_resumen_diario) && p.fecha_ultimo_aviso_descarga !== m.fecha
}

export const avisaRecordatorio = (p: PreferenciaAviso, r: Pick<Recordatorio, 'tipo_repeticion'>) =>
  p.estado === 'activo' && p.recibir_recordatorios && p.tipos_recordatorio.includes(r.tipo_repeticion)

export interface Aviso { titulo: string; cuerpo: string; abrir: string }

// En la pantalla de bloqueo cualquiera lo lee: por defecto no dice de qué se trata. Nunca lleva montos.
export const avisoRecordatorio = (p: PreferenciaAviso, r: Pick<Recordatorio, 'descripcion'>): Aviso => ({
  titulo: 'Recordatorio', cuerpo: p.mostrar_descripcion ? r.descripcion : 'Tienes un recordatorio. Ábrelo para verlo.', abrir: '/?ir=tareas',
})

export interface ConteoDia { tareas: number; recordatorios: number; facturas: number; metasAtrasadas: number }
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export function avisoResumenDiario(c: ConteoDia): Aviso {
  const partes = [
    c.tareas && plural(c.tareas, 'tarea', 'tareas'),
    c.recordatorios && plural(c.recordatorios, 'recordatorio', 'recordatorios'),
    c.facturas && plural(c.facturas, 'factura por pagar', 'facturas por pagar'),
    c.metasAtrasadas && plural(c.metasAtrasadas, 'meta atrasada', 'metas atrasadas'),
  ].filter(Boolean)
  return { titulo: 'Tu día', cuerpo: partes.length ? `Hoy: ${partes.join(', ')}.` : 'Hoy no tienes pendientes. Buen día.', abrir: '/' }
}

export const avisoResumenSemanal = (aTiempo: number, total: number): Aviso => ({
  titulo: 'Tu semana',
  cuerpo: total ? `Hiciste a tiempo ${aTiempo} de ${total} ${total === 1 ? 'tarea' : 'tareas'} con fecha. Mira cómo te fue.` : 'Mira cómo te fue esta semana.',
  abrir: '/',
})

export const AVISO_CIERRE_MES: Aviso = { titulo: 'Cierre de mes', cuerpo: 'Revisa cómo te fue este mes en tus finanzas.', abrir: '/?ir=finanzas' }
export const AVISO_PRUEBA: Aviso = { titulo: 'seguiapp', cuerpo: 'Así te llegarán los avisos en este equipo.', abrir: '/' }
export const AVISO_DESCARGA: Aviso = { titulo: 'Tus datos', cuerpo: 'Descarga una copia de tus datos de este mes.', abrir: '/?ir=misdatos' }
// Solo al administrador; sin el texto del mensaje.
export const avisoMensajesNuevos = (n: number): Aviso =>
  ({ titulo: 'Contacto', cuerpo: n === 1 ? 'Tienes un mensaje nuevo.' : `Tienes ${n} mensajes nuevos.`, abrir: '/?ir=administrar' })
