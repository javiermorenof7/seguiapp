// Períodos del historial (semana de lunes a domingo, mes o año). Fechas 'AAAA-MM-DD'.
import type { Registro } from '../indicadores'

export type Escala = 'semana' | 'mes' | 'ano'
export interface Rango { desde: string; hasta: string; titulo: string }

const DIA_MS = 864e5
const fecha = (texto: string) => new Date(`${texto}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const sumarDias = (texto: string, n: number) => iso(new Date(fecha(texto).getTime() + n * DIA_MS))

export function rango(escala: Escala, ancla: string): Rango {
  const [a, m] = [Number(ancla.slice(0, 4)), Number(ancla.slice(5, 7))]
  if (escala === 'ano') return { desde: `${a}-01-01`, hasta: `${a}-12-31`, titulo: String(a) }
  if (escala === 'mes') {
    const desde = `${ancla.slice(0, 7)}-01`
    const titulo = fecha(desde).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    return { desde, hasta: iso(new Date(Date.UTC(a, m, 0))), titulo }
  }
  const desde = sumarDias(ancla, -((fecha(ancla).getUTCDay() + 6) % 7))
  return { desde, hasta: sumarDias(desde, 6), titulo: `Semana del ${desde.slice(8, 10)}/${desde.slice(5, 7)}` }
}

// El mismo día de la semana, mes o año n períodos antes o después (en mes y año, el día 1).
export function mover(escala: Escala, ancla: string, n: number): string {
  const [a, m] = [Number(ancla.slice(0, 4)), Number(ancla.slice(5, 7))]
  if (escala === 'semana') return sumarDias(ancla, 7 * n)
  if (escala === 'mes') return iso(new Date(Date.UTC(a, m - 1 + n, 1)))
  return `${a + n}-01-01`
}

// Un punto por día (semana y mes) o por mes (año): suma de valores o cantidad de registros.
// suma: total del día; conteo: cuántos (o lo que diga cuanto, p. ej. las series); maximo: el mayor valor, vacío (null) si ese día no hubo.
export type Modo = 'suma' | 'conteo' | 'maximo'
export interface Punto { fecha: string; valor: number | null }

export function agrupar<T extends Registro>(escala: Escala, r: Rango, registros: T[], modo: Modo | boolean, cuanto?: (x: T) => number): Punto[] {
  const m: Modo = modo === true ? 'suma' : modo === false ? 'conteo' : modo
  const clave = (f: string) => escala === 'ano' ? `${f.slice(0, 7)}-01` : f
  const totales = new Map<string, number | null>()
  for (let f = r.desde; f <= r.hasta; f = escala === 'ano' ? mover('mes', f, 1) : sumarDias(f, 1)) totales.set(f, m === 'maximo' ? null : 0)
  for (const x of registros) {
    const k = clave(x.fecha)
    if (!totales.has(k)) continue
    const antes = totales.get(k)!
    totales.set(k, m === 'maximo' ? Math.max(antes ?? -Infinity, x.valor) : antes! + (m === 'suma' ? x.valor : cuanto ? cuanto(x) : 1))
  }
  return [...totales].map(([fecha, valor]) => ({ fecha, valor }))
}

// Los días del mes en bloques de 7 (1–7, 8–14…): en el celular caben mejor que 30 grupos de barras.
export function porSemanas(puntos: Punto[], modo: Modo): (Punto & { etiqueta: string })[] {
  const bloques: (Punto & { etiqueta: string })[] = []
  for (let i = 0; i < puntos.length; i += 7) {
    const tramo = puntos.slice(i, i + 7)
    const valores = tramo.flatMap(p => p.valor === null ? [] : [p.valor])
    const valor = modo === 'maximo' ? (valores.length ? Math.max(...valores) : null) : valores.reduce((s, v) => s + v, 0)
    bloques.push({ fecha: tramo[0].fecha, valor, etiqueta: `${Number(tramo[0].fecha.slice(8))}–${Number(tramo[tramo.length - 1].fecha.slice(8))}` })
  }
  return bloques
}
