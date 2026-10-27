// Cuentas del módulo Hábitos, tomadas del bot anterior. Fechas 'AAAA-MM-DD'; cada hábito es un seguimiento
// sí/no (valor 1) o de cantidad, y lo de un mismo día se suma.
import { normalizar } from '../finanzas/parseo'
import { restarDias } from '../salud/calculos'

export interface Marca { fecha: string; valor: number }
export interface Leido { habito: string; valor: number | null; unidad: string; fecha: string }

const NUMERO = String.raw`\d+(?:[.,]\d+)?`
const DIA_MS = 864e5
// Los nombres se comparan sin mayúsculas ni tildes: "Leer" y "leer" son el mismo hábito.
export const mismoNombre = (a: string, b: string) => normalizar(a) === normalizar(b)
export const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`
// La cantidad como se escriba ("2", "2,5", "2 litros"); null si no se entiende o se sale de rango.
export function leerCantidad(texto: string): { valor: number; unidad: string } | null {
  const m = texto.trim().match(new RegExp(String.raw`^(${NUMERO})\s*(\p{L}*)$`, 'u'))
  const valor = m ? Number(m[1].replace(',', '.')) : NaN
  return valor > 0 && valor < 1e6 ? { valor, unidad: m![2].toLowerCase() } : null
}

const porDia = (marcas: Marca[]) => {
  const suma = new Map<string, number>()
  for (const r of marcas) suma.set(r.fecha, (suma.get(r.fecha) ?? 0) + r.valor)
  return suma
}

// Días que cuentan: con registro, o llegando a la meta diaria si la tiene.
export function diasCumplidos(marcas: Marca[], meta?: number | null): Set<string> {
  return new Set([...porDia(marcas)].filter(([, v]) => v >= (meta ?? Number.MIN_VALUE)).map(([d]) => d))
}

export const totalDelDia = (marcas: Marca[], fecha: string) => porDia(marcas).get(fecha) ?? 0

// Días seguidos cumplidos hasta hoy; si hoy aún no, la racha sigue viva hasta ayer.
export function racha(marcas: Marca[], hoy: string, meta?: number | null): number {
  const dias = diasCumplidos(marcas, meta)
  let dia = dias.has(hoy) ? hoy : restarDias(hoy, 1), n = 0
  while (dias.has(dia)) { n++; dia = restarDias(dia, 1) }
  return n
}

export function mejorRacha(marcas: Marca[], meta?: number | null): number {
  const dias = [...diasCumplidos(marcas, meta)].sort()
  let mejor = 0, actual = 0
  dias.forEach((d, i) => {
    actual = i > 0 && Date.parse(d) - Date.parse(dias[i - 1]) === DIA_MS ? actual + 1 : 1
    mejor = Math.max(mejor, actual)
  })
  return mejor
}

export const diasHechos = (marcas: Marca[], hoy: string, meta?: number | null, dias = 30) =>
  [...diasCumplidos(marcas, meta)].filter(d => d <= hoy && d > restarDias(hoy, dias)).length

// Los últimos n días, el más antiguo primero, con lo sumado en cada uno (0 si nada).
export function ultimosDias(marcas: Marca[], hoy: string, n = 30): Marca[] {
  const suma = porDia(marcas)
  return Array.from({ length: n }, (_, i) => {
    const fecha = restarDias(hoy, n - 1 - i)
    return { fecha, valor: suma.get(fecha) ?? 0 }
  })
}
