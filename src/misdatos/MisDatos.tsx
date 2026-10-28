import { useEffect, useState, type FormEvent } from 'react'
import { borrarMiCuenta, enviarMensaje, obtenerDescarga, obtenerMisMensajes, type MensajeContacto, type ModuloDescarga } from '../datos'
import { fechaColombia } from '../tareas/calculos'
import { aCsv } from './csv'

const MODULOS: [ModuloDescarga, string][] = [
  ['finanzas', 'Finanzas'], ['deudas', 'Deudas'], ['salud', 'Salud'], ['habitos', 'Hábitos'], ['tareas', 'Tareas'], ['cuenta', 'Cuenta'],
]
export const MOTIVO: Record<MensajeContacto['motivo'], string> = { duda: 'Duda', mis_datos: 'Mis datos', error: 'Algo falla', otro: 'Otro' }
export const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

function bajar(nombre: string, contenido: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  a.click()
  URL.revokeObjectURL(url)
}

export default function MisDatos({ alVolver }: { alVolver: () => void }) {
  const [mensajes, setMensajes] = useState<MensajeContacto[]>([])
  const [motivo, setMotivo] = useState<MensajeContacto['motivo']>('duda')
  const [texto, setTexto] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => { obtenerMisMensajes().then(setMensajes, e => setError((e as Error).message)) }, [])

  async function hacer(accion: () => Promise<void>, mensaje: string) {
    setEnviando(true)
    try {
      await accion()
      setAviso(mensaje)
      setError('')
    } catch (e) {
      setError((e as Error).message)
      setAviso('')
    } finally {
      setEnviando(false)
    }
  }

  const descargar = (modulo: ModuloDescarga, nombre: string) => hacer(async () => {
    bajar(`seguiapp-${modulo}-${fechaColombia(new Date())}.csv`, aCsv(await obtenerDescarga(modulo)))
  }, `${nombre} descargado.`)

  function enviar(ev: FormEvent) {
    ev.preventDefault()
    const limpio = texto.trim()
    if (!limpio) return setError('Escribe tu mensaje.')
    hacer(async () => {
      await enviarMensaje(motivo, limpio)
      setTexto('')
      setMensajes(await obtenerMisMensajes())
    }, 'Mensaje enviado. La respuesta te aparece aquí.')
  }

  return (
    <div className="contenedor">
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado"><div><h1>Mis datos</h1><p className="tenue">Descárgalos, escríbenos o borra tu cuenta.</p></div></header>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}

      <section className="formulario">
        <h2>Descargar mis datos</h2>
        <p className="tenue">Un archivo CSV por módulo, que abre en Excel o Google Sheets.</p>
        <div className="chips">
          {MODULOS.map(([m, nombre]) => <button key={m} className="secundario" disabled={enviando} onClick={() => descargar(m, nombre)}>{nombre}</button>)}
        </div>
      </section>

      <form className="formulario" onSubmit={enviar}>
        <h2>Contacto</h2>
        <p className="tenue">Dudas, solicitudes sobre tus datos o algo que no funciona. Solo lo lee el administrador.</p>
        <div className="chips" role="radiogroup" aria-label="Motivo">
          {(Object.keys(MOTIVO) as MensajeContacto['motivo'][]).map(m => (
            <button key={m} type="button" role="radio" aria-checked={motivo === m} className="chip" onClick={() => setMotivo(m)}>{MOTIVO[m]}</button>
          ))}
        </div>
        <label>Mensaje<textarea value={texto} maxLength={1000} onChange={ev => setTexto(ev.target.value)} /></label>
        <small className="ayuda">{texto.length}/1.000 · máximo 5 mensajes al día</small>
        <button className="principal" disabled={enviando}>Enviar</button>
        {mensajes.map(m => (
          <div key={m.id_mensaje_contacto} className="mensaje">
            <small className="tenue">{MOTIVO[m.motivo]} · {fechaCorta(m.fecha_creacion)}</small>
            <p>{m.mensaje}</p>
            {m.respuesta
              ? <p><strong>Respuesta ({fechaCorta(m.fecha_respuesta!)}):</strong> {m.respuesta}</p>
              : <small className="tenue">Sin respuesta todavía.</small>}
          </div>
        ))}
      </form>

      <section className="formulario">
        <h2>Borrar mi cuenta</h2>
        <p className="tenue">Se borran para siempre todos tus datos y tu acceso. Descárgalos antes si los quieres. No se puede deshacer.</p>
        <label>Escribe BORRAR para confirmar<input value={confirmacion} onChange={ev => setConfirmacion(ev.target.value)} autoComplete="off" /></label>
        <button className="secundario peligro" disabled={enviando || confirmacion.trim() !== 'BORRAR'}
          onClick={() => hacer(borrarMiCuenta, 'Cuenta borrada.')}>Borrar mi cuenta</button>
      </section>
    </div>
  )
}
