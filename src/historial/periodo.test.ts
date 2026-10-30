import { describe, expect, it } from 'vitest'
import { agrupar, mover, porSemanas, rango } from './periodo'

describe('rango', () => {
  it('semana de lunes a domingo, mes completo y año', () => {
    expect(rango('semana', '2026-10-27')).toEqual({ desde: '2026-10-26', hasta: '2026-11-01', titulo: 'Semana del 26/10' })
    expect(rango('semana', '2026-11-01').desde).toBe('2026-10-26')
    expect(rango('mes', '2024-02-10')).toMatchObject({ desde: '2024-02-01', hasta: '2024-02-29' })
    expect(rango('mes', '2026-10-27').titulo).toContain('octubre')
    expect(rango('ano', '2026-10-27')).toEqual({ desde: '2026-01-01', hasta: '2026-12-31', titulo: '2026' })
  })
})

describe('mover', () => {
  it('cruza meses y años', () => {
    expect(mover('semana', '2026-12-28', 1)).toBe('2027-01-04')
    expect(mover('mes', '2026-01-31', -1)).toBe('2025-12-01')
    expect(mover('ano', '2026-10-27', -1)).toBe('2025-01-01')
  })
})

describe('agrupar', () => {
  const registros = [{ fecha: '2026-10-26', valor: 10 }, { fecha: '2026-10-26', valor: 5 }, { fecha: '2026-10-28', valor: 1 }, { fecha: '2026-11-02', valor: 9 }]
  it('por día en la semana, sin lo de fuera del período', () => {
    const p = agrupar('semana', rango('semana', '2026-10-27'), registros, true)
    expect(p).toHaveLength(7)
    expect(p.slice(0, 3).map(x => x.valor)).toEqual([15, 0, 1])
  })
  it('por mes en el año, contando registros', () => {
    const p = agrupar('ano', rango('ano', '2026-01-01'), registros, false)
    expect(p).toHaveLength(12)
    expect(p[9]).toEqual({ fecha: '2026-10-01', valor: 3 })
    expect(p[10].valor).toBe(1)
  })
})

describe('agrupar por máximo y por semanas', () => {
  const r = rango('mes', '2026-10-15')
  const registros = [{ fecha: '2026-10-02', valor: 60 }, { fecha: '2026-10-02', valor: 70 }, { fecha: '2026-10-09', valor: 65 }]
  it('máximo deja vacíos los días sin registro', () => {
    const p = agrupar('mes', r, registros, 'maximo')
    expect(p.find(x => x.fecha === '2026-10-02')!.valor).toBe(70)
    expect(p.find(x => x.fecha === '2026-10-03')!.valor).toBeNull()
  })
  it('conteo con cuánto vale cada registro (p. ej. series)', () => {
    expect(agrupar('mes', r, registros, 'conteo', () => 3).find(x => x.fecha === '2026-10-02')!.valor).toBe(6)
  })
  it('junta el mes en bloques de 7 días', () => {
    const s = porSemanas(agrupar('mes', r, registros, 'suma'), 'suma')
    expect(s.map(x => x.etiqueta)).toEqual(['1–7', '8–14', '15–21', '22–28', '29–31'])
    expect(s.map(x => x.valor)).toEqual([130, 65, 0, 0, 0])
    expect(porSemanas(agrupar('mes', r, registros, 'maximo'), 'maximo')[2].valor).toBeNull()
  })
})
