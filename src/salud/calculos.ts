// Cuentas del módulo Salud (Gym y Cuerpo), tomadas del bot anterior. Fechas 'AAAA-MM-DD'; las sesiones
// llegan de la más reciente a la más antigua, así el último registro del día es el primero.
import { normalizar } from '../finanzas/parseo'
import { formatoValor } from '../indicadores'

// unidad: en la que se escribió la serie; vacía en las anteriores, que se ven en la unidad del ejercicio
// cardio: minutos (y km si se anotaron), con series y repeticiones en 0
export interface Sesion { fecha: string; ejercicio: string; series: number; repeticiones: number; peso: number | null; unidad?: Unidad | null; minutos?: number | null; km?: number | null }
export interface Medicion { fecha: string; valor: number }

const NUMERO = String.raw`\d+(?:[.,]\d+)?`
const aNumero = (texto: string) => Number(texto.replace(',', '.'))
const DIA_MS = 864e5
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS)
export const restarDias = (fecha: string, dias: number) => new Date(Date.parse(fecha) - dias * DIA_MS).toISOString().slice(0, 10)
const masReciente = <T extends { fecha: string }>(a: T, b: T) => b.fecha.localeCompare(a.fecha)

export type Unidad = 'kg' | 'lb'
const KG_POR_LB = 0.45359237
// Lo escrito en la unidad del ejercicio pasa a kg con 2 decimales, que es como se guarda.
export const aKg = (valor: number, unidad: Unidad = 'kg') => unidad === 'lb' ? Math.round(valor * KG_POR_LB * 100) / 100 : valor
// Los kg guardados, en la unidad del ejercicio; las libras a 1 decimal para que 45 lb vuelva como 45.
export const enUnidad = (kilos: number, unidad: Unidad = 'kg') => unidad === 'lb' ? Math.round(kilos / KG_POR_LB * 10) / 10 : kilos
// Lo que sube el peso con − y +, y lo que propone la sugerencia.
export const pasoDe = (unidad: Unidad) => unidad === 'lb' ? 5 : 2.5

export const PARTES = {
  pecho: 'Pecho', espalda: 'Espalda', hombros: 'Hombros', biceps: 'Bíceps', triceps: 'Tríceps',
  abdomen: 'Abdomen', piernas: 'Piernas', gluteos: 'Glúteos', pantorrillas: 'Pantorrillas', cardio: 'Cardio',
} as const
export type Parte = keyof typeof PARTES
// Del más específico al más general: "press francés" es tríceps antes que "press" sea pecho, "curl femoral" es piernas antes que bíceps.
const PISTAS: [Parte, RegExp][] = [
  ['cardio', /cardio|caminadora|trotadora|bicicleta|eliptica|trote|correr|escaladora|escalera|cinta|spinning|remo ergometro|caminar/],
  ['pantorrillas', /pantorrilla|gemelo|talon/],
  ['triceps', /tricep|frances|copa|rompecraneo/],
  ['gluteos', /gluteo|hip thrust|patada|puente/],
  ['abdomen', /abdom|crunch|plancha|oblicuo/],
  ['hombros', /hombro|militar|lateral|elevacion|deltoid|arnold|encogimiento/],
  ['piernas', /pierna|isquio|sentadilla|prensa|zancada|femoral|cuadricep|peso muerto|extension|abductor|aductor|desplante/],
  ['espalda', /espalda|remo|dominada|jalon|pull|dorsal/],
  ['biceps', /bicep|curl|martillo|predicador/],
  ['pecho', /pecho|banca|press|apertura|fondo|flexion|pec/],
]
// La parte del cuerpo que sugiere el nombre de un ejercicio; null si no se reconoce.
export const parteDe = (nombre: string): Parte | null => PISTAS.find(([, pista]) => pista.test(normalizar(nombre)))?.[0] ?? null

// Cada campo del formulario por separado, el peso en la unidad del ejercicio; vacío = propio cuerpo ("60", "82,5 kg", "45 lb"). El peso sale en kg. null si algo no se entiende o se sale de rango.
export function leerSerie(ejercicio: string, series: string, repeticiones: string, peso: string, unidad: Unidad = 'kg'): Omit<Sesion, 'fecha'> | null {
  const nombre = normalizar(ejercicio)
  const entero = (texto: string) => /^\d+$/.test(texto.trim()) ? Number(texto) : NaN
  const kilos = peso.trim().match(new RegExp(String.raw`^(${NUMERO})\s*(?:${unidad})?$`, 'i'))
  const s = { ejercicio: nombre, series: entero(series), repeticiones: entero(repeticiones), peso: peso.trim() ? (kilos ? aKg(aNumero(kilos[1]), unidad) : NaN) : null }
  if (!nombre || nombre.length > 60 || !(s.series >= 1 && s.series <= 100) || !(s.repeticiones >= 1 && s.repeticiones <= 1000)) return null
  if (s.peso !== null && !(s.peso > 0 && s.peso < 1e4)) return null
  return s
}

