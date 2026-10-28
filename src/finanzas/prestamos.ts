// Préstamos de cuota fija: tabla de amortización con cambios de tasa, abonos y cuadres con el extracto. Fechas 'AAAA-MM-DD'.

export interface Prestamo {
  id_prestamo: string
  nombre_entidad: string
  nombre_prestamo: string | null
  valor_saldo_inicial: number
  fecha_primera_cuota: string
  cantidad_cuotas: number
  tasa_efectiva_anual: number
  valor_seguro_mensual: number
  dia_pago: number
}

export type TipoAbono = 'reduce_plazo' | 'reduce_cuota'
export interface MovimientoPrestamo {
  id_movimiento_prestamo: string
  id_prestamo: string
  id_registro: string | null
  tipo_movimiento: 'cuota' | 'abono' | 'cambio_tasa' | 'cuadre'
  fecha_movimiento: string
  numero_cuota: number | null
  valor: number | null
  tasa_efectiva_anual: number | null
  tipo_abono: TipoAbono | null
}

export interface FilaAmortizacion {
  numero: number; fecha: string; tasa: number
  interes: number; capital: number; cuota: number; seguro: number; total: number; saldo: number
  pago: MovimientoPrestamo | null
}
export interface Cuadre { fecha: string; extracto: number; calculado: number; diferencia: number }
export type EstadoCuota = 'atrasada' | 'pendiente' | 'al_dia'

const MAX_CUOTAS = 600
const MARGEN = 1e-9

export const tasaMensual = (efectivaAnual: number) => (1 + efectivaAnual / 100) ** (1 / 12) - 1

export function cuotaFija(saldo: number, tasa: number, cuotas: number) {
  const n = Math.max(cuotas, 1)
  return Math.round(tasa === 0 ? saldo / n : saldo * tasa / (1 - (1 + tasa) ** -n))
}

// Cuántas cuotas hacen falta con la misma cuota; si la cuota no alcanza ni para el interés, null.
export function cuotasPara(saldo: number, tasa: number, cuota: number) {
  if (cuota <= saldo * tasa) return null
  return Math.ceil((tasa === 0 ? saldo / cuota : -Math.log(1 - saldo * tasa / cuota) / Math.log(1 + tasa)) - MARGEN)
}

// La cuota k cae k-1 meses después de la primera, en el día de pago o el último del mes si es corto.
export function fechaCuota(primera: string, k: number, dia: number) {
  const mes = +primera.slice(5, 7) - 1 + k - 1
  const fecha = new Date(Date.UTC(+primera.slice(0, 4), mes, 1))
  const ultimo = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0)).getUTCDate()
  fecha.setUTCDate(Math.min(dia, ultimo))
  return fecha.toISOString().slice(0, 10)
}

// Un abono, cambio de tasa o cuadre cuenta desde la primera cuota posterior a su fecha (el mismo día va después de la cuota).
// shortcut: el abono no cobra interés por días dentro del mes; si no cuadra con el extracto, el cuadre lo corrige.
export function amortizacion(p: Prestamo, movimientos: MovimientoPrestamo[]) {
  const eventos = movimientos.filter(m => m.tipo_movimiento !== 'cuota')
    .sort((a, b) => a.fecha_movimiento.localeCompare(b.fecha_movimiento))
  const pagos = new Map(movimientos.filter(m => m.tipo_movimiento === 'cuota').map(m => [m.numero_cuota, m]))
  let saldo = p.valor_saldo_inicial
  let tasa = p.tasa_efectiva_anual
  let restantes = p.cantidad_cuotas
  let cuota = cuotaFija(saldo, tasaMensual(tasa), restantes)
  const filas: FilaAmortizacion[] = []
  const cuadres: Cuadre[] = []
  let e = 0
  for (let k = 1; saldo > 0 && k <= MAX_CUOTAS; k++) {
    const fecha = fechaCuota(p.fecha_primera_cuota, k, p.dia_pago)
    for (; e < eventos.length && eventos[e].fecha_movimiento < fecha; e++) {
      const m = eventos[e]
      if (m.tipo_movimiento === 'cambio_tasa') {
        tasa = m.tasa_efectiva_anual ?? tasa
        cuota = cuotaFija(saldo, tasaMensual(tasa), restantes)
      } else if (m.tipo_movimiento === 'abono') {
        saldo = Math.max(0, saldo - (m.valor ?? 0))
        if (m.tipo_abono === 'reduce_cuota') cuota = cuotaFija(saldo, tasaMensual(tasa), restantes)
        else restantes = cuotasPara(saldo, tasaMensual(tasa), cuota) ?? restantes
      } else {
        const extracto = m.valor ?? saldo
        cuadres.push({ fecha: m.fecha_movimiento, extracto, calculado: saldo, diferencia: extracto - saldo })
        saldo = extracto
        cuota = cuotaFija(saldo, tasaMensual(tasa), restantes)
      }
    }
    if (saldo <= 0) break
    const interes = Math.round(saldo * tasaMensual(tasa))
    const capital = restantes <= 1 ? saldo : Math.max(0, Math.min(saldo, cuota - interes))
    saldo -= capital
    restantes--
    const seguro = p.valor_seguro_mensual
    filas.push({ numero: k, fecha, tasa, interes, capital, cuota: interes + capital, seguro, total: interes + capital + seguro, saldo, pago: pagos.get(k) ?? null })
  }
  return { filas, cuadres }
}

// Lo que se ve arriba: saldo antes de la próxima cuota, la próxima por pagar y su estado.
export function estadoPrestamo(filas: FilaAmortizacion[], hoy: string) {
  const futura = filas.find(f => f.fecha > hoy)
  const proxima = filas.find(f => !f.pago) ?? null
  const estado: EstadoCuota | null = !proxima ? null
    : proxima.fecha < hoy ? 'atrasada' : proxima.fecha.slice(0, 7) === hoy.slice(0, 7) ? 'pendiente' : 'al_dia'
  return {
    saldo: futura ? futura.saldo + futura.capital : 0,
    proxima, estado,
    faltan: filas.filter(f => !f.pago).length,
    fin: filas.at(-1)?.fecha ?? null,
  }
}

export const nombrePrestamo = (p: Pick<Prestamo, 'nombre_entidad' | 'nombre_prestamo'>) =>
  p.nombre_prestamo ? `${p.nombre_prestamo} · ${p.nombre_entidad}` : p.nombre_entidad

// "12,5", "12.5 %" o "12,68 E.A." → 12.5; null si no es una tasa entre 0 y 200.
export function leerTasa(texto: string) {
  const m = texto.replace(/\s/g, '').match(/^(\d{1,3}(?:[.,]\d{1,4})?)%?(?:e\.?a\.?)?$/i)
  const tasa = m ? Number(m[1].replace(',', '.')) : NaN
  return tasa >= 0 && tasa <= 200 ? tasa : null
}
