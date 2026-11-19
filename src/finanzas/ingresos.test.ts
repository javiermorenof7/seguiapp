import { describe, expect, it } from 'vitest'
import { adicionales, anotados, cambiarAdicional, nuevoAdicional, claveDe, conTramo, esperadoVsRecibido, estadoFijo, fijos, fuenteDeFijo, historiales, llegadas, porFuente, porRecibir } from './ingresos'
import type { Movimiento } from './calculos'
import type { Categoria } from './parseo'

const ing = (fecha: string, valor: number, id_etiqueta: string | null = 'sueldo'): Movimiento => ({ fecha, valor, tipo: 'ingreso', id_etiqueta })
const sueldo = [ing('2026-07-30', 3100000), ing('2026-08-29', 3000000), ing('2026-09-30', 3000000)]

describe('fijos', () => {
  it('fuente en los 2 meses anteriores con hasta 10 % de diferencia', () => {
    expect(fijos(sueldo, '2026-10')).toEqual([{ id_etiqueta: 'sueldo', monto: 3000000, dia: 30 }])
  })
  it('no si falta un mes, varía más de 10 % o no tiene fuente', () => {
    expect(fijos(sueldo.slice(2), '2026-10')).toEqual([])
    expect(fijos([...sueldo.slice(0, 2), ing('2026-09-30', 3500000)], '2026-10')).toEqual([])
    expect(fijos(sueldo.map(m => ({ ...m, id_etiqueta: null })), '2026-10')).toEqual([])
    expect(fijos([...sueldo.slice(0, 2), { ...sueldo[2], tipo: 'gasto' }], '2026-10')).toEqual([])
  })
  it('suma varios pagos del mes y toma el primer día', () => {
    const quincenas = ['07', '08', '09'].flatMap(m => [ing(`2026-${m}-15`, 1500000), ing(`2026-${m}-30`, 1500000)])
    expect(fijos(quincenas, '2026-10')).toEqual([{ id_etiqueta: 'sueldo', monto: 3000000, dia: 15 }])
  })
  it('el anotado a mano manda sobre el aprendido y vale sin historia', () => {
    const suyo = { id_etiqueta: 'sueldo', monto: 2500000, dia: 5 }
    expect(fijos([], '2026-10', [suyo])).toEqual([suyo])
    expect(fijos([...sueldo, ...sueldo.map(m => ({ ...m, id_etiqueta: 'arriendo' }))], '2026-10', [suyo]))
      .toEqual([suyo, { id_etiqueta: 'arriendo', monto: 3000000, dia: 30 }])
    expect(porRecibir([], '2026-10-10', [suyo])).toEqual([{ ...suyo, falta: 2500000 }])
  })
  it('el anotado solo se espera desde su mes; antes vale el aprendido', () => {
    const suyo = { id_etiqueta: 'sueldo', monto: 2500000, dia: 5, desde: '2026-11' }
    expect(fijos([], '2026-10', [suyo])).toEqual([])
    expect(fijos(sueldo, '2026-10', [suyo])).toEqual([{ id_etiqueta: 'sueldo', monto: 3000000, dia: 30 }])
    expect(fijos([], '2026-11', [suyo])).toEqual([suyo])
    expect(anotados([{ id_etiqueta: 'sueldo', nombre: 'Sueldo', grupo: null, palabras_clave: [], monto_fijo: 2500000, dia_fijo: 5, fecha_fijo_desde: '2026-11-01' }])).toEqual([suyo])
  })
  it('una fuente que ya no es fija no se espera ni se aprende', () => {
    const quitado = anotados([{ id_etiqueta: 'sueldo', nombre: 'Sueldo', grupo: null, palabras_clave: [], sin_ingreso_fijo: true }])
    expect(quitado).toEqual([{ id_etiqueta: 'sueldo', monto: 0, dia: 0, quitado: true }])
    expect(fijos(sueldo, '2026-10', quitado)).toEqual([])
    expect(porRecibir(sueldo, '2026-10-10', quitado)).toEqual([])
    expect(esperadoVsRecibido(sueldo, '2026-10', 1, quitado)).toEqual([{ mes: '2026-10', esperado: 0, recibido: 0 }])
  })
  it('lee los anotados de las fuentes que tienen monto y día', () => {
    const fuente = { id_etiqueta: 'sueldo', nombre: 'Sueldo', grupo: null, palabras_clave: [] }
    expect(anotados([{ ...fuente, monto_fijo: 2500000, dia_fijo: 5 }, { ...fuente, id_etiqueta: 'otra' }])).toEqual([{ id_etiqueta: 'sueldo', monto: 2500000, dia: 5 }])
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
      { id_etiqueta: 'sueldo', datos: [3100000, 3000000, 3000000, 0] },
      { id_etiqueta: null, datos: [0, 0, 0, 200000] },
    ])
  })
  it('un mes pasado conserva lo que se esperaba entonces', () => {
    const quitado = [{ id_etiqueta: 'sueldo', monto: 0, dia: 0, quitado: true }]
    // quitado en nov. sin monto guardado: los meses de antes usan lo aprendido al quitarlo (sep. y oct.)
    const conOct = [...sueldo, ing('2026-10-30', 3000000)]
    expect(esperadoVsRecibido(conOct, '2026-11', 3, quitado, { sueldo: [{ desde: '2026-11', monto: null, dia: null }] }).map(m => m.esperado))
      .toEqual([3000000, 3000000, 0])
    // editado a 4 M en nov.: oct. sigue en 3 M
    const editado = conTramo([], '2026-11', { monto: 4000000, dia: 30 }, { monto: 3000000, dia: 30 })
    expect(editado).toEqual([{ desde: '', monto: 3000000, dia: 30 }, { desde: '2026-11', monto: 4000000, dia: 30 }])
    const suyo = [{ id_etiqueta: 'sueldo', monto: 4000000, dia: 30 }]
    expect(esperadoVsRecibido(conOct, '2026-11', 2, suyo, { sueldo: editado }).map(m => m.esperado)).toEqual([3000000, 4000000])
    // el tramo del mismo mes se reemplaza y lo mal formado se descarta al leer
    expect(conTramo(editado, '2026-11', null)).toEqual([{ desde: '', monto: 3000000, dia: 30 }, { desde: '2026-11', monto: null, dia: null }])
    const fuente = { id_etiqueta: 'sueldo', nombre: 'Sueldo', grupo: null, palabras_clave: [] }
    expect(historiales([{ ...fuente, historial_fijo: [{ desde: 'x', monto: 1, dia: 1 }, { desde: '2026-11', monto: -5, dia: 1 }, { desde: '2026-10', monto: 2, dia: 1 }] }]))
      .toEqual({ sueldo: [{ desde: '2026-10', monto: 2, dia: 1 }] })
  })
  it('cada mes espera los fijos del mes que se ve y suma todo lo que llegó', () => {
    const r = esperadoVsRecibido([...sueldo, ing('2026-10-30', 2900000), ing('2026-10-01', 50000, 'venta')], '2026-10', 2)
    expect(r).toEqual([{ mes: '2026-09', esperado: 3000000, recibido: 3000000 }, { mes: '2026-10', esperado: 3000000, recibido: 2950000 }])
    expect(esperadoVsRecibido(sueldo, '2026-11', 2)).toEqual([{ mes: '2026-10', esperado: 0, recibido: 0 }, { mes: '2026-11', esperado: 0, recibido: 0 }])
  })
})

