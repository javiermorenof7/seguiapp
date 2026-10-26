import { describe, expect, it } from 'vitest'
import {
  acumuladoAno, estadoPresupuesto, mesAMes, mesesAntes, porCategoria, promedioSeisMeses, recibosPendientes, resumenMes,
  saldoDespues, type Movimiento, type PagoRecibo, type Recibo,
} from './calculos'

const g = (fecha: string, valor: number, id_etiqueta: string | null = 'hogar'): Movimiento => ({ fecha, valor, tipo: 'gasto', id_etiqueta })
const movimientos: Movimiento[] = [
  { fecha: '2026-10-01', valor: 5000000, tipo: 'ingreso', id_etiqueta: null },
  { fecha: '2026-10-05', valor: 500000, tipo: 'ahorro', id_etiqueta: null },
  g('2026-10-03', 800000), g('2026-10-10', 200000, 'comida'), g('2026-10-12', 50000, null),
  { fecha: '2026-09-01', valor: 4000000, tipo: 'ingreso', id_etiqueta: null }, g('2026-09-15', 1000000),
  g('2025-12-20', 999999),
]

describe('saldo', () => {
  it('del mes: ingresos − gastos − ahorro', () => {
    expect(resumenMes(movimientos, '2026-10')).toEqual({ ingresos: 5000000, gastos: 1050000, ahorro: 500000, saldo: 3450000 })
  })
  it('acumulado del año sin el año anterior', () => {
    expect(acumuladoAno(movimientos, '2026-10')).toBe(3450000 + 3000000)
  })
  it('mes a mes desde enero', () => {
    const meses = mesAMes(movimientos, '2026-10')
    expect(meses).toHaveLength(10)
    expect(meses[8]).toMatchObject({ mes: '2026-09', ingresos: 4000000, gastos: 1000000 })
  })
  it('meses antes cruza el año', () => {
    expect(mesesAntes('2026-02', 3)).toBe('2025-11')
  })
})

describe('presupuestos', () => {
  it('avisa al 80 % y al pasarse', () => {
    expect(estadoPresupuesto(79, 100)).toBeNull()
    expect(estadoPresupuesto(80, 100)).toBe('cerca')
    expect(estadoPresupuesto(100, 100)).toBe('cerca')
    expect(estadoPresupuesto(101, 100)).toBe('pasado')
    expect(estadoPresupuesto(500, null)).toBeNull()
  })
})

describe('recibos pendientes', () => {
  const recibos: Recibo[] = [
    { id_recibo: 'luz', nombre_servicio: 'Luz', nombre_ubicacion: 'Casa', tipo_recibo: 'hogar' },
    { id_recibo: 'cel', nombre_servicio: 'Celular', nombre_ubicacion: null, tipo_recibo: 'personal' },
    { id_recibo: 'raro', nombre_servicio: 'Revista', nombre_ubicacion: null, tipo_recibo: 'personal' },
  ]
  const p = (id_recibo: string, fecha_periodo: string, valor: number, estado = 'pagado'): PagoRecibo => ({ id_recibo, fecha_periodo, valor, estado })
  const pagos = [
    p('luz', '2026-07-01', 100), p('luz', '2026-09-01', 120),
    p('cel', '2026-08-01', 50), p('cel', '2026-09-01', 55), p('cel', '2026-10-01', 55),
    p('raro', '2026-09-01', 10), p('raro', '2026-08-01', 10, 'vencido'),
  ]

  it('2 de 3 meses, sin pagar este mes, con el último valor', () => {
    expect(recibosPendientes(recibos, pagos, '2026-10')).toEqual([{ id_recibo: 'luz', nombre: 'Luz · Casa', valor: 120, tipo_recibo: 'hogar' }])
  })
})

describe('por categoría y saldo después', () => {
  const categorias = [{ id_etiqueta: 'hogar', nombre: 'Hogar' }, { id_etiqueta: 'comida', nombre: 'Comida' }]
  const pendientes = [{ id_recibo: 'luz', nombre: 'Luz', valor: 100000, tipo_recibo: 'hogar' as const },
    { id_recibo: 'cel', nombre: 'Celular', valor: 50000, tipo_recibo: 'personal' as const }]
  const filas = porCategoria(movimientos, '2026-10', categorias, new Map([['hogar', 1000000], ['comida', 600000]]), pendientes, 'hogar')

  it('ordena por gasto y agrega sin categoría', () => {
    expect(filas.map(f => [f.nombre, f.gastado, f.pendiente])).toEqual([
      ['Hogar', 800000, 100000], ['Comida', 200000, 0], ['Sin categoría', 50000, 0]])
  })
  it('no cuenta dos veces el recibo que cabe en el presupuesto', () => {
    // 3.450.000 − recibos 150.000 − restante hogar 100.000 − restante comida 400.000
    expect(saldoDespues(3450000, filas, pendientes)).toBe(2800000)
  })
  it('un presupuesto pasado no suma restante', () => {
    const pasado = porCategoria(movimientos, '2026-10', categorias, new Map([['hogar', 500000]]), [], 'hogar')
    expect(saldoDespues(0, pasado, [])).toBe(0)
  })
})

describe('sugerencia de presupuesto', () => {
  it('promedio de los 6 meses anteriores, sin el mes actual', () => {
    expect(promedioSeisMeses(movimientos, 'hogar', '2026-10')).toBe(167000)
  })
})
