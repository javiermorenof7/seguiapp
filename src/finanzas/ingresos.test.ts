import { describe, expect, it } from 'vitest'
import { esperadoVsRecibido, estadoFijo, fijos, porFuente } from './ingresos'
import type { Movimiento } from './calculos'

const ing = (fecha: string, valor: number, id_etiqueta: string | null = 'sueldo'): Movimiento => ({ fecha, valor, tipo: 'ingreso', id_etiqueta })
const sueldo = [ing('2026-07-30', 3000000), ing('2026-08-29', 3100000), ing('2026-09-30', 3000000)]

describe('fijos', () => {
  it('fuente en los 3 meses anteriores con hasta 10 % de diferencia', () => {
    expect(fijos(sueldo, '2026-10')).toEqual([{ id_etiqueta: 'sueldo', monto: 3000000, dia: 30 }])
  })
  it('no si falta un mes, varía más de 10 % o no tiene fuente', () => {
    expect(fijos(sueldo.slice(1), '2026-10')).toEqual([])
    expect(fijos([...sueldo.slice(0, 2), ing('2026-09-30', 3500000)], '2026-10')).toEqual([])
    expect(fijos(sueldo.map(m => ({ ...m, id_etiqueta: null })), '2026-10')).toEqual([])
    expect(fijos([...sueldo.slice(0, 2), { ...sueldo[2], tipo: 'gasto' }], '2026-10')).toEqual([])
  })
  it('suma varios pagos del mes y toma el primer día', () => {
    const quincenas = ['07', '08', '09'].flatMap(m => [ing(`2026-${m}-15`, 1500000), ing(`2026-${m}-30`, 1500000)])
    expect(fijos(quincenas, '2026-10')).toEqual([{ id_etiqueta: 'sueldo', monto: 3000000, dia: 15 }])
  })
})

describe('estadoFijo', () => {
  const fijo = { id_etiqueta: 'sueldo', monto: 3000000, dia: 15 }
  it('recibido, pendiente hasta 3 días después y luego atrasado', () => {
    expect(estadoFijo(fijo, [ing('2026-10-14', 3000000)], '2026-10-20')).toBe('recibido')
    expect(estadoFijo(fijo, [], '2026-10-18')).toBe('pendiente')
    expect(estadoFijo(fijo, [], '2026-10-19')).toBe('atrasado')
  })
  it('el día 31 en un mes corto se toma como el último', () => {
    expect(estadoFijo({ ...fijo, dia: 31 }, [], '2026-02-28')).toBe('pendiente')
    expect(estadoFijo({ ...fijo, dia: 31 }, [], '2026-11-30')).toBe('pendiente')
  })
})

describe('porFuente y esperadoVsRecibido', () => {
  it('suma por fuente y mes en los últimos meses', () => {
    const r = porFuente([...sueldo, ing('2026-10-02', 200000, null), ing('2025-01-01', 1)], '2026-10', 4)
    expect(r.meses).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
    expect(r.series).toEqual([
      { id_etiqueta: 'sueldo', datos: [3000000, 3100000, 3000000, 0] },
      { id_etiqueta: null, datos: [0, 0, 0, 200000] },
    ])
  })
  it('esperado del fijo frente a lo recibido de esa fuente', () => {
    const r = esperadoVsRecibido([...sueldo, ing('2026-10-30', 2900000), ing('2026-10-01', 50000, 'venta')], '2026-10', 2)
    expect(r).toEqual([{ mes: '2026-09', esperado: 0, recibido: 0 }, { mes: '2026-10', esperado: 3000000, recibido: 2900000 }])
  })
})
