import { describe, expect, it } from 'vitest'
import { categoriaDe, leerMonto, leerMovimiento, type Categoria } from './parseo'

describe('leerMonto', () => {
  it('acepta el monto como se escriba', () => {
    expect(['35 mil', '35.000', '$35,000', '35k', '1,5 millones', '2 palos', ' 35000 '].map(leerMonto))
      .toEqual([35000, 35000, 35000, 35000, 1500000, 2000000, 35000])
  })
  it('null si no es solo un monto', () => {
    expect(['', 'almuerzo', '35 mil almuerzo', '0'].map(leerMonto)).toEqual([null, null, null, null])
  })
})

describe('leerMovimiento', () => {
  it.each([
    ['35 mil almuerzo', 35000, 'almuerzo'],
    ['almuerzo 35000', 35000, 'almuerzo'],
    ['35.000 almuerzo', 35000, 'almuerzo'],
    ['$35,000 taxi', 35000, 'taxi'],
    ['35k mercado', 35000, 'mercado'],
    ['1,2 millones arriendo', 1200000, 'arriendo'],
    ['2 millones de sueldo', 2000000, 'sueldo'],
    ['1.5m prima', 1500000, 'prima'],
    ['12,5 mil empanadas', 12500, 'empanadas'],
    ['1.234.567 viaje', 1234567, 'viaje'],
    ['en 20 mil gasolina', 20000, 'gasolina'],
  ])('%s', (texto, valor, descripcion) => {
    expect(leerMovimiento(texto)).toEqual({ valor, descripcion })
  })

  it('no inventa montos', () => {
    expect(leerMovimiento('almuerzo')).toBeNull()
    expect(leerMovimiento('0 almuerzo')).toBeNull()
  })

  it('una palabra que empieza por m no es millones', () => {
    expect(leerMovimiento('20 mercado')).toEqual({ valor: 20, descripcion: 'mercado' })
  })
})

describe('categoriaDe', () => {
  const comida: Categoria = { id_etiqueta: 'c', nombre: 'Comida', grupo: 'basico', palabras_clave: ['almuerzo', 'mercado'] }
  const ocio: Categoria = { id_etiqueta: 'o', nombre: 'Ocio y salidas', grupo: 'personal', palabras_clave: ['cine'] }
  const categorias = [comida, ocio]

  it('lo aprendido gana a las palabras clave', () => {
    expect(categoriaDe('Almuerzo', new Map([['almuerzo', 'Ocio y salidas']]), categorias)).toBe(ocio)
  })
  it('palabra clave completa, sin tildes ni mayúsculas', () => {
    expect(categoriaDe('Mercado del mes', new Map(), categorias)).toBe(comida)
    expect(categoriaDe('cinema', new Map(), categorias)).toBeNull()
  })
  it('nombre de la categoría', () => {
    expect(categoriaDe('ocio y salidas', new Map(), categorias)).toBe(ocio)
  })
  it('lo aprendido hacia una categoría que ya no existe no rompe', () => {
    expect(categoriaDe('cine', new Map([['cine', 'Borrada']]), categorias)).toBe(ocio)
  })
})
