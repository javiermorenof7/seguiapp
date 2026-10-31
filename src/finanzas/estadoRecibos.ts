// Cuentas de la pestaña Recibos. "mes" es 'AAAA-MM'; "hoy" es 'AAAA-MM-DD'.
import { mesesAntes, recibosPendientes, type PagoRecibo, type Recibo } from './calculos'
import { normalizar } from './parseo'

export interface ReciboVisible extends Recibo {
  dia_pago: number | null; numero_cuenta_enmascarado: string | null; estado?: 'activo' | 'no_se_paga'; requiere_numero_pago?: boolean; descuenta_saldo?: boolean
}
export interface PagoGuardado extends PagoRecibo { id_pago_recibo: string; id_registro: string | null; fecha_pago: string | null }
export type EstadoRecibo = 'vencido' | 'por_pagar' | 'pagado' | 'omitida' | 'sin_pendiente'
export interface FilaRecibo {
  recibo: ReciboVisible; nombre: string; estado: EstadoRecibo; valor: number | null; dia: number | null; pago: PagoGuardado | null
}

export const nombreRecibo = (r: Recibo) => r.nombre_ubicacion ? `${r.nombre_servicio} · ${r.nombre_ubicacion}` : r.nombre_servicio

// Ubicación del filtro: las personales no tienen, van como "Personal".
export const ubicacionDe = (r: Recibo) => r.nombre_ubicacion ?? 'Personal'
export const ubicacionesDe = (recibos: Recibo[]) => [...new Set(recibos.map(ubicacionDe))]
  .sort((a, b) => Number(a === 'Personal') - Number(b === 'Personal') || a.localeCompare(b, 'es'))

// Para el selector: primero las que tienen facturas en el grupo que se ve, después las que no.
export function ubicacionesConConteo(todas: Recibo[], delGrupo: Recibo[]) {
  const lista = ubicacionesDe(todas).map(ubicacion => ({ ubicacion, facturas: delGrupo.filter(r => ubicacionDe(r) === ubicacion).length }))
  return [...lista.filter(u => u.facturas), ...lista.filter(u => !u.facturas)]
}

// Mediana de los días en que se pagó; null sin pagos con fecha.
// shortcut: los pagos cargados de la hoja tienen fecha de pago = inicio del período; se ignoran (un pago real justo el día 1 también, raro).
// Los pagados en otro mes (atrasados) no dicen en qué día vence.
export function diaAprendido(pagos: PagoGuardado[]): number | null {
  const dias = pagos.filter(p => p.estado === 'pagado' && p.fecha_pago && p.fecha_pago !== p.fecha_periodo && p.fecha_pago.slice(0, 7) === p.fecha_periodo.slice(0, 7)).map(p => Number(p.fecha_pago!.slice(8, 10))).sort((a, b) => a - b)
  if (!dias.length) return null
  const m = dias.length >> 1
  return dias.length % 2 ? dias[m] : Math.round((dias[m - 1] + dias[m]) / 2)
}

// Estado de cada recibo en el mes: vencido al pasarse su día; lo del mes anterior no se arrastra.
export function recibosDelMes(recibos: ReciboVisible[], pagos: PagoGuardado[], hoy: string): FilaRecibo[] {
  const mes = hoy.slice(0, 7)
  const pendientes = new Map(recibosPendientes(recibos, pagos, mes).map(p => [p.id_recibo, p.valor]))
  const orden: Record<EstadoRecibo, number> = { vencido: 0, por_pagar: 1, sin_pendiente: 2, omitida: 3, pagado: 4 }
  return recibos.map(r => {
    const suyos = pagos.filter(p => p.id_recibo === r.id_recibo)
    // el día que la persona puso manda; si no hay, el aprendido de sus pagos
    const dia = r.dia_pago ?? diaAprendido(suyos)
    const pago = suyos.find(p => p.fecha_periodo === `${mes}-01` && p.estado === 'pagado') ?? null
    const omitido = suyos.find(p => p.fecha_periodo === `${mes}-01` && p.estado === 'cancelado') ?? null
    const pendiente = pendientes.get(r.id_recibo)
    const estado: EstadoRecibo = pago ? 'pagado' : omitido ? 'omitida'
      : pendiente === undefined ? 'sin_pendiente'
        : dia && Number(hoy.slice(8, 10)) > dia ? 'vencido' : 'por_pagar'
    return { recibo: r, nombre: nombreRecibo(r), estado, valor: pago ? Number(pago.valor) : pendiente || null, dia, pago: pago ?? omitido }
  }).sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre))
}

