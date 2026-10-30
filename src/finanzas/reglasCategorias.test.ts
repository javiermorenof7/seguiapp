import { describe, expect, it } from 'vitest'
import { puedeCrear, sugerirNuevas, yaExiste, type SinCategoria } from './reglasCategorias'

const hoy = '2026-10-29'
const registros = (nota: string, fechas: string[]): SinCategoria[] =>
  fechas.map((fecha_registro, i) => ({ id_registro: `${nota}-${i}`, nota, fecha_registro }))
const cinco = ['2026-08-01', '2026-09-01', '2026-09-15', '2026-10-01', '2026-10-20']

describe('topes', () => {
  it('deja crear hasta el tope de cada tipo', () => {
    expect(puedeCrear('gasto', 11)).toBe(true)
    expect(puedeCrear('gasto', 12)).toBe(false)
    expect(puedeCrear('ingreso', 5)).toBe(false)
    expect(puedeCrear('ahorro', 5)).toBe(true)
  })

  it('no duplica nombres que solo cambian en mayúsculas o tildes', () => {
    expect(yaExiste('mercado', [{ nombre: 'Mercado' }])).toBe(true)
    expect(yaExiste('Educacion', [{ nombre: 'Educación' }])).toBe(true)
    expect(yaExiste('Mascotas', [{ nombre: 'Mercado' }])).toBe(false)
  })
})

describe('sugerirNuevas', () => {
  it('sugiere con 5 o más en 3 meses y lleva todos los registros de esa descripción', () => {
    const viejos = registros('Veterinaria', ['2025-01-10'])
    const [s] = sugerirNuevas([...registros('Veterinaria', cinco), ...registros('veterinaria ', ['2026-10-25']), ...viejos], [], new Map(), 'gasto', hoy)
    expect(s.texto).toBe('Veterinaria')
    expect(s.recientes).toBe(6)
    expect(s.ids).toHaveLength(7)
  })

  it('no sugiere con menos de 5 recientes, sin descripción, si ya existe o si se aprendió o descartó', () => {
    expect(sugerirNuevas(registros('Veterinaria', cinco.slice(1)), [], new Map(), 'gasto', hoy)).toEqual([])
    expect(sugerirNuevas(registros('', cinco), [], new Map(), 'gasto', hoy)).toEqual([])
    expect(sugerirNuevas(registros('Mercado', cinco), [{ nombre: 'mercado' }], new Map(), 'gasto', hoy)).toEqual([])
    expect(sugerirNuevas(registros('Veterinaria', cinco), [], new Map([['veterinaria', 'Veterinaria']]), 'gasto', hoy)).toEqual([])
  })

  it('no sugiere al llegar al tope', () => {
    const doce = Array.from({ length: 12 }, (_, i) => ({ nombre: `C${i}` }))
    expect(sugerirNuevas(registros('Veterinaria', cinco), doce, new Map(), 'gasto', hoy)).toEqual([])
    expect(sugerirNuevas(registros('Veterinaria', cinco), doce.slice(0, 4), new Map(), 'ingreso', hoy)).toHaveLength(1)
  })
})
