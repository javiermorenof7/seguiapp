// Función "avisos" (Supabase Edge Functions, Deno). Dos entradas:
// - la tarea programada (cada 5 min) con la cabecera x-firma, que se compara con la firma guardada en Vault;
// - "Enviar un aviso de prueba" desde la app, con la sesión de la persona: solo le llega a ella.
// Las reglas son las mismas de la app (src/); `npm run funcion:avisos` las empaqueta en un solo archivo para el panel.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'
import {
  AVISO_CIERRE_MES, AVISO_DESCARGA, AVISO_PRUEBA, avisaRecordatorio, avisoMensajesNuevos, avisoRecordatorio, avisoResumenDiario, avisoResumenSemanal,
  momentoColombia, tocaAvisoDescarga, tocaCierreMes, tocaResumenDiario, tocaResumenSemanal, type Aviso, type PreferenciaAviso,
} from '../../../src/avisos/reglas'
import { aTiempoSemana, deHoy, tocaAvisar, type Recordatorio, type Tarea } from '../../../src/tareas/calculos'
import { recibosDelMes, type PagoGuardado, type ReciboVisible } from '../../../src/finanzas/estadoRecibos'
import { avanceMeta, type MetaAhorro } from '../../../src/finanzas/metas'
import { mesesAntes } from '../../../src/finanzas/calculos'
import { LLAVE_PUBLICA_VAPID } from '../../../src/avisos/llave'
import { avisoInactividad, avisoRegistro, enSilencio, horaColombia, inactivo, moduloDe, MODULOS, ritmo, sinUso, tocaInactividad, tocaRecordatorio, type Marca, type Modulo } from '../../../src/avisos/ritmo'

declare const Deno: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } }

const base = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
// el "sujeto" identifica a quien envía ante Google y Apple: la web, nunca un correo
webpush.setVapidDetails('https://seguiapp.pages.dev', LLAVE_PUBLICA_VAPID, Deno.env.get('VAPID_PRIVADA')!)

interface Suscripcion { id_suscripcion_push: string; id_usuario: string; endpoint: string; llave_p256dh: string; llave_auth: string }
// La app llama desde sus dos webs (y local); la tarea programada no usa CORS.
const ORIGENES = ['https://seguiapp.pages.dev', 'http://localhost:5173']
let origen = ORIGENES[0]
const respuesta = (estado: number, cuerpo: object | null) => new Response(cuerpo && JSON.stringify(cuerpo), {
  status: estado,
  headers: {
    'content-type': 'application/json', 'access-control-allow-origin': origen, vary: 'origin',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS',
  },
})

// Envía a todos los equipos de la persona; cuenta los que lo recibieron. Los errores no llevan datos de la persona.
async function enviar(suscripciones: Suscripcion[], aviso: Aviso) {
  let entregados = 0
  for (const s of suscripciones) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.llave_p256dh, auth: s.llave_auth } }, JSON.stringify(aviso), { TTL: 3600 })
      entregados++
      await base.from('suscripcion_push').update({ fecha_ultimo_envio: new Date().toISOString() }).eq('id_suscripcion_push', s.id_suscripcion_push)
    } catch (e) {
      // shortcut: los equipos que ya no existen (404/410) no se borran solos; se quitan desde la app o al cerrar sesión.
      console.log('aviso no entregado', (e as { statusCode?: number }).statusCode ?? 'error')
    }
  }
  return entregados
}

const revisar = <T>(r: { data: T | null; error: unknown }) => { if (r.error) throw r.error; return r.data as T }

