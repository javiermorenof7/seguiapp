// Ingresos por fuente (etiqueta de Ingresos) y los fijos: los que se anotan a mano y los aprendidos de los últimos 2 meses. "mes" es 'AAAA-MM', "hoy" 'AAAA-MM-DD'.
import { mesDe, mesesAntes, type Movimiento } from './calculos'
import type { Categoria } from './parseo'

export type EstadoFijo = 'recibido' | 'pendiente' | 'atrasado'
// quitado: él dijo que ya no es fijo; no se espera ni se aprende. clave y nombre: solo los fijos adicionales de la fuente.
export interface Fijo { id_etiqueta: string; monto: number; dia: number; desde?: string; quitado?: boolean; clave?: string; nombre?: string }
// Un fijo más de la misma fuente (otro arriendo, otro sueldo); monto null = ya no es fijo, se guarda por su historial.
export interface Adicional { clave: string; nombre: string; monto: number | null; dia: number | null; desde: string; historial: Tramo[] }

const TOLERANCIA = 0.1
const GRACIA_DIAS = 3
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const diasDelMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate()

export const MESES_FIJO = 2
export const MAX_ADICIONALES = 3
// los que ya no son fijos se guardan por su historial pero no cuentan en el cupo de MAX_ADICIONALES
export const MAX_GUARDADOS = 8
export const DIAS_CERCA = 7
export const hayCupo = (lista: Adicional[]) => lista.filter(a => a.monto).length < MAX_ADICIONALES && lista.length < MAX_GUARDADOS
// Identifica cada fijo: la fuente sola para el primero, fuente y clave para los adicionales.
export const claveDe = (f: { id_etiqueta: string; clave?: string }) => f.clave ? `${f.id_etiqueta}:${f.clave}` : f.id_etiqueta

// Un tramo del historial del fijo: desde 'AAAA-MM' (vacío = antes del primer cambio), monto null = ya no es fijo.
export interface Tramo { desde: string; monto: number | null; dia: number | null }
const esTramo = (t: unknown): t is Tramo => {
  const x = t as Tramo
  return !!x && typeof x.desde === 'string' && /^(\d{4}-\d{2})?$/.test(x.desde) && (x.monto === null || (typeof x.monto === 'number' && x.monto > 0))
}
const ordenados = (h: unknown) => Array.isArray(h) ? h.filter(esTramo).sort((a, b) => a.desde.localeCompare(b.desde)) : []

// Los fijos adicionales de una fuente, sin los mal formados (los escribe el navegador de la persona).
export function adicionales(f: Categoria): Adicional[] {
  if (!Array.isArray(f.fijos_adicionales)) return []
  const entero = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
  return (f.fijos_adicionales as Adicional[]).filter(a => !!a && typeof a.clave === 'string' && /^[a-z0-9]{1,12}$/.test(a.clave)
    && typeof a.nombre === 'string' && a.nombre.trim().length > 0 && a.nombre.length <= 40
    && (a.monto === null ? a.dia === null : entero(a.monto, 1, 1000000000) && entero(a.dia, 1, 31))
    && typeof a.desde === 'string' && /^\d{4}-\d{2}$/.test(a.desde))
    .slice(0, MAX_GUARDADOS).map(a => ({ ...a, historial: ordenados(a.historial) }))
}

// Los fijos que se anotaron a mano en las fuentes (con sus adicionales) y las que ya no son fijas.
export const anotados = (fuentes: Categoria[]): Fijo[] =>
  fuentes.flatMap<Fijo>(f => [
    ...(f.sin_ingreso_fijo ? [{ id_etiqueta: f.id_etiqueta, monto: 0, dia: 0, quitado: true }]
      : f.monto_fijo && f.dia_fijo ? [{ id_etiqueta: f.id_etiqueta, monto: Number(f.monto_fijo), dia: f.dia_fijo, desde: f.fecha_fijo_desde?.slice(0, 7) }] : []),
    ...adicionales(f).flatMap(a => a.monto && a.dia ? [{ id_etiqueta: f.id_etiqueta, clave: a.clave, nombre: a.nombre, monto: a.monto, dia: a.dia, desde: a.desde }] : []),
  ])

// Fija si llegó en cada uno de los 2 meses anteriores con una diferencia de hasta 10 %; el anotado a mano manda sobre el aprendido desde su mes.
export function fijos(movimientos: Movimiento[], mes: string, todos: Fijo[] = []): Fijo[] {
  const suyos = todos.filter(f => !f.desde || f.desde <= mes)
  const meses = Array.from({ length: MESES_FIJO }, (_, i) => mesesAntes(mes, i + 1))
  const porFuente = new Map<string, Map<string, { total: number; dia: number }>>()
  for (const m of movimientos) {
    if (m.tipo !== 'ingreso' || !m.id_etiqueta || !meses.includes(mesDe(m.fecha))) continue
    const delaFuente = porFuente.get(m.id_etiqueta) ?? new Map()
    const actual = delaFuente.get(mesDe(m.fecha)) ?? { total: 0, dia: 31 }
    delaFuente.set(mesDe(m.fecha), { total: actual.total + m.valor, dia: Math.min(actual.dia, +m.fecha.slice(8, 10)) })
    porFuente.set(m.id_etiqueta, delaFuente)
  }
  const conSuyo = new Set(suyos.map(f => f.id_etiqueta))
  return [...suyos.filter(f => !f.quitado), ...[...porFuente].flatMap(([id_etiqueta, porMes]) => {
    if (porMes.size < MESES_FIJO || conSuyo.has(id_etiqueta)) return []
    const totales = [...porMes.values()].map(x => x.total)
    if (Math.max(...totales) > Math.min(...totales) * (1 + TOLERANCIA)) return []
    return [{ id_etiqueta, monto: Math.round(mediana(totales)), dia: mediana([...porMes.values()].map(x => x.dia)) }]
  })]
}

