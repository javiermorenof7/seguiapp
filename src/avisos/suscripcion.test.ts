import { describe, expect, it } from 'vitest'
import { quiereAvisos, recordarAvisos } from './suscripcion'

const almacen = () => {
  const datos = new Map<string, string>()
  return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) }
}

describe('avisos en el equipo', () => {
  it('se renueva solo para quien los activó aquí', () => {
    const a = almacen()
    recordarAvisos('ana', true, a)
    expect(quiereAvisos('ana', a)).toBe(true)
    expect(quiereAvisos('luis', a)).toBe(false)
  })

  it('desactivar lo olvida sin tocar a los demás', () => {
    const a = almacen()
    recordarAvisos('ana', true, a)
    recordarAvisos('luis', true, a)
    recordarAvisos('ana', false, a)
    expect(quiereAvisos('ana', a)).toBe(false)
    expect(quiereAvisos('luis', a)).toBe(true)
  })

  it('un valor dañado no rompe la app', () => {
    const a = almacen()
    a.setItem('avisos_en_equipo', '{no es json')
    expect(quiereAvisos('ana', a)).toBe(false)
  })
})