async function conteoDelDia(idUsuario: string, hoy: string, tareas: Tarea[], recordatorios: Recordatorio[]) {
  const h = deHoy(tareas, recordatorios, hoy)
  const [recibos, pagos, ahorro] = await Promise.all([
    base.from('recibo').select('id_recibo, nombre_servicio, nombre_ubicacion, tipo_recibo, dia_pago').eq('id_usuario', idUsuario).eq('estado', 'activo'),
    base.from('pago_recibo').select('id_pago_recibo, id_recibo, id_registro, fecha_periodo, valor, fecha_pago, estado').eq('id_usuario', idUsuario)
      .gte('fecha_periodo', `${mesesAntes(hoy.slice(0, 7), 12)}-01`),
    base.from('seguimiento').select('id_seguimiento').eq('id_usuario', idUsuario).eq('codigo_plantilla', 'finanzas').eq('nombre', 'Ahorro').maybeSingle(),
  ])
  const filas = recibosDelMes((revisar(recibos) ?? []).map(r => ({ ...r, numero_cuenta_enmascarado: null })) as ReciboVisible[], (revisar(pagos) ?? []) as PagoGuardado[], hoy)
  let metasAtrasadas = 0
  const idAhorro = (revisar(ahorro) as { id_seguimiento: string } | null)?.id_seguimiento
  if (idAhorro) {
    const [etiquetas, metas, ahorros] = await Promise.all([
      base.from('etiqueta').select('id_etiqueta, nombre').eq('id_seguimiento', idAhorro).eq('estado', 'activo'),
      base.from('meta').select('id_meta, id_etiqueta, valor, fecha_inicio, fecha_fin').eq('id_seguimiento', idAhorro).eq('estado', 'activo').not('id_etiqueta', 'is', null),
      base.from('registro').select('fecha_registro, valor, id_etiqueta').eq('id_seguimiento', idAhorro).eq('estado', 'activo'),
    ])
    const nombres = new Map((revisar(etiquetas) ?? []).map(e => [e.id_etiqueta, e.nombre]))
    const movimientos = (revisar(ahorros) ?? []).map(r => ({ fecha: r.fecha_registro, valor: Number(r.valor), tipo: 'ahorro' as const, id_etiqueta: r.id_etiqueta }))
    metasAtrasadas = (revisar(metas) ?? []).filter(m => nombres.has(m.id_etiqueta))
      .filter(m => avanceMeta({ ...m, valor: Number(m.valor), nombre: '' } as MetaAhorro, movimientos, hoy).estado === 'atrasada').length
  }
  return {
    tareas: h.vencidas.length + h.deHoy.length + h.sinFecha.length,
    recordatorios: h.recordatorios.length,
    facturas: filas.filter(f => f.estado === 'por_pagar' || f.estado === 'vencido').length,
    metasAtrasadas,
  }
}

const SELECCION_SUSCRIPCION = 'id_suscripcion_push, id_usuario, endpoint, llave_p256dh, llave_auth'

// Mensajes de contacto que el administrador aún no sabe que llegaron: un solo aviso con cuántos, sin el texto.
async function avisarMensajesNuevos() {
  const nuevos = revisar(await base.from('mensaje_contacto').select('id_mensaje_contacto').is('fecha_aviso_administrador', null)) as { id_mensaje_contacto: string }[]
  if (!nuevos.length) return 0
  const ids = revisar(await base.rpc('ids_administradores')) as string[]
  const suyas = ids.length ? revisar(await base.from('suscripcion_push').select(SELECCION_SUSCRIPCION).in('id_usuario', ids)) as Suscripcion[] : []
  const entregados = await enviar(suyas, avisoMensajesNuevos(nuevos.length))
  // Se marcan aunque no se entregue, como los resúmenes: el administrador los ve igual en su pantalla.
  await base.from('mensaje_contacto').update({ fecha_aviso_administrador: new Date().toISOString() }).in('id_mensaje_contacto', nuevos.map(n => n.id_mensaje_contacto))
  return entregados ? 1 : 0
}

