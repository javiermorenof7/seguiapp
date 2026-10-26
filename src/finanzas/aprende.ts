// Lo que la app aprende de los movimientos de cada persona.
import { mesDe, mesesAntes, type Movimiento } from './calculos'
import { normalizar } from './parseo'

export interface Reparto { basicos: number; personales: number; ahorro: number; avisos: string[] }

// Porcentajes del ingreso del mes. Un gasto sin grupo ni categoría cuenta como personal.
export function cincuentaTreintaVeinte(movimientos: Movimiento[], mes: string, grupoDeEtiqueta: Map<string, string | null>): Reparto | null {
  const delMes = movimientos.filter(m => mesDe(m.fecha) === mes)
  const ingresos = delMes.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.valor, 0)
  if (!ingresos) return null
  let basicos = 0, personales = 0, ahorro = 0
  for (const m of delMes) {
    if (m.tipo === 'ahorro') ahorro += m.valor
    if (m.tipo !== 'gasto') continue
    const grupo = m.grupo ?? (m.id_etiqueta ? grupoDeEtiqueta.get(m.id_etiqueta) : null)
    if (grupo === 'basico') basicos += m.valor
    else personales += m.valor
  }
  const pct = (v: number) => Math.round((v / ingresos) * 100)
  const r = { basicos: pct(basicos), personales: pct(personales), ahorro: pct(ahorro), avisos: [] as string[] }
  if (r.basicos > 50) r.avisos.push(`Los gastos básicos van en ${r.basicos} % de tus ingresos (lo sano es hasta 50 %).`)
  if (r.personales > 30) r.avisos.push(`Los gastos personales van en ${r.personales} % de tus ingresos (lo sano es hasta 30 %).`)
  return r
}

// Más del doble del promedio de esa descripción en 6 meses (o, si no hay 3 registros, de su categoría).
export function gastoInusual(
  movimientos: Movimiento[], nuevo: { valor: number; descripcion: string; id_etiqueta: string | null }, mes: string,
): { promedio: number; base: 'descripcion' | 'categoria' } | null {
  const desde = mesesAntes(mes, 6)
  const recientes = movimientos.filter(m => m.tipo === 'gasto' && mesDe(m.fecha) >= desde)
  const d = normalizar(nuevo.descripcion)
  const porDescripcion = d ? recientes.filter(m => normalizar(m.nota ?? '') === d) : []
  const porCategoria = nuevo.id_etiqueta ? recientes.filter(m => m.id_etiqueta === nuevo.id_etiqueta) : []
  const [base, lista] = porDescripcion.length >= 3 ? ['descripcion', porDescripcion] as const : ['categoria', porCategoria] as const
  if (lista.length < 3) return null
  const promedio = Math.round(lista.reduce((s, m) => s + m.valor, 0) / lista.length)
  return nuevo.valor > promedio * 2 ? { promedio, base } : null
}

export interface Grupo { texto: string; ids: string[]; total: number }

// Gastos sin categoría agrupados por descripción, los grupos más grandes primero.
export function agrupar(sinCategoria: { id_registro: string; nota: string | null; valor: number }[]): Grupo[] {
  const grupos = new Map<string, Grupo>()
  for (const r of sinCategoria) {
    const clave = normalizar(r.nota ?? '')
    const g = grupos.get(clave) ?? { texto: r.nota?.trim() || 'Sin descripción', ids: [], total: 0 }
    g.ids.push(r.id_registro)
    g.total += r.valor
    grupos.set(clave, g)
  }
  return [...grupos.values()].sort((a, b) => b.ids.length - a.ids.length || b.total - a.total)
}
