import { useEffect, useState } from 'react'
import { enviarAvisoPrueba, guardarPreferenciaAviso, guardarSuscripcion, obtenerAvisos, quitarSuscripcion } from '../datos'
import { LLAVE_PUBLICA_VAPID } from './llave'
import { equipoDe, estaInstalada } from '../equipo'
import type { Repeticion } from '../tareas/calculos'
import { PREFERENCIA_INICIAL, TIPOS_RECORDATORIO, type PreferenciaAviso } from './reglas'


type Preferencia = Omit<PreferenciaAviso, `fecha_ultimo_${string}`>
type EstadoEquipo = 'sin_soporte' | 'instalar' | 'bloqueado' | 'apagado' | 'activo'

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const TIPO: Record<Repeticion, string> = { unico: 'Una vez', diario: 'Cada día', habiles: 'Lunes a viernes', semanal: 'Cada semana', mensual: 'Cada mes' }
const soportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const nombreEquipo = () => {
  const equipo = equipoDe(navigator.userAgent, navigator.maxTouchPoints)
  return equipo === 'iphone' ? 'iPhone' : equipo === 'android' ? 'Android' : 'Computador'
}
// La llave VAPID viaja en base64 url; pushManager la pide en bytes.
const enBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0))
const enBase64 = (buffer: ArrayBuffer | null) => btoa(String.fromCharCode(...new Uint8Array(buffer ?? new ArrayBuffer(0))))

async function suscripcionActual() {
  if (!soportaPush()) return null
  const registro = await navigator.serviceWorker.getRegistration()
  return registro ? registro.pushManager.getSubscription() : null
}

