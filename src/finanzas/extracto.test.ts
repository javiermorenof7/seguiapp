import { describe, expect, it } from 'vitest'
import { categoriaDeBanco, comercio, conciliar, diferencia, leerCentavos, leerExtracto, limpiarOcr, posibles, saldoEstimado, type Anotado, type ExtractoLeido } from './extracto'

// Extracto inventado: saldo anterior 1.000.000,00 y cuatro movimientos.
const POR_LINEA = [
  'BANCO DE PRUEBA', 'Cuenta de ahorros No. ****4321', 'Periodo 01/10/2026 al 31/10/2026', 'SALDO ANTERIOR 1.000.000,00',
  'FECHA DESCRIPCION CREDITOS DEBITOS SALDO',
  '02/10/2026 COMPRA TIENDA LA ESQUINA 0,00 45.000,00 955.000,00',
  '05/10/2026 PAGO NOMINA EMPRESA 2.500.000,00 0,00 3.455.000,00',
  '05/10/2026 TRANSPORTE 0,00 2.950,00 3.452.050,00',
  '05/10/2026 TRANSPORTE 0,00 2.950,00 3.449.100,00',
  '31/10/2026 INTERESES 0,03 0,00 3.449.100,03',
  'TOTAL CREDITOS 2.500.000,03 TOTAL DEBITOS 50.900,00',
]
// El mismo extracto con cada dato en su renglón y una descripción partida en dos.
const POR_CAMPO = [
  'Cuenta 4321', '2026',
  '02/10/2026', 'COMPRA TIENDA', 'LA ESQUINA', '0,00', '45.000,00', '955.000,00',
  '05/10/2026', 'PAGO NOMINA EMPRESA', '2.500.000,00', '0,00', '3.455.000,00',
  '05/10/2026', 'TRANSPORTE', '0,00', '2.950,00', '3.452.050,00',
  '05/10/2026', 'TRANSPORTE', '0,00', '2.950,00', '3.449.100,00',
  '31/10/2026', 'INTERESES', '0,03', '0,00', '3.449.100,03',
]

const leido = (lineas: string[]): ExtractoLeido => {
  const r = leerExtracto(lineas)
  if (!r.ok) throw new Error(r.motivo)
  return r.extracto
}

describe('leerCentavos', () => {
  it('entiende puntos, comas y negativos', () => {
    expect(leerCentavos('1.234,56')).toBe(123456)
    expect(leerCentavos('1,234.56')).toBe(123456)
    expect(leerCentavos('$ 25.000')).toBe(2500000)
    expect(leerCentavos('-1.000,00')).toBe(-100000)
    expect(leerCentavos('(1.000,00)')).toBe(-100000)
    expect(leerCentavos('1.000,00-')).toBe(-100000)
    expect(leerCentavos('0,03')).toBe(3)
  })
})

