import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  aprenderNombre, crearEjercicio, crearSeguimiento, guardarMeta, obtenerSalud, registrar, registrarSerie,
  type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor, type Direccion } from '../indicadores'
import Grafico from '../Grafico'
import Barras from '../finanzas/Barras'
import { normalizar } from '../finanzas/parseo'
import {
  anteriorDe, comparar, conSigno, diasEntrenados, diasPorSemana, kg, leerSerie, parecido, pesoPorDia, progreso, restarDias, sugerencia,
  type Sesion,
} from './calculos'

type Datos = Awaited<ReturnType<typeof obtenerSalud>>
type Leido = NonNullable<ReturnType<typeof leerSerie>>

const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
const serie = (s: Omit<Sesion, 'fecha'>) => `${s.series}x${s.repeticiones}${s.peso === null ? '' : ` ${kg(s.peso)}`}`
const leerNumero = (texto: string) => Number(texto.replace(',', '.').trim())
// Lo que crea el módulo la primera vez que se abre (o al activarlo).
export const INICIALES = [
  { nombre: 'Gym', unidad: 'kg', codigo_plantilla: 'gym' },
  { nombre: 'Peso', unidad: 'kg', codigo_plantilla: 'cuerpo' },
  { nombre: 'Cintura', unidad: 'cm', codigo_plantilla: 'cuerpo' },
]

export default function Salud({ seguimientos, registros, abrir, alVolver, alCambiar }: {
  seguimientos: Seguimiento[]
  abrir?: 'ejercicio' | 'medida'
  registros: RegistroGuardado[]
  alVolver: () => void
  alCambiar: () => Promise<void>
}) {
  const [pestana, setPestana] = useState<'gym' | 'cuerpo'>(abrir === 'medida' ? 'cuerpo' : 'gym')
  const [error, setError] = useState('')
  const creando = useRef(false)
  const gym = seguimientos.find(s => s.codigo_plantilla === 'gym')
  const medidas = seguimientos.filter(s => s.codigo_plantilla === 'cuerpo')

  useEffect(() => {
    const faltan = INICIALES.filter(i => !seguimientos.some(s => s.codigo_plantilla === i.codigo_plantilla && s.nombre === i.nombre))
    if (!faltan.length || creando.current) return
    creando.current = true
    Promise.all(faltan.map(f => crearSeguimiento({ ...f, tipo_medida: 'numero', frecuencia: 'registro' }, null)))
      .then(alCambiar).catch(e => setError((e as Error).message))
  }, [seguimientos, alCambiar])

  return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado"><div><h1>Salud</h1></div></header>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="chips pestanas" role="radiogroup" aria-label="Sección de Salud">
        {(['gym', 'cuerpo'] as const).map(p => (
          <button key={p} type="button" role="radio" aria-checked={pestana === p} className="chip" onClick={() => setPestana(p)}>
            {p === 'gym' ? 'Gym' : 'Cuerpo'}
          </button>
        ))}
      </div>
      {!gym && <p className="tenue">Preparando…</p>}
      {gym && pestana === 'gym' && (
        <Gym idGym={gym.id_seguimiento} registros={registros.filter(r => r.id_seguimiento === gym.id_seguimiento)} enfocar={abrir === 'ejercicio'} alCambiar={alCambiar} />
      )}
      {pestana === 'cuerpo' && (
        <>
          {medidas.map(m => (
            <Medida key={m.id_seguimiento} medida={m} registros={registros.filter(r => r.id_seguimiento === m.id_seguimiento)} alCambiar={alCambiar} />
          ))}
          <NuevaMedida inicial={abrir === 'medida'} alCrear={async (nombre, unidad) => {
            await crearSeguimiento({ nombre, unidad, tipo_medida: 'numero', frecuencia: 'registro', codigo_plantilla: 'cuerpo' }, null)
            await alCambiar()
          }} />
        </>
      )}
    </>
  )
}

