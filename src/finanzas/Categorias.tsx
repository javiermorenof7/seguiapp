import { useEffect, useState, type FormEvent } from 'react'
import { aprenderCategoria, categorizar, crearCategoria, editarCategoria, editarMetaAhorro, obtenerSinCategoria, quitarCategoria, quitarMetaAhorro } from '../datos'
import { FormularioMeta } from './Ahorro'
import type { MetaAhorro } from './metas'
import { puedeCrear, sugerirNuevas, TOPE, yaExiste, type Sugerencia, type TipoCategoria } from './reglasCategorias'
import { normalizar, type Categoria } from './parseo'

const hoyIso = () => new Date().toLocaleDateString('en-CA')
const TEXTO = {
  gasto: { titulo: 'Gastos', una: 'categoría', varias: 'categorías', registros: 'gastos', vacio: 'Sin categoría' },
  ingreso: { titulo: 'Ingresos', una: 'fuente', varias: 'fuentes', registros: 'ingresos', vacio: 'Sin fuente' },
  ahorro: { titulo: 'Ahorro', una: 'meta', varias: 'metas', registros: 'ahorros', vacio: 'Libre' },
}

// Un solo lugar para las categorías de Finanzas, por tipo y con tope: la app sugiere, nunca crea sola.
export default function Categorias({ idGastos, idIngresos, idAhorro, categorias, fuentes, metas, aprendido, alIrAhorro, alCambiar }: {
  idGastos: string
  idIngresos: string | null
  idAhorro: string | null
  categorias: Categoria[]
  fuentes: Categoria[]
  metas: MetaAhorro[]
  aprendido: Map<string, string>
  alIrAhorro: () => void
  alCambiar: () => Promise<void>
}) {
  const [tipo, setTipo] = useState<TipoCategoria>('gasto')
  const tipos: TipoCategoria[] = idIngresos ? ['gasto', 'ingreso', 'ahorro'] : ['gasto', 'ahorro']
  const cuantas = { gasto: categorias.length, ingreso: fuentes.length, ahorro: metas.length }
  const t = TEXTO[tipo]

  return (
    <>
      <p className="tenue explica">Pocas categorías se leen mejor en los gráficos: la app te sugiere una nueva solo cuando la ve muchas veces, y nunca la crea sola.</p>
      <div className="chips" role="radiogroup" aria-label="Tipo de categoría">
        {tipos.map(x => (
          <button key={x} type="button" role="radio" aria-checked={tipo === x} className="chip" onClick={() => setTipo(x)}>
            {TEXTO[x].titulo} ({cuantas[x]} de {TOPE[x]})
          </button>
        ))}
      </div>
      {tipo === 'ahorro' ? (
        <section>
          <h2>Metas de ahorro</h2>
          <p className="tenue">En Ahorro cada meta es su categoría ({metas.length} de {TOPE.ahorro}). Aquí las corriges o quitas; se crean en la pestaña Ahorro.</p>
          {idAhorro && <Metas idAhorro={idAhorro} metas={metas} alCambiar={alCambiar} />}
          <button className="secundario" onClick={alIrAhorro}>Ir a Ahorro</button>
        </section>
      ) : (
        <Lista key={tipo} tipo={tipo} idSeguimiento={tipo === 'gasto' ? idGastos : idIngresos!} lista={tipo === 'gasto' ? categorias : fuentes}
          aprendido={aprendido} texto={t} alCambiar={alCambiar} />
      )}
    </>
  )
}

