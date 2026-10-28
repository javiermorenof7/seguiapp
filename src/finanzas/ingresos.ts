// Ingresos por fuente (etiqueta de Ingresos) y los fijos aprendidos de los últimos 3 meses. "mes" es 'AAAA-MM', "hoy" 'AAAA-MM-DD'.
import { mesDe, mesesAntes, type Movimiento } from './calculos'

export type EstadoFijo = 'recibido' | 'pendiente' | 'atrasado'
export interface Fijo { id_etiqueta: string; monto: number; dia: number }

const TOLERANCIA = 0.1
const GRACIA_DIAS = 3
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const diasDelMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate()

// Fija si llegó en cada uno de los 3 meses anteriores con una diferencia de hasta 10 %.
export function fijos(movimientos: Movimiento[], mes: string): Fijo[] {
  const meses = [1, 2, 3].map(n => mesesAntes(mes, n))
  const porFuente = new Map<string, Map<string, { total: number; dia: number }>>()
  for (const m of movimientos) {
    if (m.tipo !== 'ingreso' || !m.id_etiqueta || !meses.includes(mesDe(m.fecha))) continue
    const delaFuente = porFuente.get(m.id_etiqueta) ?? new Map()
    const actual = delaFuente.get(mesDe(m.fecha)) ?? { total: 0, dia: 31 }
    delaFuente.set(mesDe(m.fecha), { total: actual.total + m.valor, dia: Math.min(actual.dia, +m.fecha.slice(8, 10)) })
    porFuente.set(m.id_etiqueta, delaFuente)
  }
  return [...porFuente].flatMap(([id_etiqueta, porMes]) => {
    if (porMes.size < 3) return []
    const totales = [...porMes.values()].map(x => x.total)
    if (Math.max(...totales) > Math.min(...totales) * (1 + TOLERANCIA)) return []
    return [{ id_etiqueta, monto: Math.round(mediana(totales)), dia: mediana([...porMes.values()].map(x => x.dia)) }]
  })
}

export function estadoFijo(fijo: Fijo, movimientos: Movimiento[], hoy: string): EstadoFijo {
  const mes = mesDe(hoy)
  if (movimientos.some(m => m.tipo === 'ingreso' && m.id_etiqueta === fijo.id_etiqueta && mesDe(m.fecha) === mes)) return 'recibido'
  return +hoy.slice(8, 10) > Math.min(fijo.dia, diasDelMes(mes)) + GRACIA_DIAS ? 'atrasado' : 'pendiente'
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

// Lo esperado (fijos aprendidos hasta ese mes) frente a lo recibido de esas fuentes, mes a mes.
export function esperadoVsRecibido(movimientos: Movimiento[], mes: string, n = 6) {
  return Array.from({ length: n }, (_, i) => mesesAntes(mes, n - 1 - i)).map(m => {
    const delMes = fijos(movimientos, m)
    const ids = new Set(delMes.map(f => f.id_etiqueta))
    return {
      mes: m,
      esperado: delMes.reduce((s, f) => s + f.monto, 0),
      recibido: movimientos.filter(x => x.tipo === 'ingreso' && mesDe(x.fecha) === m && ids.has(x.id_etiqueta ?? '')).reduce((s, x) => s + x.valor, 0),
    }
  })
}
