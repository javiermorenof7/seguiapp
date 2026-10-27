import { supabase } from './supabase'
import { encolar, pendientes, quitar, vaciar } from './cola'
import type { Frecuencia, Meta, Registro, TipoMedida } from './indicadores'
import type { Categoria } from './finanzas/parseo'
import type { PagoRecibo, Recibo } from './finanzas/calculos'
import type { PagoGuardado, ReciboVisible } from './finanzas/estadoRecibos'

export interface Seguimiento {
  id_seguimiento: string
  nombre: string
  tipo_medida: TipoMedida
  unidad: string | null
  frecuencia: Frecuencia
  codigo_plantilla: string | null
  meta: Meta | null
}

export interface RegistroGuardado extends Registro {
  id_registro: string
  id_seguimiento: string
  id_etiqueta: string | null
  grupo: 'basico' | 'personal' | null
  nota: string | null
}

interface NuevoRegistro {
  id_registro: string
  id_seguimiento: string
  id_etiqueta?: string | null
  grupo?: 'basico' | 'personal' | null
  fecha_registro: string
  valor: number
  nota: string | null
}

// Errores genéricos hacia la pantalla: el detalle de la base nunca se muestra.
class ErrorDatos extends Error {}
function revisar<T>(respuesta: { data: T; error: unknown }): NonNullable<T> {
  if (respuesta.error) throw new ErrorDatos('No se pudo completar. Revisa tu conexión e inténtalo de nuevo.')
  return respuesta.data as NonNullable<T>
}

const sinConexion = (error: { message?: string } | null) =>
  !navigator.onLine || /fetch|network/i.test(error?.message ?? '')

export async function asegurarPerfil(nombre: string | null) {
  revisar(await supabase.from('perfil').upsert({ nombre }, { onConflict: 'id_usuario', ignoreDuplicates: true }))
}

export async function obtenerSeguimientos(): Promise<Seguimiento[]> {
  const filas = revisar(await supabase
    .from('seguimiento')
    .select('id_seguimiento, nombre, tipo_medida, unidad, frecuencia, codigo_plantilla, meta(valor, direccion, periodo, estado, id_etiqueta)')
    .eq('estado', 'activo')
    .order('fecha_creacion'))
  return filas.map(({ meta, ...s }) => ({
    ...s,
    // la meta general es la activa sin etiqueta; las de etiqueta son presupuestos por categoría
    meta: (meta.find(m => m.estado === 'activo' && !m.id_etiqueta) as Meta | undefined) ?? null,
  })) as Seguimiento[]
}

// shortcut: trae los registros del año de una vez; paginar si una persona pasa de miles por año.
export async function obtenerRegistros(desde: string, idSeguimiento?: string): Promise<RegistroGuardado[]> {
  let consulta = supabase
    .from('registro')
    .select('id_registro, id_seguimiento, id_etiqueta, grupo, fecha_registro, valor, nota')
    .eq('estado', 'activo')
    .gte('fecha_registro', desde)
    .order('fecha_registro', { ascending: false })
    .order('fecha_creacion', { ascending: false })
  if (idSeguimiento) consulta = consulta.eq('id_seguimiento', idSeguimiento)
  return revisar(await consulta).map(({ fecha_registro, ...r }) => ({ ...r, fecha: fecha_registro }))
}

export async function crearSeguimiento(
  datos: Omit<Seguimiento, 'id_seguimiento' | 'meta' | 'codigo_plantilla'> & { codigo_plantilla?: string }, meta: Meta | null,
) {
  const { id_seguimiento } = revisar(await supabase.from('seguimiento').insert(datos).select('id_seguimiento').single())
  if (meta) revisar(await supabase.from('meta').insert({ ...meta, id_seguimiento }))
  return id_seguimiento as string
}

async function enviar(registro: NuevoRegistro) {
  // reenviar el mismo id no duplica
  return supabase.from('registro').upsert(registro, { onConflict: 'id_registro', ignoreDuplicates: true })
}

