// Recordatorios que aprenden: el ritmo de cada módulo sale de los registros de la persona (días y hora en que suele anotar).
// Fechas 'AAAA-MM-DD' y horas 'HH:MM' en hora de Colombia. Las mismas reglas las usa la función que envía.
import type { Aviso, Momento } from './reglas'

export type Modulo = 'gastos' | 'gym' | 'habitos'
export const MODULOS: Modulo[] = ['gastos', 'gym', 'habitos']
// Cuándo se anotó algo (la fecha del registro y la hora en que se creó).
export interface Marca { fecha: string; hora: string }
export interface Ritmo { dias: number[]; hora: string; aprendido: boolean }

// De qué módulo es un seguimiento (solo los que tienen recordatorio).
export const moduloDe = (s: { codigo_plantilla: string | null; nombre: string }): Modulo | null =>
  s.codigo_plantilla === 'gym' ? 'gym' : s.codigo_plantilla === 'habitos' ? 'habitos' : s.codigo_plantilla === 'finanzas' && s.nombre === 'Gastos' ? 'gastos' : null
// La hora de Colombia (UTC−5, sin horario de verano) en que se creó un registro.
export const horaColombia = (momento: string) => new Date(Date.parse(momento) - 5 * 3600000).toISOString().slice(11, 16)

const TODOS = [1, 2, 3, 4, 5, 6, 7]
// Sin datos suficientes: gastos y hábitos todos los días a una hora tranquila; el gym no se adivina.
const POR_DEFECTO: Record<Modulo, Ritmo> = {
  gastos: { dias: TODOS, hora: '21:00', aprendido: false },
  gym: { dias: [], hora: '10:00', aprendido: false },
  habitos: { dias: TODOS, hora: '20:30', aprendido: false },
}
const DIA_MS = 864e5
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS)
const diaSemana = (fecha: string) => (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7 + 1
const aMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5))
const aHora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// Últimas 8 semanas: un día de la semana entra si se anotó en al menos la mitad de esas semanas;
// la hora es la mediana de cuando suele anotar más una hora de margen (en cuartos de hora, hasta las 22:00).
export function ritmo(modulo: Modulo, marcas: Marca[], hoy: string): Ritmo {
  const recientes = marcas.filter(x => x.fecha <= hoy && diasEntre(x.fecha, hoy) < 56)
  const dias = new Set(recientes.map(x => x.fecha))
  if (dias.size < 6) return POR_DEFECTO[modulo]
  const semanasPorDia = new Map<number, Set<number>>()
  for (const f of dias) {
    const d = diaSemana(f)
    if (!semanasPorDia.has(d)) semanasPorDia.set(d, new Set())
    semanasPorDia.get(d)!.add(Math.floor(diasEntre(f, hoy) / 7))
  }
  const suyos = TODOS.filter(d => (semanasPorDia.get(d)?.size ?? 0) >= 4)
  const hora = Math.min(22 * 60, Math.round((mediana(recientes.map(x => aMinutos(x.hora))) + 60) / 15) * 15)
  return { dias: suyos, hora: aHora(hora), aprendido: true }
}

// Un módulo que no se usa hace 30 días no se recuerda: no se regaña por lo que se dejó.
export const sinUso = (marcas: Marca[], hoy: string) => !marcas.some(x => x.fecha <= hoy && diasEntre(x.fecha, hoy) < 30)

export function enSilencio(m: Momento, inicio: string, fin: string) {
  const [h, i, f] = [m.hora, inicio.slice(0, 5), fin.slice(0, 5)]
  return i <= f ? h >= i && h < f : h >= i || h < f
}

// Avisos seguidos de un módulo que no tuvieron respuesta (ese día no se anotó nada), del más reciente hacia atrás.
export function ignorados(enviados: string[], fechasConRegistro: Set<string>) {
  let n = 0
  for (const f of [...enviados].sort().reverse()) {
    if (fechasConRegistro.has(f)) break
    n++
  }
  return n
}

// Toca si hoy es uno de sus días, ya pasó su hora, no ha anotado y no se le avisó hoy.
// Si ignora 3 seguidos, solo cada 2 días; con 6, ya no (queda el resumen semanal) hasta que vuelva a anotar.
export function tocaRecordatorio(r: Ritmo, m: Momento, registradoHoy: boolean, enviados: string[], fechasConRegistro: Set<string>) {
  if (!r.dias.includes(m.dia) || registradoHoy || m.hora < r.hora || enviados.includes(m.fecha)) return false
  const n = ignorados(enviados, fechasConRegistro)
  if (n >= 6) return false
  const ultimo = [...enviados].sort().pop()
  return !(n >= 3 && ultimo && diasEntre(ultimo, m.fecha) < 2)
}

