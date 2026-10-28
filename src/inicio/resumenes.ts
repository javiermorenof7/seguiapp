// Datos de cada bloque del inicio. "hoy" es 'AAAA-MM-DD'.
import type { RegistroGuardado, Seguimiento } from '../datos'
import { estado, inicioPeriodo, type Registro } from '../indicadores'
import { resumenMes, type Movimiento, type TipoMovimiento } from '../finanzas/calculos'
import { racha, totalDelDia } from '../habitos/calculos'
import { estadoFijo, fijos } from '../finanzas/ingresos'
import { comparar, restarDias } from '../salud/calculos'

export type Modulo = 'finanzas' | 'salud' | 'habitos' | 'tareas'
export const MODULOS: Modulo[] = ['finanzas', 'salud', 'habitos', 'tareas']
export const PLANTILLAS: Record<Modulo, string[]> = { finanzas: ['finanzas'], salud: ['gym', 'cuerpo'], habitos: ['habitos'], tareas: ['tareas'] }
export const moduloDe = (codigo: string | null) => MODULOS.find(m => PLANTILLAS[m].includes(codigo ?? ''))
export const TIPO_FINANZAS: Record<string, TipoMovimiento> = { Gastos: 'gasto', Ingresos: 'ingreso', Ahorro: 'ahorro' }

const SIGNO: Record<TipoMovimiento, number> = { ingreso: 1, gasto: -1, ahorro: -1 }
const ultimo = (registros: RegistroGuardado[]) => registros.reduce<RegistroGuardado | null>((u, r) => !u || r.fecha > u.fecha ? r : u, null)
const de = (registros: RegistroGuardado[], s?: Seguimiento) => s ? registros.filter(r => r.id_seguimiento === s.id_seguimiento) : []

// Activo si la persona lo activó o si ya tiene seguimientos suyos (los de antes no tienen fila en plantilla_activa).
export function activos(seguimientos: Seguimiento[], plantillas: string[]): Set<Modulo> {
  const codigos = new Set([...plantillas, ...seguimientos.map(s => s.codigo_plantilla ?? '')])
  return new Set(MODULOS.filter(m => PLANTILLAS[m].some(c => codigos.has(c))))
}

// Saldo del mes y su curva: saldo acumulado al cierre de cada día con movimientos.
export function resumenFinanzas(seguimientos: Seguimiento[], registros: RegistroGuardado[], hoy: string) {
  const suyos = seguimientos.filter(s => s.codigo_plantilla === 'finanzas' && TIPO_FINANZAS[s.nombre])
  if (!suyos.length) return null
  const tipoDe = new Map(suyos.map(s => [s.id_seguimiento, TIPO_FINANZAS[s.nombre]]))
  const mes = hoy.slice(0, 7)
  const movimientos: Movimiento[] = registros.flatMap(r => {
    const tipo = tipoDe.get(r.id_seguimiento)
    return tipo ? [{ fecha: r.fecha, valor: r.valor, tipo, id_etiqueta: r.id_etiqueta }] : []
  })
  const porDia = new Map<string, number>()
  let saldo = 0
  for (const m of movimientos.filter(m => m.fecha.startsWith(mes)).sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    porDia.set(m.fecha, (saldo += SIGNO[m.tipo] * m.valor))
  }
  const estados = fijos(movimientos, mes).map(f => estadoFijo(f, movimientos, hoy))
  return {
    idGastos: (suyos.find(s => s.nombre === 'Gastos') ?? suyos[0]).id_seguimiento,
    ingresosFijos: { total: estados.length, pendientes: estados.filter(e => e === 'pendiente').length, atrasados: estados.filter(e => e === 'atrasado').length },
    ...resumenMes(movimientos, mes),
    hayDatos: movimientos.length > 0,
    puntos: [...porDia].map(([fecha, valor]): Registro => ({ fecha, valor })),
  }
}

export function resumenSalud(seguimientos: Seguimiento[], registros: RegistroGuardado[], hoy: string) {
  const gym = seguimientos.find(s => s.codigo_plantilla === 'gym')
  const medida = (nombre: string) => seguimientos.find(s => s.codigo_plantilla === 'cuerpo' && s.nombre === nombre)
  const peso = medida('Peso'), cintura = medida('Cintura')
  const lunes = inicioPeriodo('semana', new Date(`${hoy}T12:00`))
  const pesos = de(registros, peso)
  const ultimoPeso = ultimo(pesos)
  const ultimaCintura = ultimo(de(registros, cintura))
  return {
    diasGym: new Set(de(registros, gym).filter(r => r.fecha >= lunes && r.fecha <= hoy).map(r => r.fecha)).size,
    peso: ultimoPeso && {
      valor: ultimoPeso.valor, unidad: peso!.unidad, estado: estado(ultimoPeso.valor, peso!.meta),
      cambio30: comparar(ultimoPeso.valor, pesos, hoy).hace30?.cambio ?? null,
    },
    cintura: ultimaCintura && { valor: ultimaCintura.valor, unidad: cintura!.unidad, estado: estado(ultimaCintura.valor, cintura!.meta) },
    hayDatos: de(registros, gym).length + pesos.length > 0 || !!ultimaCintura,
    puntos: pesos.filter(r => r.fecha >= restarDias(hoy, 30)).sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map(({ fecha, valor }): Registro => ({ fecha, valor })),
  }
}

// Un hábito cuenta como hecho el día que llega a su meta (o tiene algún registro si no la tiene).
export function resumenHabitos(seguimientos: Seguimiento[], registros: RegistroGuardado[], hoy: string) {
  const suyos = seguimientos.filter(s => s.codigo_plantilla === 'habitos')
    .map(h => ({ marcas: de(registros, h), meta: h.meta?.valor ?? null }))
  if (!suyos.length) return null
  const hechos = (fecha: string) => suyos.filter(x => totalDelDia(x.marcas, fecha) >= (x.meta ?? Number.MIN_VALUE)).length
  return {
    total: suyos.length,
    hechos: hechos(hoy),
    mejorRacha: Math.max(...suyos.map(x => racha(x.marcas, hoy, x.meta))),
    puntos: [6, 5, 4, 3, 2, 1, 0].map(n => restarDias(hoy, n)).map((fecha): Registro => ({ fecha, valor: hechos(fecha) })),
  }
}