export async function registrar(datos: Omit<NuevoRegistro, 'id_registro'>): Promise<'guardado' | 'en_cola'> {
  const registro = { ...datos, id_registro: crypto.randomUUID() }
  const { error } = await enviar(registro)
  if (!error) return 'guardado'
  if (sinConexion(error)) {
    await encolar(registro)
    return 'en_cola'
  }
  throw new ErrorDatos('No se pudo guardar. Revisa el valor e inténtalo de nuevo.')
}

// shortcut: un registro de la cola que la base rechaza (no por red) se queda ahí; mostrarlo si pasa.
export async function enviarCola(): Promise<number> {
  let enviados = 0
  for (const registro of await pendientes<NuevoRegistro>()) {
    const { error } = await enviar(registro)
    if (error) continue
    await quitar(registro.id_registro)
    enviados++
  }
  return enviados
}

export async function eliminarRegistro(id: string) {
  revisar(await supabase.from('registro').update({ estado: 'eliminado' }).eq('id_registro', id))
}

export interface Presupuesto { id_meta: string; id_etiqueta: string; valor: number }

// Lo que necesita la pantalla Finanzas además de los registros: categorías de Gastos, presupuestos,
// lo aprendido y los recibos con sus pagos de los últimos 4 meses (para los pendientes).
export async function obtenerFinanzas(idGastos: string, desdePagos: string) {
  const [categorias, presupuestos, aprendido, recibos, pagos] = await Promise.all([
    supabase.from('etiqueta').select('id_etiqueta, nombre, grupo, palabras_clave')
      .eq('id_seguimiento', idGastos).eq('estado', 'activo').order('nombre'),
    supabase.from('meta').select('id_meta, id_etiqueta, valor')
      .eq('id_seguimiento', idGastos).eq('estado', 'activo').not('id_etiqueta', 'is', null),
    supabase.from('alias').select('texto_escrito, texto_correcto').eq('tipo', 'categoria').eq('estado', 'activo'),
    supabase.from('recibo').select('id_recibo, nombre_servicio, nombre_ubicacion, tipo_recibo').eq('estado', 'activo'),
    supabase.from('pago_recibo').select('id_recibo, fecha_periodo, valor, estado').gte('fecha_periodo', desdePagos),
  ])
  return {
    categorias: revisar(categorias) as Categoria[],
    presupuestos: revisar(presupuestos) as Presupuesto[],
    aprendido: new Map(revisar(aprendido).map(a => [a.texto_escrito, a.texto_correcto] as [string, string])),
    recibos: revisar(recibos) as Recibo[],
    pagos: revisar(pagos) as PagoRecibo[],
  }
}

// La próxima vez que escriba lo mismo, sale esta categoría.
export const aprenderCategoria = (textoEscrito: string, categoria: string) => aprenderNombre('categoria', textoEscrito, categoria)

// Un "no" a "¿quisiste decir…?" se guarda con el mismo texto como correcto.
export async function aprenderNombre(tipo: 'categoria' | 'ejercicio' | 'habito', textoEscrito: string, correcto: string) {
  revisar(await supabase.from('alias').upsert(
    { tipo, texto_escrito: textoEscrito.slice(0, 100), texto_correcto: correcto.slice(0, 100), estado: 'activo' },
    { onConflict: 'id_usuario,tipo,texto_escrito' },
  ))
}

export async function obtenerAlias(tipo: 'categoria' | 'ejercicio' | 'habito') {
  const filas = revisar(await supabase.from('alias').select('texto_escrito, texto_correcto').eq('tipo', tipo).eq('estado', 'activo'))
  return new Map(filas.map(a => [a.texto_escrito, a.texto_correcto] as [string, string]))
}