// Lo que llegó en el mes a cada fijo de "delMes". Con un fijo en la fuente, todo lo de la fuente (como las quincenas);
// con varios, cada pago va al fijo cuyo faltante se parece (±10 %) y cuyo día está a DIAS_CERCA o menos; si ninguno,
// al de día más cercano entre los que aún aceptan ese monto (así una quincena no se va al otro sueldo).
// Un pago mayor que cualquier faltante (subió el sueldo) va al pendiente de día más cercano.
export function llegadas(delMes: Fijo[], movimientos: Movimiento[], mes: string): Map<string, number> {
  const llego = new Map(delMes.map(f => [claveDe(f), 0]))
  const deFuente = new Map<string, Fijo[]>()
  for (const f of delMes) deFuente.set(f.id_etiqueta, [...deFuente.get(f.id_etiqueta) ?? [], f])
  const pagos = movimientos.filter(m => m.tipo === 'ingreso' && m.id_etiqueta && deFuente.has(m.id_etiqueta) && mesDe(m.fecha) === mes)
  for (const m of [...pagos].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const suyos = deFuente.get(m.id_etiqueta!)!
    const dia = +m.fecha.slice(8, 10)
    const pendientes = suyos
      .map(f => ({ f, falta: f.monto - llego.get(claveDe(f))!, lejos: Math.abs(f.dia - dia) }))
      .filter(c => c.falta > 0)
    const caben = pendientes.filter(c => m.valor <= c.falta * (1 + TOLERANCIA))
    const parecidos = caben.filter(c => Math.abs(c.falta - m.valor) <= c.falta * TOLERANCIA && c.lejos <= DIAS_CERCA)
    const mejor = suyos.length === 1 ? suyos[0] : (parecidos.length ? parecidos : caben.length ? caben : pendientes)
      .sort((a, b) => a.lejos - b.lejos || Math.abs(a.falta - m.valor) - Math.abs(b.falta - m.valor))[0]?.f
    if (mejor) llego.set(claveDe(mejor), llego.get(claveDe(mejor))! + m.valor)
  }
  return llego
}
// recibido cuando ya llegó casi todo (la primera quincena sola no basta)
const yaLlego = (fijo: Fijo, llego: Map<string, number>) => (llego.get(claveDe(fijo)) ?? 0) >= fijo.monto * (1 - TOLERANCIA)

// "delMes": todos los fijos del mes, para repartir los pagos de una fuente que tiene varios.
export function estadoFijo(fijo: Fijo, movimientos: Movimiento[], hoy: string, delMes: Fijo[] = [fijo]): EstadoFijo {
  const mes = mesDe(hoy)
  if (yaLlego(fijo, llegadas(delMes, movimientos, mes))) return 'recibido'
  return +hoy.slice(8, 10) > Math.min(fijo.dia, diasDelMes(mes)) + GRACIA_DIAS ? 'atrasado' : 'pendiente'
}

// Lo que falta de cada fijo que aún no llega en el mes de "hoy": no entra al saldo, solo se muestra aparte.
export function porRecibir(movimientos: Movimiento[], hoy: string, suyos: Fijo[] = []) {
  const mes = mesDe(hoy)
  const delMes = fijos(movimientos, mes, suyos)
  const llego = llegadas(delMes, movimientos, mes)
  return delMes.flatMap(f => yaLlego(f, llego) ? [] : [{ ...f, falta: f.monto - (llego.get(claveDe(f)) ?? 0) }])
}

// Fuente del fijo que aún no llega ese mes y cuyo faltante se parece (±10 %) a un ingreso del banco, en pesos;
// si ninguno, el de día de pago a DIAS_CERCA o menos que reciba hasta 50 % más de lo que falta (subió el sueldo).
// shortcut: una quincena suelta no se reconoce (vale la mitad del faltante), si hace falta comparar también contra monto / 2.
export const MAS_DE_LO_ESPERADO = 0.5
export function fuenteDeFijo(movimientos: Movimiento[], fecha: string, valor: number, suyos: Fijo[] = []): string | null {
  const faltan = porRecibir(movimientos, fecha, suyos)
  const parecido = faltan.find(f => Math.abs(valor - f.falta) <= f.falta * TOLERANCIA)
  if (parecido) return parecido.id_etiqueta
  const dia = +fecha.slice(8, 10)
  const lejos = (f: Fijo) => Math.abs(Math.min(f.dia, diasDelMes(mesDe(fecha))) - dia)
  const mayor = faltan.filter(f => valor > f.falta && valor <= f.falta * (1 + MAS_DE_LO_ESPERADO) && lejos(f) <= DIAS_CERCA)
    .sort((a, b) => lejos(a) - lejos(b))[0]
  return mayor?.id_etiqueta ?? null
}

