// Ingresos por fuente (etiqueta de Ingresos) y los fijos: los que se anotan a mano y los aprendidos de los últimos 2 meses. "mes" es 'AAAA-MM', "hoy" 'AAAA-MM-DD'.
import { mesDe, mesesAntes, type Movimiento } from './calculos'
import type { Categoria } from './parseo'

export type EstadoFijo = 'recibido' | 'pendiente' | 'atrasado'
// quitado: él dijo que ya no es fijo; no se espera ni se aprende
export interface Fijo { id_etiqueta: string; monto: number; dia: number; desde?: string; quitado?: boolean }

const TOLERANCIA = 0.1
const GRACIA_DIAS = 3
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const diasDelMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate()

export const MESES_FIJO = 2

// Los fijos que se anotaron a mano en las fuentes y las que ya no son fijas.
export const anotados = (fuentes: Categoria[]): Fijo[] =>
  fuentes.flatMap<Fijo>(f => f.sin_ingreso_fijo ? [{ id_etiqueta: f.id_etiqueta, monto: 0, dia: 0, quitado: true }]
    : f.monto_fijo && f.dia_fijo ? [{ id_etiqueta: f.id_etiqueta, monto: f.monto_fijo, dia: f.dia_fijo, desde: f.fecha_fijo_desde?.slice(0, 7) }] : [])

// Fija si llegó en cada uno de los 2 meses anteriores con una diferencia de hasta 10 %; el anotado a mano manda sobre el aprendido desde su mes.
export function fijos(movimientos: Movimiento[], mes: string, todos: Fijo[] = []): Fijo[] {
  const suyos = todos.filter(f => !f.desde || f.desde <= mes)
  const meses = Array.from({ length: MESES_FIJO }, (_, i) => mesesAntes(mes, i + 1))
  const porFuente = new Map<string, Map<string, { total: number; dia: number }>>()
  for (const m of movimientos) {
    if (m.tipo !== 'ingreso' || !m.id_etiqueta || !meses.includes(mesDe(m.fecha))) continue
    const delaFuente = porFuente.get(m.id_etiqueta) ?? new Map()
    const actual = delaFuente.get(mesDe(m.fecha)) ?? { total: 0, dia: 31 }
    delaFuente.set(mesDe(m.fecha), { total: actual.total + m.valor, dia: Math.min(actual.dia, +m.fecha.slice(8, 10)) })
    porFuente.set(m.id_etiqueta, delaFuente)
  }
  const conSuyo = new Set(suyos.map(f => f.id_etiqueta))
  return [...suyos.filter(f => !f.quitado), ...[...porFuente].flatMap(([id_etiqueta, porMes]) => {
    if (porMes.size < MESES_FIJO || conSuyo.has(id_etiqueta)) return []
    const totales = [...porMes.values()].map(x => x.total)
    if (Math.max(...totales) > Math.min(...totales) * (1 + TOLERANCIA)) return []
    return [{ id_etiqueta, monto: Math.round(mediana(totales)), dia: mediana([...porMes.values()].map(x => x.dia)) }]
  })]
}

const llegoDe = (fijo: Fijo, movimientos: Movimiento[], mes: string) =>
  movimientos.filter(m => m.tipo === 'ingreso' && m.id_etiqueta === fijo.id_etiqueta && mesDe(m.fecha) === mes).reduce((s, m) => s + m.valor, 0)
// recibido cuando ya llegó casi todo (la primera quincena sola no basta)
const yaLlego = (fijo: Fijo, movimientos: Movimiento[], mes: string) => llegoDe(fijo, movimientos, mes) >= fijo.monto * (1 - TOLERANCIA)

export function estadoFijo(fijo: Fijo, movimientos: Movimiento[], hoy: string): EstadoFijo {
  const mes = mesDe(hoy)
  if (yaLlego(fijo, movimientos, mes)) return 'recibido'
  return +hoy.slice(8, 10) > Math.min(fijo.dia, diasDelMes(mes)) + GRACIA_DIAS ? 'atrasado' : 'pendiente'
}

// Lo que falta de cada fijo que aún no llega en el mes de "hoy": no entra al saldo, solo se muestra aparte.
export function porRecibir(movimientos: Movimiento[], hoy: string, suyos: Fijo[] = []) {
  const mes = mesDe(hoy)
  return fijos(movimientos, mes, suyos).flatMap(f => yaLlego(f, movimientos, mes) ? [] : [{ ...f, falta: f.monto - llegoDe(f, movimientos, mes) }])
}

// Fuente del fijo que aún no llega ese mes y cuyo faltante se parece (±10 %) a un ingreso del banco, en pesos.
// shortcut: una quincena suelta no se reconoce (vale la mitad del faltante), si hace falta comparar también contra monto / 2.
export function fuenteDeFijo(movimientos: Movimiento[], fecha: string, valor: number, suyos: Fijo[] = []): string | null {
  const falta = porRecibir(movimientos, fecha, suyos).find(f => Math.abs(valor - f.falta) <= f.falta * TOLERANCIA)
  return falta?.id_etiqueta ?? null
}

// Ingresos de cada fuente en los últimos "n" meses (incluido el actual); sin fuente va con id null.
export function porFuente(movimientos: Movimiento[], mes: string, n = 6) {
  const meses = Array.from({ length: n }, (_, i) => mesesAntes(mes, n - 1 - i))
  const series = new Map<string | null, number[]>()
  for (const m of movimientos) {
    const i = meses.indexOf(mesDe(m.fecha))
    if (m.tipo !== 'ingreso' || i < 0) continue
    const fila = series.get(m.id_etiqueta) ?? meses.map(() => 0)
    fila[i] += m.valor
    series.set(m.id_etiqueta, fila)
  }
  return { meses, series: [...series].map(([id_etiqueta, datos]) => ({ id_etiqueta, datos })) }
}

// Cada mes, lo esperado de los fijos del mes que se ve frente a todo lo que llegó.
export function esperadoVsRecibido(movimientos: Movimiento[], mes: string, n = 6, suyos: Fijo[] = []) {
  const esperado = fijos(movimientos, mes, suyos).reduce((s, f) => s + f.monto, 0)
  return Array.from({ length: n }, (_, i) => mesesAntes(mes, n - 1 - i)).map(m => ({
    mes: m,
    esperado,
    recibido: movimientos.filter(x => x.tipo === 'ingreso' && mesDe(x.fecha) === m).reduce((s, x) => s + x.valor, 0),
  }))
}
