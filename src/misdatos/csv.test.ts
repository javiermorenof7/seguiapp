import { describe, expect, it } from 'vitest'
import { aCsv } from './csv'

const lineas = (csv: string) => csv.replace('﻿', '').split('\r\n')

describe('aCsv', () => {
  it('empieza con BOM y separa con ;', () => {
    const csv = aCsv([{ titulo: 'Tareas', filas: [{ descripcion: 'Pagar luz', estado: 'hecho' }] }])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lineas(csv)).toEqual(['Tareas', 'descripcion;estado', 'Pagar luz;hecho', ''])
  })

  it('comillas para ; comillas y saltos de línea; vacío para null', () => {
    const csv = aCsv([{ titulo: 'Registros', filas: [{ nota: 'a;b', otra: 'dijo "hola"', linea: 'uno\ndos', vacio: null }] }])
    expect(csv).toContain('"a;b";"dijo ""hola""";"uno\ndos";\r\n')
  })

  it('no deja pasar fórmulas en textos, pero sí números negativos', () => {
    const csv = aCsv([{ titulo: 'x', filas: [{ nota: '=HYPERLINK("x")', otra: '@SUM(1)', valor: -5000 }] }])
    expect(lineas(csv)[2]).toBe(`"'=HYPERLINK(""x"")";'@SUM(1);-5000`)
  })

  it('arreglos en una celda, columnas de todas las filas y secciones vacías', () => {
    const csv = aCsv([
      { titulo: 'Etiquetas', filas: [{ nombre: 'Mercado', palabras_clave: ['d1', 'ara'] }, { nombre: 'Gym', grupo: 'personal' }] },
      { titulo: 'Metas', filas: [] },
    ])
    expect(lineas(csv)).toEqual(['Etiquetas', 'nombre;palabras_clave;grupo', 'Mercado;d1, ara;', 'Gym;;personal', '', 'Metas', 'Sin datos', ''])
  })
})
