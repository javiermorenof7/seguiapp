import { describe, expect, it } from 'vitest'
import { DESARROLLO, baseDe } from './entorno'

describe('entorno', () => {
  it('dev va bajo /seguiapp/ y producción en la raíz', () => {
    expect(baseDe(DESARROLLO)).toBe('/seguiapp/')
    expect(baseDe('production')).toBe('/')
    expect(baseDe('development')).toBe('/')
  })
})
