export type TipoMedida = 'dinero' | 'numero' | 'si_no' | 'duracion' | 'escala'
export type Frecuencia = 'registro' | 'dia' | 'semana' | 'mes'
export type Periodo = 'dia' | 'semana' | 'mes' | 'ano'
export type Direccion = 'mas_es_mejor' | 'menos_es_mejor'
export type Estado = 'en_meta' | 'cerca' | 'fuera'

export interface Meta { valor: number; direccion: Direccion; periodo: Periodo }
export interface Registro { fecha: string; valor: number }

// Dinero, duración y sí/no se suman en el período; número y escala se promedian.
export const seSuma = (tipo: TipoMedida) => tipo === 'dinero' || tipo === 'duracion' || tipo === 'si_no'

export function periodoDe(frecuencia: Frecuencia, meta?: Meta | null): Periodo {
  if (meta) return meta.periodo
  return frecuencia === 'registro' ? 'mes' : frecuencia
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

// Primer día (ISO) del período que contiene "hoy"; la semana empieza el lunes.
export function inicioPeriodo(periodo: Periodo, hoy: Date): string {
  const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()))
  if (periodo === 'semana') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  if (periodo === 'mes') d.setUTCDate(1)
  if (periodo === 'ano') d.setUTCMonth(0, 1)
  return iso(d)
}

export function agregado(tipo: TipoMedida, registros: Registro[]): number | null {
  if (!registros.length) return seSuma(tipo) ? 0 : null
  const total = registros.reduce((s, r) => s + r.valor, 0)
  return seSuma(tipo) ? total : total / registros.length
}

// shortcut: "más es mejor" se compara contra la meta completa, sin prorratear el avance del período;
// prorratear cuando el inicio muestre "fuera" a mitad de mes sin motivo.
export function estado(valor: number | null, meta?: Meta | null): Estado | null {
  if (!meta || valor === null) return null
  if (meta.direccion === 'menos_es_mejor') {
    if (valor > meta.valor) return 'fuera'
    return valor >= meta.valor * 0.8 ? 'cerca' : 'en_meta'
  }
  if (valor >= meta.valor) return 'en_meta'
  return valor >= meta.valor * 0.8 ? 'cerca' : 'fuera'
}

// Serie para el gráfico: acumulado del período si se suma, valores tal cual si se promedia.
export function serie(tipo: TipoMedida, registros: Registro[]): Registro[] {
  const ordenados = [...registros].sort((a, b) => a.fecha.localeCompare(b.fecha))
  if (!seSuma(tipo)) return ordenados
  let acumulado = 0
  return ordenados.map(r => ({ fecha: r.fecha, valor: (acumulado += r.valor) }))
}

const ORDEN: Record<Estado, number> = { fuera: 0, cerca: 1, en_meta: 2 }
export const ordenEstado = (e: Estado | null) => (e ? ORDEN[e] : 3)

export function formatoValor(tipo: TipoMedida, valor: number | null, unidad?: string | null): string {
  if (valor === null) return '—'
  if (tipo === 'dinero') return `$${Math.round(valor).toLocaleString('es-CO')}`
  if (tipo === 'si_no') return `${valor} ${valor === 1 ? 'vez' : 'veces'}`
  const texto = valor.toLocaleString('es-CO', { maximumFractionDigits: 1 })
  if (tipo === 'duracion') return `${texto} min`
  return unidad ? `${texto} ${unidad}` : texto
}