describe('leerExtracto', () => {
  it.each([['una fila por línea', POR_LINEA], ['un dato por renglón', POR_CAMPO]])('lee %s y el saldo cuadra', (_, lineas) => {
    const e = leido(lineas)
    expect(e.movimientos).toHaveLength(5)
    expect(e.movimientos.some(m => m.dudoso)).toBe(false)
    expect(e.saldoInicial).toBe(100000000)
    expect(e.saldoFinal).toBe(344910003)
    expect(e.saldoInicial + e.movimientos.reduce((t, m) => t + m.valor, 0)).toBe(e.saldoFinal)
    expect(e.ultimos4).toBe('4321')
    expect([e.desde, e.hasta]).toEqual(['2026-10-02', '2026-10-31'])
    expect(e.movimientos[0]).toMatchObject({ fecha: '2026-10-02', descripcion: 'COMPRA TIENDA LA ESQUINA', valor: -4500000 })
  })

  it('dos movimientos iguales el mismo día tienen huella distinta', () => {
    const [, , a, b] = leido(POR_LINEA).movimientos
    expect(a.valor).toBe(b.valor)
    expect(a.huella).not.toBe(b.huella)
  })

  it('con un solo monto y saldo, el signo sale del saldo', () => {
    const e = leido(['Saldo anterior $ 500.000', '03/11 MERCADO $ 80.000 $ 420.000', '04/11 ABONO $ 100.000 $ 520.000', 'Periodo noviembre 2026'])
    expect(e.movimientos.map(m => m.valor)).toEqual([-8000000, 10000000])
    expect(e.movimientos[0].fecha).toBe('2026-11-03')
    expect(e.saldoInicial).toBe(50000000)
  })

  it('lee un extracto del más nuevo al más viejo', () => {
    const e = leido(['2026', '04/11 ABONO 100.000,00 520.000,00', '03/11 MERCADO 80.000,00 420.000,00', '02/11 PAN 5.000,00 500.000,00'])
    expect(e.movimientos.map(m => m.valor)).toEqual([-500000, -8000000, 10000000])
  })

  it('marca la fila que no sigue el saldo', () => {
    const lineas = POR_LINEA.map(l => l.replace('0,00 2.950,00 3.452.050,00', '0,00 2.050,00 3.452.050,00'))
    const e = leido([...lineas, ...Array.from({ length: 8 }, (_, i) => `31/10/2026 ABONO ${i} 1,00 0,00 3.449.10${i + 1},03`)])
    expect(e.movimientos.filter(m => m.dudoso).map(m => m.descripcion)).toEqual(['TRANSPORTE'])
  })

  it('quita el "$" suelto y el pie de página de la descripción', () => {
    const e = leido(['2026', 'Saldo anterior $ 500.000,00', '01/10/2026 Recibí de PEDRO $15.000,00 $515.000,00', 'https://www.banco.com.co/tarifas',
      '05/10/2026 COMPRA EN TIENDA $-25.900,00 $489.100,00', 'Defensor del Consumidor Financiero', '07/10/2026 Pago de Intereses $2,00 $489.102,00'])
    expect(e.movimientos.map(m => m.descripcion)).toEqual(['Recibí de PEDRO', 'COMPRA EN TIENDA', 'Pago de Intereses'])
    expect(e.movimientos.map(m => m.valor)).toEqual([1500000, -2590000, 200])
  })

  // Extracto inventado con el signo aparte y sin saldo por fila: el saldo sale del resumen.
  const CON_SIGNO = [
    'CUENTA DE AHORROS', '1234 5678 4321', 'INFORME DEL MES: OCTUBRE /2026',
    'Saldo Anterior', '$1,000,000.00', 'Más Créditos', '$200,000.00', 'Menos Débitos', '$50,500.00', 'Nuevo Saldo', '$1,149,500.00',
    'Fecha Valor Doc. Clase de Movimiento Oficina',
    '02 10 $ 45,000.00 - 1111 Compra TIENDA LA ESQUINA FRANQUICIA MASTER CARD',
    'Redeban BreB',
    '05 10 $ 200,000.00 + 2222 Transferencia De Otra Entidad A Llave Redeban BreB',
    'Fecha Valor Doc. Clase de Movimiento Oficina',
    '31 10 $ 5,500.00 - 3333 Transferencia de Dinero a Bolsillo',
    'EXTRACTO BOLSILLO', 'Saldo Anterior', '$10,000.00',
  ]

  it('con el signo aparte y sin saldo por fila, arma el saldo desde el resumen', () => {
    const e = leido(CON_SIGNO)
    expect(e.movimientos.map(m => m.valor)).toEqual([-4500000, 20000000, -550000])
    expect(e.movimientos.map(m => m.saldo)).toEqual([95500000, 115500000, 114950000])
    expect([e.saldoInicial, e.saldoFinal, e.desde, e.hasta, e.ultimos4]).toEqual([100000000, 114950000, '2026-10-02', '2026-10-31', '4321'])
    expect(e.movimientos[0].descripcion).toBe('Compra TIENDA LA ESQUINA FRANQUICIA MASTER CARD')
  })

  it('con el signo aparte, si no llega al nuevo saldo no carga nada', () => {
    expect(leerExtracto(CON_SIGNO.map(l => l.replace('$ 5,500.00 -', '$ 5,500.00 +')))).toMatchObject({ ok: false, motivo: 'columnas' })
    expect(leerExtracto(CON_SIGNO.filter(l => !/^Nuevo Saldo|1,149,500/.test(l)))).toMatchObject({ ok: false, motivo: 'columnas' })
  })

  it('dice cuando no hay movimientos o no entiende las columnas', () => {
    expect(leerExtracto(['Términos y condiciones', 'Página 1 de 4'])).toEqual({ ok: false, motivo: 'sin_movimientos' })
    const r = leerExtracto(['2026', '01/10 A 10.000,00 7.000,00', '02/10 B 3.000,00 99.000,00', '03/10 C 8.000,00 1.000,00', '04/10 D 2.000,00 44.000,00'])
    expect(r).toMatchObject({ ok: false, motivo: 'columnas' })
  })
})

