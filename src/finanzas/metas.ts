// Metas de ahorro: cada una es una etiqueta de Ahorro con su objetivo y fecha opcional. Fechas 'AAAA-MM-DD'.
import type { Movimiento } from './calculos'

export interface MetaAhorro { id_meta: string; id_etiqueta: string; nombre: string; valor: number; fecha_inicio: string; fecha_fin: string | null }
export type EstadoMeta = 'cumplida' | 'va_bien' | 'atrasada' | 'sin_fecha'

const dias = (desde: string, hasta: string) => (Date.parse(hasta) - Date.parse(desde)) / 86400000

// Meses que quedan contando el actual: de octubre a diciembre son 3.
export function mesesHasta(hoy: string, fin: string) {
  return (+fin.slice(0, 4) - +hoy.slice(0, 4)) * 12 + (+fin.slice(5, 7) - +hoy.slice(5, 7)) + 1
}

// Va atrasada si lo ahorrado no alcanza la parte del objetivo que corresponde al tiempo corrido desde que se creó.
export function avanceMeta(meta: MetaAhorro, movimientos: Movimiento[], hoy: string) {
  const ahorrado = movimientos.filter(m => m.tipo === 'ahorro' && m.id_etiqueta === meta.id_etiqueta).reduce((s, m) => s + m.valor, 0)
  const falta = Math.max(0, meta.valor - ahorrado)
  const porcentaje = meta.valor > 0 ? Math.min(100, Math.floor(ahorrado / meta.valor * 100)) : 100
  if (!falta) return { ahorrado, falta, porcentaje, porMes: null, estado: 'cumplida' as EstadoMeta }
  if (!meta.fecha_fin) return { ahorrado, falta, porcentaje, porMes: null, estado: 'sin_fecha' as EstadoMeta }
  const meses = Math.max(1, mesesHasta(hoy, meta.fecha_fin))
  const total = dias(meta.fecha_inicio, meta.fecha_fin)
  const corrido = total > 0 ? Math.min(1, Math.max(0, dias(meta.fecha_inicio, hoy) / total)) : 1
  return {
    ahorrado, falta, porcentaje,
    porMes: Math.ceil(falta / meses),
    estado: (ahorrado >= meta.valor * corrido ? 'va_bien' : 'atrasada') as EstadoMeta,
  }
}

// La que vence primero entre las que faltan; si ninguna tiene fecha, la más avanzada.
export function metaProxima(metas: MetaAhorro[], movimientos: Movimiento[], hoy: string) {
  const conAvance = metas.map(meta => ({ meta, ...avanceMeta(meta, movimientos, hoy) })).filter(m => m.estado !== 'cumplida')
  return conAvance.sort((a, b) => (a.meta.fecha_fin ?? '9999').localeCompare(b.meta.fecha_fin ?? '9999') || b.porcentaje - a.porcentaje)[0] ?? null
}