export default function Avisos({ alVolver, alInstalar }: { alVolver: () => void; alInstalar: () => void }) {
  const [preferencia, setPreferencia] = useState<Preferencia | null>(null)
  const [guardada, setGuardada] = useState(false)
  const [equipo, setEquipo] = useState<EstadoEquipo | null>(null)
  const [otros, setOtros] = useState(0)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function revisarEquipo() {
    if (!soportaPush()) return setEquipo(equipoDe(navigator.userAgent, navigator.maxTouchPoints) === 'iphone' && !estaInstalada() ? 'instalar' : 'sin_soporte')
    if (Notification.permission === 'denied') return setEquipo('bloqueado')
    setEquipo(await suscripcionActual() ? 'activo' : 'apagado')
  }

  useEffect(() => {
    obtenerAvisos().then(d => {
      setPreferencia(d.preferencia ?? PREFERENCIA_INICIAL)
      setGuardada(!!d.preferencia)
      setOtros(d.equipos)
    }, e => setError((e as Error).message))
    revisarEquipo().catch(() => setEquipo('sin_soporte'))
  }, [])

  async function hacer(accion: () => Promise<void>, mensaje: string) {
    setEnviando(true)
    try {
      await accion()
      setAviso(mensaje)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const activarEquipo = () => hacer(async () => {
    if (await Notification.requestPermission() !== 'granted') { await revisarEquipo(); throw new Error('Sin tu permiso este equipo no puede recibir avisos.') }
    const registro = await navigator.serviceWorker.ready
    const s = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: enBytes(LLAVE_PUBLICA_VAPID) })
    await guardarSuscripcion({ endpoint: s.endpoint, llave_p256dh: enBase64(s.getKey('p256dh')), llave_auth: enBase64(s.getKey('auth')), nombre_equipo: nombreEquipo() })
    if (!guardada && preferencia) { await guardarPreferenciaAviso(preferencia); setGuardada(true) }
    setOtros(otros + 1)
    setEquipo('activo')
  }, 'Listo: este equipo recibirá tus avisos.')

  const desactivarEquipo = () => hacer(async () => {
    const s = await suscripcionActual()
    if (s) {
      await quitarSuscripcion(s.endpoint)
      await s.unsubscribe()
      setOtros(Math.max(0, otros - 1))
    }
    setEquipo('apagado')
  }, 'Este equipo ya no recibirá avisos.')

  const guardar = (cambios: Partial<Preferencia>, mensaje = 'Guardado.') => {
    if (!preferencia) return
    const nueva = { ...preferencia, ...cambios }
    setPreferencia(nueva)
    hacer(async () => { await guardarPreferenciaAviso(nueva); setGuardada(true) }, mensaje)
  }

  if (!preferencia || !equipo) return <><button className="volver" onClick={alVolver}>← Mi seguimiento</button>{error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>}</>
  const p = preferencia
  const apagados = p.estado === 'pausado'
  const tipos = (t: Repeticion) => p.tipos_recordatorio.includes(t) ? p.tipos_recordatorio.filter(x => x !== t) : [...p.tipos_recordatorio, t]

  return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado"><div><h1>Avisos</h1><p className="tenue">Sin montos. Llegan al celular o al computador donde los actives.</p></div></header>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}

      <section className="formulario">
        <h2>Este equipo</h2>
        {equipo === 'activo' && <p>✓ Recibe tus avisos.</p>}
        {equipo === 'apagado' && <p className="tenue">No recibe avisos.</p>}
        {equipo === 'bloqueado' && <p className="tenue">Bloqueaste los avisos en el navegador. Permítelos en los ajustes del sitio y vuelve aquí.</p>}
        {equipo === 'sin_soporte' && <p className="tenue">Este navegador no recibe avisos. Prueba con Chrome, Edge o Safari actualizados.</p>}
        {equipo === 'instalar' && (
          <p className="tenue">En el iPhone los avisos solo llegan con la app instalada. <button className="enlace" onClick={alInstalar}>Instalar la app</button></p>
        )}
        {equipo === 'apagado' && <button className="principal" disabled={enviando} onClick={activarEquipo}>Activar avisos en este equipo</button>}
        {equipo === 'activo' && <button className="secundario" disabled={enviando} onClick={desactivarEquipo}>Desactivar en este equipo</button>}
        {otros > 0 && (
          <button className="secundario" disabled={enviando} onClick={() => hacer(async () => {
            const entregados = await enviarAvisoPrueba()
            if (!entregados) throw new Error('No llegó a ningún equipo. Desactiva y vuelve a activar los avisos en este equipo.')
          }, 'Aviso de prueba enviado. Debe llegarte en unos segundos.')}>Enviar un aviso de prueba</button>
        )}
        {otros > 0 && <small className="ayuda">{otros === 1 ? '1 equipo activado' : `${otros} equipos activados`} en total.</small>}
      </section>

      <section className="formulario">
        <h2>Todos los avisos</h2>
        <label className="casilla">
          <input type="checkbox" checked={!apagados} disabled={enviando}
            onChange={ev => guardar({ estado: ev.target.checked ? 'activo' : 'pausado' }, ev.target.checked ? 'Avisos encendidos.' : 'Avisos apagados en todos tus equipos.')} />
          <span><strong>{apagados ? 'Apagados' : 'Encendidos'}</strong> · apagados no te llega ninguno; tus elecciones se guardan</span>
        </label>
      </section>

      <fieldset className="formulario" disabled={apagados || enviando}>
        <legend><h2>Resumen del día</h2></legend>
        <label className="casilla"><input type="checkbox" checked={p.recibir_resumen_diario} onChange={ev => guardar({ recibir_resumen_diario: ev.target.checked })} />
          <span>Tareas, recordatorios, facturas por pagar y metas atrasadas del día</span></label>
        {p.recibir_resumen_diario && (
          <>
            <div className="chips" role="radiogroup" aria-label="Qué días">
              {(['diario', 'habiles'] as const).map(f => (
                <button key={f} type="button" role="radio" aria-checked={p.frecuencia_resumen_diario === f} className="chip"
                  onClick={() => guardar({ frecuencia_resumen_diario: f })}>{f === 'diario' ? 'Cada día' : 'Lunes a viernes'}</button>
              ))}
            </div>
            <label>Hora<input type="time" value={p.hora_resumen_diario.slice(0, 5)} onChange={ev => ev.target.value && guardar({ hora_resumen_diario: ev.target.value })} /></label>
          </>
        )}
      </fieldset>

      <fieldset className="formulario" disabled={apagados || enviando}>
        <legend><h2>Resumen de la semana</h2></legend>
        <label className="casilla"><input type="checkbox" checked={p.recibir_resumen_semanal} onChange={ev => guardar({ recibir_resumen_semanal: ev.target.checked })} />
          <span>Cómo te fue con tus tareas en la semana</span></label>
        {p.recibir_resumen_semanal && (
          <>
            <label>Día
              <select value={p.dia_resumen_semanal} onChange={ev => guardar({ dia_resumen_semanal: Number(ev.target.value) })}>
                {DIAS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </label>
            <label>Hora<input type="time" value={p.hora_resumen_semanal.slice(0, 5)} onChange={ev => ev.target.value && guardar({ hora_resumen_semanal: ev.target.value })} /></label>
          </>
        )}
      </fieldset>

      <fieldset className="formulario" disabled={apagados || enviando}>
        <legend><h2>Cierre de mes</h2></legend>
        <label className="casilla"><input type="checkbox" checked={p.recibir_cierre_mes} onChange={ev => guardar({ recibir_cierre_mes: ev.target.checked })} />
          <span>El último día del mes, para revisar tus finanzas</span></label>
        {p.recibir_cierre_mes && (
          <label>Hora<input type="time" value={p.hora_cierre_mes.slice(0, 5)} onChange={ev => ev.target.value && guardar({ hora_cierre_mes: ev.target.value })} /></label>
        )}
      </fieldset>

      <fieldset className="formulario" disabled={apagados || enviando}>
        <legend><h2>Copia de tus datos</h2></legend>
        <label className="casilla"><input type="checkbox" checked={p.recibir_aviso_descarga} onChange={ev => guardar({ recibir_aviso_descarga: ev.target.checked })} />
          <span>El día 1 de cada mes, a la hora del resumen, para descargarlos</span></label>
      </fieldset>

      <fieldset className="formulario" disabled={apagados || enviando}>
        <legend><h2>Recordatorios</h2></legend>
        <label className="casilla"><input type="checkbox" checked={p.recibir_recordatorios} onChange={ev => guardar({ recibir_recordatorios: ev.target.checked })} />
          <span>Cada uno a la hora que le pusiste</span></label>
        {p.recibir_recordatorios && (
          <div className="chips" role="group" aria-label="De qué recordatorios">
            {TIPOS_RECORDATORIO.map(t => (
              <button key={t} type="button" role="checkbox" aria-checked={p.tipos_recordatorio.includes(t)} className="chip"
                onClick={() => guardar({ tipos_recordatorio: tipos(t) })}>{TIPO[t]}</button>
            ))}
          </div>
        )}
        <small className="ayuda">Los que no avisen siguen saliendo en Hoy.</small>
      </fieldset>

      <fieldset className="formulario" disabled={apagados || enviando}>
        <legend><h2>Pantalla de bloqueo</h2></legend>
        <div className="chips" role="radiogroup" aria-label="Qué se ve con el celular bloqueado">
          {[false, true].map(v => (
            <button key={String(v)} type="button" role="radio" aria-checked={p.mostrar_descripcion === v} className="chip"
              onClick={() => guardar({ mostrar_descripcion: v })}>{v ? 'Con la descripción' : 'Texto genérico'}</button>
          ))}
        </div>
        <small className="ayuda">{p.mostrar_descripcion ? 'Ej.: "Tomar la pastilla". Cualquiera que vea tu celular lo lee.' : 'Ej.: "Tienes un recordatorio". Lo ves al abrirlo.'}</small>
      </fieldset>
    </>
  )
}
