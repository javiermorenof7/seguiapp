import { describe, expect, it } from 'vitest'
import { diaAprendido, recibosDelMes, totalesDelMes, valoresEnElTiempo, type PagoGuardado, type ReciboVisible } from './estadoRecibos'

const r = (id: string, extra: Partial<ReciboVisible> = {}): ReciboVisible => ({
  id_recibo: id, nombre_servicio: id, nombre_ubicacion: null, tipo_recibo: 'personal', dia_pago: null, numero_cuenta_enmascarado: null, ...extra,
})
const p = (id_recibo: string, mes: string, valor: number, dia: number | null = 10): PagoGuardado => ({
  id_pago_recibo: `${id_recibo}-${mes}`, id_recibo, fecha_periodo: `${mes}-01`, valor, estado: 'pagado', id_registro: null,
  fecha_pago: dia ? `${mes}-${String(dia).padStart(2, '0')}` : null,
})

describe('diaAprendido', () => {
  it('es la mediana de los días pagados', () => {
    expect(diaAprendido([p('a', '2026-07', 1, 5), p('a', '2026-08', 1, 20), p('a', '2026-09', 1, 8)])).toBe(8)
    expect(diaAprendido([p('a', '2026-08', 1, 5), p('a', '2026-09', 1, 10)])).toBe(8)
  })
  it('sin fechas de pago no aprende', () => expect(diaAprendido([p('a', '2026-09', 1, null)])).toBeNull())
})

describe('recibosDelMes', () => {
  const pagos = [
    p('luz', '2026-08', 90000, 8), p('luz', '2026-09', 100000, 12),
    p('agua', '2026-08', 50000, 20), p('agua', '2026-09', 60000, 20),
    p('gas', '2026-09', 30000),
    p('net', '2026-08', 80000), p('net', '2026-09', 80000), p('net', '2026-10', 85000, 2),
  ]
  const filas = recibosDelMes([r('luz'), r('agua'), r('gas'), r('net')], pagos, '2026-10-15')
  const de = (id: string) => filas.find(f => f.recibo.id_recibo === id)!

  it('vencido al pasarse el día aprendido, con el valor del último pago', () => {
    expect(de('luz')).toMatchObject({ estado: 'vencido', valor: 100000, dia: 10 })
  })
  it('por pagar antes de su día', () => expect(de('agua')).toMatchObject({ estado: 'por_pagar', valor: 60000, dia: 20 }))
  it('sin pendiente si no se pagó en 2 de los 3 meses anteriores', () => expect(de('gas')).toMatchObject({ estado: 'sin_pendiente', valor: null }))
  it('pagado con el valor real del mes', () => expect(de('net')).toMatchObject({ estado: 'pagado', valor: 85000 }))
  it('ordena vencidos, por pagar, sin pendiente y pagados', () =>
    expect(filas.map(f => f.estado)).toEqual(['vencido', 'por_pagar', 'sin_pendiente', 'pagado']))
  it('el vencido de un mes no pasa al siguiente si dejó de cumplir la regla', () => {
    const noviembre = recibosDelMes([r('gas')], [p('gas', '2026-09', 30000)], '2026-11-20')
    expect(noviembre[0].estado).toBe('sin_pendiente')
  })
  it('sin día aprendido usa el guardado y, sin ninguno, nunca vence', () => {
    const sinFecha = [p('x', '2026-08', 1, null), p('x', '2026-09', 1, null)]
    expect(recibosDelMes([r('x', { dia_pago: 5 })], sinFecha, '2026-10-15')[0].estado).toBe('vencido')
    expect(recibosDelMes([r('x')], sinFecha, '2026-10-31')[0].estado).toBe('por_pagar')
  })
  it('suma pagado, por pagar y vencido', () =>
    expect(totalesDelMes(filas)).toEqual({ pagado: 85000, porPagar: 60000, vencido: 100000 }))
})

it('valoresEnElTiempo ordena los pagos del recibo', () => {
  expect(valoresEnElTiempo([p('a', '2026-09', 2), p('b', '2026-08', 9), p('a', '2026-08', 1)], 'a'))
    .toEqual([{ fecha: '2026-08-01', valor: 1 }, { fecha: '2026-09-01', valor: 2 }])
})