// Períodos sin pagar ni omitir de los últimos 12 meses, del más reciente al más antiguo; cada factura desde su primer pago,
// para no avisar de meses en que no existía. Valor: el último pagado antes de ese mes.
export function vencidasAnteriores(recibos: ReciboVisible[], pagos: PagoGuardado[], hoy: string) {
  const mes = hoy.slice(0, 7)
  return Array.from({ length: 12 }, (_, i) => `${mesesAntes(mes, i + 1)}-01`).flatMap(periodo => recibos.flatMap(r => {
    const suyos = pagos.filter(p => p.id_recibo === r.id_recibo)
    if (suyos.some(p => p.fecha_periodo === periodo && (p.estado === 'pagado' || p.estado === 'cancelado'))) return []
    const antes = suyos.filter(p => p.estado === 'pagado' && p.fecha_periodo < periodo).sort((a, b) => b.fecha_periodo.localeCompare(a.fecha_periodo))
    return antes.length ? [{ recibo: r, nombre: nombreRecibo(r), periodo, valor: Number(antes[0].valor) }] : []
  }))
}

export function vencidasPorFactura(vencidas: ReturnType<typeof vencidasAnteriores>) {
  const grupos = new Map<string, { recibo: ReciboVisible; nombre: string; periodos: typeof vencidas }>()
  for (const v of vencidas) {
    const g = grupos.get(v.recibo.id_recibo) ?? { recibo: v.recibo, nombre: v.nombre, periodos: [] }
    g.periodos.push(v)
    grupos.set(v.recibo.id_recibo, g)
  }
  return [...grupos.values()]
}

// Último día del mes de un período 'AAAA-MM-01'.
export const finDeMes = (periodo: string) =>
  new Date(Date.UTC(+periodo.slice(0, 4), +periodo.slice(5, 7), 0)).toISOString().slice(0, 10)

// Hogares como tabla (lugar por servicio) y lo demás suelto. Un servicio repetido en el mismo lugar va suelto para no perderlo.
export function mosaicoRecibos(filas: FilaRecibo[]) {
  const servicios = new Map<string, string>()
  const lugares = new Map<string, { lugar: string; celdas: Map<string, FilaRecibo> }>()
  const sueltas: FilaRecibo[] = []
  for (const f of [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const clave = normalizar(f.recibo.nombre_ubicacion ?? '')
    // un hogar con ubicación "Personal" se muestra con las personales
    if (f.recibo.tipo_recibo !== 'hogar' || !f.recibo.nombre_ubicacion || clave === 'personal') { sueltas.push(f); continue }
    const servicio = normalizar(f.recibo.nombre_servicio)
    const lugar = lugares.get(clave) ?? { lugar: f.recibo.nombre_ubicacion, celdas: new Map() }
    lugares.set(clave, lugar)
    if (lugar.celdas.has(servicio)) { sueltas.push(f); continue }
    lugar.celdas.set(servicio, f)
    if (!servicios.has(servicio)) servicios.set(servicio, f.recibo.nombre_servicio)
  }
  const columnas = [...servicios].sort((a, b) => a[1].localeCompare(b[1]))
  return {
    servicios: columnas.map(c => c[1]),
    hogares: [...lugares.values()].sort((a, b) => a.lugar.localeCompare(b.lugar))
      .map(l => ({ lugar: l.lugar, celdas: columnas.map(([c]) => l.celdas.get(c) ?? null) })),
    sueltas,
  }
}

// Las omitidas y las que no tienen valor este mes no cuentan como pagadas ni como faltantes.
export function avanceDelMes(filas: FilaRecibo[]) {
  const t = totalesDelMes(filas)
  const pagadas = filas.filter(f => f.estado === 'pagado').length
  return { pagadas, total: filas.filter(f => f.estado !== 'sin_pendiente' && f.estado !== 'omitida').length, falta: t.porPagar + t.vencido }
}

export const numeroParaCopiar = (numero: string) => numero.replace(/\s+/g, '')

export function totalesDelMes(filas: FilaRecibo[]) {
  const suma = (e: EstadoRecibo) => filas.filter(f => f.estado === e).reduce((s, f) => s + (f.valor ?? 0), 0)
  return { pagado: suma('pagado'), porPagar: suma('por_pagar'), vencido: suma('vencido') }
}
