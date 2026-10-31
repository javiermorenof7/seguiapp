// Reglas de las categorías de Finanzas: categorías de gastos, fuentes de ingresos y metas de ahorro.
import { mesesAntes } from './calculos'
import { normalizar } from './parseo'

export type TipoCategoria = 'gasto' | 'ingreso' | 'ahorro'

// Pocas por tipo para que los gráficos se lean de un vistazo.
export const TOPE: Record<TipoCategoria, number> = { gasto: 12, ingreso: 5, ahorro: 6 }
export const puedeCrear = (tipo: TipoCategoria, cuantas: number) => cuantas < TOPE[tipo]

// Las de Gastos con que empieza una persona nueva, con palabras clave para proponerlas desde el primer gasto.
// Hogar y Deudas las usan Facturas y Deudas; quedan cupos libres para las que la persona cree.
export const CATEGORIAS_INICIALES: { nombre: string; grupo: 'basico' | 'personal'; palabras_clave: string[] }[] = [
  { nombre: 'Hogar', grupo: 'basico', palabras_clave: ['arriendo', 'luz', 'agua', 'gas', 'internet', 'administracion', 'aseo'] },
  { nombre: 'Mercado', grupo: 'basico', palabras_clave: ['mercado', 'supermercado', 'tienda', 'fruver', 'carniceria', 'panaderia'] },
  { nombre: 'Transporte', grupo: 'basico', palabras_clave: ['taxi', 'uber', 'bus', 'transmilenio', 'metro', 'gasolina', 'parqueadero', 'peaje'] },
  { nombre: 'Salud', grupo: 'basico', palabras_clave: ['farmacia', 'drogueria', 'medico', 'cita', 'eps', 'medicamentos'] },
  { nombre: 'Deudas', grupo: 'basico', palabras_clave: ['cuota', 'tarjeta', 'credito', 'prestamo'] },
  { nombre: 'Comida fuera', grupo: 'personal', palabras_clave: ['almuerzo', 'desayuno', 'cena', 'restaurante', 'domicilio', 'cafe', 'onces'] },
  { nombre: 'Entretenimiento', grupo: 'personal', palabras_clave: ['cine', 'netflix', 'spotify', 'salida', 'fiesta', 'concierto'] },
  { nombre: 'Compras', grupo: 'personal', palabras_clave: ['ropa', 'zapatos', 'regalo', 'celular'] },
  { nombre: 'Otros', grupo: 'personal', palabras_clave: [] },
]

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