function Gym({ idGym, registros, enfocar, alCambiar }: {
  idGym: string; registros: RegistroGuardado[]; enfocar?: boolean; alCambiar: () => Promise<void>
}) {
  const hoy = hoyIso()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [texto, setTexto] = useState('')
  const [pregunta, setPregunta] = useState<{ leido: Leido; sugerido: string } | null>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setDatos(await obtenerSalud(idGym, restarDias(hoyIso(), 366)))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [idGym])
  useEffect(() => { cargar() }, [cargar])

  const sesiones = useMemo<Sesion[]>(() => {
    if (!datos) return []
    const nombres = new Map(datos.ejercicios.map(e => [e.id_etiqueta, e.nombre]))
    const series = new Map(datos.series.map(s => [s.id_registro, s]))
    return registros.flatMap(r => {
      const s = series.get(r.id_registro)
      const ejercicio = r.id_etiqueta && nombres.get(r.id_etiqueta)
      return s && ejercicio ? [{
        fecha: r.fecha, ejercicio, series: s.cantidad_series, repeticiones: s.cantidad_repeticiones,
        peso: s.peso_kilogramos === null ? null : Number(s.peso_kilogramos),
      }] : []
    })
  }, [datos, registros])

  const leido = leerSerie(texto)

  async function guardar(s: Leido) {
    if (!datos) return
    setEnviando(true)
    try {
      const existente = datos.ejercicios.find(e => e.nombre === s.ejercicio)
      const idEtiqueta = existente?.id_etiqueta ?? await crearEjercicio(idGym, s.ejercicio)
      const anterior = anteriorDe(sesiones, s.ejercicio)
      await registrarSerie({ id_seguimiento: idGym, id_etiqueta: idEtiqueta, fecha: hoy, ...s })
      const cambio = anterior && s.peso !== null && anterior.peso !== null && s.peso !== anterior.peso ? ` (${conSigno(s.peso - anterior.peso, 'kg')})` : ''
      setAviso([
        `${s.ejercicio} ${serie(s)}.`,
        anterior ? `La vez anterior (${diaMes(anterior.fecha)}): ${serie(anterior)}${cambio}.` : 'Primera vez que lo registras.',
        sugerencia(s, sesiones),
      ].filter(Boolean).join(' '))
      setTexto('')
      setPregunta(null)
      setError('')
      await Promise.all([cargar(), alCambiar()])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  // Nombre conocido → lo aprendido → "¿Quisiste decir…?" si se parece a uno conocido → nuevo.
  function enviar(evento: FormEvent) {
    evento.preventDefault()
    if (!leido) return setError('Escribe ejercicio, series x repeticiones y kg, por ejemplo "press banca 4x10 60".')
    if (!datos) return
    const conocidos = datos.ejercicios.map(e => e.nombre)
    const aprendido = datos.alias.get(leido.ejercicio)
    if (conocidos.includes(leido.ejercicio)) return guardar(leido)
    if (aprendido) return guardar({ ...leido, ejercicio: aprendido })
    const sugerido = parecido(leido.ejercicio, conocidos)
    if (sugerido) return setPregunta({ leido, sugerido })
    guardar(leido)
  }

  async function responder(correcto: string) {
    if (!pregunta) return
    await aprenderNombre('ejercicio', pregunta.leido.ejercicio, correcto).catch(() => {})
    await guardar({ ...pregunta.leido, ejercicio: correcto })
  }

  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  return (
    <>
      <form className="formulario" onSubmit={enviar}>
        <h2>Registrar ejercicio</h2>
        <label>Ejercicio, series x repeticiones y kg
          <input required maxLength={80} value={texto} onChange={ev => { setTexto(ev.target.value); setPregunta(null) }}
            placeholder="press banca 4x10 60" autoComplete="off" autoFocus={enfocar} />
        </label>
        {leido && <p className="tenue" aria-live="polite">{leido.ejercicio} · <strong>{serie(leido)}</strong>{leido.peso === null ? ' · propio cuerpo' : ''}</p>}
        {pregunta ? (
          <div className="chips" role="group" aria-label="¿Quisiste decir…?">
            <span>¿Quisiste decir <strong>{pregunta.sugerido}</strong>?</span>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.sugerido)}>Sí</button>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.leido.ejercicio)}>No, es nuevo</button>
          </div>
        ) : <button className="principal" disabled={enviando}>Guardar</button>}
        {aviso && <p role="status" className="aviso">{aviso}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </form>
      <Constancia sesiones={sesiones} hoy={hoy} />
      <Progreso sesiones={sesiones} ejercicios={datos.ejercicios.map(e => e.nombre).sort()} />
    </>
  )
}

