import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aprenderNombre, crearHabito, guardarMeta, obtenerAlias, quitarSeguimiento, registrar, renombrarHabito, type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor } from '../indicadores'
import { normalizar } from '../finanzas/parseo'
import Grafico from '../Grafico'
import Barras from '../finanzas/Barras'
import { parecido } from '../salud/calculos'
import { dias, diasHechos, leerHabito, mismoNombre, mejorRacha, racha, totalDelDia, ultimosDias, type Leido, type Marca } from './calculos'

const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
const metaDe = (h: Seguimiento) => h.meta?.valor ?? null

// "hecho", "2 litros de 3" o null si ese día no hay nada.
function delDia(h: Seguimiento, marcas: Marca[], fecha: string): string | null {
  const total = totalDelDia(marcas, fecha)
  if (!total) return null
  if (h.tipo_medida === 'si_no') return 'hecho'
  const meta = metaDe(h)
  return `${formatoValor('numero', total, h.unidad)}${meta ? ` de ${formatoValor('numero', meta, h.unidad)}` : ''}`
}

export default function Habitos({ seguimientos, registros, alVolver, alCambiar }: {
  seguimientos: Seguimiento[]
  registros: RegistroGuardado[]
  alVolver: () => void
  alCambiar: () => Promise<void>
}) {
  const hoy = hoyIso()
  const habitos = useMemo(() => seguimientos.filter(s => s.codigo_plantilla === 'habitos')
    .sort((a, b) => a.nombre.localeCompare(b.nombre)), [seguimientos])
  const marcas = useMemo(() => new Map(habitos.map(h => [h.id_seguimiento, registros.filter(r => r.id_seguimiento === h.id_seguimiento)])),
    [habitos, registros])
  const [alias, setAlias] = useState<Map<string, string> | null>(null)
  const [texto, setTexto] = useState('')
  const [pregunta, setPregunta] = useState<{ leido: Leido; sugerido: string } | null>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmar, setConfirmar] = useState<string | null>(null)
  const [renombrando, setRenombrando] = useState<{ id: string; nombre: string } | null>(null)

  useEffect(() => { obtenerAlias('habito').then(setAlias).catch(e => setError((e as Error).message)) }, [])

  const leido = leerHabito(texto, hoy)

  async function guardar(l: Leido) {
    const existente = habitos.find(h => mismoNombre(h.nombre, l.habito))
    const nombre = existente?.nombre ?? l.habito
    if (existente?.tipo_medida === 'numero' && l.valor === null) {
      return setError(`${nombre} se mide en ${existente.unidad ?? 'cantidad'}: escribe cuánto, por ejemplo "${nombre} 2".`)
    }
    setEnviando(true)
    try {
      const esSiNo = existente ? existente.tipo_medida === 'si_no' : l.valor === null
      // shortcut: un hábito quitado que vuelve se guarda con el tipo de antes; si no coincide con lo escrito, la base lo rechaza.
      const id = existente?.id_seguimiento ?? await crearHabito({
        nombre: l.habito, tipo_medida: esSiNo ? 'si_no' : 'numero', unidad: esSiNo ? null : l.unidad || null,
      })
      const valor = esSiNo ? 1 : l.valor!
      const resultado = await registrar({ id_seguimiento: id, fecha_registro: l.fecha, valor, nota: null })
      const h = existente ?? { tipo_medida: esSiNo ? 'si_no' : 'numero', unidad: l.unidad || null, meta: null } as Seguimiento
      const nuevas = [...(marcas.get(id) ?? []), { fecha: l.fecha, valor }]
      setAviso(resultado === 'en_cola' ? 'Sin conexión: quedó guardado en este equipo y se enviará al volver la conexión.' : [
        `${nombre}${l.fecha === hoy ? ' hoy' : ` el ${diaMes(l.fecha)}`}: ${delDia(h, nuevas, l.fecha)}.`,
        existente ? '' : 'Hábito nuevo.',
        `Racha: ${dias(racha(nuevas, hoy, metaDe(h)))} · mejor: ${dias(mejorRacha(nuevas, metaDe(h)))}.`,
      ].filter(Boolean).join(' '))
      setTexto('')
      setPregunta(null)
      setError('')
      await alCambiar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  // Nombre conocido → lo aprendido → "¿Quisiste decir…?" si se parece a uno conocido → nuevo.
  function enviar(evento: FormEvent) {
    evento.preventDefault()
    if (!leido) return setError('Escribe el hábito y, si quieres, cuánto y qué día: "leer", "agua 2 litros", "meditar 10 ayer".')
    if (!alias) return
    if (habitos.some(h => mismoNombre(h.nombre, leido.habito))) return guardar(leido)
    const aprendido = alias.get(normalizar(leido.habito))
    if (aprendido) return guardar({ ...leido, habito: aprendido })
    const sugerido = parecido(leido.habito, habitos.map(h => normalizar(h.nombre)))
    const conocido = sugerido && habitos.find(h => normalizar(h.nombre) === sugerido)
    if (conocido) return setPregunta({ leido, sugerido: conocido.nombre })
    guardar(leido)
  }

  async function quitar(h: Seguimiento) {
    try {
      await quitarSeguimiento(h.id_seguimiento)
      setConfirmar(null)
      setAviso(`${h.nombre} quitado.`)
      await alCambiar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function renombrar(evento: FormEvent, h: Seguimiento) {
    evento.preventDefault()
    const nuevo = (renombrando?.nombre ?? '').replace(/\s+/g, ' ').trim()
    if (!nuevo || nuevo.length > 60) return setError('Escribe un nombre de 1 a 60 letras.')
    if (nuevo === h.nombre) return setRenombrando(null)
    const otro = habitos.find(o => o.id_seguimiento !== h.id_seguimiento && mismoNombre(o.nombre, nuevo))
    if (otro) return setError(`Ya tienes un hábito llamado ${otro.nombre}.`)
    try {
      await renombrarHabito(h.id_seguimiento, h.nombre, nuevo)
      // escribir el nombre viejo sigue llevando a este hábito
      if (!mismoNombre(h.nombre, nuevo)) await aprenderNombre('habito', normalizar(h.nombre), nuevo).catch(() => {})
      setAlias(await obtenerAlias('habito'))
      setRenombrando(null)
      setError('')
      setAviso(`${h.nombre} ahora se llama ${nuevo}.`)
      await alCambiar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function responder(correcto: string) {
    if (!pregunta) return
    await aprenderNombre('habito', normalizar(pregunta.leido.habito), correcto).catch(() => {})
    await guardar({ ...pregunta.leido, habito: correcto })
  }

  return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado"><div><h1>Hábitos</h1></div></header>
      {habitos.length > 0 && <DesdeLista habitos={habitos} hoy={hoy} enviando={enviando} alGuardar={guardar} />}
      <form className="formulario" onSubmit={enviar}>
        <h2>{habitos.length ? 'Escribir o crear un hábito' : 'Registrar hábito'}</h2>
        <label>Hábito, cuánto y qué día (opcionales)
          <input required maxLength={80} value={texto} onChange={ev => { setTexto(ev.target.value); setPregunta(null) }}
            placeholder="agua 2 litros" autoComplete="off" />
        </label>
        {leido && (
          <p className="tenue" aria-live="polite">
            {leido.habito} · <strong>{leido.valor === null ? 'hecho' : `${leido.valor} ${leido.unidad}`.trim()}</strong>
            {leido.fecha !== hoy && ` · ${diaMes(leido.fecha)}`}
          </p>
        )}
        {pregunta ? (
          <div className="chips" role="group" aria-label="¿Quisiste decir…?">
            <span>¿Quisiste decir <strong>{pregunta.sugerido}</strong>?</span>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.sugerido)}>Sí</button>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.leido.habito)}>No, es nuevo</button>
          </div>
        ) : <button className="principal" disabled={enviando || !alias}>Guardar</button>}
        {aviso && <p role="status" className="aviso">{aviso}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </form>
      {habitos.length === 0 && <p className="tenue">Aún no hay hábitos. Escribe el primero, por ejemplo "leer" o "agua 2 litros".</p>}
      {habitos.length > 0 && (
        <>
          <section>
            <h2>Hoy</h2>
            <ul className="lista">
              {habitos.map(h => {
                const suyas = marcas.get(h.id_seguimiento) ?? []
                return (
                  <li key={h.id_seguimiento} className="dos">
                    <span>{h.nombre} <span className="tenue">· {delDia(h, suyas, hoy) ?? 'pendiente'}</span></span>
                    <span>racha <strong>{dias(racha(suyas, hoy, metaDe(h)))}</strong> <span className="tenue">· mejor {dias(mejorRacha(suyas, metaDe(h)))}</span>
                      {' '}<button className="enlace" aria-expanded={renombrando?.id === h.id_seguimiento}
                        onClick={() => { setRenombrando(renombrando?.id === h.id_seguimiento ? null : { id: h.id_seguimiento, nombre: h.nombre }); setConfirmar(null) }}>Renombrar</button>
                      {' '}<button className="enlace" aria-expanded={confirmar === h.id_seguimiento}
                        onClick={() => { setConfirmar(confirmar === h.id_seguimiento ? null : h.id_seguimiento); setRenombrando(null) }}>Quitar</button>
                    </span>
                    {renombrando?.id === h.id_seguimiento && (
                      <form className="chips" onSubmit={ev => renombrar(ev, h)}>
                        <label>Nuevo nombre
                          <input required maxLength={60} value={renombrando.nombre} autoComplete="off"
                            onChange={ev => setRenombrando({ id: h.id_seguimiento, nombre: ev.target.value })} />
                        </label>
                        <button className="chip">Guardar</button>
                        <button type="button" className="chip" onClick={() => { setRenombrando(null); setError('') }}>Cancelar</button>
                      </form>
                    )}
                    {confirmar === h.id_seguimiento && (
                      <div className="chips" role="group" aria-label={`Quitar ${h.nombre}`}>
                        <span>¿Quitar <strong>{h.nombre}</strong>? Sus registros se conservan.</span>
                        <button type="button" className="chip" onClick={() => quitar(h)}>Sí</button>
                        <button type="button" className="chip" onClick={() => setConfirmar(null)}>No</button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
          <Constancia habitos={habitos} marcas={marcas} hoy={hoy} />
          <Detalle habitos={habitos} marcas={marcas} hoy={hoy} alCambiar={alCambiar} />
        </>
      )}
    </>
  )
}

// Registrar uno de los hábitos que ya existen: elegirlo, la cantidad si es de cantidad y el día.
function DesdeLista({ habitos, hoy, enviando, alGuardar }: {
  habitos: Seguimiento[]; hoy: string; enviando: boolean; alGuardar: (l: Leido) => Promise<void>
}) {
  const [id, setId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [fecha, setFecha] = useState(hoy)
  const [error, setError] = useState('')
  const h = habitos.find(x => x.id_seguimiento === id) ?? habitos[0]

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    if (!fecha || fecha > hoy) return setError('Elige hoy o un día anterior.')
    const n = h.tipo_medida === 'numero' ? Number(cantidad.replace(',', '.').trim()) : null
    if (n !== null && (!Number.isFinite(n) || n <= 0 || n >= 1e6)) return setError(`Escribe cuánto en ${h.unidad ?? 'números'}, por ejemplo 2.`)
    setError('')
    await alGuardar({ habito: h.nombre, valor: n, unidad: '', fecha })
    setCantidad('')
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <h2>Registrar hábito</h2>
      <label>Hábito
        <select value={h.id_seguimiento} onChange={ev => { setId(ev.target.value); setError('') }}>
          {habitos.map(x => <option key={x.id_seguimiento} value={x.id_seguimiento}>{x.nombre}</option>)}
        </select>
      </label>
      {h.tipo_medida === 'numero' && (
        <label>Cuánto{h.unidad ? ` (${h.unidad})` : ''}
          <input required inputMode="decimal" maxLength={8} value={cantidad} onChange={ev => setCantidad(ev.target.value)} />
        </label>
      )}
      <label>Día
        <input type="date" required value={fecha} max={hoy} onChange={ev => setFecha(ev.target.value)} />
      </label>
      <button className="principal" disabled={enviando}>{h.tipo_medida === 'si_no' ? 'Hecho' : 'Guardar'}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

function Constancia({ habitos, marcas, hoy }: { habitos: Seguimiento[]; marcas: Map<string, Marca[]>; hoy: string }) {
  const series = useMemo(() => [{
    nombre: 'Días', color: cssVar('--acento'),
    datos: habitos.map(h => diasHechos(marcas.get(h.id_seguimiento) ?? [], hoy, metaDe(h))),
  }], [habitos, marcas, hoy])
  return (
    <section>
      <h2>¿Cuántos días los cumplo?</h2>
      <Barras horizontal etiquetas={habitos.map(h => h.nombre)} series={series} formato={v => `${Math.round(v)}`}
        colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')} descripcion="Días cumplidos de cada hábito en los últimos 30" />
    </section>
  )
}

function Detalle({ habitos, marcas, hoy, alCambiar }: {
  habitos: Seguimiento[]; marcas: Map<string, Marca[]>; hoy: string; alCambiar: () => Promise<void>
}) {
  const [elegido, setElegido] = useState('')
  const h = habitos.find(x => x.id_seguimiento === elegido) ?? habitos[0]
  const dias30 = useMemo(() => ultimosDias(marcas.get(h.id_seguimiento) ?? [], hoy), [marcas, h, hoy])
  const meta = metaDe(h)
  const cumple = (v: number) => v > 0 && v >= (meta ?? 0)
  return (
    <section>
      <h2>¿Cómo voy en cada hábito?</h2>
      <div className="formulario">
        <label>Hábito
          <select value={h.id_seguimiento} onChange={ev => setElegido(ev.target.value)}>
            {habitos.map(x => <option key={x.id_seguimiento} value={x.id_seguimiento}>{x.nombre}</option>)}
          </select>
        </label>
      </div>
      {h.tipo_medida === 'numero' ? (
        <Grafico puntos={dias30} meta={meta} color={cssVar('--acento')} colorMeta={cssVar('--tenue')}
          formato={v => formatoValor('numero', v, h.unidad)}
          descripcion={`${h.nombre} por día en los últimos 30${meta ? '; la línea punteada es la meta diaria' : ''}`} />
      ) : (
        <div className="calendario" role="img" aria-label={`${h.nombre}: hecho ${dias30.filter(d => cumple(d.valor)).length} de los últimos 30 días`}>
          {dias30.map(d => <span key={d.fecha} className={cumple(d.valor) ? 'hecho' : ''} title={`${diaMes(d.fecha)}${cumple(d.valor) ? ' · hecho' : ''}`} />)}
        </div>
      )}
      {h.tipo_medida === 'numero' && <MetaDiaria key={h.id_seguimiento} habito={h} alCambiar={alCambiar} />}
    </section>
  )
}

function MetaDiaria({ habito, alCambiar }: { habito: Seguimiento; alCambiar: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState(habito.meta ? String(habito.meta.valor).replace('.', ',') : '')
  const [mensaje, setMensaje] = useState('')

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const n = valor.trim() ? Number(valor.replace(',', '.').trim()) : null
    if (n !== null && (!Number.isFinite(n) || n <= 0 || n >= 1e6)) return setMensaje('Escribe la meta como número.')
    try {
      await guardarMeta(habito.id_seguimiento, n === null ? null : { valor: n, direccion: 'mas_es_mejor', periodo: 'dia' })
      setMensaje(n === null ? 'Meta quitada.' : 'Meta guardada.')
      await alCambiar()
    } catch (e) {
      setMensaje((e as Error).message)
    }
  }

  return (
    <>
      <button className="enlace" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {habito.meta ? 'Cambiar meta diaria' : 'Poner meta diaria (opcional)'}
      </button>
      {abierto && (
        <form className="formulario" onSubmit={guardar}>
          <label>Meta por día en {habito.unidad ?? 'cantidad'} (vacía para quitarla)
            <input inputMode="decimal" maxLength={8} value={valor} onChange={ev => setValor(ev.target.value)} />
          </label>
          <button className="principal">Guardar meta</button>
          {mensaje && <p role="status" className="tenue">{mensaje}</p>}
        </form>
      )}
    </>
  )
}
