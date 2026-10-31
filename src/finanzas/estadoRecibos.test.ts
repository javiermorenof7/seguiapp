import { describe, expect, it } from 'vitest'
import { avanceDelMes, diaAprendido, mosaicoRecibos, finDeMes, numeroParaCopiar, recibosDelMes, totalesDelMes, ubicacionDe, ubicacionesConConteo, ubicacionesDe, vencidasAnteriores, vencidasPorFactura, type FilaRecibo, type PagoGuardado, type ReciboVisible } from './estadoRecibos'

const r = (id: string, extra: Partial<ReciboVisible> = {}): ReciboVisible => ({
  id_recibo: id, nombre_servicio: id, nombre_ubicacion: null, tipo_recibo: 'personal', dia_pago: null, numero_cuenta_enmascarado: null, ...extra,
})
const p = (id_recibo: string, mes: string, valor: number, dia: number | null = 10): PagoGuardado => ({
  id_pago_recibo: `${id_recibo}-${mes}`, id_recibo, fecha_periodo: `${mes}-01`, valor, estado: 'pagado', id_registro: null,
  fecha_pago: dia ? `${mes}-${String(dia).padStart(2, '0')}` : null,
})

describe('mosaicoRecibos', () => {
  const fila = (id: string, extra: Partial<ReciboVisible>, estado: FilaRecibo['estado'] = 'por_pagar', valor: number | null = 100): FilaRecibo =>
    ({ recibo: r(id, extra), nombre: id, estado, valor, dia: null, pago: null })
  const hogar = (id: string, servicio: string, lugar: string) => fila(id, { tipo_recibo: 'hogar', nombre_servicio: servicio, nombre_ubicacion: lugar })

  it('une servicios sin mayúsculas ni tildes y deja vacío lo que el lugar no tiene', () => {
    const m = mosaicoRecibos([hogar('a', 'Agua', 'La Mesa'), hogar('b', 'agua', 'Ribera'), hogar('c', 'Gas', 'Ribera'), fila('d', {})])
    expect(m.servicios).toEqual(['Agua', 'Gas'])
    expect(m.hogares.map(h => [h.lugar, h.celdas.map(c => c?.recibo.id_recibo ?? null)])).toEqual([['La Mesa', ['a', null]], ['Ribera', ['b', 'c']]])
    expect(m.sueltas.map(f => f.recibo.id_recibo)).toEqual(['d'])
  })
  it('un servicio repetido en el mismo lugar no se pierde', () => {
    const m = mosaicoRecibos([hogar('a', 'Luz', 'Casa'), hogar('b', 'LUZ', 'casa')])
    expect(m.hogares).toHaveLength(1)
    expect(m.sueltas.map(f => f.recibo.id_recibo)).toEqual(['b'])
  })
  it('un hogar con ubicación Personal va con las personales', () => {
    const m = mosaicoRecibos([hogar('a', 'Cursos', 'Personal')])
    expect(m.servicios).toEqual([])
    expect(m.sueltas.map(f => f.recibo.id_recibo)).toEqual(['a'])
  })
  it('el avance no cuenta las que no tienen valor', () => {
    expect(avanceDelMes([fila('a', {}, 'pagado', 50), fila('b', {}, 'vencido', 200), fila('c', {}, 'por_pagar', 30), fila('d', {}, 'sin_pendiente', null)]))
      .toEqual({ pagadas: 1, total: 3, falta: 230 })
  })
  it('el número se copia sin espacios y conserva ceros y letras', () => expect(numeroParaCopiar(' 0012 AB 34 ')).toBe('0012AB34'))
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
  it('toda activa queda pendiente aunque se haya pagado una sola vez', () => expect(de('gas')).toMatchObject({ estado: 'vencido', valor: 30000 }))
  it('pagado con el valor real del mes', () => expect(de('net')).toMatchObject({ estado: 'pagado', valor: 85000 }))
  it('ordena vencidos, por pagar, sin pendiente y pagados', () =>
    expect(filas.map(f => f.estado)).toEqual(['vencido', 'vencido', 'por_pagar', 'pagado']))
  it('nueva sin pagos: pendiente sin valor; cancelada en el mes: omitida', () => {
    expect(recibosDelMes([r('nueva')], [], '2026-10-01')[0]).toMatchObject({ estado: 'por_pagar', valor: null })
    const cancelado = { ...p('gas', '2026-10', 0, null), estado: 'cancelado' }
    expect(recibosDelMes([r('gas')], [cancelado], '2026-10-20')[0].estado).toBe('omitida')
  })
  it('sin día aprendido usa el guardado y, sin ninguno, nunca vence', () => {
    const sinFecha = [p('x', '2026-08', 1, null), p('x', '2026-09', 1, null)]
    expect(recibosDelMes([r('x', { dia_pago: 5 })], sinFecha, '2026-10-15')[0].estado).toBe('vencido')
    expect(recibosDelMes([r('x')], sinFecha, '2026-10-31')[0].estado).toBe('por_pagar')
  })
  it('suma pagado, por pagar y vencido', () =>
    expect(totalesDelMes(filas)).toEqual({ pagado: 85000, porPagar: 60000, vencido: 130000 }))
})