function Constancia({ sesiones, hoy }: { sesiones: Sesion[]; hoy: string }) {
  const semanas = useMemo(() => diasPorSemana(sesiones, hoy), [sesiones, hoy])
  const series = useMemo(() => [{ nombre: 'Días', datos: semanas.map(s => s.dias), color: cssVar('--acento') }], [semanas])
  return (
    <section>
      <h2>¿Estoy entrenando seguido?</h2>
      <p><strong>{diasEntrenados(sesiones, hoy)}</strong> <span className="tenue">días entrenados en los últimos 30</span></p>
      <Barras etiquetas={semanas.map(s => diaMes(s.desde))} series={series} formato={v => `${Math.round(v)}`}
        colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')} descripcion="Días entrenados en cada una de las últimas 8 semanas" />
    </section>
  )
}

function Progreso({ sesiones, ejercicios }: { sesiones: Sesion[]; ejercicios: string[] }) {
  const [elegido, setElegido] = useState('')
  const actual = ejercicios.includes(elegido) ? elegido : ejercicios[0]
  const p = useMemo(() => actual ? progreso(sesiones, actual) : null, [sesiones, actual])
  const puntos = useMemo(() => actual ? pesoPorDia(sesiones, actual) : [], [sesiones, actual])
  if (!actual || !p) return null
  return (
    <section>
      <h2>¿Cómo voy en cada ejercicio?</h2>
      <div className="formulario">
        <label>Ejercicio
          <select value={actual} onChange={ev => setElegido(ev.target.value)}>
            {ejercicios.map(e => <option key={e}>{e}</option>)}
          </select>
        </label>
      </div>
      <ul className="lista">
        {p.ultimas.map((s, i) => <li key={i} className="dos"><span>{diaMes(s.fecha)}</span><strong>{serie(s)}</strong></li>)}
      </ul>
      {p.record !== null && <p>Récord: <strong>{kg(p.record)}</strong>{p.desdePrimera !== null && <span className="tenue"> · desde la primera {conSigno(p.desdePrimera, 'kg')}</span>}</p>}
      {puntos.length > 1 && (
        <Grafico puntos={puntos} meta={p.record} color={cssVar('--acento')} colorMeta={cssVar('--tenue')} formato={kg}
          descripcion={`Mayor peso de cada día en ${actual}; la línea punteada es el récord`} />
      )}
    </section>
  )
}

function Medida({ medida, registros, alCambiar }: { medida: Seguimiento; registros: RegistroGuardado[]; alCambiar: () => Promise<void> }) {
  const hoy = hoyIso()
  const { nombre, unidad, meta } = medida
  const [valor, setValor] = useState('')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const rango = normalizar(nombre) === 'peso' ? [20, 400] : [0.1, 1000]
  const puntos = useMemo(() => registros.filter(r => r.fecha >= restarDias(hoy, 90)).slice().reverse(), [registros, hoy])
  const ultimo = registros[0]

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const n = leerNumero(valor)
    if (!Number.isFinite(n) || n < rango[0] || n > rango[1]) return setError(`Escribe ${nombre.toLowerCase()} en ${unidad ?? 'números'}, por ejemplo 78,5.`)
    setEnviando(true)
    try {
      const c = comparar(n, registros, hoy)
      const resultado = await registrar({ id_seguimiento: medida.id_seguimiento, fecha_registro: hoy, valor: n, nota: null })
      setAviso(resultado === 'en_cola' ? 'Sin conexión: quedó guardado en este equipo y se enviará al volver la conexión.' : [
        `${nombre}: ${formatoValor('numero', n, unidad)}.`,
        c.ultimo ? `Frente al último (${diaMes(c.ultimo.fecha)}): ${conSigno(c.ultimo.cambio, unidad)}.` : 'Es tu primer registro.',
        c.hace30 ? `Frente a hace 30 días (${diaMes(c.hace30.fecha)}): ${conSigno(c.hace30.cambio, unidad)}.` : '',
      ].filter(Boolean).join(' '))
      setValor('')
      setError('')
      await alCambiar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      <h2>{nombre}</h2>
      {ultimo && <p><strong>{formatoValor('numero', ultimo.valor, unidad)}</strong> <span className="tenue">el {diaMes(ultimo.fecha)}{meta ? ` · meta ${formatoValor('numero', meta.valor, unidad)}` : ''}</span></p>}
      <form className="fila-presupuesto" onSubmit={guardar}>
        <label htmlFor={`m-${medida.id_seguimiento}`}>Hoy</label>
        <input id={`m-${medida.id_seguimiento}`} inputMode="decimal" maxLength={8} value={valor} onChange={ev => setValor(ev.target.value)} placeholder={unidad ?? ''} />
        <button className="secundario" disabled={enviando}>Guardar</button>
      </form>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {puntos.length > 1 && (
        <Grafico puntos={puntos} meta={meta?.valor} color={cssVar('--acento')} colorMeta={cssVar('--tenue')}
          formato={v => formatoValor('numero', v, unidad)}
          descripcion={`${nombre} en los últimos 90 días${meta ? '; la línea punteada es la meta' : ''}`} />
      )}
      <MetaMedida medida={medida} alCambiar={alCambiar} />
    </section>
  )
}

