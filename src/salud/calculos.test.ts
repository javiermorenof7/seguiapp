import { describe, expect, it } from 'vitest'
import {
  anteriorDe, cambioPeso, comparar, constancia, seriesPorDia, diasEntrenados, faltaParaMeta, estadoSemana, leerSerie, parecido, pesoPorDia, progreso, seriesDeUltima, sesionesPorDia, sugerencia, textoSerie, type Sesion,
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
  it('lee cada campo; el peso con coma, punto o kg', () => {
    expect(leerSerie('Press Banca ', '4', '10', '60')).toEqual({ ejercicio: 'press banca', series: 4, repeticiones: 10, peso: 60 })
    expect(leerSerie('sentadilla', '5', '5', '82,5 kg')).toEqual({ ejercicio: 'sentadilla', series: 5, repeticiones: 5, peso: 82.5 })
  })
  it('sin kg es con el propio cuerpo', () => expect(leerSerie('dominadas', '3', '8', ' ')?.peso).toBeNull())
  it('rechaza lo que no entiende o se sale de rango', () => {
    expect(leerSerie('', '4', '10', '60')).toBeNull()
    expect(leerSerie('press', '0', '10', '')).toBeNull()
    expect(leerSerie('press', '4', 'diez', '')).toBeNull()
    expect(leerSerie('press', '4', '10', 'mucho')).toBeNull()
  })
})

describe('gym', () => {
  it('cambio de peso del primer al último día del período; null con un solo día', () => {
    expect(cambioPeso(pesoPorDia(sesiones, 'press banca'))).toBe(7.5)
    expect(cambioPeso(pesoPorDia(sesiones, 'press banca', '2026-10-15'))).toBeNull()
  })
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
})

it('lo que falta para la meta según la dirección', () => {
  expect(faltaParaMeta(80.5, 75, 'menos_es_mejor')).toBe(5.5)
  expect(faltaParaMeta(74, 75, 'menos_es_mejor')).toBe(0)
  expect(faltaParaMeta(30, 35, 'mas_es_mejor')).toBe(5)
})

it('comparar frente al último y a hace 30 días', () => {
  const pesos = [{ fecha: '2026-09-10', valor: 80 }, { fecha: '2026-09-20', valor: 79 }, { fecha: '2026-10-18', valor: 78 }]
  expect(comparar(77.5, pesos, '2026-10-20')).toEqual({
    ultimo: { fecha: '2026-10-18', cambio: -0.5 }, hace30: { fecha: '2026-09-20', cambio: -1.5 },
  })
  expect(comparar(80, [], '2026-10-20')).toEqual({ ultimo: null, hace30: null })
  // desde la fecha del último pesaje, no desde hoy: si no se pesa hace meses no se compara consigo mismo
  expect(comparar(78, pesos, '2026-10-18').hace30).toEqual({ fecha: '2026-09-10', cambio: -2 })
})

describe('meta semanal del gym', () => {
  it('estado de cada semana frente a la meta', () => {
    expect([estadoSemana(4, 4), estadoSemana(3, 4), estadoSemana(1, 4)]).toEqual(['en_meta', 'cerca', 'fuera'])
    // el lunes sin entrenar todavía se puede llegar
    expect([estadoSemana(0, 4, 6), estadoSemana(0, 4, 2)]).toEqual(['cerca', 'fuera'])
  })
  it('series de cada día del mes, nada en los que no han llegado', () => {
    const ses = (fecha: string, series: number) => ({ fecha, ejercicio: 'x', series, repeticiones: 10, peso: null })
    const dias = seriesPorDia([ses('2026-10-02', 1), ses('2026-10-02', 1), ses('2026-10-03', 4)], '2026-10-01', '2026-10-05', '2026-10-03')
    expect(dias.map(d => d.series)).toEqual([0, 2, 4, null, null])
  })
  it('constancia por día, por semana del mes y por mes del año', () => {
    const s = ['2026-10-05', '2026-10-06', '2026-10-21', '2026-10-21', '2026-11-02'].map(fecha => ({ fecha, ejercicio: 'x', series: 1, repeticiones: 1, peso: null }))
    const semana = constancia(s, 'semana', '2026-10-19', '2026-10-25', '2026-10-21')
    expect(semana.map(g => g.dias)).toEqual([0, 0, 1, 0, 0, 0, 0])
    expect(semana[3].futuro).toBe(true)
    const mes = constancia(s, 'mes', '2026-10-01', '2026-10-31', '2026-10-21')
    expect(mes.map(g => g.desde)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(mes.map(g => g.dias)).toEqual([0, 2, 0, 1, 0])
    const ano = constancia(s, 'ano', '2026-01-01', '2026-12-31', '2026-10-21')
    expect(ano[9]).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31', dias: 3 })
    expect(ano[10]).toMatchObject({ dias: 0, futuro: true })
  })
})

describe('series individuales', () => {
  const ses = (fecha: string, series: number, repeticiones: number, peso: number | null) => ({ fecha, ejercicio: 'press banca', series, repeticiones, peso })
  // llegan de la más reciente a la más antigua: dentro del día, la última serie primero
  const sesiones = [ses('2026-10-29', 1, 6, 70), ses('2026-10-29', 1, 8, 65), ses('2026-10-29', 1, 10, 60), ses('2026-10-20', 4, 10, 60)]

  it('agrupa por día con las series en el orden en que se hicieron', () => {
    const dias = sesionesPorDia(sesiones, 'press banca')
    expect(dias.map(d => d.fecha)).toEqual(['2026-10-29', '2026-10-20'])
    expect(dias[0].series.map(s => s.peso)).toEqual([60, 65, 70])
  })

  it('precarga la última sesión serie por serie y abre las viejas', () => {
    expect(seriesDeUltima(sesiones, 'press banca')).toEqual([{ repeticiones: 10, peso: 60 }, { repeticiones: 8, peso: 65 }, { repeticiones: 6, peso: 70 }])
    expect(seriesDeUltima(sesiones.slice(3), 'press banca')).toHaveLength(4)
    expect(seriesDeUltima(sesiones, 'sentadilla')).toEqual([])
  })

  it('escribe cada serie como en el gimnasio', () => {
    expect(textoSerie({ series: 1, repeticiones: 10, peso: 60 })).toBe('60 kg × 10')
    expect(textoSerie({ series: 1, repeticiones: 12, peso: null })).toBe('Tu cuerpo × 12')
    expect(textoSerie({ series: 4, repeticiones: 10, peso: 60 })).toBe('4 × 10 · 60 kg')
  })
})