describe('conciliar', () => {
  const e = leido(POR_LINEA)
  const anotado = (id: string, fecha: string, pesos: number, extra: Partial<Anotado> = {}): Anotado => ({ id_registro: id, fecha, valor: pesos * 100, id_cuenta: null, nota: null, ...extra })

  it('sin nada anotado, todo falta y al agregarlo cuadra', () => {
    const c = conciliar(e, [], 'c1')
    expect(c.faltan).toHaveLength(5)
    expect(diferencia(c)).toBe(e.saldoFinal - e.saldoInicial)
  })

  it('empareja por valor con hasta 3 días y uno a uno', () => {
    const c = conciliar(e, [anotado('a', '2026-10-04', -45000), anotado('b', '2026-10-05', -2950), anotado('z', '2026-10-20', -45000)], 'c1')
    expect(c.cuadran.map(p => p.app.id_registro).sort()).toEqual(['a', 'b'])
    expect(c.faltan).toHaveLength(3)
    expect(c.sinCuenta.map(a => a.id_registro)).toEqual(['z'])
    expect(c.soloApp).toEqual([])
  })

  it('propone como pareja un ingreso parecido a 3 días o el mismo ingreso a 15 días', () => {
    const sueldo = conciliar(e, [anotado('s', '2026-10-07', 2480000)], 'c1')
    expect(sueldo.montoDistinto.map(p => [p.banco.descripcion, p.app.id_registro])).toEqual([['PAGO NOMINA EMPRESA', 's']])
    const arriendo = conciliar(e, [anotado('r', '2026-10-17', 2500000)], 'c1')
    expect(arriendo.montoDistinto.map(p => p.app.id_registro)).toEqual(['r'])
    expect(arriendo.faltan).toHaveLength(4)
  })

  it('un gasto igual a 10 días no se empareja solo', () => {
    const c = conciliar(e, [anotado('g', '2026-10-12', -45000)], 'c1')
    expect(c.montoDistinto).toEqual([])
    expect(c.sinCuenta.map(a => a.id_registro)).toEqual(['g'])
  })

  it('lo que la persona separa o une a mano manda', () => {
    const nomina = e.movimientos[1]
    const separados = conciliar(e, [anotado('s', '2026-10-07', 2480000)], 'c1', undefined, { unidos: new Map(), separados: new Set([`${nomina.huella}|s`]) })
    expect(separados.montoDistinto).toEqual([])
    expect(separados.faltan).toContain(nomina)
    const compra = e.movimientos[0]
    const exacto = conciliar(e, [anotado('a', '2026-10-02', -45000)], 'c1', undefined, { unidos: new Map(), separados: new Set([`${compra.huella}|a`]) })
    expect(exacto.cuadran).toEqual([])
    expect(exacto.faltan).toContain(compra)
    const transporte = e.movimientos[2]
    const u = anotado('u', '2026-10-15', -3000, { nota: 'bus' })
    const unidos = conciliar(e, [u], 'c1', undefined, { unidos: new Map([[transporte.huella, 'u']]), separados: new Set() })
    expect(unidos.montoDistinto.map(p => [p.banco.huella, p.app.id_registro])).toEqual([[transporte.huella, 'u']])
    const { cerca, otros } = posibles(anotado('v', '2026-10-25', -3000), e.movimientos)
    expect(cerca.map(m => m.fecha)).toEqual([])
    expect(otros.map(m => m.descripcion)).toEqual(['COMPRA TIENDA LA ESQUINA', 'TRANSPORTE', 'TRANSPORTE'])
    expect(posibles(u, e.movimientos).cerca.map(m => m.fecha)).toEqual(['2026-10-02', '2026-10-05', '2026-10-05'])
  })

  it('un monto con centavos cuadra con lo anotado en pesos', () => {
    const conCentavos = { ...e, movimientos: [{ ...e.movimientos[0], valor: -4500049 }] }
    expect(conciliar(conCentavos, [anotado('a', '2026-10-02', -45000)], 'c1').cuadran).toHaveLength(1)
  })

  it('separa el monto que no coincide y lo que solo está en la app', () => {
    const c = conciliar(e, [anotado('a', '2026-10-02', -54000, { nota: 'tienda la esquina' }), anotado('x', '2026-10-10', -20000, { id_cuenta: 'c1' }), anotado('o', '2026-10-10', -9000, { id_cuenta: 'otra' })], 'c1')
    expect(c.montoDistinto.map(p => p.app.id_registro)).toEqual(['a'])
    expect(c.soloApp.map(a => a.id_registro)).toEqual(['x'])
    expect(c.sinCuenta).toEqual([])
    // falta lo del banco menos lo anotado de más
    expect(diferencia(c)).toBe(e.saldoFinal - e.saldoInicial - -5400000 - -2000000)
  })

  it('lo ya cargado de un extracto cuadra por su huella', () => {
    const cargados = new Map(e.movimientos.map((m, i) => [m.huella, `r${i}`]))
    const c = conciliar(e, e.movimientos.map((m, i) => ({ id_registro: `r${i}`, fecha: m.fecha, valor: m.valor, id_cuenta: 'c1', nota: m.descripcion })), 'c1', cargados)
    expect(c.cuadran).toHaveLength(5)
    expect(diferencia(c)).toBe(0)
  })
})