describe('porRecibir', () => {
  it('lo que falta del fijo en el mes, menos lo que ya llegó', () => {
    expect(porRecibir(sueldo, '2026-10-10')).toEqual([{ id_etiqueta: 'sueldo', monto: 3000000, dia: 30, falta: 3000000 }])
    expect(porRecibir([...sueldo, ing('2026-10-15', 1500000)], '2026-10-20')[0].falta).toBe(1500000)
    expect(porRecibir([...sueldo, ing('2026-10-30', 2900000)], '2026-10-30')).toEqual([])
    expect(porRecibir([...sueldo, ing('2026-10-30', 3500000)], '2026-10-30')).toEqual([])
  })
  it('una quincena sola no lo deja recibido', () => {
    expect(estadoFijo({ id_etiqueta: 'sueldo', monto: 3000000, dia: 30 }, [ing('2026-10-15', 1500000)], '2026-10-20')).toBe('pendiente')
  })
})

describe('fuenteDeFijo', () => {
  it('sugiere la fuente del fijo pendiente si el valor se parece al faltante', () => {
    expect(fuenteDeFijo(sueldo, '2026-10-30', 2950000)).toBe('sueldo')
    expect(fuenteDeFijo(sueldo, '2026-10-30', 200000)).toBeNull()
    expect(fuenteDeFijo([...sueldo, ing('2026-10-30', 3000000)], '2026-10-31', 3000000)).toBeNull()
  })
})

