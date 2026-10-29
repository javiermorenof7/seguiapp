// Cuentas del módulo Salud (Gym y Cuerpo), tomadas del bot anterior. Fechas 'AAAA-MM-DD'; las sesiones
// llegan de la más reciente a la más antigua, así el último registro del día es el primero.
import { normalizar } from '../finanzas/parseo'
import { formatoValor } from '../indicadores'

export interface Sesion { fecha: string; ejercicio: string; series: number; repeticiones: number; peso: number | null }
export interface Medicion { fecha: string; valor: number }

const NUMERO = String.raw`\d+(?:[.,]\d+)?`
const aNumero = (texto: string) => Number(texto.replace(',', '.'))
const DIA_MS = 864e5
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS)
export const restarDias = (fecha: string, dias: number) => new Date(Date.parse(fecha) - dias * DIA_MS).toISOString().slice(0, 10)
const masReciente = <T extends { fecha: string }>(a: T, b: T) => b.fecha.localeCompare(a.fecha)

// Cada campo del formulario por separado; peso vacío = propio cuerpo ("60", "82,5 kg"). null si algo no se entiende o se sale de rango.
export function leerSerie(ejercicio: string, series: string, repeticiones: string, peso: string): Omit<Sesion, 'fecha'> | null {
  const nombre = normalizar(ejercicio)
  const entero = (texto: string) => /^\d+$/.test(texto.trim()) ? Number(texto) : NaN
  const kilos = peso.trim().match(new RegExp(String.raw`^(${NUMERO})\s*(?:kg)?$`, 'i'))
  const s = { ejercicio: nombre, series: entero(series), repeticiones: entero(repeticiones), peso: peso.trim() ? (kilos ? aNumero(kilos[1]) : NaN) : null }
  if (!nombre || nombre.length > 60 || !(s.series >= 1 && s.series <= 100) || !(s.repeticiones >= 1 && s.repeticiones <= 1000)) return null
  if (s.peso !== null && !(s.peso > 0 && s.peso < 1e4)) return null
  return s
}

export const anteriorDe = (sesiones: Sesion[], ejercicio: string) =>
  sesiones.filter(s => s.ejercicio === ejercicio).sort(masReciente)[0] ?? null

// Dos sesiones seguidas iguales: subir 2,5 kg (o una repetición si es sin peso).
export function sugerencia(nuevo: Omit<Sesion, 'fecha'>, sesiones: Sesion[]): string | null {
  const a = anteriorDe(sesiones, nuevo.ejercicio)
  if (!a || a.series !== nuevo.series || a.repeticiones !== nuevo.repeticiones || a.peso !== nuevo.peso) return null
  return nuevo.peso === null
    ? `Dos sesiones iguales: prueba ${nuevo.series}x${nuevo.repeticiones + 1} la próxima.`
    : `Dos sesiones iguales con ${kg(nuevo.peso)}: prueba ${kg(nuevo.peso + 2.5)} la próxima.`
}

export const conSigno = (v: number, unidad: string | null) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatoValor('numero', Math.abs(Math.round(v * 100) / 100), unidad)}`
export const kg = (v: number) => `${v.toLocaleString('es-CO', { maximumFractionDigits: 2 })} kg`

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
export function progreso(sesiones: Sesion[], ejercicio: string) {
  const suyas = sesiones.filter(s => s.ejercicio === ejercicio).sort(masReciente)
  const conPeso = suyas.filter(s => s.peso !== null).map(s => s.peso!)
  return {
    ultimas: suyas.slice(0, 5),
    record: conPeso.length ? Math.max(...conPeso) : null,
    desdePrimera: conPeso.length > 1 ? conPeso[0] - conPeso[conPeso.length - 1] : null,
  }
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

export const diasEntrenados = (sesiones: Sesion[], hoy: string, dias = 30) =>
  new Set(sesiones.filter(s => diasEntre(s.fecha, hoy) < dias && s.fecha <= hoy).map(s => s.fecha)).size

// Días entrenados en cada una de las últimas n semanas de lunes a domingo, la más antigua primero; la última es la que va.
export function diasPorSemana(sesiones: Sesion[], hoy: string, n = 8) {
  const lunes = restarDias(hoy, (new Date(`${hoy}T12:00:00Z`).getUTCDay() || 7) - 1)
  return Array.from({ length: n }, (_, i) => {
    const desde = restarDias(lunes, 7 * (n - 1 - i)), hasta = restarDias(desde, -6)
    return { desde, dias: new Set(sesiones.filter(s => s.fecha >= desde && s.fecha <= hasta).map(s => s.fecha)).size }
  })
}

// Medida nueva frente al último registro y al más reciente de hace 30 días o más.
export function comparar(valor: number, anteriores: Medicion[], hoy: string) {
  const orden = [...anteriores].sort(masReciente)
  const antes = orden.find(r => diasEntre(r.fecha, hoy) >= 30)
  return {
    ultimo: orden[0] ? { fecha: orden[0].fecha, cambio: valor - orden[0].valor } : null,
    hace30: antes ? { fecha: antes.fecha, cambio: valor - antes.valor } : null,
  }
}

// Meta de días por semana: la que puso la persona o, sin meta, su promedio de las semanas dadas (null si no entrenó).
export function metaSemanal(semanas: { dias: number }[], meta?: number | null) {
  if (meta) return { valor: meta, propia: true }
  const promedio = Math.round(semanas.reduce((t, s) => t + s.dias, 0) / (semanas.length || 1))
  return promedio ? { valor: promedio, propia: false } : null
}

// Cuánto falta para la meta en la dirección que se busca; 0 si ya se cumplió.
export const faltaParaMeta = (valor: number, meta: number, direccion: 'menos_es_mejor' | 'mas_es_mejor') =>
  Math.max(0, Math.round((direccion === 'menos_es_mejor' ? valor - meta : meta - valor) * 100) / 100)

export const estadoSemana = (dias: number, meta: number) => dias >= meta ? 'en_meta' : dias >= meta - 1 ? 'cerca' : 'fuera'