function MetaMedida({ medida, alCambiar }: { medida: Seguimiento; alCambiar: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState(medida.meta ? String(medida.meta.valor).replace('.', ',') : '')
  const [direccion, setDireccion] = useState<Direccion>(medida.meta?.direccion ?? 'menos_es_mejor')
  const [mensaje, setMensaje] = useState('')

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const n = valor.trim() ? leerNumero(valor) : null
    if (n !== null && (!Number.isFinite(n) || n <= 0 || n >= 1e4)) return setMensaje('Escribe la meta como número.')
    try {
      await guardarMeta(medida.id_seguimiento, n === null ? null : { valor: n, direccion, periodo: 'dia' })
      setMensaje(n === null ? 'Meta quitada.' : 'Meta guardada.')
      await alCambiar()
    } catch (e) {
      setMensaje((e as Error).message)
    }
  }

  return (
    <>
      <button className="enlace" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {medida.meta ? 'Cambiar meta' : 'Poner meta (opcional)'}
      </button>
      {abierto && (
        <form className="formulario" onSubmit={guardar}>
          <label>Meta en {medida.unidad ?? 'números'} (vacía para quitarla)
            <input inputMode="decimal" maxLength={8} value={valor} onChange={ev => setValor(ev.target.value)} />
          </label>
          <div className="chips" role="radiogroup" aria-label="Dirección de la meta">
            {(['menos_es_mejor', 'mas_es_mejor'] as const).map(d => (
              <button key={d} type="button" role="radio" aria-checked={direccion === d} className="chip" onClick={() => setDireccion(d)}>
                {d === 'menos_es_mejor' ? 'Bajar' : 'Subir'}
              </button>
            ))}
          </div>
          <button className="principal">Guardar meta</button>
          {mensaje && <p role="status" className="tenue">{mensaje}</p>}
        </form>
      )}
    </>
  )
}

function NuevaMedida({ inicial, alCrear }: { inicial?: boolean; alCrear: (nombre: string, unidad: string) => Promise<void> }) {
  const [abierto, setAbierto] = useState(!!inicial)
  const [nombre, setNombre] = useState('')
  const [unidad, setUnidad] = useState('cm')
  const [error, setError] = useState('')

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    if (!nombre.trim() || !unidad.trim()) return setError('Escribe el nombre y la unidad, por ejemplo "Brazo" y "cm".')
    try {
      await alCrear(nombre.trim(), unidad.trim())
      setNombre(''); setError(''); setAbierto(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section>
      <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? 'Cerrar' : 'Agregar otra medida'}</button>
      {abierto && (
        <form className="formulario" onSubmit={guardar}>
          <label>Nombre<input required maxLength={60} value={nombre} onChange={ev => setNombre(ev.target.value)} placeholder="Brazo" autoComplete="off" autoFocus={inicial} /></label>
          <label>Unidad<input required maxLength={20} value={unidad} onChange={ev => setUnidad(ev.target.value)} /></label>
          <button className="principal">Agregar</button>
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </section>
  )
}
