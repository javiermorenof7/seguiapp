// Datos de cada bloque del inicio. "hoy" es 'AAAA-MM-DD'.
import type { RegistroGuardado, Seguimiento } from '../datos'
import { estado, inicioPeriodo } from '../indicadores'
import { resumenMes, type Movimiento, type TipoMovimiento } from '../finanzas/calculos'
import { racha, totalDelDia } from '../habitos/calculos'
import { estadoFijo, fijos } from '../finanzas/ingresos'
import { comparar, restarDias } from '../salud/calculos'

export type Modulo = 'finanzas' | 'salud' | 'habitos' | 'tareas'
export const MODULOS: Modulo[] = ['finanzas', 'salud', 'habitos', 'tareas']
export const PLANTILLAS: Record<Modulo, string[]> = { finanzas: ['finanzas'], salud: ['gym', 'cuerpo'], habitos: ['habitos'], tareas: ['tareas'] }
export const moduloDe = (codigo: string | null) => MODULOS.find(m => PLANTILLAS[m].includes(codigo ?? ''))
export const TIPO_FINANZAS: Record<string, TipoMovimiento> = { Gastos: 'gasto', Ingresos: 'ingreso', Ahorro: 'ahorro' }

const ultimo = (registros: RegistroGuardado[]) => registros.reduce<RegistroGuardado | null>((u, r) => !u || r.fecha > u.fecha ? r : u, null)
const de = (registros: RegistroGuardado[], s?: Seguimiento) => s ? registros.filter(r => r.id_seguimiento === s.id_seguimiento) : []

// Activo si la persona lo activó o si ya tiene seguimientos suyos (los de antes no tienen fila en plantilla_activa).
export function activos(seguimientos: Seguimiento[], plantillas: string[]): Set<Modulo> {
  const codigos = new Set([...plantillas, ...seguimientos.map(s => s.codigo_plantilla ?? '')])
  return new Set(MODULOS.filter(m => PLANTILLAS[m].some(c => codigos.has(c))))
}

// Saldo del mes con lo que entró y lo que salió (gastos y ahorro).
export function resumenFinanzas(seguimientos: Seguimiento[], registros: RegistroGuardado[], hoy: string) {
  const suyos = seguimientos.filter(s => s.codigo_plantilla === 'finanzas' && TIPO_FINANZAS[s.nombre])
  if (!suyos.length) return null
  const tipoDe = new Map(suyos.map(s => [s.id_seguimiento, TIPO_FINANZAS[s.nombre]]))
  const mes = hoy.slice(0, 7)
  const movimientos: Movimiento[] = registros.flatMap(r => {
    const tipo = tipoDe.get(r.id_seguimiento)
    return tipo ? [{ fecha: r.fecha, valor: r.valor, tipo, id_etiqueta: r.id_etiqueta }] : []
  })
  const estados = fijos(movimientos, mes).map(f => estadoFijo(f, movimientos, hoy))
  return {
    idGastos: (suyos.find(s => s.nombre === 'Gastos') ?? suyos[0]).id_seguimiento,
    ingresosFijos: { total: estados.length, pendientes: estados.filter(e => e === 'pendiente').length, atrasados: estados.filter(e => e === 'atrasado').length },
    ...resumenMes(movimientos, mes),
    hayDatos: movimientos.length > 0,
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
  // 30 días antes del último pesaje, no de hoy: si no se pesa hace meses no se compara consigo mismo
  const hace30 = ultimoPeso && comparar(ultimoPeso.valor, pesos, ultimoPeso.fecha).hace30
  const semana = [0, 1, 2, 3, 4, 5, 6].map(n => restarDias(lunes, -n)).map(fecha => fecha > hoy ? null : de(registros, gym).some(r => r.fecha === fecha))
  return {
    diasGym: new Set(de(registros, gym).filter(r => r.fecha >= lunes && r.fecha <= hoy).map(r => r.fecha)).size,
    peso: ultimoPeso && {
      valor: ultimoPeso.valor, unidad: peso!.unidad, estado: estado(ultimoPeso.valor, peso!.meta),
      cambio30: hace30?.cambio ?? null, fecha30: hace30?.fecha ?? null,
    },
    cintura: ultimaCintura && { valor: ultimaCintura.valor, unidad: cintura!.unidad, estado: estado(ultimaCintura.valor, cintura!.meta) },
    hayDatos: de(registros, gym).length + pesos.length > 0 || !!ultimaCintura,
    // de lunes a domingo: entrenó, no entrenó o null si el día no ha llegado
    semana,
    quedanGym: semana.filter(d => d === null).length,
    metaGym: gym?.meta?.valor ?? null,
  }
}

// Un hábito cuenta como hecho el día que llega a su meta (o tiene algún registro si no la tiene).
export function resumenHabitos(seguimientos: Seguimiento[], registros: RegistroGuardado[], hoy: string) {
  const suyos = seguimientos.filter(s => s.codigo_plantilla === 'habitos')
    .map(h => ({ nombre: h.nombre, marcas: de(registros, h), meta: h.meta?.valor ?? null }))
  if (!suyos.length) return null
  const lista = suyos.map(x => ({ nombre: x.nombre, hecho: totalDelDia(x.marcas, hoy) >= (x.meta ?? Number.MIN_VALUE) }))
  return {
    total: suyos.length,
    hechos: lista.filter(x => x.hecho).length,
    mejorRacha: Math.max(...suyos.map(x => racha(x.marcas, hoy, x.meta))),
    lista,
  }
}
