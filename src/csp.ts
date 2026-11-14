// Política de contenido: solo la propia web, Supabase y las fotos de perfil de Google.
export const CSP = [
  "default-src 'self'",
  // wasm-unsafe-eval deja compilar WebAssembly propio (leer extractos en imagen); no abre eval ni código en línea
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "connect-src 'self' https://soanuxwzrixrtslsqpyf.supabase.co",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

// Cabeceras de Cloudflare (`_headers`). frame-ancestors solo funciona como cabecera, no en la meta.
export const CABECERAS = `/*
  Content-Security-Policy: ${CSP}; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  X-Robots-Tag: noindex, nofollow
`
