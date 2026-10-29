import { useState, type FormEvent } from 'react'

// Cambia un nombre o un texto en su fila; si guardar falla, el error se queda a la vista sin cerrar el formulario.
export default function CambiarNombre({ inicial, etiqueta = 'Nuevo nombre', maximo = 60, alGuardar, alCancelar }: {
  inicial: string; etiqueta?: string; maximo?: number; alGuardar: (nuevo: string) => Promise<void>; alCancelar: () => void
}) {
  const [texto, setTexto] = useState(inicial)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const nuevo = texto.replace(/\s+/g, ' ').trim()
    if (!nuevo) return setError('Escribe el nuevo texto.')
    if (nuevo === inicial) return alCancelar()
    setEnviando(true)
    try {
      await alGuardar(nuevo)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="chips cambiar-nombre" onSubmit={guardar}>
      <label>{etiqueta}
        <input required maxLength={maximo} value={texto} autoComplete="off" autoFocus onChange={ev => setTexto(ev.target.value)} />
      </label>
      <button className="chip" disabled={enviando}>Guardar</button>
      <button type="button" className="chip" onClick={alCancelar}>Cancelar</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}