describe('limpiarOcr', () => {
  it('deja leer una tabla sacada de una imagen', () => {
    const lineas = [
      'Periodo: Abril 2026', 'Saldo Anterior: 1,000,000.00',
      '02/04 | AB1 |Deposito nomina [0012 |Suc Centro 01 2,500,000.00| 3,500,000.00|',
      'a 05/04 | CD2 (Retiro en cajero [0012 |Suc Norte 02 -200,000.00| 3,300,000.00/',
      '" 09/04 | EF3 |Comision manejo [0012 |Suc Norte 02 -11.90| 3,299,988.10|',
      '9 12/04 | AB1 [Deposito nomina [0012 [Suc Centro 01 100,000.00| 3,399,988.10',
      '(1) Los pagos del 12/04 se abonan al día siguiente.',
    ]
    const e = leido(limpiarOcr(lineas))
    expect(e.movimientos.map(m => m.valor)).toEqual([250000000, -20000000, -1190, 10000000])
    expect(e.movimientos.some(m => m.dudoso)).toBe(false)
    expect(e.movimientos[1]).toMatchObject({ fecha: '2026-04-05', saldo: 330000000 })
    expect(e.saldoInicial).toBe(100000000)
  })
})

describe('sugerir la categoría de un movimiento del banco', () => {
  const categorias = [
    { id_etiqueta: 't', nombre: 'Transporte', grupo: null, palabras_clave: ['uber', 'taxi'] },
    { id_etiqueta: 'm', nombre: 'Mercado', grupo: null, palabras_clave: [] },
  ]

  it('quita el ruido del banco', () => {
    expect(comercio('COMPRA NAL.UBER 123')).toBe('uber')
    expect(comercio('Abono Transf. desde cta 000111222')).toBe('')
    expect(comercio('COMPRA NAL.TIENDAS LA ESQUINA')).toBe('tiendas esquina')
  })

  it('encuentra la palabra clave aunque venga pegada', () => {
    expect(categoriaDeBanco('COMPRA NAL.UBER 123', new Map(), categorias, [])?.nombre).toBe('Transporte')
  })

  it('usa lo aprendido con el comercio y, si no, donde más se anotó', () => {
    expect(categoriaDeBanco('COMPRA NAL.PANADERIA SOL 9', new Map([['panaderia sol', 'Mercado']]), categorias, [])?.nombre).toBe('Mercado')
    const historia = [{ texto: 'tiendas esquina', id_etiqueta: 'm' }, { texto: 'esquina', id_etiqueta: 'm' }, { texto: 'esquina', id_etiqueta: 't' }, { texto: 'esquina', id_etiqueta: 'otra' }]
    expect(categoriaDeBanco('COMPRA NAL.TIENDAS LA ESQUINA', new Map(), categorias, historia)?.nombre).toBe('Mercado')
    expect(categoriaDeBanco('COMPRA NAL.FERRETERIA', new Map(), categorias, historia)).toBeNull()
    expect(categoriaDeBanco('COMPRA NAL.TIENDAS LA ESQUINA', new Map(), categorias, historia.slice(1, 3))).toBeNull()
    expect(categoriaDeBanco('COMPRA NAL.MERCADO CENTRAL', new Map(), categorias, [])?.nombre).toBe('Mercado')
  })
})

describe('saldoEstimado', () => {
  it('suma al saldo del extracto solo lo anotado después de su fecha', () => {
    const anotados = [{ fecha: '2026-10-31', valor: -999 }, { fecha: '2026-11-01', valor: -20000 }, { fecha: '2026-11-05', valor: 50000 }]
    expect(saldoEstimado(100000, '2026-10-31', anotados)).toEqual({ saldo: 130000, cuantos: 2 })
    expect(saldoEstimado(100000, '2026-11-30', anotados)).toEqual({ saldo: 100000, cuantos: 0 })
  })
})
