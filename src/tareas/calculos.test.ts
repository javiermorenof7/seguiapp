import { describe, expect, it } from 'vitest'
import { aTiempoPorSemana, aTiempoSemana, deHoy, despuesDeListo, fechaColombia, proximoEnvio, siguienteFecha, type Recordatorio, type Tarea } from './calculos'

const rec = (r: Partial<Recordatorio>): Recordatorio => ({
  id_recordatorio: 'r', descripcion: 'x', hora_envio: '09:00:00', tipo_repeticion: 'diario', dias_semana: null, dia_mes: null,
  fecha_proximo_envio: null, estado: 'activo', ...r,
})
const tarea = (t: Partial<Tarea>): Tarea => ({ id_tarea: 't', descripcion: 'x', fecha_limite: null, fecha_realizacion: null, estado: 'pendiente', ...t })
// miércoles 28 de octubre de 2026, 8:00 en Colombia
const ahora = new Date('2026-10-28T13:00:00Z')

describe('fecha de Colombia', () => {
  it('las 11 p. m. de Colombia siguen siendo el mismo día', () => {
    expect(fechaColombia('2026-10-29T04:00:00Z')).toBe('2026-10-28')
    expect(fechaColombia('2026-10-29T05:00:00Z')).toBe('2026-10-29')
  })
})

describe('siguienteFecha', () => {
  it('hábiles salta el fin de semana', () => {
    expect(siguienteFecha(rec({ tipo_repeticion: 'habiles' }), '2026-10-31')).toBe('2026-11-02')
  })
  it('semanal con varios días', () => {
    expect(siguienteFecha(rec({ tipo_repeticion: 'semanal', dias_semana: [2, 5] }), '2026-10-28')).toBe('2026-10-30')
  })
  it('mensual el 31 cae el último día en meses cortos', () => {
    expect(siguienteFecha(rec({ tipo_repeticion: 'mensual', dia_mes: 31 }), '2026-11-01')).toBe('2026-11-30')
    expect(siguienteFecha(rec({ tipo_repeticion: 'mensual', dia_mes: 31 }), '2027-02-01')).toBe('2027-02-28')
  })
})

describe('proximoEnvio', () => {
  it('hoy si la hora no ha pasado; si pasó, el siguiente día que toque', () => {
    expect(proximoEnvio(rec({}), ahora)).toBe('2026-10-28T14:00:00.000Z')
    expect(proximoEnvio(rec({ hora_envio: '07:00' }), ahora)).toBe('2026-10-29T12:00:00.000Z')
  })
  it('único: su fecha, o nada si ya pasó', () => {
    expect(proximoEnvio(rec({ tipo_repeticion: 'unico' }), ahora, '2026-11-05')).toBe('2026-11-05T14:00:00.000Z')
    expect(proximoEnvio(rec({ tipo_repeticion: 'unico', hora_envio: '07:00' }), ahora, '2026-10-28')).toBeNull()
  })
})

describe('despuesDeListo', () => {
  it('pasa al día siguiente que toque, aunque el de hoy no haya llegado a su hora', () => {
    expect(despuesDeListo(rec({ fecha_proximo_envio: '2026-10-28T14:00:00Z' }), ahora))
      .toEqual({ fecha_proximo_envio: '2026-10-29T14:00:00.000Z', estado: 'activo' })
  })
  it('si estaba atrasado varios días, sigue desde mañana', () => {
    expect(despuesDeListo(rec({ tipo_repeticion: 'habiles', fecha_proximo_envio: '2026-10-23T14:00:00Z' }), ahora).fecha_proximo_envio)
      .toBe('2026-10-29T14:00:00.000Z')
  })
  it('el único termina', () => {
    expect(despuesDeListo(rec({ tipo_repeticion: 'unico', fecha_proximo_envio: '2026-10-28T14:00:00Z' }), ahora))
      .toEqual({ fecha_proximo_envio: null, estado: 'terminado' })
  })
})

describe('deHoy', () => {
  it('vencidas, de hoy, sin fecha, hechas hoy y recordatorios de hoy o atrasados', () => {
    const tareas = [
      tarea({ id_tarea: 'v', fecha_limite: '2026-10-20' }), tarea({ id_tarea: 'h', fecha_limite: '2026-10-28' }),
      tarea({ id_tarea: 's' }), tarea({ id_tarea: 'f', fecha_limite: '2026-11-02' }),
      tarea({ id_tarea: 'x', estado: 'hecho', fecha_realizacion: '2026-10-28T20:00:00Z' }),
      tarea({ id_tarea: 'y', estado: 'hecho', fecha_realizacion: '2026-10-27T20:00:00Z' }),
    ]
    const recordatorios = [
      rec({ id_recordatorio: 'hoy', fecha_proximo_envio: '2026-10-28T14:00:00Z' }),
      rec({ id_recordatorio: 'atrasado', fecha_proximo_envio: '2026-10-26T14:00:00Z' }),
      rec({ id_recordatorio: 'manana', fecha_proximo_envio: '2026-10-29T14:00:00Z' }),
      rec({ id_recordatorio: 'pausado', estado: 'pausado', fecha_proximo_envio: '2026-10-28T14:00:00Z' }),
    ]
    const h = deHoy(tareas, recordatorios, '2026-10-28')
    expect([h.vencidas, h.deHoy, h.sinFecha, h.hechasHoy].map(l => l.map(t => t.id_tarea))).toEqual([['v'], ['h'], ['s'], ['x']])
    expect(h.recordatorios.map(r => r.id_recordatorio)).toEqual(['atrasado', 'hoy'])
  })
})

describe('aTiempoSemana', () => {
  it('tareas con fecha de lunes a domingo y las hechas a tiempo', () => {
    const tareas = [
      tarea({ fecha_limite: '2026-10-26', estado: 'hecho', fecha_realizacion: '2026-10-26T22:00:00Z' }),
      tarea({ fecha_limite: '2026-10-27', estado: 'hecho', fecha_realizacion: '2026-10-28T15:00:00Z' }),
      tarea({ fecha_limite: '2026-11-01' }),
      tarea({ fecha_limite: '2026-11-02' }), tarea({}),
    ]
    expect(aTiempoSemana(tareas, '2026-10-28')).toEqual({ aTiempo: 1, total: 3 })
  })
})

describe('aTiempoPorSemana', () => {
  it('cuenta a tiempo y tarde por semana; las pendientes que no vencen no cuentan', () => {
    const tareas = [
      tarea({ fecha_limite: '2026-10-20', estado: 'hecho', fecha_realizacion: '2026-10-20T15:00:00Z' }),
      tarea({ fecha_limite: '2026-10-21' }),
      tarea({ fecha_limite: '2026-10-26', estado: 'hecho', fecha_realizacion: '2026-10-27T15:00:00Z' }),
      tarea({ fecha_limite: '2026-10-30' }),
    ]
    expect(aTiempoPorSemana(tareas, '2026-10-28', 2)).toEqual([
      { desde: '2026-10-19', aTiempo: 1, tarde: 1 },
      { desde: '2026-10-26', aTiempo: 0, tarde: 1 },
    ])
  })
})
