import { supabase } from './supabase'
import { encolar, pendientes, quitar, vaciar } from './cola'
import type { Frecuencia, Meta, Registro, TipoMedida } from './indicadores'
import type { Categoria } from './finanzas/parseo'
import { CATEGORIAS_INICIALES } from './finanzas/reglasCategorias'
import type { PagoRecibo, Recibo } from './finanzas/calculos'
import type { PagoGuardado, ReciboVisible } from './finanzas/estadoRecibos'
import type { MovimientoPrestamo, Prestamo } from './finanzas/prestamos'
import type { MetaAhorro } from './finanzas/metas'
import type { Recordatorio, Tarea } from './tareas/calculos'
import type { PreferenciaAviso } from './avisos/reglas'

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
export async function obtenerPlantillasActivas(): Promise<string[]> {
  return revisar(await supabase.from('plantilla_activa').select('codigo_plantilla').eq('estado', 'activo')).map(p => p.codigo_plantilla)
}

export async function activarPlantillas(codigos: string[]) {
  revisar(await supabase.from('plantilla_activa')
    .upsert(codigos.map(codigo_plantilla => ({ codigo_plantilla, estado: 'activo' })), { onConflict: 'id_usuario,codigo_plantilla' }))
}

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

// El nombre es único por persona aunque el hábito se haya quitado: si ya existió, vuelve con sus registros.
export async function crearHabito(datos: Pick<Seguimiento, 'nombre' | 'tipo_medida' | 'unidad'>) {
  const { data, error } = await supabase.from('seguimiento')
    .insert({ ...datos, frecuencia: 'dia', codigo_plantilla: 'habitos' }).select('id_seguimiento').single()
  if (!error) return data.id_seguimiento as string
  const vuelto = revisar(await supabase.from('seguimiento').update({ estado: 'activo' })
    .eq('nombre', datos.nombre).eq('codigo_plantilla', 'habitos').eq('estado', 'eliminado').select('id_seguimiento'))
  if (!vuelto.length) revisar({ data: null, error })
  return vuelto[0].id_seguimiento as string
}

// Igual que los hábitos: una medida que se dejó de medir vuelve con sus registros si se crea con el mismo nombre.
export async function crearMedida(nombre: string, unidad: string) {
  const { data, error } = await supabase.from('seguimiento')
    .insert({ nombre, unidad, tipo_medida: 'numero', frecuencia: 'registro', codigo_plantilla: 'cuerpo' }).select('id_seguimiento').single()
  if (!error) return data.id_seguimiento as string
  const vuelta = revisar(await supabase.from('seguimiento').update({ estado: 'activo' })
    .eq('nombre', nombre).eq('codigo_plantilla', 'cuerpo').eq('estado', 'eliminado').select('id_seguimiento'))
  if (!vuelta.length) revisar({ data: null, error })
  return vuelta[0].id_seguimiento as string
}

// 23505: el nombre ya existe, también entre los quitados.
async function cambiarNombre(tabla: 'seguimiento' | 'etiqueta', id: string, nuevo: string, repetido: string) {
  const { error } = await supabase.from(tabla).update({ nombre: nuevo }).eq(`id_${tabla}`, id)
  if ((error as { code?: string } | null)?.code === '23505') throw new ErrorDatos(repetido)
  revisar({ data: null, error })
}

// Lo aprendido con el nombre viejo pasa al nuevo.
export async function renombrarHabito(id: string, viejo: string, nuevo: string) {
  await cambiarNombre('seguimiento', id, nuevo, `Ya existe un hábito llamado ${nuevo} (o lo tuviste antes).`)
  revisar(await supabase.from('alias').update({ texto_correcto: nuevo }).eq('tipo', 'habito').eq('texto_correcto', viejo))
}

export async function renombrarEjercicio(idEtiqueta: string, viejo: string, nuevo: string) {
  await cambiarNombre('etiqueta', idEtiqueta, nuevo, `Ya existe un ejercicio llamado ${nuevo} (o lo tuviste antes).`)
  revisar(await supabase.from('alias').update({ texto_correcto: nuevo }).eq('tipo', 'ejercicio').eq('texto_correcto', viejo))
}

export const renombrarMedida = (id: string, nuevo: string) =>
  cambiarNombre('seguimiento', id, nuevo, `Ya tienes algo llamado ${nuevo} (o lo tuviste antes).`)

// Nombre y unidad de una medida del cuerpo; el nombre es único aunque la medida se haya dejado de medir.
export async function editarMedida(id: string, cambios: { nombre: string; unidad: string }) {
  const { error } = await supabase.from('seguimiento').update(cambios).eq('id_seguimiento', id)
  if ((error as { code?: string } | null)?.code === '23505') throw new ErrorDatos(`Ya tienes algo llamado ${cambios.nombre} (o lo tuviste antes).`)
  revisar({ data: null, error })
}

