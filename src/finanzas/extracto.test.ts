import { describe, expect, it } from 'vitest'
import { conciliar, diferencia, leerCentavos, leerExtracto, type Anotado, type ExtractoLeido } from './extracto'

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
