import { describe, expect, it } from 'vitest'
import {
  avisaRecordatorio, avisoRecordatorio, avisoResumenDiario, momentoColombia, PREFERENCIA_INICIAL as P,
  tocaAvisoDescarga, tocaCierreMes, tocaResumenDiario, tocaResumenSemanal,
} from './reglas'

// sábado 31 de octubre de 2026 en Colombia
const m = (hora: string, fecha = '2026-10-31', dia = 6) => ({ fecha, hora, dia })

describe('momentoColombia', () => {
  it('fecha, hora y día de la semana en Colombia', () => {
    expect(momentoColombia(new Date('2026-11-01T02:30:00Z'))).toEqual({ fecha: '2026-10-31', hora: '21:30', dia: 6 })
  })
})

describe('resumen diario', () => {
  it('desde su hora, una vez por día', () => {
    expect(tocaResumenDiario(P, m('08:55'))).toBe(false)
    expect(tocaResumenDiario(P, m('09:00'))).toBe(true)
    expect(tocaResumenDiario({ ...P, fecha_ultimo_resumen_diario: '2026-10-31' }, m('15:00'))).toBe(false)
  })
  it('lunes a viernes no sale el sábado', () => {
    expect(tocaResumenDiario({ ...P, frecuencia_resumen_diario: 'habiles' }, m('10:00'))).toBe(false)
    expect(tocaResumenDiario({ ...P, frecuencia_resumen_diario: 'habiles' }, m('10:00', '2026-10-30', 5))).toBe(true)
  })
  it('no sale si lo apagó o si los avisos están en pausa', () => {
    expect(tocaResumenDiario({ ...P, recibir_resumen_diario: false }, m('10:00'))).toBe(false)
    expect(tocaResumenDiario({ ...P, estado: 'pausado' }, m('10:00'))).toBe(false)
  })
})

describe('resumen semanal y cierre de mes', () => {
  it('semanal solo el día elegido, desde su hora', () => {
    expect(tocaResumenSemanal(P, m('19:30'))).toBe(false)
    expect(tocaResumenSemanal(P, m('19:30', '2026-11-01', 7))).toBe(true)
    expect(tocaResumenSemanal({ ...P, dia_resumen_semanal: 6 }, m('19:30'))).toBe(true)
  })
  it('cierre de mes el último día, una vez', () => {
    expect(tocaCierreMes(P, m('20:00'))).toBe(true)
    expect(tocaCierreMes(P, m('20:00', '2026-10-30', 5))).toBe(false)
    expect(tocaCierreMes({ ...P, fecha_ultimo_cierre_mes: '2026-10-31' }, m('21:00'))).toBe(false)
    expect(tocaCierreMes({ ...P, recibir_cierre_mes: false }, m('20:00'))).toBe(false)
  })
})

describe('aviso para descargar los datos', () => {
  it('el día 1 a la hora del resumen, una vez, y nada si lo apagó', () => {
    const primero = (hora: string) => m(hora, '2026-11-01', 7)
    expect(tocaAvisoDescarga(P, primero('09:00'))).toBe(true)
    expect(tocaAvisoDescarga(P, primero('08:55'))).toBe(false)
    expect(tocaAvisoDescarga(P, m('09:00'))).toBe(false)
    expect(tocaAvisoDescarga({ ...P, fecha_ultimo_aviso_descarga: '2026-11-01' }, primero('10:00'))).toBe(false)
    expect(tocaAvisoDescarga({ ...P, recibir_aviso_descarga: false }, primero('09:00'))).toBe(false)
  })
})

describe('recordatorios', () => {
  it('solo los tipos que eligió, y nada si los apagó o pausó todo', () => {
    const soloDiarios = { ...P, tipos_recordatorio: ['diario' as const] }
    expect(avisaRecordatorio(soloDiarios, { tipo_repeticion: 'diario' })).toBe(true)
    expect(avisaRecordatorio(soloDiarios, { tipo_repeticion: 'semanal' })).toBe(false)
    expect(avisaRecordatorio({ ...P, recibir_recordatorios: false }, { tipo_repeticion: 'diario' })).toBe(false)
    expect(avisaRecordatorio({ ...P, estado: 'pausado' }, { tipo_repeticion: 'diario' })).toBe(false)
  })
  it('texto genérico por defecto: no dice la descripción', () => {
    expect(avisoRecordatorio(P, { descripcion: 'Tomar la pastilla' }).cuerpo).not.toContain('pastilla')
    expect(avisoRecordatorio({ ...P, mostrar_descripcion: true }, { descripcion: 'Tomar la pastilla' }).cuerpo).toBe('Tomar la pastilla')
  })
})

describe('textos', () => {
  it('el resumen cuenta pendientes y nunca lleva montos', () => {
    const a = avisoResumenDiario({ tareas: 3, recordatorios: 1, facturas: 2, metasAtrasadas: 0 })
    expect(a.cuerpo).toBe('Hoy: 3 tareas, 1 recordatorio, 2 facturas por pagar.')
    expect(a.cuerpo).not.toMatch(/\$|\d{1,3}\.\d{3}/)
    expect(avisoResumenDiario({ tareas: 0, recordatorios: 0, facturas: 0, metasAtrasadas: 0 }).cuerpo).toContain('no tienes pendientes')
  })
})