export async function quitarSeguimiento(id: string) {
  revisar(await supabase.from('seguimiento').update({ estado: 'eliminado' }).eq('id_seguimiento', id))
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

export type Origen = 'factura' | 'prestamo'
export const TEXTO_ORIGEN: Record<Origen, string> = { factura: 'Factura', prestamo: 'Cuota de préstamo' }

export interface Presupuesto { id_meta: string; id_etiqueta: string; valor: number }

// Lo que necesita la pantalla Finanzas además de los registros: categorías de Gastos, fuentes de Ingresos, presupuestos,
// lo aprendido y los recibos con sus pagos de los últimos 4 meses (para los pendientes).
export async function obtenerFinanzas(idGastos: string, desdePagos: string, idIngresos?: string) {
  const etiquetas = (id: string) => supabase.from('etiqueta').select('id_etiqueta, nombre, grupo, palabras_clave')
    .eq('id_seguimiento', id).eq('estado', 'activo').order('nombre')
  const [categorias, fuentes, presupuestos, aprendido, recibos, pagos, deFacturas, dePrestamos] = await Promise.all([
    etiquetas(idGastos),
    idIngresos ? etiquetas(idIngresos) : { data: [], error: null },
    supabase.from('meta').select('id_meta, id_etiqueta, valor')
      .eq('id_seguimiento', idGastos).eq('estado', 'activo').not('id_etiqueta', 'is', null),
    supabase.from('alias').select('texto_escrito, texto_correcto').eq('tipo', 'categoria').eq('estado', 'activo'),
    supabase.from('recibo').select('id_recibo, nombre_servicio, nombre_ubicacion, tipo_recibo, descuenta_saldo').eq('estado', 'activo'),
    supabase.from('pago_recibo').select('id_recibo, fecha_periodo, valor, estado').gte('fecha_periodo', desdePagos),
    supabase.from('pago_recibo').select('id_registro').not('id_registro', 'is', null),
    supabase.from('movimiento_prestamo').select('id_registro').not('id_registro', 'is', null),
  ])
  return {
    categorias: revisar(categorias) as Categoria[],
    fuentes: revisar(fuentes) as Categoria[],
    presupuestos: revisar(presupuestos) as Presupuesto[],
    aprendido: new Map(revisar(aprendido).map(a => [a.texto_escrito, a.texto_correcto] as [string, string])),
    recibos: revisar(recibos) as Recibo[],
    pagos: revisar(pagos) as PagoRecibo[],
    // de dónde salió cada gasto que no se registró a mano
    origenes: new Map<string, Origen>([
      ...revisar(deFacturas).map(p => [p.id_registro, 'factura'] as [string, Origen]),
      ...revisar(dePrestamos).map(m => [m.id_registro, 'prestamo'] as [string, Origen]),
    ]),
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
  return revisar(await supabase.from('registro').select('id_registro, nota, valor, fecha_registro')
    .eq('id_seguimiento', idGastos).eq('estado', 'activo').is('id_etiqueta', null)) as { id_registro: string; nota: string | null; valor: number; fecha_registro: string }[]
}

// Solo cambia la categoría, nunca montos ni fechas. En tandas de 100 para no alargar la URL.
export async function categorizar(ids: string[], idEtiqueta: string) {
  for (let i = 0; i < ids.length; i += 100)
    revisar(await supabase.from('registro').update({ id_etiqueta: idEtiqueta }).in('id_registro', ids.slice(i, i + 100)).is('id_etiqueta', null))
}

// Metas de ahorro y todos los ahorros (no solo el último año), para el total de cada meta.
// shortcut: hasta 1.000 ahorros (límite de la API); paginar si alguien tiene más.
export async function obtenerMetasAhorro(idAhorro: string) {
  const [etiquetas, metas, ahorros] = await Promise.all([
    supabase.from('etiqueta').select('id_etiqueta, nombre').eq('id_seguimiento', idAhorro).eq('estado', 'activo'),
    supabase.from('meta').select('id_meta, id_etiqueta, valor, fecha_inicio, fecha_fin')
      .eq('id_seguimiento', idAhorro).eq('estado', 'activo').not('id_etiqueta', 'is', null).order('fecha_creacion'),
    obtenerRegistros('1900-01-01', idAhorro),
  ])
  const nombres = new Map(revisar(etiquetas).map(e => [e.id_etiqueta, e.nombre] as [string, string]))
  return {
    metas: revisar(metas).flatMap(m => nombres.has(m.id_etiqueta) ? [{ ...m, nombre: nombres.get(m.id_etiqueta)! }] : []) as MetaAhorro[],
    ahorros,
  }
}

// El nombre es único en Ahorro aunque la meta se haya quitado: si la etiqueta ya existe, se reusa con sus ahorros.
export async function crearMetaAhorro(idAhorro: string, meta: { nombre: string; valor: number; fecha_fin: string | null }) {
  const { data, error } = await supabase.from('etiqueta').insert({ id_seguimiento: idAhorro, nombre: meta.nombre }).select('id_etiqueta').single()
  let idEtiqueta = data?.id_etiqueta as string | undefined
  if (error) {
    const [existente] = revisar(await supabase.from('etiqueta').update({ estado: 'activo' })
      .eq('id_seguimiento', idAhorro).eq('nombre', meta.nombre).select('id_etiqueta'))
    if (!existente) revisar({ data: null, error })
    idEtiqueta = existente.id_etiqueta
    const conMeta = revisar(await supabase.from('meta').select('id_meta').eq('id_etiqueta', idEtiqueta).eq('estado', 'activo'))
    if (conMeta.length) throw new ErrorDatos(`Ya tienes una meta llamada "${meta.nombre}".`)
  }
  // periodo es obligatorio en meta; en las de ahorro no se usa (manda fecha_fin)
  revisar(await supabase.from('meta').insert({
    id_seguimiento: idAhorro, id_etiqueta: idEtiqueta, valor: meta.valor, direccion: 'mas_es_mejor', periodo: 'ano', fecha_fin: meta.fecha_fin,
  }))
}

export async function editarMetaAhorro(meta: MetaAhorro, cambios: { nombre: string; valor: number; fecha_fin: string | null }) {
  if (cambios.nombre !== meta.nombre) {
    const { error } = await supabase.from('etiqueta').update({ nombre: cambios.nombre }).eq('id_etiqueta', meta.id_etiqueta)
    if (error) throw new ErrorDatos(`Ya tienes una meta llamada "${cambios.nombre}".`)
  }
  revisar(await supabase.from('meta').update({ valor: cambios.valor, fecha_fin: cambios.fecha_fin }).eq('id_meta', meta.id_meta))
}

// Sus ahorros no se borran: quedan como ahorro libre.
export async function quitarMetaAhorro(idAhorro: string, meta: MetaAhorro) {
  revisar(await supabase.from('registro').update({ id_etiqueta: null }).eq('id_seguimiento', idAhorro).eq('id_etiqueta', meta.id_etiqueta))
  revisar(await supabase.from('meta').update({ estado: 'eliminado' }).eq('id_meta', meta.id_meta))
  revisar(await supabase.from('etiqueta').update({ estado: 'eliminado' }).eq('id_etiqueta', meta.id_etiqueta))
}

// Pendientes, hechas de los últimos 30 días y recordatorios que siguen vivos.
export async function obtenerTareas(desdeHechas: string) {
  const [pendientes, hechas, recordatorios] = await Promise.all([
    supabase.from('tarea').select('id_tarea, descripcion, fecha_limite, fecha_realizacion, estado').eq('estado', 'pendiente'),
    supabase.from('tarea').select('id_tarea, descripcion, fecha_limite, fecha_realizacion, estado').eq('estado', 'hecho')
      .gte('fecha_realizacion', desdeHechas).order('fecha_realizacion', { ascending: false }),
    supabase.from('recordatorio').select('id_recordatorio, descripcion, hora_envio, tipo_repeticion, dias_semana, dia_mes, fecha_proximo_envio, estado')
      .in('estado', ['activo', 'pausado']).order('hora_envio'),
  ])
  return {
    tareas: [...revisar(pendientes), ...revisar(hechas)] as Tarea[],
    recordatorios: revisar(recordatorios) as Recordatorio[],
  }
}

export async function crearTarea(tarea: { descripcion: string; fecha_limite: string | null }) {
  revisar(await supabase.from('tarea').insert(tarea))
}

export async function marcarTarea(idTarea: string, hecha: boolean) {
  revisar(await supabase.from('tarea').update(hecha
    ? { estado: 'hecho', fecha_realizacion: new Date().toISOString() }
    : { estado: 'pendiente', fecha_realizacion: null }).eq('id_tarea', idTarea))
}

export async function editarTarea(idTarea: string, descripcion: string) {
  revisar(await supabase.from('tarea').update({ descripcion }).eq('id_tarea', idTarea))
}

export async function quitarTarea(idTarea: string) {
  revisar(await supabase.from('tarea').update({ estado: 'eliminado' }).eq('id_tarea', idTarea))
}

export async function crearRecordatorio(r: Omit<Recordatorio, 'id_recordatorio' | 'estado'>) {
  revisar(await supabase.from('recordatorio').insert({ ...r, estado: r.fecha_proximo_envio ? 'activo' : 'terminado' }))
}

export async function cambiarRecordatorio(idRecordatorio: string, cambios: Partial<Pick<Recordatorio, 'fecha_proximo_envio' | 'estado' | 'descripcion'>> | { estado: 'eliminado' }) {
  revisar(await supabase.from('recordatorio').update(cambios).eq('id_recordatorio', idRecordatorio))
}

const CAMPOS_PREFERENCIA = 'estado, recibir_resumen_diario, frecuencia_resumen_diario, hora_resumen_diario, recibir_resumen_semanal, '
  + 'dia_resumen_semanal, hora_resumen_semanal, recibir_cierre_mes, hora_cierre_mes, recibir_recordatorios, tipos_recordatorio, mostrar_descripcion, recibir_aviso_descarga, '
  + 'recibir_recordatorio_no_registrado, modulos_recordatorio_apagados, cantidad_maxima_recordatorios_dia, hora_inicio_silencio, hora_fin_silencio, recibir_aviso_inactividad'

// Cuándo se anotó cada registro (para mostrar el ritmo que aprendió la app).
export async function obtenerMarcas(desde: string) {
  return revisar(await supabase.from('registro').select('id_seguimiento, fecha_registro, fecha_creacion').eq('estado', 'activo').gte('fecha_registro', desde)) as
    { id_seguimiento: string; fecha_registro: string; fecha_creacion: string }[]
}

// null si nunca ha guardado: la pantalla parte de PREFERENCIA_INICIAL.
export async function obtenerAvisos() {
  const [preferencia, equipos] = await Promise.all([
    supabase.from('preferencia_aviso').select(CAMPOS_PREFERENCIA).maybeSingle(),
    supabase.from('suscripcion_push').select('id_suscripcion_push', { count: 'exact', head: true }),
  ])
  if (preferencia.error || equipos.error) revisar({ data: null, error: preferencia.error ?? equipos.error })
  return { preferencia: preferencia.data as unknown as Omit<PreferenciaAviso, `fecha_ultimo_${string}`> | null, equipos: equipos.count ?? 0 }
}

// Las fechas del último envío las lleva la función que envía; aquí no se tocan.
export async function guardarPreferenciaAviso(p: Omit<PreferenciaAviso, `fecha_ultimo_${string}`>) {
  // la primera vez la pantalla parte de PREFERENCIA_INICIAL, que trae esas fechas: sin quitarlas la base responde 403
  const datos = Object.fromEntries(Object.entries(p).filter(([campo]) => !campo.startsWith('fecha_ultimo_'))) as typeof p
  revisar(await supabase.from('preferencia_aviso').upsert(datos, { onConflict: 'id_usuario' }))
}

export async function guardarSuscripcion(s: { endpoint: string; llave_p256dh: string; llave_auth: string; nombre_equipo: string }) {
  revisar(await supabase.from('suscripcion_push').upsert(s, { onConflict: 'endpoint' }))
}

// Solo llega a los equipos de quien la pide (la función lo sabe por la sesión).
export async function enviarAvisoPrueba(): Promise<number> {
  const { data, error } = await supabase.functions.invoke('avisos', { body: {} })
  if (error) throw new ErrorDatos('No se pudo enviar el aviso de prueba. Inténtalo de nuevo.')
  return data?.entregados ?? 0
}

export async function quitarSuscripcion(endpoint: string) {
  revisar(await supabase.from('suscripcion_push').delete().eq('endpoint', endpoint))
}

// Recibos activos (número siempre enmascarado) y sus pagos del último año, para el día aprendido y el gráfico.
export async function obtenerRecibos(desde: string) {
  const [recibos, pagos] = await Promise.all([
    supabase.from('recibo_visible').select('id_recibo, nombre_servicio, nombre_ubicacion, tipo_recibo, dia_pago, numero_cuenta_enmascarado, requiere_numero_pago, descuenta_saldo, estado')
      .in('estado', ['activo', 'no_se_paga']).order('nombre_servicio'),
    supabase.from('pago_recibo').select('id_pago_recibo, id_recibo, id_registro, fecha_periodo, valor, fecha_pago, estado')
      .gte('fecha_periodo', desde),
  ])
  return { recibos: revisar(recibos) as ReciboVisible[], pagos: revisar(pagos) as PagoGuardado[] }
}

// El número completo solo se pide al tocar "ver" y queda en memoria de la pantalla, nunca en el navegador.
export async function verNumeroCuenta(idRecibo: string): Promise<string | null> {
  return revisar(await supabase.from('recibo').select('numero_cuenta').eq('id_recibo', idRecibo).single()).numero_cuenta
}

// Si ya existe en pausa o quitada, la vuelve a usar con el estado pedido en vez de fallar.
export async function crearRecibo(datos: {
  nombre_servicio: string; tipo_recibo: 'hogar' | 'personal'; nombre_ubicacion: string | null; numero_cuenta: string | null; requiere_numero_pago: boolean
  estado: 'activo' | 'no_se_paga'
}) {
  const { error, data } = await supabase.from('recibo').insert(datos).select('id_recibo').single()
  if (error?.code !== '23505') return revisar({ data, error }).id_recibo as string
  const { numero_cuenta, ...resto } = datos
  // sin número nuevo se conserva el que tenía
  let existente = supabase.from('recibo').update(numero_cuenta ? datos : resto).eq('nombre_servicio', datos.nombre_servicio).neq('estado', 'activo')
  existente = datos.nombre_ubicacion ? existente.eq('nombre_ubicacion', datos.nombre_ubicacion) : existente.is('nombre_ubicacion', null)
  const [fila] = revisar(await existente.select('id_recibo'))
  if (!fila) throw new ErrorDatos('Ya tienes una factura activa con ese servicio y ubicación.')
  return fila.id_recibo as string
}

export async function cambiarEstadoRecibo(idRecibo: string, estado: 'activo' | 'no_se_paga') {
  revisar(await supabase.from('recibo').update({ estado }).eq('id_recibo', idRecibo))
}

// "No se paga este mes": cierra el período sin gasto para que no vuelva a salir.
export async function marcarSinPago(idRecibo: string, fechaPeriodo: string) {
  revisar(await supabase.from('pago_recibo').upsert({ id_recibo: idRecibo, fecha_periodo: fechaPeriodo, valor: 0, estado: 'cancelado' },
    { onConflict: 'id_usuario,id_recibo,fecha_periodo' }))
}

// Sin número nuevo se conserva el que tenía (la pantalla solo conoce el enmascarado).
export async function editarRecibo(idRecibo: string, cambios: {
  nombre_servicio: string; nombre_ubicacion: string | null; tipo_recibo: 'hogar' | 'personal'; dia_pago: number | null
  requiere_numero_pago: boolean; descuenta_saldo: boolean; numero_cuenta?: string
}) {
  const { error } = await supabase.from('recibo').update(cambios).eq('id_recibo', idRecibo)
  if (error?.code === '23505') throw new ErrorDatos('Ya tienes una factura con ese servicio y ubicación.')
  revisar({ data: null, error })
}

// Borrado lógico: conserva su historial de pagos.
export async function quitarRecibo(idRecibo: string) {
  revisar(await supabase.from('recibo').update({ estado: 'eliminado' }).eq('id_recibo', idRecibo))
}

// Crea el gasto (si la factura descuenta del saldo) y marca el período pagado; si el pago falla, quita el gasto para no contarlo sin recibo.
// shortcut: dos llamadas sin transacción y sin cola; pasar a una función SQL si un fallo entre las dos llega a dejar huérfanos.
export async function pagarRecibo(pago: {
  id_recibo: string; fecha_periodo: string; valor: number; fecha_pago: string; dia_pago: number | null
  // fecha: a qué día va el gasto; fecha_pago es cuándo se pagó
  gasto: { id_seguimiento: string; id_etiqueta: string | null; grupo: 'basico' | null; nota: string; fecha: string } | null
}) {
  const id_registro = pago.gasto ? crypto.randomUUID() : null
  if (pago.gasto) {
    const { fecha, ...gasto } = pago.gasto
    revisar(await supabase.from('registro').insert({ ...gasto, id_registro, fecha_registro: fecha, valor: pago.valor }))
  }
  const { error } = await supabase.from('pago_recibo').upsert({
    id_recibo: pago.id_recibo, fecha_periodo: pago.fecha_periodo, valor: pago.valor, fecha_pago: pago.fecha_pago, estado: 'pagado', id_registro,
  }, { onConflict: 'id_usuario,id_recibo,fecha_periodo' })
  if (error) {
    if (id_registro) await eliminarRegistro(id_registro).catch(() => {})
    revisar({ data: null, error })
  }
  if (pago.dia_pago) await supabase.from('recibo').update({ dia_pago: pago.dia_pago }).eq('id_recibo', pago.id_recibo)
}

// Deshacer: borra el pago del período y su gasto.
export async function deshacerPago(pago: { id_pago_recibo: string; id_registro: string | null }) {
  revisar(await supabase.from('pago_recibo').delete().eq('id_pago_recibo', pago.id_pago_recibo))
  if (pago.id_registro) await eliminarRegistro(pago.id_registro)
}

// Borrar un movimiento de Finanzas: si es el gasto de una factura o de un préstamo, deshace también eso para que cuadre.
export async function borrarMovimiento(idRegistro: string) {
  const [pagos, movimientos] = await Promise.all([
    supabase.from('pago_recibo').select('id_pago_recibo, id_registro').eq('id_registro', idRegistro),
    supabase.from('movimiento_prestamo').select('id_movimiento_prestamo, id_registro').eq('id_registro', idRegistro),
  ])
  const [pago] = revisar(pagos)
  const [movimiento] = revisar(movimientos)
  if (pago) return deshacerPago(pago)
  if (movimiento) return deshacerMovimientoPrestamo(movimiento)
  return eliminarRegistro(idRegistro)
}

const CAMPOS_PRESTAMO = 'id_prestamo, nombre_entidad, nombre_prestamo, valor_saldo_inicial, fecha_primera_cuota, cantidad_cuotas, tasa_efectiva_anual, valor_seguro_mensual, dia_pago'

export async function obtenerPrestamos() {
  const [prestamos, movimientos] = await Promise.all([
    supabase.from('prestamo').select(CAMPOS_PRESTAMO).eq('estado', 'activo').order('fecha_creacion'),
    supabase.from('movimiento_prestamo')
      .select('id_movimiento_prestamo, id_prestamo, id_registro, tipo_movimiento, fecha_movimiento, numero_cuota, valor, tasa_efectiva_anual, tipo_abono'),
  ])
  return { prestamos: revisar(prestamos) as Prestamo[], movimientos: revisar(movimientos) as MovimientoPrestamo[] }
}

export async function crearPrestamo(datos: Omit<Prestamo, 'id_prestamo'>) {
  revisar(await supabase.from('prestamo').insert(datos))
}

export async function quitarPrestamo(idPrestamo: string) {
  revisar(await supabase.from('prestamo').update({ estado: 'eliminado' }).eq('id_prestamo', idPrestamo))
}

type NuevoMovimientoPrestamo = Pick<MovimientoPrestamo, 'id_prestamo' | 'tipo_movimiento' | 'fecha_movimiento'>
  & Partial<Pick<MovimientoPrestamo, 'numero_cuota' | 'valor' | 'tasa_efectiva_anual' | 'tipo_abono'>>

// Cuota o abono: crea el gasto y luego el movimiento; si el movimiento falla, quita el gasto (como pagarRecibo).
// shortcut: dos llamadas sin transacción; pasar a una función SQL si llegan a quedar gastos huérfanos.
export async function registrarMovimientoPrestamo(movimiento: NuevoMovimientoPrestamo,
  gasto?: { id_seguimiento: string; id_etiqueta: string | null; nota: string }) {
  const id_registro = gasto ? crypto.randomUUID() : null
  if (gasto) revisar(await supabase.from('registro').insert({
    ...gasto, id_registro, grupo: 'basico', fecha_registro: movimiento.fecha_movimiento, valor: movimiento.valor,
  }))
  const { error } = await supabase.from('movimiento_prestamo').insert({ ...movimiento, id_registro })
  if (error) {
    if (id_registro) await eliminarRegistro(id_registro).catch(() => {})
    revisar({ data: null, error })
  }
}

export async function deshacerMovimientoPrestamo(m: Pick<MovimientoPrestamo, 'id_movimiento_prestamo' | 'id_registro'>) {
  revisar(await supabase.from('movimiento_prestamo').delete().eq('id_movimiento_prestamo', m.id_movimiento_prestamo))
  if (m.id_registro) await eliminarRegistro(m.id_registro)
}

// Ejercicios (etiquetas de Gym), series del último año y nombres aprendidos; las fechas salen de los registros.
export async function obtenerSalud(idGym: string, desde: string) {
  const [ejercicios, series, alias] = await Promise.all([
    // también los quitados: sus series pasadas siguen contando y se ven con su nombre
    supabase.from('etiqueta').select('id_etiqueta, nombre, estado').eq('id_seguimiento', idGym),
    supabase.from('serie_gym').select('id_registro, cantidad_series, cantidad_repeticiones, peso_kilogramos').gte('fecha_creacion', desde),
    supabase.from('alias').select('texto_escrito, texto_correcto').eq('tipo', 'ejercicio').eq('estado', 'activo'),
  ])
  const todos = revisar(ejercicios) as { id_etiqueta: string; nombre: string; estado: string }[]
  return {
    ejercicios: todos.filter(e => e.estado === 'activo'),
    nombres: new Map(todos.map(e => [e.id_etiqueta, e.nombre])),
    series: revisar(series) as { id_registro: string; cantidad_series: number; cantidad_repeticiones: number; peso_kilogramos: number | null }[],
    alias: new Map(revisar(alias).map(a => [a.texto_escrito, a.texto_correcto] as [string, string])),
  }
}

export async function crearEtiqueta(idSeguimiento: string, nombre: string) {
  return revisar(await supabase.from('etiqueta').insert({ id_seguimiento: idSeguimiento, nombre }).select('id_etiqueta').single()).id_etiqueta as string
}
// Si el ejercicio existió y se quitó, vuelve con su nombre (el nombre es único en el seguimiento).
export async function crearEjercicio(idGym: string, nombre: string) {
  const { data, error } = await supabase.from('etiqueta').insert({ id_seguimiento: idGym, nombre }).select('id_etiqueta').single()
  if (error?.code !== '23505') return revisar({ data, error }).id_etiqueta as string
  const [fila] = revisar(await supabase.from('etiqueta').update({ estado: 'activo' })
    .eq('id_seguimiento', idGym).eq('nombre', nombre).eq('estado', 'eliminado').select('id_etiqueta'))
  if (!fila) throw new ErrorDatos(`Ya tienes un ejercicio llamado ${nombre}.`)
  return fila.id_etiqueta as string
}

// Deja de salir en la lista y en las sugerencias; sus series pasadas se conservan.
export async function quitarEjercicio(idEtiqueta: string) {
  revisar(await supabase.from('etiqueta').update({ estado: 'eliminado' }).eq('id_etiqueta', idEtiqueta))
}

// Categoría de gastos o fuente de ingresos. Si existió y se quitó, vuelve con su nombre (el nombre es único en el seguimiento).
export async function crearCategoria(idSeguimiento: string, nombre: string, grupo: 'basico' | 'personal' | null) {
  const { data, error } = await supabase.from('etiqueta').insert({ id_seguimiento: idSeguimiento, nombre, grupo }).select('id_etiqueta').single()
  if (error?.code !== '23505') return revisar({ data, error }).id_etiqueta as string
  const [fila] = revisar(await supabase.from('etiqueta').update({ estado: 'activo', grupo })
    .eq('id_seguimiento', idSeguimiento).eq('nombre', nombre).eq('estado', 'eliminado').select('id_etiqueta'))
  if (!fila) throw new ErrorDatos(`Ya tienes una categoría llamada ${nombre}.`)
  return fila.id_etiqueta as string
}

// Corrige nombre y grupo; lo aprendido con el nombre viejo pasa al nuevo (como al renombrar hábitos).
export async function editarCategoria(idEtiqueta: string, viejo: string, cambios: { nombre: string; grupo: 'basico' | 'personal' | null }) {
  const { error } = await supabase.from('etiqueta').update(cambios).eq('id_etiqueta', idEtiqueta)
  if (error?.code === '23505') throw new ErrorDatos(`Ya tienes una categoría llamada ${cambios.nombre} (o la tuviste antes).`)
  revisar({ data: null, error })
  if (cambios.nombre !== viejo)
    revisar(await supabase.from('alias').update({ texto_correcto: cambios.nombre }).eq('tipo', 'categoria').eq('texto_correcto', viejo))
}

// Las categorías iniciales de Gastos; las que ya existan (aunque se hayan quitado) no se tocan.
export async function crearCategoriasIniciales(idGastos: string) {
  revisar(await supabase.from('etiqueta')
    .upsert(CATEGORIAS_INICIALES.map(c => ({ ...c, id_seguimiento: idGastos })), { onConflict: 'id_seguimiento,nombre', ignoreDuplicates: true }))
}

// Borrado lógico: sus registros pasan a la categoría elegida (o quedan sin categoría); montos y fechas no se tocan.
export async function quitarCategoria(idEtiqueta: string, idDestino: string | null) {
  revisar(await supabase.from('registro').update({ id_etiqueta: idDestino }).eq('id_etiqueta', idEtiqueta))
  revisar(await supabase.from('etiqueta').update({ estado: 'eliminado' }).eq('id_etiqueta', idEtiqueta))
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

// Corrige una serie ya guardada con el mismo reparto de registrarSerie.
export async function corregirSerie(idRegistro: string, s: { series: number; repeticiones: number; peso: number | null }) {
  revisar(await supabase.from('serie_gym')
    .update({ cantidad_series: s.series, cantidad_repeticiones: s.repeticiones, peso_kilogramos: s.peso }).eq('id_registro', idRegistro))
  revisar(await supabase.from('registro').update({ valor: s.peso ?? s.repeticiones }).eq('id_registro', idRegistro))
}

// Cambia o quita (valor null) la meta general de un seguimiento.
export async function guardarMeta(idSeguimiento: string, meta: Meta | null) {
  revisar(await supabase.from('meta').update({ estado: 'eliminado' })
    .eq('id_seguimiento', idSeguimiento).is('id_etiqueta', null).eq('estado', 'activo'))
  if (meta) revisar(await supabase.from('meta').insert({ ...meta, id_seguimiento: idSeguimiento }))
}

export async function cerrarSesion() {
  await vaciar()
  // En un equipo compartido, quien entre después no recibe los avisos de quien salió. Si falla, igual cierra la sesión.
  try {
    const registro = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    const suscripcion = await registro?.pushManager?.getSubscription()
    if (suscripcion) {
      await quitarSuscripcion(suscripcion.endpoint)
      await suscripcion.unsubscribe()
    }
  } catch { /* sigue con el cierre */ }
  await supabase.auth.signOut()
}

// ---------- Mis datos ----------

export type ModuloDescarga = 'finanzas' | 'deudas' | 'salud' | 'habitos' | 'tareas' | 'cuenta'
const PLANTILLAS_DESCARGA: Partial<Record<ModuloDescarga, string[]>> = { finanzas: ['finanzas', 'recibos'], salud: ['gym', 'cuerpo'] }

// Todas las filas de la persona (la RLS filtra); de 1.000 en 1.000, el máximo que entrega la API. Sin id_usuario.
async function todas(tabla: string, orden = `id_${tabla}`, en?: [string, string[]]) {
  const filas: Record<string, unknown>[] = []
  for (let desde = 0; ; desde += 1000) {
    let consulta = supabase.from(tabla).select('*')
    if (en) consulta = consulta.in(en[0], en[1])
    const lote = revisar(await consulta.order(orden).range(desde, desde + 999)) as Record<string, unknown>[]
    filas.push(...lote.map(({ id_usuario: _, ...resto }) => resto))
    if (lote.length < 1000) return filas
  }
}

// Seguimientos del módulo con sus etiquetas, metas y registros. Hábitos se lleva también los creados a mano.
async function deSeguimientos(modulo: ModuloDescarga) {
  const propias = PLANTILLAS_DESCARGA[modulo]
  const otras = Object.values(PLANTILLAS_DESCARGA).flat()
  const seguimientos = (await todas('seguimiento')).filter(s =>
    propias ? propias.includes(s.codigo_plantilla as string) : !otras.includes(s.codigo_plantilla as string))
  const ids = seguimientos.map(s => s.id_seguimiento as string)
  const [etiquetas, metas, registros] = await Promise.all(['etiqueta', 'meta', 'registro'].map(t => todas(t, undefined, ['id_seguimiento', ids])))
  return [
    { titulo: 'Seguimientos', filas: seguimientos }, { titulo: 'Etiquetas', filas: etiquetas },
    { titulo: 'Metas', filas: metas }, { titulo: 'Registros', filas: registros },
  ]
}

export async function obtenerDescarga(modulo: ModuloDescarga) {
  const tablas = async (...t: [string, string, string?][]) =>
    Promise.all(t.map(async ([titulo, tabla, orden]) => ({ titulo, filas: await todas(tabla, orden) })))
  switch (modulo) {
    case 'finanzas': return [...await deSeguimientos(modulo), ...await tablas(['Recibos', 'recibo_visible', 'id_recibo'], ['Pagos de recibos', 'pago_recibo'])]
    case 'deudas': return tablas(['Préstamos', 'prestamo'], ['Movimientos de préstamos', 'movimiento_prestamo'])
    case 'salud': return [...await deSeguimientos(modulo), ...await tablas(['Series de gym', 'serie_gym'])]
    case 'habitos': return deSeguimientos(modulo)
    case 'tareas': return tablas(['Tareas', 'tarea'], ['Recordatorios', 'recordatorio'])
    case 'cuenta': return tablas(['Perfil', 'perfil', 'id_usuario'], ['Módulos activos', 'plantilla_activa'], ['Nombres aprendidos', 'alias'],
      ['Preferencias de avisos', 'preferencia_aviso'], ['Mensajes de contacto', 'mensaje_contacto'])
  }
}

export interface MensajeContacto {
  id_mensaje_contacto: string
  motivo: 'duda' | 'mis_datos' | 'error' | 'otro'
  mensaje: string
  respuesta: string | null
  fecha_respuesta: string | null
  estado: 'nuevo' | 'respondido'
  fecha_creacion: string
}
const CAMPOS_MENSAJE = 'id_mensaje_contacto, motivo, mensaje, respuesta, fecha_respuesta, estado, fecha_creacion'

export async function obtenerMisMensajes(): Promise<MensajeContacto[]> {
  return revisar(await supabase.from('mensaje_contacto').select(CAMPOS_MENSAJE).order('fecha_creacion', { ascending: false }).limit(50)) as MensajeContacto[]
}

export async function enviarMensaje(motivo: MensajeContacto['motivo'], mensaje: string) {
  const { error } = await supabase.from('mensaje_contacto').insert({ motivo, mensaje })
  if (error?.message === 'limite de mensajes') throw new ErrorDatos('Ya enviaste 5 mensajes hoy. Inténtalo mañana.')
  revisar({ data: null, error })
}

export async function soyAdministrador(): Promise<boolean> {
  return revisar(await supabase.rpc('soy_administrador')) as boolean
}

export async function obtenerMensajesRecibidos(): Promise<(MensajeContacto & { correo: string })[]> {
  return revisar(await supabase.rpc('mensajes_contacto_recibidos')) as (MensajeContacto & { correo: string })[]
}

export async function responderMensaje(idMensaje: string, texto: string) {
  revisar(await supabase.rpc('responder_mensaje_contacto', { id_mensaje: idMensaje, texto }))
}

export type Invitado = { correo: string; estado: 'activo' | 'inactivo'; es_administrador: boolean; tiene_cuenta: boolean; fecha_actualizacion: string }

export async function obtenerInvitados(): Promise<Invitado[]> {
  return revisar(await supabase.rpc('invitados')) as Invitado[]
}

export async function invitar(correo: string) {
  const { error } = await supabase.rpc('invitar', { correo_invitado: correo })
  if (error?.message === 'correo invalido') throw new ErrorDatos('Revisa el correo.')
  revisar({ data: null, error })
}

// Borra la cuenta de esa persona con todos sus datos; su correo queda inactivo.
export async function quitarInvitado(correo: string) {
  const { error } = await supabase.rpc('quitar_invitado', { correo_invitado: correo })
  if (error?.message === 'administrador') throw new ErrorDatos('La cuenta del administrador no se quita.')
  revisar({ data: null, error })
}

// Borra todo en la base; después se cierra la sesión en este equipo (quita su suscripción local y la cola).
export async function borrarMiCuenta() {
  const { error } = await supabase.rpc('borrar_mi_cuenta')
  if (error?.message === 'administrador') throw new ErrorDatos('La cuenta del administrador no se borra desde la app.')
  revisar({ data: null, error })
  await cerrarSesion()
}