// Ingresos de cada fuente en los últimos "n" meses (incluido el actual); sin fuente va con id null.
export function porFuente(movimientos: Movimiento[], mes: string, n = 6) {
  const meses = Array.from({ length: n }, (_, i) => mesesAntes(mes, n - 1 - i))
  const series = new Map<string | null, number[]>()
  for (const m of movimientos) {
    const i = meses.indexOf(mesDe(m.fecha))
    if (m.tipo !== 'ingreso' || i < 0) continue
    const fila = series.get(m.id_etiqueta) ?? meses.map(() => 0)
    fila[i] += m.valor
    series.set(m.id_etiqueta, fila)
  }
  return { meses, series: [...series].map(([id_etiqueta, datos]) => ({ id_etiqueta, datos })) }
}

// El historial de cada fijo (por claveDe), sin los tramos mal formados.
export function historiales(fuentes: Categoria[]): Record<string, Tramo[]> {
  return Object.fromEntries(fuentes.flatMap(f => [
    [f.id_etiqueta, ordenados(f.historial_fijo)] as const,
    ...adicionales(f).map(a => [claveDe({ id_etiqueta: f.id_etiqueta, clave: a.clave }), a.historial] as const),
  ]).filter(([, tramos]) => tramos.length))
}

// Agrega el tramo de "mes" (reemplaza el de ese mismo mes); en el primer cambio guarda también el valor de antes.
export function conTramo(historial: unknown, mes: string, fijo: { monto: number; dia: number } | null, antes?: { monto: number; dia: number } | null): Tramo[] {
  const previos = Array.isArray(historial) ? (historial as Tramo[]).filter(t => t.desde !== mes) : []
  const base = !previos.length && antes ? [{ desde: '', monto: antes.monto, dia: antes.dia }] : []
  return [...base, ...previos, { desde: mes, monto: fijo?.monto ?? null, dia: fijo?.dia ?? null }].slice(-120)
}

// Un fijo adicional nuevo desde "mes": antes de ese mes no se espera.
// shortcut: los que ya no son fijos siguen ocupando cupo (se guardan por su historial); si estorba, reusar el cupo del más viejo.
export function nuevoAdicional(lista: Adicional[], nombre: string, mes: string, fijo: { monto: number; dia: number }): Adicional[] {
  let clave = ''
  while (!clave || lista.some(a => a.clave === clave)) clave = Math.random().toString(36).slice(2, 8)
  return [...lista, { clave, nombre: nombre.trim().slice(0, 40), ...fijo, desde: mes, historial: [{ desde: '', monto: null, dia: null }, { desde: mes, ...fijo }] }]
}

// Cambia un fijo adicional desde "mes" (fijo null = ya no es fijo) sin tocar los meses pasados.
export const cambiarAdicional = (lista: Adicional[], clave: string, mes: string, fijo: { monto: number; dia: number } | null): Adicional[] =>
  lista.map(a => a.clave !== clave ? a : { ...a, monto: fijo?.monto ?? null, dia: fijo?.dia ?? null, historial: conTramo(a.historial, mes, fijo) })

// Cada mes, lo esperado frente a todo lo que llegó: el mes que se ve con los fijos de hoy; uno pasado con lo que valía entonces
// (el tramo vigente de cada fuente; antes del primer tramo, lo aprendido al cambiar o, si no hay, el de hoy).
export function esperadoVsRecibido(movimientos: Movimiento[], mes: string, n = 6, suyos: Fijo[] = [], historial: Record<string, Tramo[]> = {}) {
  const hoy = new Map(fijos(movimientos, mes, suyos).map(f => [claveDe(f), f.monto]))
  const ids = new Set([...hoy.keys(), ...Object.keys(historial)])
  const valorEn = (id: string, m: string) => {
    const tramos = historial[id] ?? []
    const vigente = tramos.filter(t => t.desde <= m).at(-1)
    if (vigente) return vigente.monto ?? 0
    if (tramos.length) return fijos(movimientos, tramos[0].desde).find(f => claveDe(f) === id)?.monto ?? hoy.get(id) ?? 0
    return hoy.get(id) ?? 0
  }
  return Array.from({ length: n }, (_, i) => mesesAntes(mes, n - 1 - i)).map(m => ({
    mes: m,
    esperado: m === mes ? [...hoy.values()].reduce((s, v) => s + v, 0) : [...ids].reduce((s, id) => s + valorEn(id, m), 0),
    recibido: movimientos.filter(x => x.tipo === 'ingreso' && mesDe(x.fecha) === m).reduce((s, x) => s + x.valor, 0),
  }))
}
