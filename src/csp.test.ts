import { describe, expect, it } from 'vitest'
import { CSP } from './csp'

describe('CSP', () => {
  it('no permite código ni estilos en línea', () => {
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*/)
  })

  it('cierra lo que no se usa', () => {
    expect(CSP).toContain("default-src 'self'")
    expect(CSP).toContain("object-src 'none'")
    expect(CSP).toContain("base-uri 'self'")
  })
})
