// Cuentas de la pantalla Finanzas. Todo en pesos enteros; "mes" es 'AAAA-MM'.

export type TipoMovimiento = 'gasto' | 'ingreso' | 'ahorro'
export interface Movimiento {
  fecha: string; valor: number; tipo: TipoMovimiento; id_etiqueta: string | null
  grupo?: 'basico' | 'personal' | null; nota?: string | null
}
export interface Recibo { id_recibo: string; nombre_servicio: string; nombre_ubicacion: string | null; tipo_recibo: 'hogar' | 'personal'; descuenta_saldo?: boolean }
export interface PagoRecibo { id_recibo: string; fecha_periodo: string; valor: number; estado: string }
export interface Pendiente { id_recibo: string; nombre: string; valor: number; tipo_recibo: 'hogar' | 'personal' }
export interface FilaCategoria { id_etiqueta: string | null; nombre: string; gastado: number; presupuesto: number | null; pendiente: number }
export type EstadoPresupuesto = 'cerca' | 'pasado' | null

export const mesDe = (fecha: string) => fecha.slice(0, 7)

export function mesesAntes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 - n, 1))
  return d.toISOString().slice(0, 7)
}

export function totales(movimientos: Movimiento[], filtro: (m: Movimiento) => boolean) {
  const t = { ingreso: 0, gasto: 0, ahorro: 0 }
  for (const m of movimientos) if (filtro(m)) t[m.tipo] += m.valor
  return { ingresos: t.ingreso, gastos: t.gasto, ahorro: t.ahorro, saldo: t.ingreso - t.gasto - t.ahorro }
}

export const resumenMes = (movimientos: Movimiento[], mes: string) => totales(movimientos, m => mesDe(m.fecha) === mes)

// Del 1 de enero hasta el mes dado.
export const acumuladoAno = (movimientos: Movimiento[], mes: string) =>
  totales(movimientos, m => m.fecha.slice(0, 4) === mes.slice(0, 4) && mesDe(m.fecha) <= mes).saldo

export function mesAMes(movimientos: Movimiento[], mes: string) {
  const meses = Array.from({ length: Number(mes.slice(5, 7)) }, (_, i) => `${mes.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`)
  return meses.map(m => ({ mes: m, ...resumenMes(movimientos, m) }))
}

export function estadoPresupuesto(gastado: number, presupuesto: number | null): EstadoPresupuesto {
  if (!presupuesto) return null
  if (gastado > presupuesto) return 'pasado'
  return gastado >= presupuesto * 0.8 ? 'cerca' : null
}

// Pendiente del mes: toda factura activa sin pagar ni cancelar en este mes; vale lo del último pago (0 si nunca se pagó).
export function recibosPendientes(recibos: Recibo[], pagos: PagoRecibo[], mes: string): Pendiente[] {
  return recibos.flatMap(r => {
    const suyos = pagos.filter(p => p.id_recibo === r.id_recibo)
    if (suyos.some(p => p.fecha_periodo === `${mes}-01` && (p.estado === 'pagado' || p.estado === 'cancelado'))) return []
    const ultimo = suyos.filter(p => p.estado === 'pagado').sort((a, b) => b.fecha_periodo.localeCompare(a.fecha_periodo))[0]
    const nombre = r.nombre_ubicacion ? `${r.nombre_servicio} · ${r.nombre_ubicacion}` : r.nombre_servicio
    return [{ id_recibo: r.id_recibo, nombre, valor: ultimo ? Number(ultimo.valor) : 0, tipo_recibo: r.tipo_recibo }]
  })
}

// Gasto del mes por categoría, de mayor a menor; los recibos de hogar pendientes cuentan en su categoría.
export function porCategoria(
  movimientos: Movimiento[], mes: string, categorias: { id_etiqueta: string; nombre: string }[],
  presupuestos: Map<string, number>, pendientes: Pendiente[], idHogar: string | null,
): FilaCategoria[] {
  const gastado = new Map<string | null, number>()
  for (const m of movimientos)
    if (m.tipo === 'gasto' && mesDe(m.fecha) === mes) gastado.set(m.id_etiqueta, (gastado.get(m.id_etiqueta) ?? 0) + m.valor)
  const hogar = pendientes.filter(p => p.tipo_recibo === 'hogar').reduce((s, p) => s + p.valor, 0)
  const filas: FilaCategoria[] = categorias.map(c => ({
    id_etiqueta: c.id_etiqueta, nombre: c.nombre, gastado: gastado.get(c.id_etiqueta) ?? 0,
    presupuesto: presupuestos.get(c.id_etiqueta) ?? null, pendiente: c.id_etiqueta === idHogar ? hogar : 0,
  }))
  const sinCategoria = gastado.get(null) ?? 0
  if (sinCategoria) filas.push({ id_etiqueta: null, nombre: 'Sin categoría', gastado: sinCategoria, presupuesto: null, pendiente: 0 })
  return filas.sort((a, b) => b.gastado - a.gastado)
}

// Saldo menos recibos pendientes y lo que falta por gastar de cada presupuesto, sin contar dos veces
// el recibo que también cabe en el presupuesto de su categoría.
export function saldoDespues(saldo: number, filas: FilaCategoria[], pendientes: Pendiente[]): number {
  const recibos = pendientes.reduce((s, p) => s + p.valor, 0)
  const restante = filas.reduce((s, f) => s + (f.presupuesto ? Math.max(0, f.presupuesto - f.gastado - f.pendiente) : 0), 0)
  return saldo - recibos - restante
}

// Sugerencia de presupuesto: promedio de los 6 meses anteriores, redondeado a miles.
export function promedioSeisMeses(movimientos: Movimiento[], idEtiqueta: string, mes: string): number {
  const desde = mesesAntes(mes, 6)
  const total = movimientos
    .filter(m => m.tipo === 'gasto' && m.id_etiqueta === idEtiqueta && mesDe(m.fecha) >= desde && mesDe(m.fecha) < mes)
    .reduce((s, m) => s + m.valor, 0)
  return Math.round(total / 6 / 1000) * 1000
}
