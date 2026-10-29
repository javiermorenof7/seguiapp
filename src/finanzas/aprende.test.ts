import { describe, expect, it } from 'vitest'
import { agrupar, cincuentaTreintaVeinte, facturaParecida, gastoInusual, posibleRepetido, sugeridos } from './aprende'
import type { Movimiento } from './calculos'

const g = (fecha: string, valor: number, extra: Partial<Movimiento> = {}): Movimiento =>
  ({ fecha, valor, tipo: 'gasto', id_etiqueta: 'comida', nota: 'almuerzo', ...extra })

describe('50-30-20', () => {
  const grupos = new Map<string, string | null>([['hogar', 'basico'], ['ocio', 'personal']])
  const movimientos: Movimiento[] = [
    { fecha: '2026-10-01', valor: 1000, tipo: 'ingreso', id_etiqueta: null },
    { fecha: '2026-10-02', valor: 200, tipo: 'ahorro', id_etiqueta: null },
    g('2026-10-03', 550, { id_etiqueta: 'hogar' }),
    g('2026-10-04', 100, { id_etiqueta: 'ocio' }),
    g('2026-10-05', 50, { id_etiqueta: 'hogar', grupo: 'personal' }), // lo elegido gana a la categoría
    g('2026-10-06', 30, { id_etiqueta: null }),
  ]
  it('reparte por grupo y avisa lo que se pasa', () => {
    const r = cincuentaTreintaVeinte(movimientos, '2026-10', grupos)!
    expect([r.basicos, r.personales, r.ahorro]).toEqual([55, 18, 20])
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0]).toContain('básicos')
  })
  it('sin ingresos no hay reparto', () => {
    expect(cincuentaTreintaVeinte(movimientos, '2026-09', grupos)).toBeNull()
  })
})

describe('gasto inusual', () => {
  const historia = [g('2026-08-01', 20000), g('2026-09-01', 20000), g('2026-09-10', 20000),
    g('2026-09-11', 5000, { nota: 'tinto' }), g('2026-01-01', 900000)]
  it('más del doble del promedio de la descripción', () => {
    expect(gastoInusual(historia, { valor: 41000, descripcion: 'Almuerzo', id_etiqueta: 'comida' }, '2026-10'))
      .toEqual({ promedio: 20000, base: 'descripcion' })
    expect(gastoInusual(historia, { valor: 40000, descripcion: 'almuerzo', id_etiqueta: 'comida' }, '2026-10')).toBeNull()
  })
  it('sin 3 de la descripción usa la categoría', () => {
    expect(gastoInusual(historia, { valor: 50000, descripcion: 'tinto', id_etiqueta: 'comida' }, '2026-10'))
      .toEqual({ promedio: 16250, base: 'categoria' })
  })
  it('con menos de 3 registros no opina', () => {
    expect(gastoInusual(historia, { valor: 1e6, descripcion: 'x', id_etiqueta: 'otra' }, '2026-10')).toBeNull()
  })
})

describe('agrupar', () => {
  it('por descripción sin tildes ni mayúsculas, los grandes primero', () => {
    const grupos = agrupar([
      { id_registro: '1', nota: 'Café', valor: 5 }, { id_registro: '2', nota: 'cafe ', valor: 5 },
      { id_registro: '3', nota: 'Uber', valor: 50 }, { id_registro: '4', nota: null, valor: 1 },
    ])
    expect(grupos.map(x => [x.texto, x.ids.length, x.total])).toEqual([['Café', 2, 10], ['Uber', 1, 50], ['Sin descripción', 1, 1]])
  })
})

describe('aprende de lo registrado', () => {
  const g = (fecha: string, valor: number, nota: string, id_etiqueta = 'comida'): Movimiento => ({ fecha, valor, tipo: 'gasto', id_etiqueta, nota })
  const movs = [
    g('2026-10-27', 20000, 'Almuerzo'), g('2026-10-20', 18000, 'almuerzo'), g('2026-10-13', 19000, 'Almuerzo'),
    g('2026-10-25', 12000, 'Taxi', 'transporte'), g('2025-01-10', 90000, 'Regalo', 'otros'),
  ]

  it('sugiere lo más registrado con su último valor y categoría; lo viejo y aislado no', () => {
    expect(sugeridos(movs, 'gasto', '2026-10-28')).toEqual([
      { nota: 'Almuerzo', valor: 20000, id_etiqueta: 'comida' },
      { nota: 'Taxi', valor: 12000, id_etiqueta: 'transporte' },
    ])
    expect(sugeridos(movs, 'ingreso', '2026-10-28')).toEqual([])
  })
  it('avisa un posible repetido: misma descripción, valor parecido, 2 días', () => {
    expect(posibleRepetido(movs, { tipo: 'gasto', fecha: '2026-10-28', valor: 21000, descripcion: ' almuerzo ' })?.fecha).toBe('2026-10-27')
    expect(posibleRepetido(movs, { tipo: 'gasto', fecha: '2026-10-28', valor: 40000, descripcion: 'almuerzo' })).toBeNull()
    expect(posibleRepetido(movs, { tipo: 'gasto', fecha: '2026-10-31', valor: 20000, descripcion: 'almuerzo' })).toBeNull()
  })
  it('reconoce la factura en lo que escribió', () => {
    const recibos = [{ nombre_servicio: 'Agua', id: 1 }, { nombre_servicio: 'Disney +', id: 2 }]
    expect(facturaParecida(recibos, 'Pago de agua')?.id).toBe(1)
    expect(facturaParecida(recibos, 'disney + octubre')?.id).toBe(2)
    expect(facturaParecida(recibos, 'aguacate')).toBeNull()
  })
})
