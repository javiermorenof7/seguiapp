import { describe, expect, it } from 'vitest'
import { avanceMeta, mesesHasta, metaProxima, type MetaAhorro } from './metas'
import type { Movimiento } from './calculos'

const viaje: MetaAhorro = { id_meta: 'm1', id_etiqueta: 'viaje', nombre: 'Viaje', valor: 3000000, fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31' }
const ahorro = (valor: number, id_etiqueta: string | null = 'viaje', fecha = '2026-05-10'): Movimiento => ({ fecha, valor, tipo: 'ahorro', id_etiqueta })

describe('mesesHasta', () => {
  it('cuenta el mes actual', () => {
    expect(mesesHasta('2026-10-28', '2026-12-01')).toBe(3)
    expect(mesesHasta('2026-10-28', '2027-01-15')).toBe(4)
    expect(mesesHasta('2026-10-28', '2026-10-30')).toBe(1)
  })
})

describe('avanceMeta', () => {
  it('suma solo los ahorros de su etiqueta', () => {
    const a = avanceMeta(viaje, [ahorro(1000000), ahorro(500000, null), ahorro(200000, 'otra'), { ...ahorro(900000), tipo: 'gasto' }], '2026-03-01')
    expect(a).toMatchObject({ ahorrado: 1000000, falta: 2000000, porcentaje: 33 })
  })
  it('cuánto falta por mes hasta la fecha, contando el mes actual', () => {
    expect(avanceMeta(viaje, [ahorro(1000000)], '2026-10-28').porMes).toBe(Math.ceil(2000000 / 3))
  })
  it('va bien si lo ahorrado alcanza lo esperado al día de hoy; si no, atrasada', () => {
    expect(avanceMeta(viaje, [ahorro(1000000)], '2026-03-01').estado).toBe('va_bien')
    expect(avanceMeta(viaje, [ahorro(1000000)], '2026-10-28').estado).toBe('atrasada')
  })
  it('cumplida al llegar al objetivo, aunque sobre', () => {
    expect(avanceMeta(viaje, [ahorro(2000000), ahorro(1500000)], '2026-10-28')).toMatchObject({ estado: 'cumplida', falta: 0, porcentaje: 100, porMes: null })
  })
  it('sin fecha: avance sin cuota mensual', () => {
    expect(avanceMeta({ ...viaje, fecha_fin: null }, [ahorro(600000)], '2026-10-28')).toMatchObject({ estado: 'sin_fecha', porcentaje: 20, porMes: null })
  })
  it('fecha vencida sin cumplir: atrasada y falta todo en un mes', () => {
    expect(avanceMeta(viaje, [ahorro(1000000)], '2027-02-01')).toMatchObject({ estado: 'atrasada', porMes: 2000000 })
  })
})

describe('metaProxima', () => {
  it('la que vence primero entre las que faltan', () => {
    const casa = { ...viaje, id_meta: 'm2', id_etiqueta: 'casa', nombre: 'Casa', fecha_fin: '2026-11-30' }
    const libre = { ...viaje, id_meta: 'm3', id_etiqueta: 'libre', nombre: 'Libre', fecha_fin: null }
    expect(metaProxima([viaje, libre, casa], [], '2026-10-28')!.meta.nombre).toBe('Casa')
    expect(metaProxima([viaje, casa], [ahorro(3000000, 'casa')], '2026-10-28')!.meta.nombre).toBe('Viaje')
    expect(metaProxima([], [], '2026-10-28')).toBeNull()
  })
})
