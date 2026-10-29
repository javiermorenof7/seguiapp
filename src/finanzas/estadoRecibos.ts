// Cuentas de la pestaña Recibos. "mes" es 'AAAA-MM'; "hoy" es 'AAAA-MM-DD'.
import { mesesAntes, recibosPendientes, type PagoRecibo, type Recibo } from './calculos'

export interface ReciboVisible extends Recibo { dia_pago: number | null; numero_cuenta_enmascarado: string | null; estado?: 'activo' | 'no_se_paga' }
export interface PagoGuardado extends PagoRecibo { id_pago_recibo: string; id_registro: string | null; fecha_pago: string | null }
export type EstadoRecibo = 'vencido' | 'por_pagar' | 'pagado' | 'sin_pendiente'
export interface FilaRecibo {
  recibo: ReciboVisible; nombre: string; estado: EstadoRecibo; valor: number | null; dia: number | null; pago: PagoGuardado | null
}

export const nombreRecibo = (r: Recibo) => r.nombre_ubicacion ? `${r.nombre_servicio} · ${r.nombre_ubicacion}` : r.nombre_servicio

// Mediana de los días en que se pagó; null sin pagos con fecha.
export function diaAprendido(pagos: PagoGuardado[]): number | null {
  const dias = pagos.filter(p => p.estado === 'pagado' && p.fecha_pago).map(p => Number(p.fecha_pago!.slice(8, 10))).sort((a, b) => a - b)
  if (!dias.length) return null
  const m = dias.length >> 1
  return dias.length % 2 ? dias[m] : Math.round((dias[m - 1] + dias[m]) / 2)
}

// Estado de cada recibo en el mes: vencido al pasarse su día; lo del mes anterior no se arrastra.
export function recibosDelMes(recibos: ReciboVisible[], pagos: PagoGuardado[], hoy: string): FilaRecibo[] {
  const mes = hoy.slice(0, 7)
  const pendientes = new Map(recibosPendientes(recibos, pagos, mes).map(p => [p.id_recibo, p.valor]))
  const orden: Record<EstadoRecibo, number> = { vencido: 0, por_pagar: 1, sin_pendiente: 2, pagado: 3 }
  return recibos.map(r => {
    const suyos = pagos.filter(p => p.id_recibo === r.id_recibo)
    const dia = diaAprendido(suyos) ?? r.dia_pago
    const pago = suyos.find(p => p.fecha_periodo === `${mes}-01` && p.estado === 'pagado') ?? null
    const pendiente = pendientes.get(r.id_recibo)
    const estado: EstadoRecibo = pago ? 'pagado'
      : pendiente === undefined ? 'sin_pendiente'
        : dia && Number(hoy.slice(8, 10)) > dia ? 'vencido' : 'por_pagar'
    return { recibo: r, nombre: nombreRecibo(r), estado, valor: pago ? Number(pago.valor) : pendiente || null, dia, pago }
  }).sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre))
}

// Facturas que el mes pasado quedaron sin pagar ni marcar; solo las que venían en uso (algún pago en los 3 meses antes),
// para no avisar de una recién creada o activada.
export function sinPagarMesAnterior(recibos: ReciboVisible[], pagos: PagoGuardado[], hoy: string) {
  const mes = hoy.slice(0, 7)
  const anterior = `${mesesAntes(mes, 1)}-01`
  const antes = [2, 3, 4].map(n => `${mesesAntes(mes, n)}-01`)
  return recibos.flatMap(r => {
    const suyos = pagos.filter(p => p.id_recibo === r.id_recibo)
    if (suyos.some(p => p.fecha_periodo === anterior && (p.estado === 'pagado' || p.estado === 'cancelado'))) return []
    const usados = suyos.filter(p => p.estado === 'pagado' && antes.includes(p.fecha_periodo))
      .sort((a, b) => b.fecha_periodo.localeCompare(a.fecha_periodo))
    return usados.length ? [{ recibo: r, nombre: nombreRecibo(r), periodo: anterior, valor: Number(usados[0].valor) }] : []
  })
}

export function totalesDelMes(filas: FilaRecibo[]) {
  const suma = (e: EstadoRecibo) => filas.filter(f => f.estado === e).reduce((s, f) => s + (f.valor ?? 0), 0)
  return { pagado: suma('pagado'), porPagar: suma('por_pagar'), vencido: suma('vencido') }
}

// Valor pagado por período, del más antiguo al más reciente.
export const valoresEnElTiempo = (pagos: PagoGuardado[], idRecibo: string) =>
  pagos.filter(p => p.id_recibo === idRecibo && p.estado === 'pagado')
    .sort((a, b) => a.fecha_periodo.localeCompare(b.fecha_periodo))
    .map(p => ({ fecha: p.fecha_periodo, valor: Number(p.valor) }))
