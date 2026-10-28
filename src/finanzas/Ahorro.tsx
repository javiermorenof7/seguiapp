import { useState, type FormEvent } from 'react'
import { categorizar, crearMetaAhorro, editarMetaAhorro, quitarMetaAhorro, type RegistroGuardado } from '../datos'
import { formatoValor } from '../indicadores'
import { leerMonto, leidoDe, MONTO_INVALIDO } from './parseo'
import { avanceMeta, type EstadoMeta, type MetaAhorro } from './metas'
import type { Movimiento } from './calculos'

const pesos = (v: number) => formatoValor('dinero', v)
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const mesAno = (f: string) => new Date(`${f}T12:00`).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' })
const fechaCorta = (f: string) => new Date(`${f}T12:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
const ESTADO: Record<EstadoMeta, { texto: string; clase: string }> = {
  cumplida: { texto: '✓ Cumplida', clase: 'en-meta' },
  va_bien: { texto: '✓ Va bien', clase: 'en-meta' },
  atrasada: { texto: '◐ Va atrasada', clase: 'cerca' },
  sin_fecha: { texto: 'Sin fecha', clase: '' },
}

export default function Ahorro({ idAhorro, metas, ahorros, alCambiar }: {
  idAhorro: string
  metas: MetaAhorro[]
  ahorros: RegistroGuardado[]
  alCambiar: () => Promise<void>
}) {
  const hoy = hoyIso()
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const movimientos: Movimiento[] = ahorros.map(r => ({ fecha: r.fecha, valor: r.valor, tipo: 'ahorro', id_etiqueta: r.id_etiqueta }))
  const deMetas = new Set(metas.map(m => m.id_etiqueta))
  const libres = ahorros.filter(r => !r.id_etiqueta || !deMetas.has(r.id_etiqueta))

  // Lanza el error para que el formulario que llamó lo muestre y no se cierre.
  async function accion(hacer: () => Promise<unknown>, mensaje: string) {
    await hacer()
    setAviso(mensaje)
    setError('')
    await alCambiar()
  }

  return (
    <>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <section>
        <h2>Metas de ahorro</h2>
        {!metas.length && <p className="tenue">Aún no tienes metas. Crea una abajo y elige la meta al registrar cada ahorro.</p>}
        <ul className="lista">
          {metas.map(m => (
            <FilaMeta key={m.id_meta} meta={m} avance={avanceMeta(m, movimientos, hoy)}
              alEditar={cambios => accion(() => editarMetaAhorro(m, cambios), `${cambios.nombre} actualizada.`)}
              alQuitar={() => confirm(`¿Quitar la meta ${m.nombre}? Sus ahorros se conservan como ahorro libre.`) &&
                accion(() => quitarMetaAhorro(idAhorro, m), `${m.nombre} quitada. Sus ahorros quedaron como ahorro libre.`).catch(e => setError((e as Error).message))} />
          ))}
        </ul>
      </section>
      <FormularioMeta titulo="Crear una meta" alGuardar={nueva => accion(() => crearMetaAhorro(idAhorro, nueva), `Meta ${nueva.nombre} creada.`)} />
      {metas.length > 0 && libres.some(r => !r.id_etiqueta) && (
        <AhorroLibre libres={libres} metas={metas}
          alAsignar={(ids, meta) => accion(() => categorizar(ids, meta.id_etiqueta),
            `${ids.length} ${ids.length === 1 ? 'ahorro asignado' : 'ahorros asignados'} a ${meta.nombre}.`)} />
      )}
    </>
  )
}

function FilaMeta({ meta, avance, alEditar, alQuitar }: {
  meta: MetaAhorro
  avance: ReturnType<typeof avanceMeta>
  alEditar: (cambios: { nombre: string; valor: number; fecha_fin: string | null }) => Promise<void>
  alQuitar: () => void
}) {
  const [editando, setEditando] = useState(false)
  const { ahorrado, falta, porcentaje, porMes, estado } = avance
  return (
    <li className="meta-ahorro">
      <span>{meta.nombre}<span className="tenue">{meta.fecha_fin ? ` · hasta ${fechaCorta(meta.fecha_fin)}` : ''}</span></span>
      <span className={`estado ${ESTADO[estado].clase}`}>{ESTADO[estado].texto}</span>
      <div className="barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje}
        aria-label={`${meta.nombre}: ${porcentaje} %`}>
        <span style={{ width: `${porcentaje}%` }} />
      </div>
      <p className="tenue">
        {pesos(ahorrado)} de {pesos(meta.valor)} · {porcentaje} %
        {falta > 0 && ` · faltan ${pesos(falta)}`}
        {porMes !== null && ` · ${pesos(porMes)} al mes hasta ${mesAno(meta.fecha_fin!)}`}
      </p>
      <div className="acciones">
        <button className="enlace" aria-expanded={editando} onClick={() => setEditando(!editando)}>{editando ? 'Cancelar' : 'Editar'}</button>
        <button className="enlace" onClick={alQuitar}>Quitar meta</button>
      </div>
      {editando && <FormularioMeta inicial={meta} alGuardar={async c => { await alEditar(c); setEditando(false) }} />}
    </li>
  )
}

function FormularioMeta({ titulo, inicial, alGuardar }: {
  titulo?: string
  inicial?: MetaAhorro
  alGuardar: (meta: { nombre: string; valor: number; fecha_fin: string | null }) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(!!inicial)
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [monto, setMonto] = useState(inicial ? Math.round(inicial.valor).toLocaleString('es-CO') : '')
  const [fecha, setFecha] = useState(inicial?.fecha_fin ?? '')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  // la base pide que la fecha límite no sea anterior a la creación de la meta
  const minimo = inicial?.fecha_inicio ?? hoyIso()

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const limpio = nombre.replace(/\s+/g, ' ').trim()
    const valor = leerMonto(monto)
    if (!limpio || limpio.length > 60) return setError('Escribe el nombre de la meta, de 1 a 60 letras.')
    if (valor === null || valor <= 0) return setError(MONTO_INVALIDO)
    if (fecha && fecha < minimo) return setError(`La fecha no puede ser antes del ${fechaCorta(minimo)}.`)
    setEnviando(true)
    try {
      await alGuardar({ nombre: limpio, valor, fecha_fin: fecha || null })
      if (!inicial) { setNombre(''); setMonto(''); setFecha(''); setAbierto(false) }
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      {titulo && <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? 'Cerrar' : titulo}</button>}
      {abierto && (
        <form className="formulario" onSubmit={guardar}>
          <label>Nombre<input required maxLength={60} value={nombre} onChange={ev => setNombre(ev.target.value)} placeholder="Para qué ahorras" autoComplete="off" autoFocus={!inicial} /><small className="ayuda">Ej.: Viaje, Fondo de emergencia</small></label>
          <label>Objetivo
            <input required maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder="Cuánto quieres juntar" />
            <small className="ayuda" aria-live="polite">{leidoDe(monto) || 'Ej.: 5 millones o 5.000.000'}</small>
          </label>
          <label>Fecha límite (opcional)
            <input type="date" value={fecha} min={minimo} onChange={ev => setFecha(ev.target.value)} />
            <small className="ayuda">Con fecha te digo cuánto ahorrar cada mes</small>
          </label>
          <button className="principal" disabled={enviando}>{inicial ? 'Guardar cambios' : 'Crear meta'}</button>
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </section>
  )
}

function AhorroLibre({ libres, metas, alAsignar }: {
  libres: RegistroGuardado[]
  metas: MetaAhorro[]
  alAsignar: (ids: string[], meta: MetaAhorro) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const [marcados, setMarcados] = useState<string[]>([])
  const [idMeta, setIdMeta] = useState(metas[0]?.id_meta ?? '')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const total = libres.reduce((s, r) => s + r.valor, 0)

  async function asignar(evento: FormEvent) {
    evento.preventDefault()
    const meta = metas.find(m => m.id_meta === idMeta)
    if (!marcados.length) return setError('Marca al menos un ahorro.')
    if (!meta) return setError('Elige la meta.')
    setEnviando(true)
    try {
      await alAsignar(marcados, meta)
      setMarcados([])
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      <h2>Ahorro libre</h2>
      <p className="tenue">{pesos(total)} en {libres.length} {libres.length === 1 ? 'ahorro' : 'ahorros'} sin meta.</p>
      <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? 'Cerrar' : 'Asignar a una meta'}</button>
      {abierto && (
        <form className="formulario" onSubmit={asignar}>
          <fieldset className="opciones">
            <legend>¿Cuáles?</legend>
            {libres.filter(r => !r.id_etiqueta).map(r => (
              <label key={r.id_registro} className="casilla">
                <input type="checkbox" checked={marcados.includes(r.id_registro)}
                  onChange={ev => setMarcados(ev.target.checked ? [...marcados, r.id_registro] : marcados.filter(x => x !== r.id_registro))} />
                <span><strong>{pesos(r.valor)}</strong> · {fechaCorta(r.fecha)}{r.nota ? ` · ${r.nota}` : ''}</span>
              </label>
            ))}
          </fieldset>
          <label>Meta
            <select value={idMeta} onChange={ev => setIdMeta(ev.target.value)}>
              {metas.map(m => <option key={m.id_meta} value={m.id_meta}>{m.nombre}</option>)}
            </select>
          </label>
          <button className="principal" disabled={enviando}>Asignar{marcados.length ? ` ${marcados.length}` : ''}</button>
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </section>
  )
}
