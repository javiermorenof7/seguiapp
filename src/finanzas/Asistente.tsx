import { useState } from 'react'
import { aprenderCategoria, categorizar, obtenerSinCategoria } from '../datos'
import { formatoValor } from '../indicadores'
import { agrupar, type Grupo } from './aprende'
import { normalizar, type Categoria } from './parseo'

const TEXTOS = {
  gasto: { titulo: 'Gastos sin categoría', boton: 'Categorizar gastos sin categoría', uno: 'gasto', varios: 'gastos', que: 'Categoría', ninguno: 'ningún gasto sin categoría' },
  ingreso: { titulo: 'Ingresos sin fuente', boton: 'Ponerle fuente a los ingresos', uno: 'ingreso', varios: 'ingresos', que: 'Fuente', ninguno: 'ningún ingreso sin fuente' },
}

// Gastos sin categoría o ingresos sin fuente, un grupo (misma descripción) a la vez: se elige una vez y se aprende.
// Con alCrear, la descripción del grupo puede volverse una fuente nueva.
export default function Asistente({ idSeguimiento, tipo = 'gasto', categorias, alCrear, alCambiar }: {
  idSeguimiento: string
  tipo?: keyof typeof TEXTOS
  categorias: Categoria[]
  alCrear?: (nombre: string) => Promise<Categoria>
  alCambiar: () => Promise<void>
}) {
  const t = TEXTOS[tipo]
  const [grupos, setGrupos] = useState<Grupo[] | null>(null)
  const [indice, setIndice] = useState(0)
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function abrir() {
    try {
      setGrupos(agrupar(await obtenerSinCategoria(idSeguimiento)))
      setIndice(0)
    } catch (err) {
      setMensaje((err as Error).message)
    }
  }

  async function elegir(grupo: Grupo, elegida: Categoria | null) {
    setEnviando(true)
    try {
      const categoria = elegida ?? await alCrear!(grupo.texto.slice(0, 60))
      await categorizar(grupo.ids, categoria.id_etiqueta)
      if (grupo.texto !== 'Sin descripción') await aprenderCategoria(normalizar(grupo.texto), categoria.nombre).catch(() => {})
      setGrupos(grupos!.filter(g => g !== grupo))
      setMensaje(`${grupo.ids.length} ${grupo.ids.length === 1 ? `${t.uno} quedó` : `${t.varios} quedaron`} en ${categoria.nombre}.`)
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
      <h2>{t.titulo}</h2>
      {!grupos && <button className="secundario" onClick={abrir}>{t.boton}</button>}
      {grupos && (
        <p className="tenue" aria-live="polite">
          {grupos.length ? `Faltan ${faltan} ${t.varios} en ${grupos.length} grupos.` : `✓ No queda ${t.ninguno}.`}
        </p>
      )}
      {actual && (
        <div className="asistente">
          <p><strong>"{actual.texto}"</strong> · {actual.ids.length} {actual.ids.length === 1 ? t.uno : t.varios} · {formatoValor('dinero', actual.total)}</p>
          <div className="chips" role="group" aria-label={`${t.que} para ${actual.texto}`}>
            {categorias.map(c => (
              <button key={c.id_etiqueta} className="chip" disabled={enviando} onClick={() => elegir(actual, c)}>{c.nombre}</button>
            ))}
            {alCrear && actual.texto !== 'Sin descripción' && !categorias.some(c => normalizar(c.nombre) === normalizar(actual.texto)) && (
              <button className="chip" disabled={enviando} onClick={() => elegir(actual, null)}>+ Nueva: {actual.texto.slice(0, 60)}</button>
            )}
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