describe('vencidasAnteriores', () => {
  const hoy = '2026-11-05'
  it('avisa cada mes sin pagar desde el primer pago, del más reciente al más antiguo, con el último valor antes de ese mes', () => {
    expect(vencidasAnteriores([r('luz')], [p('luz', '2026-07', 90000), p('luz', '2026-09', 100000)], hoy))
      .toMatchObject([{ periodo: '2026-10-01', valor: 100000 }, { periodo: '2026-08-01', valor: 90000 }])
  })
  it('no avisa si se pagó o se omitió', () => {
    expect(vencidasAnteriores([r('luz')], [p('luz', '2026-09', 1), { ...p('luz', '2026-10', 0, null), estado: 'cancelado' }], hoy)).toEqual([])
  })
  it('no avisa sin pagos ni antes del primero, ni más de 12 meses atrás', () => {
    expect(vencidasAnteriores([r('nueva')], [], hoy)).toEqual([])
    expect(vencidasAnteriores([r('reciente')], [p('reciente', '2026-10', 1)], hoy)).toEqual([])
    expect(vencidasAnteriores([r('vieja')], [p('vieja', '2024-01', 1)], hoy)).toHaveLength(12)
  })
  it('agrupa los meses por factura', () => {
    const v = vencidasAnteriores([r('luz'), r('gas')], [p('luz', '2026-08', 1), p('gas', '2026-09', 1)], hoy)
    expect(vencidasPorFactura(v).map(g => [g.nombre, g.periodos.map(x => x.periodo)])).toEqual([
      ['luz', ['2026-10-01', '2026-09-01']],
      ['gas', ['2026-10-01']],
    ])
  })
  it('el fin de mes conoce febrero', () => {
    expect(finDeMes('2026-02-01')).toBe('2026-02-28')
    expect(finDeMes('2026-10-01')).toBe('2026-10-31')
  })
})

describe('omitida este mes', () => {
  const hoy = '2026-10-15'
  const omitido = { ...p('luz', '2026-10', 0, null), estado: 'cancelado' as const }
  it('queda omitida, sin valor y con su marca para deshacer', () => {
    expect(recibosDelMes([r('luz')], [p('luz', '2026-09', 100), omitido], hoy)[0]).toMatchObject({ estado: 'omitida', valor: null, pago: omitido })
  })
  it('no cuenta en el avance y el mes siguiente vuelve sola', () => {
    const filas = recibosDelMes([r('luz')], [p('luz', '2026-09', 100), omitido], hoy)
    expect(avanceDelMes(filas)).toEqual({ pagadas: 0, total: 0, falta: 0 })
    expect(recibosDelMes([r('luz')], [p('luz', '2026-09', 100), omitido], '2026-11-02')[0].estado).toBe('por_pagar')
  })
  it('un pago atrasado no mueve el día aprendido', () => {
    expect(diaAprendido([{ ...p('luz', '2026-09', 1), fecha_pago: '2026-10-28' }])).toBeNull()
  })
})

it('no aprende el día de los pagos cargados de la hoja (pago = inicio del período) y el día puesto manda', () => {
  const cargado = { ...p('a', '2026-08', 1), fecha_pago: '2026-08-01' }
  expect(diaAprendido([cargado, { ...p('a', '2026-09', 1), fecha_pago: '2026-09-01' }])).toBeNull()
  expect(recibosDelMes([r('a', { dia_pago: 20 })], [p('a', '2026-09', 1, 5)], '2026-10-15')[0]).toMatchObject({ dia: 20, estado: 'por_pagar' })
})

describe('ubicaciones del filtro', () => {
  it('las personales van como Personal y no se repiten', () => {
    const recibos = [r('luz', { tipo_recibo: 'hogar', nombre_ubicacion: 'Casa' }), r('agua', { tipo_recibo: 'hogar', nombre_ubicacion: 'Casa' }),
      r('gas', { tipo_recibo: 'hogar', nombre_ubicacion: 'Apto' }), r('celular')]
    expect(ubicacionesDe(recibos)).toEqual(['Apto', 'Casa', 'Personal'])
    expect(recibos.filter(x => ubicacionDe(x) === 'Casa').map(x => x.id_recibo)).toEqual(['luz', 'agua'])
    expect(ubicacionesDe([])).toEqual([])
    expect(ubicacionesDe([r('x'), r('y', { tipo_recibo: 'hogar', nombre_ubicacion: 'Zona' })])).toEqual(['Zona', 'Personal'])
  })

  it('el selector pone primero las ubicaciones con facturas en el grupo y conserva las demás en 0', () => {
    const casa = r('luz', { tipo_recibo: 'hogar', nombre_ubicacion: 'Casa' })
    const apto = r('gas', { tipo_recibo: 'hogar', nombre_ubicacion: 'Apto' })
    const celular = r('celular')
    expect(ubicacionesConConteo([casa, apto, celular], [casa, celular])).toEqual([
      { ubicacion: 'Casa', facturas: 1 }, { ubicacion: 'Personal', facturas: 1 }, { ubicacion: 'Apto', facturas: 0 },
    ])
  })
})
