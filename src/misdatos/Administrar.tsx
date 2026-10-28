import { useEffect, useState, type FormEvent } from 'react'
import { invitar, obtenerInvitados, obtenerMensajesRecibidos, quitarInvitado, responderMensaje, type Invitado, type MensajeContacto } from '../datos'
import { fechaCorta, MOTIVO } from './MisDatos'

type Recibido = MensajeContacto & { correo: string }

// Solo la abre el administrador; la base no le devuelve nada a nadie más.
export default function Administrar({ alVolver }: { alVolver: () => void }) {
  const [mensajes, setMensajes] = useState<Recibido[] | null>(null)
  const [respuestas, setRespuestas] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [invitados, setInvitados] = useState<Invitado[] | null>(null)
  const [correo, setCorreo] = useState('')
  const [porQuitar, setPorQuitar] = useState('')
  const [confirmacion, setConfirmacion] = useState('')

  const cargar = () => obtenerMensajesRecibidos().then(setMensajes, e => setError((e as Error).message))
  const cargarInvitados = () => obtenerInvitados().then(setInvitados, e => setError((e as Error).message))
  useEffect(() => { cargar(); cargarInvitados() }, [])

  async function hacer(accion: () => Promise<void>) {
    setEnviando(true)
    try {
      await accion()
      setError('')
      await cargarInvitados()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const alInvitar = (ev: FormEvent) => {
    ev.preventDefault()
    hacer(async () => { await invitar(correo); setCorreo('') })
  }
  const alQuitar = () => hacer(async () => { await quitarInvitado(porQuitar); setPorQuitar(''); setConfirmacion('') })

  async function responder(id: string) {
    const texto = (respuestas[id] ?? '').trim()
    if (!texto) return setError('Escribe la respuesta.')
    setEnviando(true)
    try {
      await responderMensaje(id, texto)
      setRespuestas(r => ({ ...r, [id]: '' }))
      setError('')
      await cargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="contenedor">
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado"><div><h1>Administrar</h1><p className="tenue">Invitados y mensajes.</p></div></header>
      {error && <p role="alert" className="error">{error}</p>}
      <form className="formulario" onSubmit={alInvitar}>
        <h2>Invitados</h2>
        <label>Correo de Google<input type="email" value={correo} onChange={ev => setCorreo(ev.target.value)} autoComplete="off" required maxLength={254} /></label>
        <button className="principal" disabled={enviando}>Invitar</button>
        <ul className="lista">
          {invitados?.map(i => (
            <li key={i.correo} className="dos">
              <span>{i.correo} · <span className="tenue">{i.es_administrador ? 'administrador' : i.estado === 'inactivo' ? 'sin acceso' : i.tiene_cuenta ? 'activo' : 'aún no entra'}</span></span>
              {!i.es_administrador && (i.estado === 'activo'
                ? <button type="button" className="secundario peligro" disabled={enviando} onClick={() => { setPorQuitar(i.correo); setConfirmacion('') }}>Quitar</button>
                : <button type="button" className="secundario" disabled={enviando} onClick={() => hacer(() => invitar(i.correo))}>Volver a invitar</button>)}
            </li>
          ))}
        </ul>
      </form>
      {porQuitar && (
        <section className="formulario">
          <h2>Quitar a {porQuitar}</h2>
          <p className="tenue">Pierde el acceso y se borran para siempre su cuenta y todos sus datos. No se puede deshacer.</p>
          <label>Escribe BORRAR para confirmar<input value={confirmacion} onChange={ev => setConfirmacion(ev.target.value)} autoComplete="off" /></label>
          <button className="secundario peligro" disabled={enviando || confirmacion.trim() !== 'BORRAR'} onClick={alQuitar}>Quitar y borrar sus datos</button>
          <button className="secundario" disabled={enviando} onClick={() => setPorQuitar('')}>Cancelar</button>
        </section>
      )}
      <h2>Mensajes</h2>
      {mensajes?.length === 0 && <p className="tenue">No hay mensajes.</p>}
      {mensajes?.map(m => (
        <section key={m.id_mensaje_contacto} className="formulario">
          <small className="tenue">{MOTIVO[m.motivo]} · {fechaCorta(m.fecha_creacion)} · {m.correo}</small>
          <div className="mensaje"><p>{m.mensaje}</p></div>
          {m.respuesta && <p className="tenue">Respondido el {fechaCorta(m.fecha_respuesta!)}: {m.respuesta}</p>}
          <label>{m.respuesta ? 'Cambiar respuesta' : 'Respuesta'}
            <textarea value={respuestas[m.id_mensaje_contacto] ?? ''} maxLength={2000}
              onChange={ev => setRespuestas(r => ({ ...r, [m.id_mensaje_contacto]: ev.target.value }))} />
          </label>
          <button className="principal" disabled={enviando} onClick={() => responder(m.id_mensaje_contacto)}>Responder</button>
        </section>
      ))}
    </div>
  )
}