export const anteriorDe = (sesiones: Sesion[], ejercicio: string) =>
  sesiones.filter(s => s.ejercicio === ejercicio).sort(masReciente)[0] ?? null

// Dos sesiones seguidas iguales: subir 2,5 kg o 5 lb (o una repetición si es sin peso).
export function sugerencia(nuevo: Omit<Sesion, 'fecha'>, sesiones: Sesion[], unidad: Unidad = 'kg'): string | null {
  const a = anteriorDe(sesiones, nuevo.ejercicio)
  if (!a || a.series !== nuevo.series || a.repeticiones !== nuevo.repeticiones || a.peso !== nuevo.peso) return null
  return nuevo.peso === null
    ? `Dos sesiones iguales: prueba ${nuevo.series}x${nuevo.repeticiones + 1} la próxima.`
    : `Dos sesiones iguales con ${kg(nuevo.peso, unidad)}: prueba ${kg(aKg(enUnidad(nuevo.peso, unidad) + pasoDe(unidad), unidad), unidad)} la próxima.`
}

export const conSigno = (v: number, unidad: string | null) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatoValor('numero', Math.abs(Math.round(v * 100) / 100), unidad)}`
const numero = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 })
// Un peso guardado en kg, escrito en la unidad del ejercicio.
export const kg = (v: number, unidad: Unidad = 'kg') => `${numero(enUnidad(v, unidad))} ${unidad}`

function distancia(a: string, b: string): number {
  let fila = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const nueva = [i]
    for (let j = 1; j <= b.length; j++) nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    fila = nueva
  }
  return fila[b.length]
}

// Nombre conocido a 2 letras o menos de uno nuevo (solo nombres de 4 letras o más); null si es conocido o no hay.
export function parecido(nombre: string, conocidos: string[]): string | null {
  const n = normalizar(nombre)
  if (n.length < 4 || conocidos.includes(n)) return null
  let mejor: string | null = null, minimo = 3
  for (const c of conocidos) {
    const d = distancia(n, c)
    if (d < minimo) { minimo = d; mejor = c }
  }
  return mejor
}

// Últimas 5 sesiones, récord y cambio desde la primera con peso.
// Los nombres que contienen lo escrito: primero los que empiezan así, luego los más hechos. Sin el que ya está escrito completo.
export function coincidencias(texto: string, conocidos: string[], sesiones: Sesion[], maximo = 6) {
  const n = normalizar(texto)
  if (!n) return []
  const veces = new Map<string, number>()
  for (const s of sesiones) veces.set(s.ejercicio, (veces.get(s.ejercicio) ?? 0) + 1)
  const empieza = (c: string) => normalizar(c).startsWith(n) ? 0 : 1
  return conocidos
    .filter(c => normalizar(c) !== n && normalizar(c).includes(n))
    .sort((a, b) => empieza(a) - empieza(b) || (veces.get(b) ?? 0) - (veces.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, maximo)
}

export function progreso(sesiones: Sesion[], ejercicio: string) {
  const suyas = sesiones.filter(s => s.ejercicio === ejercicio).sort(masReciente)
  const conPeso = suyas.filter(s => s.peso !== null).map(s => s.peso!)
  return {
    ultimas: suyas.slice(0, 5),
    record: conPeso.length ? Math.max(...conPeso) : null,
    desdePrimera: conPeso.length > 1 ? conPeso[0] - conPeso[conPeso.length - 1] : null,
  }
}

// Botones − y + de un campo: suma el paso a lo escrito sin bajar del mínimo; 0 queda vacío (peso con tu cuerpo).
export function conPaso(texto: string, paso: number, minimo: number) {
  const nuevo = Math.max(minimo, (aNumero(texto.replace(/[^\d.,]/g, '')) || 0) + paso)
  return nuevo ? String(nuevo).replace('.', ',') : ''
}

// Varias series de un ejercicio en un renglón: "25, 10, 50 kg × 10" si solo cambió el peso; si no, una por una.
export function textoSeries(series: Omit<Sesion, 'fecha' | 'ejercicio'>[], unidad: Unidad = 'kg') {
  const [una] = series
  const u = una?.unidad ?? unidad
  const soloPeso = series.length > 1 && series.every(s => s.series === 1 && s.repeticiones === una.repeticiones && s.peso !== null && (s.unidad ?? unidad) === u)
  return soloPeso ? `${series.map(s => numero(enUnidad(s.peso!, u))).join(', ')} ${u} × ${una.repeticiones}` : series.map(s => textoSerie(s, unidad)).join(', ')
}

// Una serie como se lee en el gimnasio: "60 kg × 10"; las viejas que juntaban varias series, "4 × 10 · 60 kg".
export const textoSerie = (s: Omit<Sesion, 'fecha' | 'ejercicio'>, unidad: Unidad = 'kg') => s.minutos
  ? `${s.minutos} min${s.km ? ` · ${numero(s.km)} km` : ''}`
  : s.series === 1
  ? `${s.peso === null ? 'Tu cuerpo' : kg(s.peso, s.unidad ?? unidad)} × ${s.repeticiones}`
  : `${s.series} × ${s.repeticiones}${s.peso === null ? '' : ` · ${kg(s.peso, s.unidad ?? unidad)}`}`

// Las últimas n sesiones (días) de un ejercicio, la más reciente primero; las series de cada día en el orden en que se hicieron.
export function sesionesPorDia(sesiones: Sesion[], ejercicio: string, n = 3) {
  const dias = new Map<string, Sesion[]>()
  for (const s of sesiones.filter(x => x.ejercicio === ejercicio).sort(masReciente)) {
    if (!dias.has(s.fecha)) dias.set(s.fecha, [])
    dias.get(s.fecha)!.push(s)
  }
  return [...dias].slice(0, n).map(([fecha, lista]) => ({ fecha, series: [...lista].reverse() }))
}

// La última sesión para precargar el formulario: las series seguidas iguales van juntas en una fila ("4 × 10 · 60 kg").
export function seriesDeUltima(sesiones: Sesion[], ejercicio: string) {
  const [dia] = sesionesPorDia(sesiones, ejercicio, 1)
  const filas: { series: number; repeticiones: number; peso: number | null; unidad?: Unidad | null; minutos?: number | null; km?: number | null }[] = []
  for (const s of dia?.series ?? []) {
    const ultima = filas[filas.length - 1]
    if (ultima && !s.minutos && ultima.repeticiones === s.repeticiones && ultima.peso === s.peso) ultima.series += s.series
    else filas.push({ series: s.series, repeticiones: s.repeticiones, peso: s.peso, unidad: s.unidad, minutos: s.minutos, km: s.km })
  }
  return filas
}

// Mayor peso de cada día en un ejercicio desde una fecha.
export function pesoPorDia(sesiones: Sesion[], ejercicio: string, desde = ''): Medicion[] {
  const maximo = new Map<string, number>()
  for (const s of sesiones) if (s.ejercicio === ejercicio && s.peso !== null && s.fecha >= desde) maximo.set(s.fecha, Math.max(maximo.get(s.fecha) ?? 0, s.peso))
  return [...maximo].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, valor]) => ({ fecha, valor }))
}

// Índices de los días que superan todo lo anterior (cada récord nuevo).
export const indicesRecord = (puntos: Medicion[]) =>
  puntos.flatMap((p, i) => i && p.valor > Math.max(...puntos.slice(0, i).map(x => x.valor)) ? [i] : [])

// Cuánto cambió el mejor peso del primer al último día del período; null con menos de 2 días.
export const cambioPeso = (puntos: Medicion[]) => puntos.length > 1 ? puntos[puntos.length - 1].valor - puntos[0].valor : null

// Días con récord nuevo de cada ejercicio (un día puede repetirse si dos ejercicios marcan récord).
export function fechasDeRecord(sesiones: Sesion[]) {
  return [...new Set(sesiones.map(s => s.ejercicio))].flatMap(e => {
    const puntos = pesoPorDia(sesiones, e)
    return indicesRecord(puntos).map(i => puntos[i].fecha)
  })
}

// Últimas n semanas cerradas (lunes a domingo): récords por semana cuando se llegó a la meta de días y cuando no.
// Sin meta, el umbral es el promedio de días por semana de esas semanas.
export function recordsSegunMeta(sesiones: Sesion[], hoy: string, meta: number | null, n = 12) {
  const lunes = restarDias(hoy, (new Date(`${hoy}T12:00:00Z`).getUTCDay() || 7) - 1)
  const semanas = constancia(sesiones, 'mes', restarDias(lunes, 7 * n), restarDias(lunes, 1), hoy)
  const umbral = meta ?? Math.max(1, Math.round(semanas.reduce((t, g) => t + g.dias, 0) / semanas.length))
  const records = fechasDeRecord(sesiones)
  const grupo = (cumple: boolean) => {
    const elegidas = semanas.filter(g => (g.dias >= umbral) === cumple)
    const total = elegidas.reduce((t, g) => t + records.filter(f => f >= g.desde && f <= g.hasta).length, 0)
    return { semanas: elegidas.length, promedio: elegidas.length ? total / elegidas.length : 0 }
  }
  return { umbral, cumplidas: grupo(true), otras: grupo(false) }
}

export const diasEntrenados = (sesiones: Sesion[], hoy: string, dias = 30) =>
  new Set(sesiones.filter(s => diasEntre(s.fecha, hoy) < dias && s.fecha <= hoy).map(s => s.fecha)).size

// Medida nueva frente al último registro y al más reciente de hace 30 días o más.
export function comparar(valor: number, anteriores: Medicion[], hoy: string) {
  const orden = [...anteriores].sort(masReciente)
  const antes = orden.find(r => diasEntre(r.fecha, hoy) >= 30)
  return {
    ultimo: orden[0] ? { fecha: orden[0].fecha, cambio: valor - orden[0].valor } : null,
    hace30: antes ? { fecha: antes.fecha, cambio: valor - antes.valor } : null,
  }
}

// Cuánto falta para la meta en la dirección que se busca; 0 si ya se cumplió.
export const faltaParaMeta = (valor: number, meta: number, direccion: 'menos_es_mejor' | 'mas_es_mejor') =>
  Math.max(0, Math.round((direccion === 'menos_es_mejor' ? valor - meta : meta - valor) * 100) / 100)

// quedan: días que faltan del período sin contar hoy; mientras se pueda llegar a la meta no sale "fuera".
export const estadoSemana = (dias: number, meta: number, quedan = 0) => dias >= meta ? 'en_meta' : dias + quedan >= meta - 1 ? 'cerca' : 'fuera'

// Series hechas cada día del período (las viejas "4 × 10" cuentan 4); null en los días que no han llegado.
export function seriesPorDia(sesiones: Sesion[], desde: string, hasta: string, hoy: string) {
  const total = new Map<string, number>()
  for (const s of sesiones) total.set(s.fecha, (total.get(s.fecha) ?? 0) + s.series)
  return Array.from({ length: diasEntre(desde, hasta) + 1 }, (_, i) => restarDias(desde, -i))
    .map(fecha => ({ fecha, series: fecha > hoy ? null : total.get(fecha) ?? 0 }))
}

// Constancia de un período: por día (semana), por semana de lunes a domingo (mes) o por mes (año); futuro: el grupo aún no empieza.
export function constancia(sesiones: Sesion[], escala: 'semana' | 'mes' | 'ano', desde: string, hasta: string, hoy: string) {
  const dias = new Set(sesiones.map(s => s.fecha).filter(f => f <= hoy))
  const grupo = (d: string, h: string) => ({ desde: d, hasta: h, dias: [...dias].filter(f => f >= d && f <= h).length, futuro: d > hoy })
  if (escala === 'semana') return Array.from({ length: 7 }, (_, i) => restarDias(desde, -i)).map(d => grupo(d, d))
  if (escala === 'ano') return Array.from({ length: 12 }, (_, i) => {
    const d = `${desde.slice(0, 4)}-${String(i + 1).padStart(2, '0')}-01`
    return grupo(d, new Date(Date.UTC(Number(desde.slice(0, 4)), i + 1, 0)).toISOString().slice(0, 10))
  })
  const lunes = restarDias(desde, (new Date(`${desde}T12:00:00Z`).getUTCDay() || 7) - 1)
  return Array.from({ length: Math.ceil((diasEntre(lunes, hasta) + 1) / 7) }, (_, i) => restarDias(lunes, -7 * i)).map(d => grupo(d, restarDias(d, -6)))
}

// Series de cada parte del cuerpo en el rango, de mayor a menor; los ejercicios sin parte van con null.
export function seriesPorParte(sesiones: Sesion[], parteDeEjercicio: (ejercicio: string) => Parte | null, desde: string, hasta: string, hoy: string) {
  const total = new Map<Parte | null, number>()
  for (const s of sesiones) {
    if (s.fecha < desde || s.fecha > hasta || s.fecha > hoy) continue
    const parte = parteDeEjercicio(s.ejercicio)
    total.set(parte, (total.get(parte) ?? 0) + s.series)
  }
  return [...total].map(([parte, series]) => ({ parte, series })).sort((a, b) => b.series - a.series)
}

// Cardio: minutos de 1 a 600 y km opcionales (hasta 200), con coma o punto.
export function leerCardio(ejercicio: string, minutos: string, km: string): Omit<Sesion, 'fecha'> | null {
  const nombre = normalizar(ejercicio)
  const m = /^\d+$/.test(minutos.trim()) ? Number(minutos) : NaN
  const k = km.trim() ? aNumero(km.trim()) : null
  if (!nombre || nombre.length > 60 || !(m >= 1 && m <= 600) || (k !== null && !(k > 0 && k <= 200))) return null
  return { ejercicio: nombre, series: 0, repeticiones: 0, peso: null, minutos: m, km: k === null ? null : Math.round(k * 100) / 100 }
}

// Minutos de cardio en el rango.
export const minutosCardio = (sesiones: Sesion[], desde: string, hasta: string, hoy: string) =>
  sesiones.reduce((t, s) => t + (s.minutos && s.fecha >= desde && s.fecha <= hasta && s.fecha <= hoy ? s.minutos : 0), 0)

// Calorías aproximadas con MET × kg de la persona × horas. Pesas: MET 5 y 2,5 minutos por serie con su descanso.
// Cardio: MET según el tipo; sin peso anotado en Cuerpo se usan 70 kg y se dice.
const MET_PESAS = 5
const MINUTOS_POR_SERIE = 2.5
export const PESO_SUPUESTO = 70
const MET_CARDIO: [RegExp, number][] = [[/correr|trote|trotadora/, 9.8], [/escalera|escaladora/, 9], [/cinta|caminadora/, 8], [/bicicleta|spinning/, 7], [/eliptica/, 5]]
export const metDe = (ejercicio: string) => MET_CARDIO.find(([pista]) => pista.test(normalizar(ejercicio)))?.[1] ?? 6

export function calorias(sesiones: Sesion[], desde: string, hasta: string, hoy: string, pesoCorporal: number | null) {
  const kilos = pesoCorporal ?? PESO_SUPUESTO
  let pesas = 0, cardio = 0
  for (const s of sesiones) {
    if (s.fecha < desde || s.fecha > hasta || s.fecha > hoy) continue
    if (s.minutos) cardio += metDe(s.ejercicio) * kilos * s.minutos / 60
    else pesas += MET_PESAS * kilos * s.series * MINUTOS_POR_SERIE / 60
  }
  return { pesas: Math.round(pesas), cardio: Math.round(cardio), total: Math.round(pesas + cardio), supuesto: pesoCorporal === null }
}

// Calorías de cada tramo (un día, o un mes en el año); los tramos que aún no llegan van en null.
export const caloriasEnTramos = (sesiones: Sesion[], tramos: { desde: string; hasta: string }[], hoy: string, pesoCorporal: number | null) =>
  tramos.map(t => t.desde > hoy ? null : calorias(sesiones, t.desde, t.hasta, hoy, pesoCorporal))

// Cambio en % frente a antes; sin nada antes no hay con qué comparar.
export const cambioPorcentual = (actual: number, antes: number) => antes > 0 ? Math.round((actual - antes) / antes * 100) : null

// "Si sigues así", mirando las 4 semanas completas anteriores: tendencia, nunca una cifra de músculo.
// constancia: menos de 3 de 4 semanas con la meta de días (3 si no hay meta); crece: además sube el peso en la mayoría de sus ejercicios; quieto: constante pero sin subir.
export function siSigues(sesiones: Sesion[], hoy: string, metaDias?: number): 'crece' | 'quieto' | 'constancia' | null {
  const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay()
  const lunes = restarDias(hoy, (dia + 6) % 7)
  const desde = restarDias(lunes, 28)
  const delMes = sesiones.filter(s => s.fecha >= desde && s.fecha < lunes)
  if (!delMes.length) return null
  const meta = metaDias ?? 3
  const cumplidas = [0, 1, 2, 3].filter(i => {
    const ini = restarDias(lunes, 28 - i * 7), fin = restarDias(lunes, 21 - i * 7)
    return new Set(delMes.filter(s => s.fecha >= ini && s.fecha < fin).map(s => s.fecha)).size >= meta
  }).length
  if (cumplidas < 3) return 'constancia'
  const cambios = [...new Set(delMes.map(s => s.ejercicio))].map(e => cambioPeso(pesoPorDia(delMes, e))).filter((c): c is number => c !== null)
  return cambios.length && cambios.filter(c => c > 0).length > cambios.length / 2 ? 'crece' : 'quieto'
}
