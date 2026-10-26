import { useState } from 'react'
import { aprenderCategoria, categorizar, obtenerSinCategoria } from '../datos'
import { formatoValor } from '../indicadores'
import { agrupar, type Grupo } from './aprende'
import { normalizar, type Categoria } from './parseo'

// Gastos sin categoría, un grupo (misma descripción) a la vez: se elige una vez y se aprende.
export default function Asistente({ idGastos, categorias, alCambiar }: {
  idGastos: string
  categorias: Categoria[]
  alCambiar: () => Promise<void>
}) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null)
  const [indice, setIndice] = useState(0)
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function abrir() {
    try {
      setGrupos(agrupar(await obtenerSinCategoria(idGastos)))
      setIndice(0)
    } catch (err) {
      setMensaje((err as Error).message)
    }
  }

  async function elegir(grupo: Grupo, categoria: Categoria) {
    setEnviando(true)
    try {
      await categorizar(grupo.ids, categoria.id_etiqueta)
      if (grupo.texto !== 'Sin descripción') await aprenderCategoria(normalizar(grupo.texto), categoria.nombre).catch(() => {})
      setGrupos(grupos!.filter(g => g !== grupo))
      setMensaje(`${grupo.ids.length} ${grupo.ids.length === 1 ? 'gasto quedó' : 'gastos quedaron'} en ${categoria.nombre}.`)
      await alCambiar()
    } catch (err) {
      setMensaje((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const actual = grupos?.[indice]
  const faltan = grupos?.reduce((s, g) => s + g.ids.length, 0) ?? 0
  return (
    <section>
      <h2>Gastos sin categoría</h2>
      {!grupos && <button className="secundario" onClick={abrir}>Categorizar gastos sin categoría</button>}
      {grupos && (
        <p className="tenue" aria-live="polite">
          {grupos.length ? `Faltan ${faltan} gastos en ${grupos.length} grupos.` : '✓ No queda ningún gasto sin categoría.'}
        </p>
      )}
      {actual && (
        <div className="asistente">
          <p><strong>"{actual.texto}"</strong> · {actual.ids.length} {actual.ids.length === 1 ? 'gasto' : 'gastos'} · {formatoValor('dinero', actual.total)}</p>
          <div className="chips" role="group" aria-label={`Categoría para ${actual.texto}`}>
            {categorias.map(c => (
              <button key={c.id_etiqueta} className="chip" disabled={enviando} onClick={() => elegir(actual, c)}>{c.nombre}</button>
            ))}
          </div>
          <div className="acciones">
            <button className="secundario" onClick={() => setIndice((indice + 1) % grupos!.length)}>Saltar</button>
            <button className="secundario" onClick={() => setGrupos(null)}>Cerrar</button>
          </div>
        </div>
      )}
      {mensaje && <p role="status" className="aviso">{mensaje}</p>}
    </section>
  )
}