// valor null quita el presupuesto (borrado lógico).
export async function guardarPresupuesto(idGastos: string, idEtiqueta: string, actual: Presupuesto | undefined, valor: number | null) {
  if (actual) {
    revisar(await supabase.from('meta').update(valor === null ? { estado: 'eliminado' } : { valor }).eq('id_meta', actual.id_meta))
  } else if (valor !== null) {
    revisar(await supabase.from('meta').insert({
      id_seguimiento: idGastos, id_etiqueta: idEtiqueta, valor, direccion: 'menos_es_mejor', periodo: 'mes',
    }))
  }
}

// Corregir monto, categoría o descripción; la base valida igual que al registrar.
export async function corregirRegistro(id: string, cambios: { valor: number; nota: string | null; id_etiqueta?: string | null }) {
  revisar(await supabase.from('registro').update(cambios).eq('id_registro', id))
}

// shortcut: trae hasta 1.000 gastos sin categoría de todos los años; paginar si alguien tiene más.
export async function obtenerSinCategoria(idGastos: string) {
  return revisar(await supabase.from('registro').select('id_registro, nota, valor')
    .eq('id_seguimiento', idGastos).eq('estado', 'activo').is('id_etiqueta', null)) as { id_registro: string; nota: string | null; valor: number }[]
}

// Solo cambia la categoría, nunca montos ni fechas. En tandas de 100 para no alargar la URL.
export async function categorizar(ids: string[], idEtiqueta: string) {
  for (let i = 0; i < ids.length; i += 100)
    revisar(await supabase.from('registro').update({ id_etiqueta: idEtiqueta }).in('id_registro', ids.slice(i, i + 100)).is('id_etiqueta', null))
}

// Recibos activos (número siempre enmascarado) y sus pagos del último año, para el día aprendido y el gráfico.
export async function obtenerRecibos(desde: string) {
  const [recibos, pagos] = await Promise.all([
    supabase.from('recibo_visible').select('id_recibo, nombre_servicio, nombre_ubicacion, tipo_recibo, dia_pago, numero_cuenta_enmascarado')
      .eq('estado', 'activo').order('nombre_servicio'),
    supabase.from('pago_recibo').select('id_pago_recibo, id_recibo, id_registro, fecha_periodo, valor, fecha_pago, estado')
      .gte('fecha_periodo', desde),
  ])
  return { recibos: revisar(recibos) as ReciboVisible[], pagos: revisar(pagos) as PagoGuardado[] }
}

// El número completo solo se pide al tocar "ver" y queda en memoria de la pantalla, nunca en el navegador.
export async function verNumeroCuenta(idRecibo: string): Promise<string | null> {
  return revisar(await supabase.from('recibo').select('numero_cuenta').eq('id_recibo', idRecibo).single()).numero_cuenta
}

export async function crearRecibo(datos: { nombre_servicio: string; tipo_recibo: 'hogar' | 'personal'; nombre_ubicacion: string | null; numero_cuenta: string | null }) {
  const { error, data } = await supabase.from('recibo').insert(datos).select('id_recibo').single()
  if (error?.code === '23505') throw new ErrorDatos('Ya tienes un recibo con ese servicio y ubicación.')
  return revisar({ data, error }).id_recibo as string
}

// Borrado lógico: conserva su historial de pagos.
export async function quitarRecibo(idRecibo: string) {
  revisar(await supabase.from('recibo').update({ estado: 'eliminado' }).eq('id_recibo', idRecibo))
}

