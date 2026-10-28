import { describe, expect, it } from 'vitest'
import { amortizacion, cuotaFija, cuotasPara, estadoPrestamo, fechaCuota, leerTasa, tasaMensual, type MovimientoPrestamo, type Prestamo } from './prestamos'

const base: Prestamo = {
  id_prestamo: 'p', nombre_entidad: 'Banco', nombre_prestamo: null, valor_saldo_inicial: 1200000,
  fecha_primera_cuota: '2026-01-15', cantidad_cuotas: 12, tasa_efectiva_anual: 0, valor_seguro_mensual: 0, dia_pago: 15,
}
const mov = (m: Partial<MovimientoPrestamo>): MovimientoPrestamo => ({
  id_movimiento_prestamo: 'm', id_prestamo: 'p', id_registro: null, tipo_movimiento: 'abono', fecha_movimiento: '2026-02-20',
  numero_cuota: null, valor: null, tasa_efectiva_anual: null, tipo_abono: null, ...m,
})

describe('tasas y fechas', () => {
  it('12 % E.A. es 0,9489 % mensual', () => {
    expect(tasaMensual(12)).toBeCloseTo(0.0094888, 6)
  })
  it('cuota fija de 10 millones a 12 meses y 12 % E.A. (hecha a mano)', () => {
    expect(cuotaFija(10000000, tasaMensual(12), 12)).toBe(885621)
    expect(cuotaFija(1200000, 0, 12)).toBe(100000)
  })
  it('cuotas que hacen falta; null si la cuota no paga el interés', () => {
    expect(cuotasPara(700000, 0, 100000)).toBe(7)
    expect(cuotasPara(10000000, tasaMensual(12), 885621)).toBe(12)
    expect(cuotasPara(10000000, 0.02, 100000)).toBeNull()
  })
  it('la cuota cae el último día en meses cortos', () => {
    expect(fechaCuota('2026-01-31', 2, 31)).toBe('2026-02-28')
    expect(fechaCuota('2026-01-31', 13, 31)).toBe('2027-01-31')
  })
})

describe('amortizacion', () => {
  it('interés, capital y saldo de la primera cuota, y termina en cero', () => {
    const { filas } = amortizacion({ ...base, valor_saldo_inicial: 10000000, tasa_efectiva_anual: 12, valor_seguro_mensual: 20000 }, [])
    expect(filas).toHaveLength(12)
    expect(filas[0]).toMatchObject({ interes: 94888, capital: 790733, cuota: 885621, seguro: 20000, total: 905621, saldo: 9209267 })
    expect(filas.at(-1)!.saldo).toBe(0)
    expect(filas.reduce((s, f) => s + f.capital, 0)).toBe(10000000)
  })
  it('abono que reduce el plazo: misma cuota, menos cuotas', () => {
    const { filas } = amortizacion(base, [mov({ valor: 300000, tipo_abono: 'reduce_plazo' })])
    expect(filas).toHaveLength(9)
    expect(filas[2].cuota).toBe(100000)
  })
  it('abono que reduce la cuota: mismo plazo, cuota menor', () => {
    const { filas } = amortizacion(base, [mov({ valor: 300000, tipo_abono: 'reduce_cuota' })])
    expect(filas).toHaveLength(12)
    expect(filas[2].cuota).toBe(70000)
  })
  it('el abono del mismo día de una cuota cuenta después de ella', () => {
    const { filas } = amortizacion(base, [mov({ fecha_movimiento: '2026-02-15', valor: 300000, tipo_abono: 'reduce_cuota' })])
    expect(filas[1].cuota).toBe(100000)
    expect(filas[2].cuota).toBe(70000)
  })
  it('cambio de tasa: mantiene el plazo y recalcula la cuota', () => {
    const { filas } = amortizacion(base, [mov({ tipo_movimiento: 'cambio_tasa', tasa_efectiva_anual: 12 })])
    expect(filas).toHaveLength(12)
    expect(filas[2]).toMatchObject({ tasa: 12, cuota: cuotaFija(1000000, tasaMensual(12), 10) })
    expect(filas.at(-1)!.saldo).toBe(0)
  })
  it('cuadre: muestra la diferencia y sigue con el saldo del extracto', () => {
    const { filas, cuadres } = amortizacion(base, [mov({ tipo_movimiento: 'cuadre', valor: 950000 })])
    expect(cuadres).toEqual([{ fecha: '2026-02-20', extracto: 950000, calculado: 1000000, diferencia: -50000 }])
    expect(filas).toHaveLength(12)
    expect(filas[2].cuota).toBe(95000)
  })
  it('préstamo ya en curso: arranca en la próxima cuota con el saldo de hoy', () => {
    const { filas } = amortizacion({ ...base, valor_saldo_inicial: 500000, cantidad_cuotas: 5, fecha_primera_cuota: '2026-11-15' }, [])
    expect(filas.map(f => f.fecha)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15', '2027-03-15'])
  })
  it('un abono por todo el saldo lo deja pagado', () => {
    const { filas } = amortizacion(base, [mov({ valor: 5000000, tipo_abono: 'reduce_plazo' })])
    expect(filas).toHaveLength(2)
  })
})

describe('estadoPrestamo', () => {
  const pagada = (n: number) => mov({ tipo_movimiento: 'cuota', numero_cuota: n, valor: 100000 })
  it('antes de la primera cuota: todo el saldo y al día', () => {
    const e = estadoPrestamo(amortizacion(base, []).filas, '2025-12-01')
    expect(e).toMatchObject({ saldo: 1200000, faltan: 12, estado: 'al_dia', fin: '2026-12-15' })
    expect(e.proxima!.numero).toBe(1)
  })
  it('cuota del mes sin pagar: pendiente; vencida: atrasada', () => {
    expect(estadoPrestamo(amortizacion(base, []).filas, '2026-01-10').estado).toBe('pendiente')
    const e = estadoPrestamo(amortizacion(base, [pagada(1)]).filas, '2026-02-20')
    expect(e).toMatchObject({ estado: 'atrasada', saldo: 1000000, faltan: 11 })
    expect(e.proxima!.numero).toBe(2)
  })
})

describe('leerTasa', () => {
  it('acepta coma, punto, % y E.A.', () => {
    expect(['12,5', '12.5', '12,5 %', '12,5% E.A.', '12.5ea'].map(leerTasa)).toEqual([12.5, 12.5, 12.5, 12.5, 12.5])
    expect(leerTasa('0')).toBe(0)
  })
  it('rechaza lo que no es una tasa', () => {
    expect(['', 'doce', '250', '1.2.3', '-3'].map(leerTasa)).toEqual([null, null, null, null, null])
  })
})
