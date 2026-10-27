import { describe, expect, it } from 'vitest'
import {
  anteriorDe, comparar, diasEntrenados, diasPorSemana, leerSerie, parecido, pesoPorDia, progreso, sugerencia, type Sesion,
} from './calculos'

const s = (fecha: string, ejercicio: string, series: number, repeticiones: number, peso: number | null): Sesion =>
  ({ fecha, ejercicio, series, repeticiones, peso })
// de la más reciente a la más antigua, como llegan de la base
const sesiones = [
  s('2026-10-15', 'press banca', 3, 8, 62.5), s('2026-10-15', 'press banca', 4, 10, 60),
  s('2026-10-10', 'dominadas', 3, 8, null), s('2026-10-08', 'press banca', 4, 10, 57.5),
  s('2026-10-01', 'press banca', 4, 10, 55), s('2026-09-01', 'sentadilla', 5, 5, 80),
]

describe('leerSerie', () => {
  it('lee ejercicio, series x repeticiones y kg', () => {
    expect(leerSerie('Press Banca 4x10 60')).toEqual({ ejercicio: 'press banca', series: 4, repeticiones: 10, peso: 60 })
    expect(leerSerie('sentadilla 5 x 5 82,5 kg')).toEqual({ ejercicio: 'sentadilla', series: 5, repeticiones: 5, peso: 82.5 })
  })
  it('sin kg es con el propio cuerpo', () => expect(leerSerie('dominadas 3x8')?.peso).toBeNull())
  it('rechaza lo que no entiende o se sale de rango', () => {
    expect(leerSerie('4x10 60')).toBeNull()
    expect(leerSerie('press banca 60')).toBeNull()
    expect(leerSerie('press 0x10')).toBeNull()
  })
})

describe('gym', () => {
  it('la vez anterior es la más reciente del ejercicio', () => expect(anteriorDe(sesiones, 'press banca')?.fecha).toBe('2026-10-15'))
  it('sugiere subir tras dos sesiones iguales', () => {
    expect(sugerencia({ ejercicio: 'press banca', series: 3, repeticiones: 8, peso: 62.5 }, sesiones)).toContain('65 kg')
    expect(sugerencia({ ejercicio: 'dominadas', series: 3, repeticiones: 8, peso: null }, sesiones)).toContain('3x9')
    expect(sugerencia({ ejercicio: 'press banca', series: 4, repeticiones: 10, peso: 60 }, [])).toBeNull()
  })
  it('¿quisiste decir…? a 2 letras o menos, solo con 4 letras o más', () => {
    const conocidos = ['press banca', 'dominadas', 'remo']
    expect(parecido('pres banka', conocidos)).toBe('press banca')
    expect(parecido('press banca', conocidos)).toBeNull()
    expect(parecido('rem', conocidos)).toBeNull()
    expect(parecido('curl biceps', conocidos)).toBeNull()
  })
  it('progreso: últimas 5, récord y cambio desde la primera', () => {
    const p = progreso(sesiones, 'press banca')
    expect(p.ultimas).toHaveLength(4)
    expect(p.record).toBe(62.5)
    expect(p.desdePrimera).toBe(7.5)
    expect(progreso(sesiones, 'dominadas')).toMatchObject({ record: null, desdePrimera: null })
  })
  it('mayor peso por día', () => expect(pesoPorDia(sesiones, 'press banca').map(p => p.valor)).toEqual([55, 57.5, 62.5]))
  it('días entrenados en 30 días', () => expect(diasEntrenados(sesiones, '2026-10-20')).toBe(4))
  it('días por semana, la más antigua primero', () => {
    const semanas = diasPorSemana(sesiones, '2026-10-21', 3)
    expect(semanas.map(w => w.dias)).toEqual([1, 2, 1])
    expect(semanas[2].desde).toBe('2026-10-15')
  })
})

it('comparar frente al último y a hace 30 días', () => {
  const pesos = [{ fecha: '2026-09-10', valor: 80 }, { fecha: '2026-09-20', valor: 79 }, { fecha: '2026-10-18', valor: 78 }]
  expect(comparar(77.5, pesos, '2026-10-20')).toEqual({
    ultimo: { fecha: '2026-10-18', cambio: -0.5 }, hace30: { fecha: '2026-09-20', cambio: -1.5 },
  })
  expect(comparar(80, [], '2026-10-20')).toEqual({ ultimo: null, hace30: null })
})
