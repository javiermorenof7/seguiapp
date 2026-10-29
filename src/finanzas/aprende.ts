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

const diasEntre = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00Z`) - Date.parse(`${b}T12:00Z`)) / 86_400_000

export interface Sugerido { nota: string; valor: number; id_etiqueta: string | null }

// Lo que más registra de ese tipo: cuenta las veces, pesa más lo de los últimos 30 días y lo del mismo día de la semana.
// shortcut: sin la hora del registro; si la base empieza a guardarla, sumar también la franja del día.
export function sugeridos(movimientos: Movimiento[], tipo: Movimiento['tipo'], hoy: string, n = 5): Sugerido[] {
  const diaSemana = new Date(`${hoy}T12:00Z`).getUTCDay()
  const grupos = new Map<string, { puntos: number; ultimo: Movimiento }>()
  for (const m of movimientos) {
    const clave = normalizar(m.nota ?? '')
    if (m.tipo !== tipo || !clave || m.fecha > hoy) continue
    const puntos = 1 + (diasEntre(m.fecha, hoy) <= 30 ? 1 : 0) + (new Date(`${m.fecha}T12:00Z`).getUTCDay() === diaSemana ? 0.5 : 0)
    const g = grupos.get(clave)
    if (!g) grupos.set(clave, { puntos, ultimo: m })
    else { g.puntos += puntos; if (m.fecha > g.ultimo.fecha) g.ultimo = m }
  }
  return [...grupos.values()].filter(g => g.puntos >= 2).sort((a, b) => b.puntos - a.puntos || b.ultimo.fecha.localeCompare(a.ultimo.fecha))
    .slice(0, n).map(({ ultimo: m }) => ({ nota: m.nota!, valor: m.valor, id_etiqueta: m.id_etiqueta }))
}

// Misma descripción, valor parecido (±10 %) y a 2 días o menos: probablemente ya está registrado.
export function posibleRepetido(movimientos: Movimiento[], nuevo: { tipo: Movimiento['tipo']; fecha: string; valor: number; descripcion: string }) {
  const d = normalizar(nuevo.descripcion)
  if (!d) return null
  return movimientos.find(m => m.tipo === nuevo.tipo && normalizar(m.nota ?? '') === d && diasEntre(m.fecha, nuevo.fecha) <= 2
    && Math.abs(m.valor - nuevo.valor) <= nuevo.valor * 0.1) ?? null
}

// La factura cuyo servicio aparece en lo que escribió ("pago de agua" → Agua · Casa).
export function facturaParecida<R extends { nombre_servicio: string }>(recibos: R[], descripcion: string): R | null {
  const d = ` ${normalizar(descripcion)} `
  return d.trim() ? recibos.find(r => d.includes(` ${normalizar(r.nombre_servicio)} `)) ?? null : null
}
