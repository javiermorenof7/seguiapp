import { useState, type FormEvent } from 'react'
import { aprenderCategoria, corregirRegistro, type RegistroGuardado } from '../datos'
import { formatoValor } from '../indicadores'
import { normalizar, type Categoria } from './parseo'

const MAX_DESCRIPCION = 120
const pesos = (v: number) => formatoValor('dinero', v)

// El último movimiento y los 5 anteriores, cada uno con "Corregir".
export default function Ultimos({ registros, idGastos, categorias, alCambiar }: {
  registros: RegistroGuardado[]
  idGastos: string
  categorias: Categoria[]
  alCambiar: () => Promise<void>
}) {
  if (!registros.length) return null
  return (
    <section>
      <h2>Últimos movimientos</h2>
      <ul className="lista">
        {registros.map(r => <FilaMovimiento key={r.id_registro} registro={r} idGastos={idGastos} categorias={categorias} alCambiar={alCambiar} />)}
      </ul>
    </section>
  )
}

// Un movimiento con "Corregir"; también lo usa el historial (tipo = Ingreso o Ahorro cuando van mezclados).
export function FilaMovimiento({ registro: r, idGastos, categorias, tipo, alCambiar }: {
  registro: RegistroGuardado; idGastos: string; categorias: Categoria[]; tipo?: string; alCambiar: () => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  if (abierto) return (
    <Corregir registro={r} esGasto={r.id_seguimiento === idGastos} categorias={categorias}
      alTerminar={async cambio => { if (cambio) await alCambiar(); setAbierto(false) }} />
  )
  return (
    <li className="ultimo">
      <span>{r.fecha.split('-').reverse().join('/')}</span>
      <strong>{pesos(r.valor)}</strong>
      <span className="tenue">
        {[tipo, r.nota, r.id_seguimiento === idGastos && (categorias.find(c => c.id_etiqueta === r.id_etiqueta)?.nombre ?? 'Sin categoría')].filter(Boolean).join(' · ')}
      </span>
      <button className="secundario" onClick={() => setAbierto(true)}>Corregir</button>
    </li>
  )
}

function Corregir({ registro: r, esGasto, categorias, alTerminar }: {
  registro: RegistroGuardado
  esGasto: boolean
  categorias: Categoria[]
  alTerminar: (cambio: boolean) => Promise<void>
}) {
  const [valor, setValor] = useState(Math.round(r.valor).toLocaleString('es-CO'))
  const [nota, setNota] = useState(r.nota ?? '')
  const [idEtiqueta, setIdEtiqueta] = useState(r.id_etiqueta ?? '')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const numero = Number(valor.replace(/[.\s$]/g, ''))
    if (!Number.isInteger(numero) || numero <= 0 || numero >= 1e12) return setError('Escribe pesos sin decimales.')
    if (nota.trim().length > MAX_DESCRIPCION) return setError(`La descripción admite hasta ${MAX_DESCRIPCION} letras.`)
    if (esGasto && !idEtiqueta) return setError('Elige la categoría.')
    setEnviando(true)
    try {
      const descripcion = nota.trim() || null
      await corregirRegistro(r.id_registro, { valor: numero, nota: descripcion, ...(esGasto ? { id_etiqueta: idEtiqueta } : {}) })
      const categoria = categorias.find(c => c.id_etiqueta === idEtiqueta)
      // cambiar la categoría la aprende para esa descripción
      if (esGasto && descripcion && categoria && idEtiqueta !== r.id_etiqueta)
        await aprenderCategoria(normalizar(descripcion), categoria.nombre).catch(() => {})
      await alTerminar(true)
    } catch (err) {
      setError((err as Error).message)
      setEnviando(false)
    }
  }

  return (
    <li>
      <form className="formulario corregir" onSubmit={guardar}>
        <label>Monto
          <input inputMode="numeric" required maxLength={16} value={valor} onChange={ev => setValor(ev.target.value)} />
        </label>
        <label>Descripción
          <input maxLength={MAX_DESCRIPCION} value={nota} onChange={ev => setNota(ev.target.value)} />
        </label>
        {esGasto && (
          <label>Categoría
            <select value={idEtiqueta} onChange={ev => setIdEtiqueta(ev.target.value)}>
              <option value="" disabled>Elige una</option>
              {categorias.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
            </select>
          </label>
        )}
        <div className="acciones">
          <button className="principal" disabled={enviando}>Guardar</button>
          <button type="button" className="secundario" onClick={() => alTerminar(false)}>Cancelar</button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </li>
  )
}