function Lista({ tipo, idSeguimiento, lista, aprendido, texto: t, alCambiar }: {
  tipo: 'gasto' | 'ingreso'
  idSeguimiento: string
  lista: Categoria[]
  aprendido: Map<string, string>
  texto: typeof TEXTO['gasto']
  alCambiar: () => Promise<void>
}) {
  const [nombre, setNombre] = useState('')
  const [grupo, setGrupo] = useState<'basico' | 'personal'>('personal')
  const [quitando, setQuitando] = useState<Categoria | null>(null)
  const [editando, setEditando] = useState<{ categoria: Categoria; nombre: string; grupo: 'basico' | 'personal' } | null>(null)
  const [destino, setDestino] = useState('')
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const lleno = !puedeCrear(tipo, lista.length)

  useEffect(() => {
    obtenerSinCategoria(idSeguimiento)
      .then(r => setSugerencias(sugerirNuevas(r, lista, aprendido, tipo, hoyIso())), () => setSugerencias([]))
  }, [idSeguimiento, lista, aprendido, tipo])

  async function hacer(accion: () => Promise<unknown>, mensaje: string) {
    setEnviando(true)
    try {
      await accion()
      setAviso(mensaje)
      setError('')
      await alCambiar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  async function crear(evento: FormEvent) {
    evento.preventDefault()
    const limpio = nombre.replace(/\s+/g, ' ').trim()
    if (!limpio || limpio.length > 60) return setError(`Escribe el nombre de la ${t.una}, de 1 a 60 letras.`)
    if (yaExiste(limpio, lista)) return setError(`Ya tienes esa ${t.una}.`)
    await hacer(() => crearCategoria(idSeguimiento, limpio, tipo === 'gasto' ? grupo : null), `${limpio} creada.`)
    setNombre('')
  }

  // Crear desde una sugerencia pasa ahí todos los registros de esa descripción y lo aprende.
  const crearSugerida = (s: Sugerencia, g: 'basico' | 'personal' | null) => hacer(async () => {
    await categorizar(s.ids, await crearCategoria(idSeguimiento, s.texto, g))
    await aprenderCategoria(normalizar(s.texto), s.texto).catch(() => {})
  }, `${s.texto} creada con ${s.ids.length} ${t.registros}.`)

  const asignarSugerida = (s: Sugerencia, c: Categoria) => hacer(async () => {
    await categorizar(s.ids, c.id_etiqueta)
    await aprenderCategoria(normalizar(s.texto), c.nombre).catch(() => {})
  }, `${s.ids.length} ${t.registros} de "${s.texto}" pasaron a ${c.nombre}.`)

  // "No sugerir" se guarda como aprendido con su mismo texto (así ya no vuelve a salir).
  const descartar = (s: Sugerencia) => hacer(() => aprenderCategoria(normalizar(s.texto), s.texto), `"${s.texto}" no se volverá a sugerir.`)

  return (
    <>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {sugerencias.slice(0, 3).map(s => (
        <section key={s.texto} className="sugerencia">
          <h2>Sugerencia</h2>
          <p>Tienes <strong>{s.recientes} {t.registros}</strong> sin {t.una} de <strong>"{s.texto}"</strong> en los últimos 3 meses.</p>
          <div className="chips">
            {tipo === 'gasto' ? (<>
              <button className="chip" disabled={enviando} onClick={() => crearSugerida(s, 'basico')}>Crear "{s.texto}" como básico</button>
              <button className="chip" disabled={enviando} onClick={() => crearSugerida(s, 'personal')}>Crear como personal</button>
            </>) : (
              <button className="chip" disabled={enviando} onClick={() => crearSugerida(s, null)}>Crear "{s.texto}"</button>
            )}
            <button className="chip" disabled={enviando} onClick={() => descartar(s)}>No sugerir</button>
          </div>
          {lista.length > 0 && (
            <label className="fila-presupuesto">O pásalos a una que ya tienes
              <select value="" disabled={enviando} onChange={ev => {
                const c = lista.find(x => x.id_etiqueta === ev.target.value)
                if (c) asignarSugerida(s, c)
              }}>
                <option value="">Elegir…</option>
                {lista.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
              </select>
            </label>
          )}
        </section>
      ))}
      <section>
        <h2>Mis {t.varias} ({lista.length} de {TOPE[tipo]})</h2>
        {!lista.length && <p className="tenue">Aún no tienes {t.varias}.</p>}
        <ul className="lista">
          {lista.map(c => (
            <li key={c.id_etiqueta} className="categoria">
              <span>{c.nombre}</span>
              {tipo === 'gasto' && <span className="tenue">{c.grupo === 'basico' ? 'Básico' : 'Personal'}</span>}
              {editando?.categoria === c ? (
                <form className="confirmar-quitar" onSubmit={ev => {
                  ev.preventDefault()
                  const limpio = editando.nombre.replace(/\s+/g, ' ').trim()
                  if (!limpio || limpio.length > 60) return setError(`Escribe el nombre de la ${t.una}, de 1 a 60 letras.`)
                  if (yaExiste(limpio, lista.filter(x => x !== c))) return setError(`Ya tienes una ${t.una} llamada ${limpio}.`)
                  hacer(() => editarCategoria(c.id_etiqueta, c.nombre, { nombre: limpio, grupo: tipo === 'gasto' ? editando.grupo : null }),
                    `${limpio} quedó guardada.`).then(() => setEditando(null))
                }}>
                  <label>Nombre<input required maxLength={60} value={editando.nombre} autoComplete="off" autoFocus
                    onChange={ev => setEditando({ ...editando, nombre: ev.target.value })} /></label>
                  {tipo === 'gasto' && (
                    <div className="chips" role="radiogroup" aria-label="Tipo de gasto">
                      {(['basico', 'personal'] as const).map(g => (
                        <button key={g} type="button" role="radio" aria-checked={editando.grupo === g} className="chip"
                          onClick={() => setEditando({ ...editando, grupo: g })}>{g === 'basico' ? 'Básico' : 'Personal'}</button>
                      ))}
                    </div>
                  )}
                  <span className="chips">
                    <button className="principal" disabled={enviando}>Guardar</button>
                    <button type="button" className="secundario" onClick={() => setEditando(null)}>Cancelar</button>
                  </span>
                </form>
              ) : quitando?.id_etiqueta === c.id_etiqueta ? (
                <span className="confirmar-quitar">
                  <label>¿A dónde pasan sus {t.registros}?
                    <select value={destino} onChange={ev => setDestino(ev.target.value)}>
                      <option value="">{t.vacio}</option>
                      {lista.filter(x => x !== c).map(x => <option key={x.id_etiqueta} value={x.id_etiqueta}>{x.nombre}</option>)}
                    </select>
                  </label>
                  <span className="chips">
                    <button className="secundario" disabled={enviando} onClick={() => hacer(() => quitarCategoria(c.id_etiqueta, destino || null),
                      `${c.nombre} quitada; sus ${t.registros} quedaron en ${lista.find(x => x.id_etiqueta === destino)?.nombre ?? t.vacio}.`).then(() => setQuitando(null))}>Quitar</button>
                    <button className="secundario" onClick={() => setQuitando(null)}>Cancelar</button>
                  </span>
                </span>
              ) : (
                <span className="chips acciones-categoria">
                  <button className="secundario" onClick={() => { setEditando({ categoria: c, nombre: c.nombre, grupo: c.grupo ?? 'personal' }); setQuitando(null); setError('') }}>Editar</button>
                  <button className="secundario" onClick={() => { setQuitando(c); setDestino(''); setEditando(null) }}>Quitar</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Nueva {t.una}</h2>
        {lleno ? (
          <p className="tenue">Llegaste al tope de {TOPE[tipo]} {t.varias}. Para crear otra, quita una que ya no uses: sus {t.registros} pasan a la que elijas.</p>
        ) : (
          <form className="formulario" onSubmit={crear}>
            <label>Nombre<input required maxLength={60} value={nombre} onChange={ev => setNombre(ev.target.value)} autoComplete="off"
              placeholder={tipo === 'gasto' ? 'Ej.: Mascotas' : 'Ej.: Freelance'} /></label>
            {tipo === 'gasto' && (
              <div className="chips" role="radiogroup" aria-label="Tipo de gasto">
                <span className="tenue">¿Qué tipo de gasto es?</span>
                <button type="button" role="radio" aria-checked={grupo === 'basico'} className="chip" onClick={() => setGrupo('basico')}>Básico</button>
                <button type="button" role="radio" aria-checked={grupo === 'personal'} className="chip" onClick={() => setGrupo('personal')}>Personal</button>
              </div>
            )}
            <button className="principal" disabled={enviando}>Crear {t.una}</button>
          </form>
        )}
      </section>
    </>
  )
}

// Metas de ahorro: corregir nombre, valor o fecha, o quitarla (sus ahorros quedan como ahorro libre).
function Metas({ idAhorro, metas, alCambiar }: { idAhorro: string; metas: MetaAhorro[]; alCambiar: () => Promise<void> }) {
  const [editando, setEditando] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  if (!metas.length) return <p className="tenue">Aún no tienes metas.</p>
  return (
    <>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <ul className="lista">
        {metas.map(m => (
          <li key={m.id_meta} className="categoria">
            <span>{m.nombre}</span>
            <span />
            {editando === m.id_meta ? (
              <span className="confirmar-quitar">
                <FormularioMeta inicial={m} alGuardar={async c => {
                  await editarMetaAhorro(m, c)
                  setAviso(`${c.nombre} quedó guardada.`); setError(''); setEditando(null)
                  await alCambiar()
                }} />
                <button className="secundario" onClick={() => setEditando(null)}>Cancelar</button>
              </span>
            ) : (
              <span className="chips acciones-categoria">
                <button className="secundario" onClick={() => setEditando(m.id_meta)}>Editar</button>
                <button className="secundario" onClick={() => confirm(`¿Quitar la meta ${m.nombre}? Sus ahorros se conservan como ahorro libre.`) &&
                  quitarMetaAhorro(idAhorro, m).then(() => { setAviso(`${m.nombre} quitada.`); return alCambiar() }, e => setError((e as Error).message))}>Quitar</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
