import { describe, expect, it } from 'vitest'
import { agregado, estado, formatoValor, inicioPeriodo, ordenEstado, periodoDe, serie } from './indicadores'

describe('inicioPeriodo', () => {
  const miercoles = new Date(2026, 9, 21)
  it('semana desde el lunes', () => expect(inicioPeriodo('semana', miercoles)).toBe('2026-10-19'))
  it('mes y año', () => {
    expect(inicioPeriodo('mes', miercoles)).toBe('2026-10-01')
    expect(inicioPeriodo('ano', miercoles)).toBe('2026-01-01')
  })
  it('domingo pertenece a la semana que empezó el lunes anterior', () =>
    expect(inicioPeriodo('semana', new Date(2026, 9, 25))).toBe('2026-10-19'))
})

describe('periodoDe', () => {
  it('manda la meta; sin meta, la frecuencia (registro = mes)', () => {
    expect(periodoDe('dia', { valor: 1, direccion: 'mas_es_mejor', periodo: 'semana' })).toBe('semana')
    expect(periodoDe('registro')).toBe('mes')
    expect(periodoDe('dia')).toBe('dia')
  })
})

describe('agregado', () => {
  const r = [{ fecha: '2026-10-01', valor: 10 }, { fecha: '2026-10-02', valor: 20 }]
  it('suma dinero y promedia números', () => {
    expect(agregado('dinero', r)).toBe(30)
    expect(agregado('numero', r)).toBe(15)
  })
  it('sin registros: 0 si se suma, nada si se promedia', () => {
    expect(agregado('dinero', [])).toBe(0)
    expect(agregado('escala', [])).toBeNull()
  })
})

describe('estado', () => {
  const tope = { valor: 100, direccion: 'menos_es_mejor' as const, periodo: 'mes' as const }
  const objetivo = { valor: 100, direccion: 'mas_es_mejor' as const, periodo: 'mes' as const }
  it('menos es mejor: bajo el 80 % va bien, hasta el tope cerca, pasado fuera', () => {
    expect(estado(50, tope)).toBe('en_meta')
    expect(estado(80, tope)).toBe('cerca')
    expect(estado(100, tope)).toBe('cerca')
    expect(estado(101, tope)).toBe('fuera')
  })
  it('más es mejor: desde la meta va bien, desde el 80 % cerca', () => {
    expect(estado(100, objetivo)).toBe('en_meta')
    expect(estado(85, objetivo)).toBe('cerca')
    expect(estado(10, objetivo)).toBe('fuera')
  })
  it('sin meta o sin valor no hay estado', () => {
    expect(estado(10, null)).toBeNull()
    expect(estado(null, tope)).toBeNull()
  })
  it('orden: fuera, cerca, en meta, sin meta', () =>
    expect(['en_meta', null, 'fuera', 'cerca'].sort((a, b) => ordenEstado(a as never) - ordenEstado(b as never)))
      .toEqual(['fuera', 'cerca', 'en_meta', null]))
})

describe('serie', () => {
  const r = [{ fecha: '2026-10-03', valor: 5 }, { fecha: '2026-10-01', valor: 10 }]
  it('acumula en orden de fecha si se suma', () =>
    expect(serie('dinero', r).map(p => p.valor)).toEqual([10, 15]))
  it('deja los valores si se promedia', () =>
    expect(serie('numero', r).map(p => p.valor)).toEqual([10, 5]))
})

describe('formatoValor', () => {
  it('pesos sin decimales y unidades', () => {
    expect(formatoValor('dinero', 35000)).toBe('$35.000')
    expect(formatoValor('numero', 78.5, 'kg')).toBe('78,5 kg')
    expect(formatoValor('numero', null)).toBe('—')
  })
})
