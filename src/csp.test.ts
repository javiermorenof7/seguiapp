import { describe, expect, it } from 'vitest'
import { CABECERAS, CSP } from './csp'

describe('CSP', () => {
  it('no permite código ni estilos en línea', () => {
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*/)
  })

  it('cierra lo que no se usa', () => {
    expect(CSP).toContain("default-src 'self'")
    expect(CSP).toContain("object-src 'none'")
    expect(CSP).toContain("base-uri 'self'")
  })

  it('las cabeceras de producción cierran marcos, tipos y referencias', () => {
    expect(CABECERAS).toContain(`Content-Security-Policy: ${CSP}; frame-ancestors 'none'`)
    expect(CABECERAS).toContain('Strict-Transport-Security: max-age=31536000')
    expect(CABECERAS).toContain('X-Content-Type-Options: nosniff')
    expect(CABECERAS).toContain('Referrer-Policy: no-referrer')
    expect(CABECERAS).toContain('X-Robots-Tag: noindex')
  })
})
