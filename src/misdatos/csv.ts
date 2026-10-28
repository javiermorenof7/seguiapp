// Descarga de los datos en CSV: un archivo por módulo, una sección por tabla. Sin DOM.
// Separador ; y BOM para que Excel en español lo abra en columnas y con tildes.

export interface Seccion { titulo: string; filas: Record<string, unknown>[] }

// Un texto que empieza con = + - @ Excel lo toma como fórmula: se antepone ' (inyección de fórmulas).
function celda(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  let texto = Array.isArray(valor) ? valor.join(', ') : typeof valor === 'object' ? JSON.stringify(valor) : String(valor)
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function aCsv(secciones: Seccion[]): string {
  const lineas: string[] = []
  for (const { titulo, filas } of secciones) {
    if (lineas.length) lineas.push('')
    lineas.push(celda(titulo))
    if (!filas.length) { lineas.push('Sin datos'); continue }
    const columnas = [...new Set(filas.flatMap(Object.keys))]
    lineas.push(columnas.join(';'))
    for (const f of filas) lineas.push(columnas.map(c => celda(f[c])).join(';'))
  }
  return '﻿' + lineas.join('\r\n') + '\r\n'
}