// Recordatorios de lo que no ha registrado e inactividad, con el ritmo aprendido de sus registros (reglas en src/avisos/ritmo.ts).
// Respeta el silencio y el máximo diario; cada envío queda en aviso_enviado (único por día y código).
async function recordatoriosDeRegistro(p: PreferenciaAviso & { id_usuario: string }, suyas: Suscripcion[], m: ReturnType<typeof momentoColombia>) {
  if (!p.recibir_recordatorio_no_registrado && !p.recibir_aviso_inactividad) return 0
  if (enSilencio(m, p.hora_inicio_silencio, p.hora_fin_silencio)) return 0
  const desde = new Date(Date.parse(m.fecha) - 60 * 864e5).toISOString().slice(0, 10)
  const [seguimientos, registros, enviadosBd] = await Promise.all([
    base.from('seguimiento').select('id_seguimiento, codigo_plantilla, nombre').eq('id_usuario', p.id_usuario).eq('estado', 'activo'),
    base.from('registro').select('id_seguimiento, fecha_registro, fecha_creacion').eq('id_usuario', p.id_usuario).eq('estado', 'activo').gte('fecha_registro', desde),
    base.from('aviso_enviado').select('codigo_aviso, fecha_aviso').eq('id_usuario', p.id_usuario).gte('fecha_aviso', desde),
  ])
  const deSeguimiento = new Map((revisar(seguimientos) as { id_seguimiento: string; codigo_plantilla: string | null; nombre: string }[]).map(s => [s.id_seguimiento, moduloDe(s)]))
  const lista = revisar(registros) as { id_seguimiento: string; fecha_registro: string; fecha_creacion: string }[]
  const marcas = Object.fromEntries(MODULOS.map(x => [x, [] as Marca[]])) as Record<Modulo, Marca[]>
  for (const r of lista) {
    const x = deSeguimiento.get(r.id_seguimiento)
    if (x) marcas[x].push({ fecha: r.fecha_registro, hora: horaColombia(r.fecha_creacion) })
  }
  const enviados = revisar(enviadosBd) as { codigo_aviso: string; fecha_aviso: string }[]
  const de = (codigo: string) => enviados.filter(e => e.codigo_aviso === codigo).map(e => e.fecha_aviso)
  const cupo = p.cantidad_maxima_recordatorios_dia - enviados.filter(e => e.fecha_aviso === m.fecha).length
  if (cupo <= 0) return 0
  const guardar = (codigos: string[]) => base.from('aviso_enviado')
    .upsert(codigos.map(codigo_aviso => ({ id_usuario: p.id_usuario, codigo_aviso, fecha_aviso: m.fecha })), { onConflict: 'id_usuario,codigo_aviso,fecha_aviso', ignoreDuplicates: true })

  // Mientras no use la app, solo la escalera de inactividad (no se juntan avisos de cada módulo).
  const todas = lista.map(r => r.fecha_registro)
  if (inactivo(todas, m.fecha)) {
    const t = p.recibir_aviso_inactividad ? tocaInactividad(todas, de('inactividad'), m.fecha) : null
    if (!t) return 0
    const entregados = await enviar(suyas, avisoInactividad(t.paso, t.dias))
    revisar(await guardar(['inactividad']))
    return entregados ? 1 : 0
  }
  if (!p.recibir_recordatorio_no_registrado) return 0
  const habitos = [...deSeguimiento.values()].filter(x => x === 'habitos').length
  const hechoHoy = (x: Modulo) => x === 'habitos'
    ? marcas.habitos.filter(r => r.fecha === m.fecha).length >= habitos
    : marcas[x].some(r => r.fecha === m.fecha)
  const pendientes = MODULOS.filter(x => [...deSeguimiento.values()].includes(x) && !p.modulos_recordatorio_apagados.includes(x) && !sinUso(marcas[x], m.fecha)
    && tocaRecordatorio(ritmo(x, marcas[x], m.fecha), m, hechoHoy(x), de(`registro_${x}`), new Set(marcas[x].map(r => r.fecha)))).slice(0, cupo)
  if (!pendientes.length) return 0
  const entregados = await enviar(suyas, avisoRegistro(pendientes))
  revisar(await guardar(pendientes.map(x => `registro_${x}`)))
  return entregados ? 1 : 0
}

