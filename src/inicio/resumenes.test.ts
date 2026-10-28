import { describe, expect, it } from 'vitest'
import type { RegistroGuardado, Seguimiento } from '../datos'
import { activos, resumenFinanzas, resumenHabitos, resumenSalud } from './resumenes'

const HOY = '2026-10-26'
const s = (id: string, nombre: string, codigo_plantilla: string | null, meta: number | null = null): Seguimiento => ({
  id_seguimiento: id, nombre, tipo_medida: 'numero', unidad: null, frecuencia: 'registro', codigo_plantilla,
  meta: meta === null ? null : { valor: meta, direccion: 'mas_es_mejor', periodo: 'dia' },
})
const r = (id_seguimiento: string, fecha: string, valor: number): RegistroGuardado =>
  ({ id_registro: `${id_seguimiento}${fecha}${valor}`, id_seguimiento, fecha, valor, id_etiqueta: null, grupo: null, nota: null })

describe('activos', () => {
  it('cuenta lo activado y lo que ya tiene seguimientos', () => {
    expect([...activos([s('p', 'Peso', 'cuerpo')], ['habitos'])]).toEqual(['salud', 'habitos'])
    expect(activos([s('l', 'Lectura', null)], []).size).toBe(0)
  })
})

describe('resumenFinanzas', () => {
  const lista = [s('g', 'Gastos', 'finanzas'), s('i', 'Ingresos', 'finanzas'), s('a', 'Ahorro', 'finanzas')]
  it('saldo del mes y su curva día a día, sin lo de meses anteriores', () => {
    const f = resumenFinanzas(lista, [r('i', '2026-10-01', 1000), r('g', '2026-10-01', 200), r('a', '2026-10-05', 300), r('g', '2026-09-30', 50)], HOY)!
    expect(f).toMatchObject({ idGastos: 'g', ingresos: 1000, gastos: 200, ahorro: 300, saldo: 500, hayDatos: true })
    expect(f.puntos).toEqual([{ fecha: '2026-10-01', valor: 800 }, { fecha: '2026-10-05', valor: 500 }])
  })
  it('cuenta los ingresos fijos pendientes y atrasados del mes', () => {
    const fuente = (fecha: string, id_etiqueta: string) => ({ ...r('i', fecha, 1000), id_etiqueta })
    const sueldo = ['07', '08', '09'].map(m => fuente(`2026-${m}-05`, 'sueldo'))
    const arriendo = ['07', '08', '09'].map(m => fuente(`2026-${m}-25`, 'arriendo'))
    expect(resumenFinanzas(lista, [...sueldo, ...arriendo], HOY)!.ingresosFijos).toEqual({ total: 2, pendientes: 1, atrasados: 1 })
  })
  it('null sin Finanzas', () => expect(resumenFinanzas([s('l', 'Lectura', null)], [], HOY)).toBeNull())
})

describe('resumenSalud', () => {
  const lista = [s('gym', 'Gym', 'gym'), s('p', 'Peso', 'cuerpo'), s('c', 'Cintura', 'cuerpo')]
  it('días de gym desde el lunes, último peso con su cambio a 30 días y última cintura', () => {
    const x = resumenSalud(lista, [
      r('gym', '2026-10-26', 60), r('gym', '2026-10-26', 40), r('gym', '2026-10-25', 60),
      r('p', '2026-09-20', 80), r('p', '2026-10-20', 78.5), r('c', '2026-10-10', 90),
    ], HOY)
    expect(x).toMatchObject({ diasGym: 1, peso: { valor: 78.5, cambio30: -1.5 }, cintura: { valor: 90 }, hayDatos: true })
    expect(x.puntos).toEqual([{ fecha: '2026-10-20', valor: 78.5 }])
  })
  it('sin datos', () => expect(resumenSalud(lista, [], HOY)).toMatchObject({ diasGym: 0, peso: null, cintura: null, hayDatos: false }))
})

describe('resumenHabitos', () => {
  it('hechos hoy según la meta, mejor racha viva y hechos por día de la semana', () => {
    const x = resumenHabitos([s('agua', 'Agua', 'habitos', 2), s('leer', 'Leer', 'habitos')], [
      r('agua', '2026-10-26', 1), r('leer', '2026-10-26', 1), r('leer', '2026-10-25', 1), r('agua', '2026-10-24', 2),
    ], HOY)!
    expect(x).toMatchObject({ total: 2, hechos: 1, mejorRacha: 2 })
    expect(x.puntos.map(p => p.valor)).toEqual([0, 0, 0, 0, 1, 1, 1])
    expect(x.puntos[6].fecha).toBe(HOY)
  })
})
