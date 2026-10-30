import { describe, expect, it } from 'vitest'
import { avisoInactividad, avisoRegistro, enSilencio, ignorados, porQue, ritmo, sinUso, tocaInactividad, tocaRecordatorio, umbralInactividad, type Marca } from './ritmo'

const hoy = '2026-10-30' // viernes
const dias = (n: number, desde = hoy) => Array.from({ length: n }, (_, i) => new Date(Date.parse(desde) - i * 864e5).toISOString().slice(0, 10))
const m = (hora: string, fecha = hoy, dia = 5) => ({ fecha, hora, dia })

describe('ritmo', () => {
  it('sin datos usa lo de siempre y el gym no se adivina', () => {
    expect(ritmo('gastos', [], hoy)).toMatchObject({ hora: '21:00', aprendido: false })
    expect(ritmo('gym', [], hoy).dias).toEqual([])
  })

  it('aprende días y hora de las últimas 8 semanas', () => {
    // lunes, miércoles y viernes de 8 semanas a las 7:00
    const marcas: Marca[] = dias(56).filter(f => [1, 3, 5].includes((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7 + 1)).map(fecha => ({ fecha, hora: '07:00' }))
    expect(ritmo('gym', marcas, hoy)).toEqual({ dias: [1, 3, 5], hora: '08:00', aprendido: true })
  })

  it('la hora nunca pasa de las 22:00', () => {
    expect(ritmo('gastos', dias(10).map(fecha => ({ fecha, hora: '23:30' })), hoy).hora).toBe('22:00')
  })

  it('un módulo sin uso en 30 días queda en silencio', () => {
    expect(sinUso([{ fecha: '2026-09-15', hora: '10:00' }], hoy)).toBe(true)
    expect(sinUso([{ fecha: '2026-10-20', hora: '10:00' }], hoy)).toBe(false)
  })
})

describe('cuándo avisar', () => {
  const r = { dias: [1, 2, 3, 4, 5, 6, 7], hora: '21:00', aprendido: true }
  it('solo si pasó su hora, no anotó y no se le avisó hoy', () => {
    expect(tocaRecordatorio(r, m('20:00'), false, [], new Set())).toBe(false)
    expect(tocaRecordatorio(r, m('21:10'), false, [], new Set())).toBe(true)
    expect(tocaRecordatorio(r, m('21:10'), true, [], new Set())).toBe(false)
    expect(tocaRecordatorio(r, m('21:10'), false, [hoy], new Set())).toBe(false)
    expect(tocaRecordatorio({ ...r, dias: [1] }, m('21:10'), false, [], new Set())).toBe(false)
  })

  it('baja la frecuencia con los ignorados y vuelve al anotar', () => {
    const tres = ['2026-10-27', '2026-10-28', '2026-10-29']
    expect(ignorados(tres, new Set())).toBe(3)
    expect(ignorados(tres, new Set(['2026-10-28']))).toBe(1)
    expect(tocaRecordatorio(r, m('21:10'), false, tres, new Set())).toBe(false)
    expect(tocaRecordatorio(r, m('21:10'), false, tres, new Set(['2026-10-29']))).toBe(true)
    expect(tocaRecordatorio(r, m('21:10'), false, dias(6, '2026-10-24'), new Set())).toBe(false)
  })

  it('respeta el silencio aunque cruce la medianoche', () => {
    expect(enSilencio(m('23:00'), '22:00', '06:00')).toBe(true)
    expect(enSilencio(m('05:59'), '22:00', '06:00')).toBe(true)
    expect(enSilencio(m('06:00'), '22:00', '06:00')).toBe(false)
    expect(enSilencio(m('14:00'), '13:00', '15:00')).toBe(true)
  })
})

describe('inactividad', () => {
  it('el umbral es el doble del espacio normal entre días, entre 3 y 14', () => {
    expect(umbralInactividad([])).toBe(3)
    expect(umbralInactividad(dias(10))).toBe(3)
    expect(umbralInactividad(['2026-09-01', '2026-09-05', '2026-09-09', '2026-09-13', '2026-09-17'])).toBe(8)
  })

  it('escalera de 3 avisos y luego silencio', () => {
    const fechas = dias(10, '2026-10-20') // anotaba a diario hasta el 20
    expect(tocaInactividad(fechas, [], '2026-10-22')).toBeNull()
    expect(tocaInactividad(fechas, [], '2026-10-23')).toEqual({ paso: 1, dias: 3, umbral: 3 })
    expect(tocaInactividad(fechas, ['2026-10-23'], '2026-10-25')).toBeNull()
    expect(tocaInactividad(fechas, ['2026-10-23'], '2026-10-30')).toMatchObject({ paso: 2 })
    expect(tocaInactividad(fechas, ['2026-10-23', '2026-10-30', '2026-11-06'], '2026-11-20')).toBeNull()
    expect(tocaInactividad([], [], hoy)).toBeNull()
  })
})

describe('textos', () => {
  it('juntan los módulos en un aviso y no llevan datos', () => {
    expect(avisoRegistro(['gastos']).abrir).toBe('/?ir=gasto')
    expect(avisoRegistro(['gastos', 'gym', 'habitos']).cuerpo).toBe('Te falta anotar tus gastos, tu gym y tus hábitos de hoy.')
    expect(avisoInactividad(3, 20).cuerpo).not.toMatch(/\d/)
  })

  it('explican por qué llega cada uno', () => {
    expect(porQue('gym', { dias: [1, 3], hora: '08:00', aprendido: true })).toBe('Sueles anotar el gym los lunes, miércoles; te aviso si a las 8:00 a. m. no lo has hecho.')
    expect(porQue('gastos', { dias: [1, 2, 3, 4, 5, 6, 7], hora: '21:00', aprendido: false })).toContain('Aún aprendo tu ritmo')
  })
})
