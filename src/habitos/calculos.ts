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
const dosCifras = (n: number) => String(n).padStart(2, '0')

// Fecha real (no 31/02) o null.
function fechaDe(ano: number, mes: number, dia: number): string | null {
  const iso = `${ano}-${dosCifras(mes)}-${dosCifras(dia)}`
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null
}

// "hoy", "ayer", "anteayer", "el 24" (el último 24 que ya pasó) o "el 24/10" al final de la línea.
function leerFecha(texto: string, hoy: string): { resto: string; fecha: string } | null {
  const m = texto.match(/^(.*?)\s*\b(hoy|ayer|anteayer|el (\d{1,2})(?:\/(\d{1,2}))?)$/i)
  if (!m) return { resto: texto, fecha: hoy }
  const [, resto, , dia, mes] = m
  const palabra = m[2].toLowerCase()
  if (palabra === 'hoy') return { resto, fecha: hoy }
  if (palabra === 'ayer') return { resto, fecha: restarDias(hoy, 1) }
  if (palabra === 'anteayer') return { resto, fecha: restarDias(hoy, 2) }
  const [ano, mesHoy] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))]
  if (mes) {
    const fecha = fechaDe(ano, Number(mes), Number(dia))
    if (!fecha) return null
    return { resto, fecha: fecha <= hoy ? fecha : fechaDe(ano - 1, Number(mes), Number(dia)) ?? fecha }
  }
  const esteMes = fechaDe(ano, mesHoy, Number(dia))
  if (esteMes && esteMes <= hoy) return { resto, fecha: esteMes }
  const [anoAntes, mesAntes] = mesHoy === 1 ? [ano - 1, 12] : [ano, mesHoy - 1]
  const fecha = fechaDe(anoAntes, mesAntes, Number(dia))
  return fecha ? { resto, fecha } : null
}

// "Leer" (hecho), "agua 2 litros", "Meditación 10 ayer"; el nombre queda como se escribió.
// null si no se entiende o la fecha es futura.
export function leerHabito(texto: string, hoy: string): Leido | null {
  const conFecha = leerFecha(texto.replace(/\s+/g, ' ').trim(), hoy)
  if (!conFecha || conFecha.fecha > hoy) return null
  const { resto, fecha } = conFecha
  const m = resto.match(new RegExp(String.raw`^(.+?)\s+(${NUMERO})\s*(\p{L}*)$`, 'u'))
  const habito = (m ? m[1] : resto).trim()
  const valor = m ? Number(m[2].replace(',', '.')) : null
  if (!habito || habito.length > 60 || (valor !== null && (valor <= 0 || valor >= 1e6))) return null
  return { habito, valor, unidad: m?.[3].toLowerCase() ?? '', fecha }
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
