import { useState, type FormEvent } from 'react'
import { aprenderCategoria, borrarMovimiento, corregirRegistro, TEXTO_ORIGEN, type Origen, type RegistroGuardado } from '../datos'
import { formatoValor } from '../indicadores'
import { leerMonto, leidoDe, MONTO_INVALIDO, normalizar, type Categoria } from './parseo'

const MAX_DESCRIPCION = 120
const pesos = (v: number) => formatoValor('dinero', v)

// Los 6 movimientos más recientes, con filtro por tipo; "Ver todos" abre el Historial con ese filtro.
export default function Ultimos({ registros, tipos, idGastos, categorias, origenes, mes, alVerTodos, alCambiar }: {
  registros: RegistroGuardado[]
  tipos: [string, string][]
  idGastos: string
  categorias: Categoria[]
  origenes: Map<string, Origen>
  mes: string
  alVerTodos: (idSeguimiento: string, origen: string) => void
  alCambiar: () => Promise<void>
}) {
  const [filtro, setFiltro] = useState('')
  const nombreTipo = new Map(tipos)
  // solo lo registrado a mano; lo que crean facturas y préstamos va resumido aparte
  const lista = registros.filter(r => !origenes.has(r.id_registro) && (!filtro || r.id_seguimiento === filtro)).slice(0, 6)
  const automaticos = registros.filter(r => origenes.has(r.id_registro) && r.fecha.startsWith(mes))
  const cuantos = (o: Origen) => automaticos.filter(r => origenes.get(r.id_registro) === o).length
  const partes = [[cuantos('factura'), 'factura', 'facturas'], [cuantos('prestamo'), 'cuota', 'cuotas']] as const
  if (!registros.length) return null
  return (
    <section>
      <h2>Lo último que registraste</h2>
      {tipos.length > 1 && <div className="chips" role="radiogroup" aria-label="Ver movimientos de">
        {[['', 'Todos'] as [string, string], ...tipos].map(([id, nombre]) => (
          <button key={id} type="button" role="radio" aria-checked={filtro === id} className="chip" onClick={() => setFiltro(id)}>{nombre}</button>
        ))}
      </div>}
      {lista.length ? (
        <ul className="lista">
          {lista.map(r => (
            <FilaMovimiento key={r.id_registro} registro={r} idGastos={idGastos} categorias={categorias} alCambiar={alCambiar} origen={origenes.get(r.id_registro)}
              tipo={r.id_seguimiento === idGastos ? undefined : nombreTipo.get(r.id_seguimiento)} />
          ))}
        </ul>
      ) : <p className="tenue">Sin movimientos de este tipo.</p>}
      <button className="enlace" onClick={() => alVerTodos(filtro, 'manual')}>Ver todos en el Historial</button>
      {automaticos.length > 0 && (
        <p className="tenue">
          Pagos automáticos del mes: {partes.filter(([n]) => n).map(([n, uno, varios]) => `${n} ${n === 1 ? uno : varios}`).join(' y ')}
          {' '}({pesos(automaticos.reduce((t, r) => t + r.valor, 0))}) · <button className="enlace" onClick={() => alVerTodos('', '')}>Ver</button>
        </p>
      )}
    </section>
  )
}

// Un movimiento con "Corregir"; también lo usa el historial (tipo = Ingreso o Ahorro cuando van mezclados).
export function FilaMovimiento({ registro: r, idGastos, categorias, tipo, origen, alCambiar }: {
  registro: RegistroGuardado; idGastos: string; categorias: Categoria[]; tipo?: string; origen?: Origen; alCambiar: () => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [error, setError] = useState('')
  if (abierto) return (
    <Corregir registro={r} esGasto={r.id_seguimiento === idGastos} categorias={categorias}
      alTerminar={async cambio => { if (cambio) await alCambiar(); setAbierto(false) }} />
  )
  return (
    <li className="ultimo">
      <span>{r.fecha.split('-').reverse().join('/')}</span>
      <strong>{pesos(r.valor)}</strong>
      <span className="tenue">
        {[tipo, origen && TEXTO_ORIGEN[origen], r.nota, r.id_seguimiento === idGastos && (categorias.find(c => c.id_etiqueta === r.id_etiqueta)?.nombre ?? 'Sin categoría')].filter(Boolean).join(' · ')}
      </span>
      {confirmar ? (
        <span className="chips">
          <span className="tenue">¿Seguro? Si viene de una factura o un préstamo, también se deshace.</span>
          <button className="secundario" onClick={() => borrarMovimiento(r.id_registro).then(alCambiar, e => setError((e as Error).message))}>Sí, borrar</button>
          <button className="secundario" onClick={() => setConfirmar(false)}>No</button>
        </span>
      ) : (
        <span className="chips">
          <button className="secundario" onClick={() => setAbierto(true)}>Corregir</button>
          <button className="secundario" onClick={() => setConfirmar(true)}>Borrar</button>
        </span>
      )}
      {error && <span role="alert" className="error">{error}</span>}
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
    const numero = leerMonto(valor)
    if (numero === null) return setError(MONTO_INVALIDO)
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
          <input required maxLength={16} value={valor} onChange={ev => setValor(ev.target.value)} />
          <small className="ayuda" aria-live="polite">{leidoDe(valor)}</small>
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
