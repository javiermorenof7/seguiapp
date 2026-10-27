import { describe, expect, it } from 'vitest'
import { diasHechos, leerHabito, mismoNombre, mejorRacha, racha, totalDelDia, ultimosDias, type Marca } from './calculos'

const HOY = '2026-10-26'
const m = (fecha: string, valor = 1): Marca => ({ fecha, valor })

describe('leerHabito', () => {
  it('sin cantidad es hecho, con cantidad suma y la unidad es opcional', () => {
    expect(leerHabito('Leer', HOY)).toEqual({ habito: 'Leer', valor: null, unidad: '', fecha: HOY })
    expect(leerHabito('agua 2,5 litros', HOY)).toEqual({ habito: 'agua', valor: 2.5, unidad: 'litros', fecha: HOY })
    expect(leerHabito('meditar 10', HOY)).toEqual({ habito: 'meditar', valor: 10, unidad: '', fecha: HOY })
  })
  it('el nombre queda con mayúsculas y tildes; la fecha y la unidad no distinguen', () => {
    expect(leerHabito('  Meditación   10 Min  Ayer ', HOY)).toEqual({ habito: 'Meditación', valor: 10, unidad: 'min', fecha: '2026-10-25' })
    expect(mismoNombre('Meditación', 'meditacion')).toBe(true)
    expect(mismoNombre('Leer', 'Lectura')).toBe(false)
  })
  it('lee el día al final', () => {
    expect(leerHabito('leer ayer', HOY)?.fecha).toBe('2026-10-25')
    expect(leerHabito('agua 2 litros anteayer', HOY)).toMatchObject({ habito: 'agua', valor: 2, fecha: '2026-10-24' })
    expect(leerHabito('leer el 3', HOY)?.fecha).toBe('2026-10-03')
    expect(leerHabito('leer el 28', HOY)?.fecha).toBe('2026-09-28')
    expect(leerHabito('leer el 31/12', HOY)?.fecha).toBe('2025-12-31')
    expect(leerHabito('leer el 30', '2026-03-05')).toBeNull()
  })
  it('rechaza lo vacío, fechas que no existen y cantidades fuera de rango', () => {
    expect(leerHabito('', HOY)).toBeNull()
    expect(leerHabito('ayer', HOY)).toBeNull()
    expect(leerHabito('leer el 31/02', HOY)).toBeNull()
    expect(leerHabito('agua 0', HOY)).toBeNull()
    expect(leerHabito('x'.repeat(61), HOY)).toBeNull()
  })
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