async function tareaProgramada() {
  const ahora = new Date()
  const m = momentoColombia(ahora)
  const mensajes = await avisarMensajesNuevos()
  const preferencias = revisar(await base.from('preferencia_aviso').select('*').eq('estado', 'activo')) as (PreferenciaAviso & { id_usuario: string })[]
  if (!preferencias.length) return { personas: 0, enviados: mensajes }
  const ids = preferencias.map(p => p.id_usuario)
  const suscripciones = revisar(await base.from('suscripcion_push').select(SELECCION_SUSCRIPCION).in('id_usuario', ids)) as Suscripcion[]
  let enviados = mensajes

  for (const p of preferencias) {
    const suyas = suscripciones.filter(s => s.id_usuario === p.id_usuario)
    if (!suyas.length) continue
    const diario = tocaResumenDiario(p, m)
    const semanal = tocaResumenSemanal(p, m)
    const cierre = tocaCierreMes(p, m)
    const descarga = tocaAvisoDescarga(p, m)
    enviados += await recordatoriosDeRegistro(p, suyas, m)

    if (diario || semanal || p.recibir_recordatorios) {
      const [tareas, recordatorios] = await Promise.all([
        base.from('tarea').select('id_tarea, descripcion, fecha_limite, fecha_realizacion, estado').eq('id_usuario', p.id_usuario).in('estado', ['pendiente', 'hecho']),
        base.from('recordatorio').select('id_recordatorio, descripcion, hora_envio, tipo_repeticion, dias_semana, dia_mes, fecha_proximo_envio, fecha_ultimo_aviso, estado')
          .eq('id_usuario', p.id_usuario).eq('estado', 'activo'),
      ])
      const lasTareas = (revisar(tareas) ?? []) as Tarea[]
      const losRecordatorios = (revisar(recordatorios) ?? []) as Recordatorio[]

      // Recordatorios que ya llegaron a su hora: se avisan una vez y siguen en Hoy hasta que se marquen "Listo".
      for (const r of losRecordatorios.filter(r => tocaAvisar(r, ahora) && avisaRecordatorio(p, r))) {
        if (await enviar(suyas, avisoRecordatorio(p, r))) {
          enviados++
          await base.from('recordatorio').update({ fecha_ultimo_aviso: ahora.toISOString() }).eq('id_recordatorio', r.id_recordatorio)
        }
      }
      if (diario && await enviar(suyas, avisoResumenDiario(await conteoDelDia(p.id_usuario, m.fecha, lasTareas, losRecordatorios)))) enviados++
      if (semanal) {
        const { aTiempo, total } = aTiempoSemana(lasTareas, m.fecha)
        if (await enviar(suyas, avisoResumenSemanal(aTiempo, total))) enviados++
      }
    }
    if (cierre && await enviar(suyas, AVISO_CIERRE_MES)) enviados++
    if (descarga && await enviar(suyas, AVISO_DESCARGA)) enviados++

    // Se marca aunque no se haya entregado, para no insistir cada 5 minutos con un equipo que no responde.
    const marcas = {
      ...(diario && { fecha_ultimo_resumen_diario: m.fecha }),
      ...(semanal && { fecha_ultimo_resumen_semanal: m.fecha }),
      ...(cierre && { fecha_ultimo_cierre_mes: m.fecha }),
      ...(descarga && { fecha_ultimo_aviso_descarga: m.fecha }),
    }
    if (Object.keys(marcas).length) await base.from('preferencia_aviso').update(marcas).eq('id_usuario', p.id_usuario)
  }
  return { personas: preferencias.length, enviados }
}

Deno.serve(async solicitud => {
  origen = ORIGENES.includes(solicitud.headers.get('origin') ?? '') ? solicitud.headers.get('origin')! : ORIGENES[0]
  if (solicitud.method === 'OPTIONS') return respuesta(204, null)
  if (solicitud.method !== 'POST') return respuesta(405, { error: 'método no permitido' })
  try {
    const firma = solicitud.headers.get('x-firma')
    if (firma) {
      const valida = revisar(await base.rpc('firma_avisos_valida', { firma }))
      if (!valida) return respuesta(401, { error: 'no autorizado' })
      return respuesta(200, await tareaProgramada())
    }
    // Aviso de prueba: la sesión dice quién es; solo se envía a sus propios equipos.
    const token = solicitud.headers.get('authorization')?.replace(/^Bearer /, '')
    const { data } = token ? await base.auth.getUser(token) : { data: { user: null } }
    if (!data.user) return respuesta(401, { error: 'no autorizado' })
    const suyas = revisar(await base.from('suscripcion_push').select(SELECCION_SUSCRIPCION)
      .eq('id_usuario', data.user.id)) as Suscripcion[]
    return respuesta(200, { entregados: await enviar(suyas, AVISO_PRUEBA) })
  } catch (e) {
    console.log('fallo en avisos', (e as Error).message)
    return respuesta(500, { error: 'no se pudo completar' })
  }
})
