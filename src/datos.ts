import { supabase } from './supabase'
import { encolar, pendientes, quitar, vaciar } from './cola'
import type { Frecuencia, Meta, Registro, TipoMedida } from './indicadores'
import type { Categoria } from './finanzas/parseo'
import type { PagoRecibo, Recibo } from './finanzas/calculos'

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
  if (idSeguimiento) consulta = consulta.eq('id_seguimiento', idSeguimiento)
  return revisar(await consulta).map(({ fecha_registro, ...r }) => ({ ...r, fecha: fecha_registro }))
}

export async function crearSeguimiento(datos: Omit<Seguimiento, 'id_seguimiento' | 'meta' | 'codigo_plantilla'>, meta: Meta | null) {
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
export async function aprenderCategoria(textoEscrito: string, categoria: string) {
  revisar(await supabase.from('alias').upsert(
    { tipo: 'categoria', texto_escrito: textoEscrito.slice(0, 100), texto_correcto: categoria, estado: 'activo' },
    { onConflict: 'id_usuario,tipo,texto_escrito' },
  ))
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

export async function cerrarSesion() {
  await vaciar()
  await supabase.auth.signOut()
}