describe('varios fijos en una fuente', () => {
  const arr = (fecha: string, valor: number) => ing(fecha, valor, 'arriendos')
  const fuente = { id_etiqueta: 'arriendos', nombre: 'Arriendos', grupo: null, palabras_clave: [], monto_fijo: 1200000, dia_fijo: 5,
    fijos_adicionales: [{ clave: 'a1', nombre: 'Apto 2', monto: 900000, dia: 10, desde: '2026-10', historial: [] }] }
  const suyos = anotados([fuente])

  it('lee el principal y los adicionales, sin los mal formados ni los quitados', () => {
    expect(suyos).toEqual([{ id_etiqueta: 'arriendos', monto: 1200000, dia: 5, desde: undefined },
      { id_etiqueta: 'arriendos', clave: 'a1', nombre: 'Apto 2', monto: 900000, dia: 10, desde: '2026-10' }])
    const malos = [{ clave: 'A 1', nombre: 'x', monto: 1, dia: 1, desde: '2026-10' }, { clave: 'b', nombre: 'x', monto: 5, dia: null, desde: '2026-10' },
      { clave: 'c', nombre: 'Viejo', monto: null, dia: null, desde: '2026-10' }, 'x']
    expect(adicionales({ ...fuente, fijos_adicionales: malos }).map(a => a.clave)).toEqual(['c'])
    expect(anotados([{ ...fuente, monto_fijo: null, dia_fijo: null, fijos_adicionales: malos }])).toEqual([])
  })

  it('cada pago va al fijo con el faltante más parecido', () => {
    const llego = llegadas(suyos, [arr('2026-10-06', 900000)], '2026-10')
    expect(llego.get('arriendos')).toBe(0)
    expect(llego.get('arriendos:a1')).toBe(900000)
    expect(estadoFijo(suyos[1], [arr('2026-10-06', 900000)], '2026-10-20', suyos)).toBe('recibido')
    expect(estadoFijo(suyos[0], [arr('2026-10-06', 900000)], '2026-10-20', suyos)).toBe('atrasado')
    expect(porRecibir([arr('2026-10-06', 900000)], '2026-10-07', suyos)).toEqual([{ ...suyos[0], falta: 1200000 }])
  })

  it('con el mismo monto, va al de día más cercano', () => {
    const iguales = anotados([{ ...fuente, fijos_adicionales: [{ clave: 'a1', nombre: 'Apto 2', monto: 1200000, dia: 20, desde: '2026-10', historial: [] }] }])
    const llego = llegadas(iguales, [arr('2026-10-19', 1200000)], '2026-10')
    expect([llego.get('arriendos'), llego.get('arriendos:a1')]).toEqual([0, 1200000])
  })

  it('una quincena suma a su fijo y un pago que no encaja no se asigna', () => {
    const sueldos = anotados([{ ...fuente, id_etiqueta: 'sueldo', monto_fijo: 3000000, dia_fijo: 15,
      fijos_adicionales: [{ clave: 's2', nombre: 'Otro', monto: 800000, dia: 1, desde: '2026-10', historial: [] }] }])
    const llego = llegadas(sueldos, [ing('2026-10-15', 1500000), ing('2026-10-30', 1500000), ing('2026-10-02', 5000000)], '2026-10')
    expect([llego.get('sueldo'), llego.get('sueldo:s2')]).toEqual([3000000, 0])
  })

  it('el extracto sugiere la fuente del fijo que falta', () => {
    expect(fuenteDeFijo([arr('2026-10-05', 1200000)], '2026-10-11', 910000, suyos)).toBe('arriendos')
  })

  it('un adicional nuevo no se espera antes de su mes y quitarlo no cambia los meses pasados', () => {
    const historial = [{ desde: '', monto: null, dia: null }, { desde: '2026-10', monto: 900000, dia: 10 }]
    const con = { ...fuente, fijos_adicionales: [{ clave: 'a1', nombre: 'Apto 2', monto: 900000, dia: 10, desde: '2026-10', historial }] }
    const esp = (f: Categoria, mes: string) => esperadoVsRecibido([], mes, 3, anotados([f]), historiales([f])).map(m => m.esperado)
    expect(esp(con, '2026-10')).toEqual([1200000, 1200000, 2100000])
    const quitado = { ...con, fijos_adicionales: [{ ...con.fijos_adicionales[0], monto: null, dia: null, historial: conTramo(historial, '2026-11', null) }] }
    expect(esp(quitado, '2026-11')).toEqual([1200000, 2100000, 1200000])
    expect(historiales([quitado])[claveDe({ id_etiqueta: 'arriendos', clave: 'a1' })]).toHaveLength(3)
  })

  it('el sueldo que cambia desde un mes no toca el otro fijo ni los meses de antes', () => {
    const cambio = { ...fuente, monto_fijo: 1300000, historial_fijo: conTramo([], '2026-11', { monto: 1300000, dia: 5 }, { monto: 1200000, dia: 5 }),
      fijos_adicionales: [{ clave: 'a1', nombre: 'Apto 2', monto: 900000, dia: 10, desde: '2026-10', historial: [{ desde: '', monto: null, dia: null }, { desde: '2026-10', monto: 900000, dia: 10 }] }] }
    expect(esperadoVsRecibido([], '2026-11', 3, anotados([cambio]), historiales([cambio])).map(m => m.esperado)).toEqual([1200000, 2100000, 2200000])
  })

  it('crea y cambia adicionales sin tocar los demás', () => {
    const lista = nuevoAdicional(adicionales(fuente), ' Apto 3 ', '2026-11', { monto: 700000, dia: 15 })
    expect(lista).toHaveLength(2)
    expect(adicionales({ ...fuente, fijos_adicionales: lista })).toEqual(lista)
    expect(lista[1]).toMatchObject({ nombre: 'Apto 3', monto: 700000, desde: '2026-11' })
    const sin = cambiarAdicional(lista, lista[1].clave, '2026-12', null)
    expect(sin[0]).toBe(lista[0])
    expect(sin[1]).toMatchObject({ monto: null, dia: null, historial: [{ desde: '' }, { desde: '2026-11' }, { desde: '2026-12', monto: null }] })
  })
})