// Crea el gasto y marca el período pagado; si el pago falla, quita el gasto para no contarlo sin recibo.
// shortcut: dos llamadas sin transacción y sin cola; pasar a una función SQL si un fallo entre las dos llega a dejar huérfanos.
export async function pagarRecibo(pago: {
  id_recibo: string; fecha_periodo: string; valor: number; fecha_pago: string; dia_pago: number | null
  gasto: { id_seguimiento: string; id_etiqueta: string | null; grupo: 'basico' | 'personal'; nota: string }
}) {
  const id_registro = crypto.randomUUID()
  revisar(await supabase.from('registro').insert({ ...pago.gasto, id_registro, fecha_registro: pago.fecha_pago, valor: pago.valor }))
  const { error } = await supabase.from('pago_recibo').upsert({
    id_recibo: pago.id_recibo, fecha_periodo: pago.fecha_periodo, valor: pago.valor, fecha_pago: pago.fecha_pago, estado: 'pagado', id_registro,
  }, { onConflict: 'id_usuario,id_recibo,fecha_periodo' })
  if (error) {
    await eliminarRegistro(id_registro).catch(() => {})
    revisar({ data: null, error })
  }
  if (pago.dia_pago) await supabase.from('recibo').update({ dia_pago: pago.dia_pago }).eq('id_recibo', pago.id_recibo)
}

// Deshacer: borra el pago del período y su gasto.
export async function deshacerPago(pago: { id_pago_recibo: string; id_registro: string | null }) {
  revisar(await supabase.from('pago_recibo').delete().eq('id_pago_recibo', pago.id_pago_recibo))
  if (pago.id_registro) await eliminarRegistro(pago.id_registro)
}

// Ejercicios (etiquetas de Gym), series del último año y nombres aprendidos; las fechas salen de los registros.
export async function obtenerSalud(idGym: string, desde: string) {
  const [ejercicios, series, alias] = await Promise.all([
    supabase.from('etiqueta').select('id_etiqueta, nombre').eq('id_seguimiento', idGym).eq('estado', 'activo'),
    supabase.from('serie_gym').select('id_registro, cantidad_series, cantidad_repeticiones, peso_kilogramos').gte('fecha_creacion', desde),
    supabase.from('alias').select('texto_escrito, texto_correcto').eq('tipo', 'ejercicio').eq('estado', 'activo'),
  ])
  return {
    ejercicios: revisar(ejercicios) as { id_etiqueta: string; nombre: string }[],
    series: revisar(series) as { id_registro: string; cantidad_series: number; cantidad_repeticiones: number; peso_kilogramos: number | null }[],
    alias: new Map(revisar(alias).map(a => [a.texto_escrito, a.texto_correcto] as [string, string])),
  }
}

export async function crearEjercicio(idGym: string, nombre: string) {
  return revisar(await supabase.from('etiqueta').insert({ id_seguimiento: idGym, nombre }).select('id_etiqueta').single()).id_etiqueta as string
}

// El registro guarda el peso (o las repeticiones si es sin peso) para la tendencia; la serie, el detalle.
// shortcut: dos llamadas sin transacción y sin cola; pasar a una función SQL si un fallo entre las dos deja huérfanos.
export async function registrarSerie(s: {
  id_seguimiento: string; id_etiqueta: string; fecha: string; series: number; repeticiones: number; peso: number | null
}) {
  const id_registro = crypto.randomUUID()
  revisar(await supabase.from('registro').insert({
    id_registro, id_seguimiento: s.id_seguimiento, id_etiqueta: s.id_etiqueta, fecha_registro: s.fecha, valor: s.peso ?? s.repeticiones,
  }))
  const { error } = await supabase.from('serie_gym').insert({
    id_registro, cantidad_series: s.series, cantidad_repeticiones: s.repeticiones, peso_kilogramos: s.peso,
  })
  if (error) {
    await eliminarRegistro(id_registro).catch(() => {})
    revisar({ data: null, error })
  }
}

// Cambia o quita (valor null) la meta general de un seguimiento.
export async function guardarMeta(idSeguimiento: string, meta: Meta | null) {
  revisar(await supabase.from('meta').update({ estado: 'eliminado' })
    .eq('id_seguimiento', idSeguimiento).is('id_etiqueta', null).eq('estado', 'activo'))
  if (meta) revisar(await supabase.from('meta').insert({ ...meta, id_seguimiento: idSeguimiento }))
}

export async function cerrarSesion() {
  await vaciar()
  await supabase.auth.signOut()
}
