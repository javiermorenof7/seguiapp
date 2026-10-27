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
export function agrupar(escala: Escala, r: Rango, registros: Registro[], suma: boolean): Registro[] {
  const clave = (f: string) => escala === 'ano' ? `${f.slice(0, 7)}-01` : f
  const totales = new Map<string, number>()
  for (let f = r.desde; f <= r.hasta; f = escala === 'ano' ? mover('mes', f, 1) : sumarDias(f, 1)) totales.set(f, 0)
  for (const x of registros) {
    const k = clave(x.fecha)
    if (totales.has(k)) totales.set(k, totales.get(k)! + (suma ? x.valor : 1))
  }
  return [...totales].map(([fecha, valor]) => ({ fecha, valor }))
}
