import { describe, expect, it } from 'vitest'
import { calendarioSemanas, cumplidosEstaSemana, diasHechos, leerCantidad, mismoNombre, mejorRacha, racha, totalDelDia, ultimosDias, type Marca } from './calculos'

const HOY = '2026-10-26'
const m = (fecha: string, valor = 1): Marca => ({ fecha, valor })

describe('leerCantidad', () => {
  it('acepta la cantidad como se escriba', () => {
    expect(leerCantidad('2')).toEqual({ valor: 2, unidad: '' })
    expect(leerCantidad(' 2,5 Litros ')).toEqual({ valor: 2.5, unidad: 'litros' })
  })
  it('los nombres no distinguen mayúsculas ni tildes', () => expect(mismoNombre('Meditación', 'meditacion')).toBe(true))
  it('rechaza lo que no es cantidad', () => expect(['', '0', 'mucho', '2 3', '1000000'].map(leerCantidad)).toEqual([null, null, null, null, null]))
})

describe('rachas', () => {
  const marcas = [m('2026-10-26'), m('2026-10-25'), m('2026-10-24'), m('2026-10-20'), m('2026-10-19'), m('2026-10-18'), m('2026-10-17')]
  it('cuenta días seguidos hasta hoy', () => expect(racha(marcas, HOY)).toBe(3))
  it('si hoy aún no, sigue viva hasta ayer', () => expect(racha(marcas.slice(1), HOY)).toBe(2))
  it('se rompe si ayer tampoco', () => expect(racha(marcas.slice(3), HOY)).toBe(0))
  it('la mejor racha es la serie más larga', () => {
    expect(mejorRacha(marcas)).toBe(4)
    expect(mejorRacha([])).toBe(0)
  })
  it('con meta diaria solo cuentan los días que la cumplen, sumando lo del día', () => {
    const agua = [m('2026-10-26', 1), m('2026-10-26', 1), m('2026-10-25', 1.5), m('2026-10-24', 2)]
    expect(totalDelDia(agua, HOY)).toBe(2)
    expect(racha(agua, HOY, 2)).toBe(1)
    expect(racha(agua, HOY)).toBe(3)
    expect(diasHechos(agua, HOY, 2)).toBe(2)
  })
})

describe('últimos días', () => {
  it('trae n días con su suma, el más antiguo primero', () => {
    const dias = ultimosDias([m('2026-10-26', 2), m('2026-10-26', 1), m('2026-10-24')], HOY, 3)
    expect(dias).toEqual([m('2026-10-24', 1), m('2026-10-25', 0), m('2026-10-26', 3)])
  })
  it('días hechos solo en la ventana', () => expect(diasHechos([m('2026-09-26'), m('2026-09-27'), m(HOY)], HOY)).toBe(2))
})

describe('calendario de semanas', () => {
  it('va de lunes a domingo, la última semana con hoy, sin días futuros', () => {
    const c = calendarioSemanas([m('2026-10-26'), m('2026-10-20', 0.5)], HOY, 1, 2)
    expect(c).toHaveLength(14)
    expect(c[0].fecha).toBe('2026-10-19')
    expect(c[1]).toEqual({ fecha: '2026-10-20', nivel: 1 })
    expect(c[7]).toEqual({ fecha: '2026-10-26', nivel: 2 })
    expect(c[8].nivel).toBeNull()
  })

  it('cuenta solo lo cumplido de la semana en curso', () => {
    const c = calendarioSemanas([m('2026-10-26'), m('2026-10-27', 0.5), m('2026-10-20')], HOY, 1, 2)
    expect(cumplidosEstaSemana(c)).toBe(1)
  })
})
