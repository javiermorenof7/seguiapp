import { describe, expect, it } from 'vitest'
import { equipoDe, instalada } from './equipo'

describe('equipoDe', () => {
  it('reconoce el equipo por el navegador', () => {
    expect(equipoDe('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe('iphone')
    expect(equipoDe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe('iphone')
    expect(equipoDe('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36')).toBe('android')
    expect(equipoDe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36')).toBe('computador')
    expect(equipoDe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130.0')).toBe('computador')
  })
})

describe('instalada', () => {
  it('sí si abre como app o en el iPhone desde el inicio', () => {
    expect([instalada(true), instalada(false, true), instalada(false), instalada(false, false)]).toEqual([true, true, false, false])
  })
})
