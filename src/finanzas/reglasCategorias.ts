// Reglas de las categorías de Finanzas: categorías de gastos, fuentes de ingresos y metas de ahorro.
import { mesesAntes } from './calculos'
import { normalizar } from './parseo'

export type TipoCategoria = 'gasto' | 'ingreso' | 'ahorro'

// Pocas por tipo para que los gráficos se lean de un vistazo.
export const TOPE: Record<TipoCategoria, number> = { gasto: 12, ingreso: 5, ahorro: 6 }
export const puedeCrear = (tipo: TipoCategoria, cuantas: number) => cuantas < TOPE[tipo]

export const yaExiste = (nombre: string, categorias: { nombre: string }[]) =>
  categorias.some(c => normalizar(c.nombre) === normalizar(nombre))

export interface SinCategoria { id_registro: string; nota: string | null; fecha_registro: string }
export interface Sugerencia { texto: string; ids: string[]; recientes: number }

// Una categoría nueva solo con evidencia: 5 o más registros sin categoría con la misma descripción en los últimos 3 meses,
// que no sea ya una categoría ni algo aprendido o descartado. Los ids son todos los de esa descripción, de cualquier fecha.
export function sugerirNuevas(sinCategoria: SinCategoria[], categorias: { nombre: string }[], aprendido: Map<string, string>,
  tipo: TipoCategoria, hoy: string): Sugerencia[] {
  if (!puedeCrear(tipo, categorias.length)) return []
  const desde = `${mesesAntes(hoy.slice(0, 7), 3)}${hoy.slice(7)}`
  const grupos = new Map<string, Sugerencia>()
  for (const r of sinCategoria) {
    const clave = normalizar(r.nota ?? '')
    if (!clave) continue
    const g = grupos.get(clave) ?? { texto: r.nota!.trim().slice(0, 60), ids: [], recientes: 0 }
    g.ids.push(r.id_registro)
    if (r.fecha_registro >= desde) g.recientes++
    grupos.set(clave, g)
  }
  return [...grupos.entries()]
    .filter(([clave, g]) => g.recientes >= 5 && !aprendido.has(clave) && !yaExiste(g.texto, categorias))
    .map(([, g]) => g)
    .sort((a, b) => b.recientes - a.recientes)
}