// Umbral de inactividad aprendido: el doble del espacio normal entre días con registros (entre 3 y 14 días; 3 sin datos).
export function umbralInactividad(fechas: string[]) {
  const dias = [...new Set(fechas)].sort().slice(-30)
  if (dias.length < 5) return 3
  const espacios = dias.slice(1).map((f, i) => diasEntre(dias[i], f))
  return Math.min(14, Math.max(3, Math.ceil(mediana(espacios) * 2)))
}

// Escalera corta: al pasar el umbral, una semana después y dos semanas después; luego silencio hasta que vuelva a anotar.
export function tocaInactividad(fechas: string[], enviados: string[], hoy: string) {
  const ultima = [...fechas].filter(f => f <= hoy).sort().pop()
  if (!ultima) return null
  const umbral = umbralInactividad(fechas)
  const sin = diasEntre(ultima, hoy)
  const desde = enviados.filter(f => f > ultima)
  if (sin < umbral || desde.length >= 3 || desde.includes(hoy) || sin < umbral + 7 * desde.length) return null
  return { paso: desde.length + 1, dias: sin, umbral }
}

export const inactivo = (fechas: string[], hoy: string) => {
  const ultima = [...fechas].filter(f => f <= hoy).sort().pop()
  return !!ultima && diasEntre(ultima, hoy) >= umbralInactividad(fechas)
}

// Textos sin montos ni nombres; si coinciden varios módulos van en un solo aviso.
const UNO: Record<Modulo, Aviso> = {
  gastos: { titulo: 'Gastos de hoy', cuerpo: '¿Gastaste algo hoy? Anótalo antes de dormir.', abrir: '/?ir=gasto' },
  gym: { titulo: 'Gym', cuerpo: 'Hoy sueles entrenar. ¿Anotas tus series?', abrir: '/?ir=gym' },
  habitos: { titulo: 'Hábitos', cuerpo: 'Te faltan hábitos de hoy. Aún estás a tiempo.', abrir: '/?ir=habitos' },
}
const NOMBRE: Record<Modulo, string> = { gastos: 'tus gastos', gym: 'tu gym', habitos: 'tus hábitos' }
export function avisoRegistro(pendientes: Modulo[]): Aviso {
  if (pendientes.length === 1) return UNO[pendientes[0]]
  const nombres = pendientes.map(p => NOMBRE[p])
  return { titulo: 'Te falta anotar', cuerpo: `Te falta anotar ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]} de hoy.`, abrir: '/' }
}
export const avisoInactividad = (paso: number, dias: number): Aviso => ({
  titulo: 'seguiapp',
  cuerpo: paso === 1 ? `Hace ${dias} días no anotas nada. ¿Registramos lo de hoy?`
    : paso === 2 ? `Llevas ${dias} días sin registrar. Con un minuto te pones al día.`
    : 'Cuando quieras retomar, tu seguimiento sigue aquí.',
  abrir: '/',
})

// "Por qué me llega": la regla de cada módulo en una línea, para la pantalla Avisos.
const doceHoras = (hora: string) => {
  const [h, m] = [Number(hora.slice(0, 2)), hora.slice(3, 5)]
  return `${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`
}
const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos']
export function porQue(modulo: Modulo, r: Ritmo) {
  const cosa = { gastos: 'gastos', gym: 'el gym', habitos: 'tus hábitos' }[modulo]
  if (!r.dias.length) return modulo === 'gym' ? 'Aún aprendo tus días de gym: te aviso cuando los vea.' : `Aún no sé cuándo anotas ${cosa}.`
  const dias = r.dias.length === 7 ? 'todos los días' : `los ${r.dias.map(d => NOMBRES_DIA[d - 1]).join(', ')}`
  return r.aprendido ? `Sueles anotar ${cosa} ${dias}; te aviso si a las ${doceHoras(r.hora)} no lo has hecho.`
    : `Aún aprendo tu ritmo: por ahora te aviso a las ${doceHoras(r.hora)} si no anotaste ${cosa}.`
}
