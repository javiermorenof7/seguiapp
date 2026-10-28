// Lee lo que la persona escribe ("35 mil almuerzo") y propone la categoría con lo que ya aprendió.
import { formatoValor } from '../indicadores'

export interface Categoria { id_etiqueta: string; nombre: string; grupo: 'basico' | 'personal' | null; palabras_clave: string[] }

export const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' ').toLowerCase().trim()

const MULTIPLICADOR: Record<string, number> = { k: 1e3, mil: 1e3, m: 1e6, millon: 1e6, millones: 1e6, palo: 1e6, palos: 1e6 }
const MONTO = /\$?\s*(\d[\d.,]*)\s*(k|mil|millones|millon|millón|m|palos?)?(?![\p{L}\d])/iu

// "35.000" y "35,000" son miles; con multiplicador ("1,5 millones") la coma o el punto es decimal.
function numero(cifra: string, conMultiplicador: boolean): number {
  if (conMultiplicador) return Number(cifra.replace(',', '.'))
  if (/^\d{1,3}([.,]\d{3})+$/.test(cifra)) return Number(cifra.replace(/[.,]/g, ''))
  return Number(cifra.replace(',', '.'))
}

export function leerMovimiento(texto: string): { valor: number; descripcion: string } | null {
  const coincidencia = MONTO.exec(texto)
  if (!coincidencia) return null
  const [todo, cifra, sufijo] = coincidencia
  const factor = sufijo ? MULTIPLICADOR[normalizar(sufijo)] : 1
  const valor = Math.round(numero(cifra, !!sufijo) * factor)
  if (!Number.isFinite(valor) || valor <= 0 || valor >= 1e12) return null
  const descripcion = (texto.slice(0, coincidencia.index) + ' ' + texto.slice(coincidencia.index + todo.length))
    .replace(/\s+/g, ' ').replace(/^\s*(de|en)\s+/i, '').trim()
  return { valor, descripcion }
}

// Solo el monto, escrito como la persona quiera ("35 mil", "35.000", "1,5 millones"); null si trae algo más.
export function leerMonto(texto: string): number | null {
  const leido = leerMovimiento(texto)
  return leido && !leido.descripcion ? leido.valor : null
}

export const MONTO_INVALIDO = 'Escribe el valor, por ejemplo 85 mil o 85.000.'

// Lo que se leyó, para mostrarlo bajo el campo mientras se escribe.
export function leidoDe(texto: string): string {
  if (!texto.trim()) return ''
  const valor = leerMonto(texto)
  return valor === null ? 'No entiendo el valor' : `= ${formatoValor('dinero', valor)}`
}

// Lo aprendido → palabra clave → nombre de la categoría; igual que en la hoja de antes.
export function categoriaDe(descripcion: string, aprendido: Map<string, string>, categorias: Categoria[]): Categoria | null {
  const d = normalizar(descripcion)
  if (!d) return null
  const porNombre = (nombre?: string) => categorias.find(c => normalizar(c.nombre) === normalizar(nombre ?? ''))
  const aprendida = porNombre(aprendido.get(d))
  if (aprendida) return aprendida
  const conEspacios = ` ${d} `
  return categorias.find(c => c.palabras_clave.some(p => conEspacios.includes(` ${normalizar(p)} `))) ?? porNombre(d) ?? null
}
