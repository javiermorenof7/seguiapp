import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Selector from '../Selector'
import {
  aprenderNombre, crearEjercicio, crearMedida, crearSeguimiento, eliminarRegistro, guardarMeta, obtenerSalud, quitarEjercicio, quitarSeguimiento, registrar, registrarSerie, renombrarEjercicio, editarMedida, corregirSerie,
  type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor, type Direccion } from '../indicadores'
import Grafico from '../Grafico'
import { PeriodoNavegable, rangoCarga, useRegistrosDe, ventanaInicial, type Ventana } from '../Periodo'
import { rango as rangoDe } from '../historial/periodo'
import SinDatos from '../SinDatos'
import Historial, { FilaSimple } from '../historial/Historial'
import Barras from '../finanzas/Barras'
import { SemanaGym } from '../inicio/Minis'
import CambiarNombre from '../CambiarNombre'
import { normalizar } from '../finanzas/parseo'
import {
  cambioPeso, comparar, conSigno, constancia, seriesPorDia, faltaParaMeta, indicesRecord, kg, leerSerie, parecido, pesoPorDia,
  progreso, restarDias, seriesDeUltima, textoSerie,
  type Sesion,
} from './calculos'

type Datos = Awaited<ReturnType<typeof obtenerSalud>>
type Leido = NonNullable<ReturnType<typeof leerSerie>>

const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
const leerNumero = (texto: string) => Number(texto.replace(',', '.').trim())
// Lo que crea el módulo la primera vez que se abre (o al activarlo).
export const INICIALES = [
  { nombre: 'Gym', unidad: 'kg', codigo_plantilla: 'gym' },
]
// Solo Gym se recrea si falta; Cuerpo empieza vacío y cada quien elige qué medir y en qué unidad.
const SIEMPRE = INICIALES
// Las más comunes, de un toque; "Otra" deja escribir nombre y unidad.
const SUGERIDAS: [string, string][] = [['Peso', 'kg'], ['Cintura', 'cm'], ['Grasa corporal', '%'], ['Cadera', 'cm'], ['Brazo', 'cm'], ['Pecho', 'cm']]
const UNIDADES = ['kg', 'lb', 'cm', '%']

export default function Salud({ seguimientos, registros, abrir, alVolver, alCambiar }: {
  seguimientos: Seguimiento[]
  abrir?: 'ejercicio' | 'medida'
  registros: RegistroGuardado[]
  alVolver: () => void
  alCambiar: () => Promise<void>
}) {
  const [pestana, setPestana] = useState<'resumen' | 'gym' | 'cuerpo' | 'historial'>(abrir === 'medida' ? 'cuerpo' : abrir === 'ejercicio' ? 'gym' : 'resumen')
  const [error, setError] = useState('')
  const creando = useRef(false)
  const gym = seguimientos.find(s => s.codigo_plantilla === 'gym')
  const medidas = seguimientos.filter(s => s.codigo_plantilla === 'cuerpo')

  useEffect(() => {
    const faltan = SIEMPRE.filter(i => !seguimientos.some(s => s.codigo_plantilla === i.codigo_plantilla && s.nombre === i.nombre))
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
        {(['resumen', 'gym', 'cuerpo', 'historial'] as const).map(p => (
          <button key={p} type="button" role="radio" aria-checked={pestana === p} className="chip" onClick={() => setPestana(p)}>
            {p === 'resumen' ? 'Resumen' : p === 'gym' ? 'Gym' : p === 'cuerpo' ? 'Cuerpo' : 'Historial'}
          </button>
        ))}
      </div>
      {!gym && <p className="tenue">Preparando…</p>}
      {gym && pestana === 'resumen' && (
        <>
          <Gym vista="resumen" idGym={gym.id_seguimiento} metaDias={gym.meta?.valor} registros={registros.filter(r => r.id_seguimiento === gym.id_seguimiento)} alCambiar={alCambiar} alVer={setPestana} />
          <CuerpoHoy medidas={medidas} registros={registros} alVer={() => setPestana('cuerpo')} />
        </>
      )}
      {gym && pestana === 'gym' && (
        <Gym vista="registrar" idGym={gym.id_seguimiento} metaDias={gym.meta?.valor} registros={registros.filter(r => r.id_seguimiento === gym.id_seguimiento)} enfocar={abrir === 'ejercicio'} alCambiar={alCambiar} />
      )}
      {gym && pestana === 'historial' && <HistorialSalud gym={gym} medidas={medidas} registros={registros} alCambiar={alCambiar} />}
      {pestana === 'cuerpo' && (
        <>
          {medidas.map(m => (
            <Medida key={m.id_seguimiento} medida={m} registros={registros.filter(r => r.id_seguimiento === m.id_seguimiento)} alCambiar={alCambiar} />
          ))}
          <NuevaMedida inicial={abrir === 'medida'} vacio={!medidas.length} existentes={medidas.map(m => m.nombre)} alCrear={async (nombre, unidad) => {
            await crearMedida(nombre, unidad)
            await alCambiar()
          }} />
        </>
      )}
    </>
  )
}

function Gym({ vista, idGym, metaDias, registros: delAno, enfocar, alCambiar, alVer }: {
  vista: 'resumen' | 'registrar'
  idGym: string; metaDias?: number; registros: RegistroGuardado[]; enfocar?: boolean; alCambiar: () => Promise<void>
  alVer?: (pestana: 'gym' | 'historial') => void
}) {
  // el Resumen abre en la semana actual; la pestaña Gym, en el mes
  const [ventana, setVentana] = useState<Ventana>(() => vista === 'resumen' ? { escala: 'semana', ancla: hoyIso() } : ventanaInicial())
  const registros = useRegistrosDe(idGym, rangoCarga(ventana), delAno) as RegistroGuardado[]
  const hoy = hoyIso()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [ejercicio, setEjercicio] = useState('')
  // una fila por serie, cada una con su peso y sus repeticiones
  const [filas, setFilas] = useState([{ repeticiones: '', peso: '' }])
  const [pregunta, setPregunta] = useState<{ leidas: Leido[]; sugerido: string } | null>(null)
  const [aviso, setAviso] = useState('')
  const [abierto, setAbierto] = useState(!!enfocar)
  const [editando, setEditando] = useState<string | null>(null)
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setDatos(await obtenerSalud(idGym, '2000-01-01'))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [idGym])
  useEffect(() => { cargar() }, [cargar])

  const sesiones = useMemo<Sesion[]>(() => {
    if (!datos) return []
    const nombres = datos.nombres
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

  const leidas = filas.map(f => leerSerie(ejercicio, '1', f.repeticiones, f.peso))
  const cambiarFila = (i: number, cambio: Partial<typeof filas[number]>) => { setFilas(filas.map((f, j) => j === i ? { ...f, ...cambio } : f)); setPregunta(null) }
  const conocidos = useMemo(() => datos?.ejercicios.map(e => e.nombre).sort() ?? [], [datos])

  // al elegir un ejercicio que ya hizo, trae lo de la vez anterior para cambiar solo lo que subió
  // los 5 ejercicios más hechos en los últimos 30 días, con su última serie
  const frecuentes = useMemo(() => {
    const desde = restarDias(hoy, 30)
    const cuenta = new Map<string, { veces: number; ultima: Sesion }>()
    for (const x of sesiones) {
      if (x.fecha < desde) continue
      const c = cuenta.get(x.ejercicio)
      if (!c) cuenta.set(x.ejercicio, { veces: 1, ultima: x })
      else { c.veces++; if (x.fecha > c.ultima.fecha) c.ultima = x }
    }
    return [...cuenta.values()].sort((a, b) => b.veces - a.veces).slice(0, 5).map(c => c.ultima)
  }, [sesiones, hoy])

  function elegirEjercicio(texto: string) {
    setEjercicio(texto)
    setPregunta(null)
    const nombre = normalizar(texto)
    const previas = seriesDeUltima(sesiones, datos?.alias.get(nombre) ?? nombre)
    if (previas.length) setFilas(previas.map(p => ({ repeticiones: String(p.repeticiones), peso: p.peso === null ? '' : String(p.peso).replace('.', ',') })))
  }

  // Cada serie es un registro propio; el aviso compara el peso máximo con la sesión anterior.
  async function guardar(nombre: string, lista: Leido[]) {
    if (!datos) return
    setEnviando(true)
    try {
      const existente = datos.ejercicios.find(e => e.nombre === nombre)
      const idEtiqueta = existente?.id_etiqueta ?? await crearEjercicio(idGym, nombre)
      const antes = pesoPorDia(sesiones, nombre).filter(p => p.fecha < hoy).pop()
      for (const x of lista) await registrarSerie({ id_seguimiento: idGym, id_etiqueta: idEtiqueta, fecha: hoy, series: 1, repeticiones: x.repeticiones, peso: x.peso })
      const pesos = lista.flatMap(x => x.peso === null ? [] : [x.peso])
      const maximo = pesos.length ? Math.max(...pesos) : null
      setAviso([
        `${nombre}: ${lista.length} ${lista.length === 1 ? 'serie' : 'series'} (${lista.map(textoSerie).join(', ')}).`,
        maximo !== null && antes ? `Peso máximo ${kg(maximo)} (${conSigno(maximo - antes.valor, 'kg')} frente al ${diaMes(antes.fecha)}).` : '',
      ].filter(Boolean).join(' '))
      setEjercicio('')
      setFilas([{ repeticiones: '', peso: '' }])
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
    if (leidas.some(l => !l)) return setError('Revisa cada serie: repeticiones de 1 a 1.000 y el peso en kg (vacío si es con tu cuerpo).')
    if (!datos) return
    const lista = leidas as Leido[]
    const nombre = lista[0].ejercicio
    const aprendido = datos.alias.get(nombre)
    if (conocidos.includes(nombre)) return guardar(nombre, lista)
    if (aprendido) return guardar(aprendido, lista)
    const sugerido = parecido(nombre, conocidos)
    if (sugerido) return setPregunta({ leidas: lista, sugerido })
    guardar(nombre, lista)
  }

  // Los ejercicios se guardan normalizados (como los lee leerSerie); escribir el nombre viejo sigue llevando a este.
  async function renombrar(viejo: string, nuevo: string) {
    const limpio = normalizar(nuevo)
    if (limpio === viejo || !datos) return
    if (datos.ejercicios.some(e => e.nombre === limpio)) throw new Error(`Ya tienes un ejercicio llamado ${limpio}.`)
    await renombrarEjercicio(datos.ejercicios.find(e => e.nombre === viejo)!.id_etiqueta, viejo, limpio)
    await aprenderNombre('ejercicio', viejo, limpio).catch(() => {})
    setRenombrando(null)
    await cargar()
  }

  async function quitar(nombre: string) {
    if (!datos || !confirm(`¿Quitar ${nombre} de tus ejercicios? Sus series pasadas se conservan.`)) return
    try {
      await quitarEjercicio(datos.ejercicios.find(e => e.nombre === nombre)!.id_etiqueta)
      await cargar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function responder(correcto: string) {
    if (!pregunta) return
    await aprenderNombre('ejercicio', pregunta.leidas[0].ejercicio, correcto).catch(() => {})
    await guardar(correcto, pregunta.leidas)
  }

  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  if (vista === 'resumen') return !sesiones.length ? (
    <SinDatos titulo="Aún no registras ejercicios" detalle="Cuando registres tu primer ejercicio en Gym, aquí verás tu constancia y tu progreso." />
  ) : (
    <>
      <PeriodoNavegable valor={ventana} alCambiar={setVentana} />
      <div className="bloques-salud">
        <Constancia sesiones={sesiones} hoy={hoy} metaDias={metaDias} ventana={ventana} alVer={() => alVer?.('gym')} />
        <Progreso sesiones={sesiones} hoy={hoy} ejercicios={datos.ejercicios.map(e => e.nombre).sort()} ventana={ventana} alVer={() => alVer?.('historial')} />
      </div>
    </>
  )
  const nombres = datos.nombres
  const deSerie = new Map(datos.series.map(x => [x.id_registro, x]))
  const ultimos = registros.filter(r => deSerie.has(r.id_registro)).slice(0, 6)
  const loUltimo = ultimos.length > 0 && (
    <section>
      <h2>Lo último que registraste</h2>
      <ul className="lista">
        {ultimos.map(r => {
          const x = deSerie.get(r.id_registro)!
          const actual = { ejercicio: nombres.get(r.id_etiqueta ?? '') ?? 'Ejercicio', series: x.cantidad_series, repeticiones: x.cantidad_repeticiones,
            peso: x.peso_kilogramos === null ? null : Number(x.peso_kilogramos) }
          return (
            <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={actual.ejercicio} detalle={textoSerie(actual)}
              alBorrar={() => eliminarRegistro(r.id_registro).then(alCambiar)} alEditar={() => setEditando(editando === r.id_registro ? null : r.id_registro)}>
              {editando === r.id_registro && (
                <EditarSerie actual={actual} alCancelar={() => setEditando(null)}
                  alGuardar={async s => { await corregirSerie(r.id_registro, s); setEditando(null); await Promise.all([cargar(), alCambiar()]) }} />
              )}
            </FilaSimple>
          )
        })}
      </ul>
    </section>
  )
  const misEjercicios = conocidos.length > 0 && (
    <section>
      <h2>Mis ejercicios</h2>
      <ul className="lista">
        {conocidos.map(e => (
          <li key={e} className="dos">
            <span>{e}</span>
            <span>
              <button className="enlace" aria-expanded={renombrando === e} onClick={() => setRenombrando(renombrando === e ? null : e)}>Renombrar</button>
              {' · '}
              <button className="enlace" onClick={() => quitar(e)}>Quitar</button>
            </span>
            {renombrando === e && <CambiarNombre inicial={e} alCancelar={() => setRenombrando(null)} alGuardar={nuevo => renombrar(e, nuevo)} />}
          </li>
        ))}
      </ul>
    </section>
  )
  if (!abierto) return (
    <>
      {sesiones.length > 0 && <SeriesDelPeriodo sesiones={sesiones} hoy={hoy} ventana={ventana} alCambiarVentana={setVentana} />}
      <section>
        <MetaGym idGym={idGym} meta={metaDias} alCambiar={alCambiar} />
      </section>
      <section>
        <button className="principal registrar-uno" onClick={() => setAbierto(true)}>+ Registrar ejercicio</button>
        {aviso && <p role="status" className="aviso">{aviso}</p>}
      </section>
      {loUltimo}
      {misEjercicios}
    </>
  )
  return (
    <>
      <form className="formulario" onSubmit={enviar}>
        <div className="encabezado-seccion">
          <h2>Registrar ejercicio</h2>
          <button type="button" className="enlace" onClick={() => setAbierto(false)}>Cerrar</button>
        </div>
        <label>Ejercicio
          <input required maxLength={60} value={ejercicio} list="ejercicios" onChange={ev => elegirEjercicio(ev.target.value)}
            placeholder="Qué ejercicio hiciste" autoComplete="off" autoFocus={enfocar} />
          <small className="ayuda">Ej.: press banca, sentadilla, dominadas</small>
          <datalist id="ejercicios">{conocidos.map(e => <option key={e} value={e} />)}</datalist>
        </label>
        {frecuentes.length > 0 && !ejercicio.trim() && (
          <div className="sugeridos">
            <span className="tenue">Usar otra vez (con tu última serie)</span>
            <div className="chips">
              {frecuentes.map(f => <button key={f.ejercicio} type="button" className="chip" onClick={() => elegirEjercicio(f.ejercicio)}>{f.ejercicio} · {textoSerie(f)}</button>)}
            </div>
          </div>
        )}
        <fieldset className="series-gym">
          <legend>Series</legend>
          {filas.map((f, i) => (
            <div key={i} className="serie-fila">
              <span className="numero-serie" aria-hidden="true">{i + 1}</span>
              <label>Peso (kg)
                <input inputMode="decimal" maxLength={8} value={f.peso} placeholder="Vacío = tu cuerpo" aria-label={`Peso de la serie ${i + 1}`}
                  onChange={ev => cambiarFila(i, { peso: ev.target.value })} />
              </label>
              <label>Repeticiones
                <input required inputMode="numeric" maxLength={4} value={f.repeticiones} placeholder="Reps" aria-label={`Repeticiones de la serie ${i + 1}`}
                  onChange={ev => cambiarFila(i, { repeticiones: ev.target.value })} />
              </label>
              {filas.length > 1 && <button type="button" className="quitar" aria-label={`Quitar la serie ${i + 1}`}
                onClick={() => { setFilas(filas.filter((_, j) => j !== i)); setPregunta(null) }}>✕</button>}
            </div>
          ))}
          <button type="button" className="secundario" disabled={filas.length >= 30}
            onClick={() => { setFilas([...filas, { ...filas[filas.length - 1] }]); setPregunta(null) }}>+ Agregar serie</button>
          <small className="ayuda">Cada serie con su peso y sus repeticiones. "+ Agregar serie" copia la anterior para que cambies solo lo que varió.</small>
        </fieldset>
        {pregunta ? (
          <div className="chips" role="group" aria-label="¿Quisiste decir…?">
            <span>¿Quisiste decir <strong>{pregunta.sugerido}</strong>?</span>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.sugerido)}>Sí</button>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.leidas[0].ejercicio)}>No, es nuevo</button>
          </div>
        ) : <button className="principal" disabled={enviando}>
          Guardar {filas.length} {filas.length === 1 ? 'serie' : 'series'}
        </button>}
        {aviso && <p role="status" className="aviso">{aviso}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </form>
      {loUltimo}
      {misEjercicios}
    </>
  )
}

// Corrige series, repeticiones y kilos; se valida igual que al registrar.
function EditarSerie({ actual, alGuardar, alCancelar }: {
  actual: Omit<Sesion, 'fecha'>; alGuardar: (s: Omit<Sesion, 'fecha'>) => Promise<void>; alCancelar: () => void
}) {
  const [campos, setCampos] = useState({ series: String(actual.series), repeticiones: String(actual.repeticiones), peso: actual.peso === null ? '' : String(actual.peso).replace('.', ',') })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const s = leerSerie(actual.ejercicio, campos.series, campos.repeticiones, campos.peso)
    if (!s) return setError('Revisa: series de 1 a 100, repeticiones de 1 a 1.000 y el peso en kg (vacío si es con tu cuerpo).')
    setEnviando(true)
    try {
      await alGuardar(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="chips editar-serie" onSubmit={guardar}>
      <label>Series<input required inputMode="numeric" maxLength={3} value={campos.series} onChange={ev => setCampos({ ...campos, series: ev.target.value })} /></label>
      <label>Repeticiones<input required inputMode="numeric" maxLength={4} value={campos.repeticiones} onChange={ev => setCampos({ ...campos, repeticiones: ev.target.value })} /></label>
      <label>Kilos<input inputMode="decimal" maxLength={8} value={campos.peso} placeholder="tu cuerpo" onChange={ev => setCampos({ ...campos, peso: ev.target.value })} /></label>
      <button className="chip" disabled={enviando}>Guardar</button>
      <button type="button" className="chip" onClick={alCancelar}>Cancelar</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

// El gráfico de cada medida vive en la pestaña Cuerpo; aquí, el último valor, su cambio y lo que falta para la meta.
function CuerpoHoy({ medidas, registros, alVer }: { medidas: Seguimiento[]; registros: RegistroGuardado[]; alVer: () => void }) {
  if (!medidas.length) return null
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cómo va mi cuerpo?</h2><button className="enlace" onClick={alVer}>Ver →</button></div>
      <ul className="lista">
        {medidas.map(m => {
          const [ultimo, ...anteriores] = registros.filter(r => r.id_seguimiento === m.id_seguimiento).sort((a, b) => b.fecha.localeCompare(a.fecha))
          // frente al registro de hace 30 días o más; si no hay, frente al anterior
          const c = ultimo && comparar(ultimo.valor, anteriores, ultimo.fecha)
          const cambio = c && (c.hace30 ?? c.ultimo)
          const falta = ultimo && m.meta && faltaParaMeta(ultimo.valor, m.meta.valor, m.meta.direccion)
          const detalle = [
            cambio && `${conSigno(cambio.cambio, m.unidad)} desde el ${diaMes(cambio.fecha)}`,
            ultimo && m.meta && (falta ? `faltan ${formatoValor('numero', falta, m.unidad)}` : '✓ meta cumplida'),
          ].filter(Boolean).join(' · ')
          return (
            <li key={m.id_seguimiento} className="dos medida-hoy">
              <span>{m.nombre}{detalle && <span className="tenue">{detalle}</span>}</span>
              {ultimo
                ? <strong className="cifra-media">{formatoValor('numero', ultimo.valor, m.unidad)}</strong>
                : <button className="enlace" onClick={alVer}>Registrar</button>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// "esta semana", "la semana del 20/10", "en octubre", "en 2025": va en las cifras de Constancia y Progreso.
function enPeriodo(ventana: Ventana, hoy: string) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  if (ventana.escala === 'semana') return r.desde <= hoy && hoy <= r.hasta ? 'esta semana' : `la ${r.titulo.toLowerCase()}`
  if (ventana.escala === 'mes') return `en ${r.desde.slice(0, 4) === hoy.slice(0, 4) ? r.titulo.split(' ')[0] : r.titulo}`
  return `en ${r.titulo}`
}

// Una cifra y un visual por período: círculos (semana), días por semana (mes) o por mes (año). Sin leyenda ni línea de meta.
function Constancia({ sesiones, hoy, metaDias, ventana, alVer }: { sesiones: Sesion[]; hoy: string; metaDias?: number; ventana: Ventana; alVer: () => void }) {
  const meta = metaDias ?? null
  const r = rangoDe(ventana.escala, ventana.ancla)
  const grupos = useMemo(() => {
    const todos = constancia(sesiones, ventana.escala, r.desde, r.hasta, hoy)
    // año en celular: los últimos 6 meses que ya empezaron
    return ventana.escala === 'ano' && matchMedia('(max-width: 560px)').matches ? todos.filter(g => !g.futuro).slice(-6) : todos
  }, [sesiones, ventana.escala, r.desde, r.hasta, hoy])
  const dias = new Set(sesiones.filter(s => s.fecha >= r.desde && s.fecha <= r.hasta && s.fecha <= hoy).map(s => s.fecha)).size
  const cuando = enPeriodo(ventana, hoy)
  const etiquetas = grupos.map(g => ventana.escala === 'ano' ? MESES[Number(g.desde.slice(5, 7)) - 1] : diaMes(g.desde))
  const series = useMemo(() => [{ nombre: 'Días entrenados', datos: grupos.map(g => g.futuro ? null : g.dias), color: cssVar('--c1') }], [grupos])
  return (
    <section>
      <div className="bloque-pie"><h2>¿Voy cumpliendo?</h2><button className="enlace" onClick={alVer}>Ver →</button></div>
      <p><strong className="cifra-media">{dias}</strong> <span className="tenue">
        {ventana.escala === 'semana' && meta ? `de ${meta} días ${cuando}` : `${dias === 1 ? 'día' : 'días'} ${cuando}`}</span></p>
      {ventana.escala === 'semana' ? <SemanaGym semana={grupos.map(g => g.futuro ? null : g.dias > 0)} meta={meta} enPagina /> : (
        <Barras etiquetas={etiquetas} series={series} maximo={ventana.escala === 'mes' ? 7 : 31} leyenda={false}
          dias={{ titulos: grupos.map((g, i) => ventana.escala === 'mes' ? `Semana del ${etiquetas[i]}` : `${etiquetas[i]} ${g.desde.slice(0, 4)}`) }}
          formato={v => `${Math.round(v)} ${Math.round(v) === 1 ? 'día' : 'días'}`} formatoEje={v => `${v}`}
          colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
          descripcion={`Días entrenados por ${ventana.escala === 'mes' ? 'semana' : 'mes'} (${r.titulo}): ${grupos.filter(g => !g.futuro).map((g, i) => `${etiquetas[i]} ${g.dias}`).join(', ')}`} />
      )}
    </section>
  )
}

// Pestaña Gym: series de cada día (semana y mes) o de cada mes (año), con su propio filtro.
function SeriesDelPeriodo({ sesiones, hoy, ventana, alCambiarVentana }: { sesiones: Sesion[]; hoy: string; ventana: Ventana; alCambiarVentana: (v: Ventana) => void }) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  const puntos = useMemo(() => {
    const porDia = seriesPorDia(sesiones, r.desde, r.hasta, hoy)
    if (ventana.escala !== 'ano') return porDia.map(d => ({ etiqueta: String(Number(d.fecha.slice(8, 10))), titulo: d.fecha.split('-').reverse().join('/'), valor: d.series }))
    return MESES.map((m, i) => {
      const delMes = porDia.filter(d => Number(d.fecha.slice(5, 7)) === i + 1 && d.series !== null)
      return { etiqueta: m, titulo: `${m} ${r.titulo}`, valor: delMes.length ? delMes.reduce((t, d) => t + (d.series ?? 0), 0) : null }
    })
  }, [sesiones, ventana.escala, r.desde, r.hasta, r.titulo, hoy])
  const total = puntos.reduce((t, p) => t + (p.valor ?? 0), 0)
  const series = useMemo(() => [{ nombre: 'Series', datos: puntos.map(p => p.valor), color: cssVar('--c1') }], [puntos])
  const nSeries = (v: number) => `${Math.round(v)} ${Math.round(v) === 1 ? 'serie' : 'series'}`
  return (
    <section>
      <h2>¿Cuántas series hice?</h2>
      <PeriodoNavegable valor={ventana} alCambiar={alCambiarVentana} />
      <p><strong className="cifra-media">{total}</strong> <span className="tenue">{total === 1 ? 'serie' : 'series'} {enPeriodo(ventana, hoy)}</span></p>
      <Barras etiquetas={puntos.map(p => p.etiqueta)} series={series} leyenda={false} dias={{ titulos: puntos.map(p => p.titulo) }}
        formato={nSeries} formatoEje={v => `${v}`} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion={`Series de ${r.titulo}: ${puntos.filter(p => p.valor).map(p => `${p.etiqueta} ${p.valor}`).join(', ') || 'ninguna'}`} />
    </section>
  )
}

function MetaGym({ idGym, meta, alCambiar }: { idGym: string; meta?: number; alCambiar: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState(meta ? String(meta) : '')
  const [mensaje, setMensaje] = useState('')

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const n = valor.trim() ? Number(valor) : null
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 7)) return setMensaje('Escribe un número de días entre 1 y 7.')
    try {
      await guardarMeta(idGym, n === null ? null : { valor: n, direccion: 'mas_es_mejor', periodo: 'semana' })
      setMensaje(n === null ? 'Meta quitada.' : 'Meta guardada.')
      await alCambiar()
    } catch (e) {
      setMensaje((e as Error).message)
    }
  }

  return (
    <>
      <button className="enlace" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {meta ? 'Cambiar meta de días' : 'Poner meta de días por semana'}
      </button>
      {abierto && (
        <form className="formulario" onSubmit={guardar}>
          <label>Días por semana (vacío para quitarla)
            <input inputMode="numeric" maxLength={1} value={valor} onChange={ev => setValor(ev.target.value)} placeholder="Ej. 4" />
          </label>
          <button className="principal">Guardar meta</button>
          {mensaje && <p role="status" className="tenue">{mensaje}</p>}
        </form>
      )}
    </>
  )
}

function Progreso({ sesiones, hoy, ejercicios, ventana, alVer }: { sesiones: Sesion[]; hoy: string; ejercicios: string[]; ventana: Ventana; alVer: () => void }) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  const [elegido, setElegido] = useState('')
  // abre en el último ejercicio entrenado (las sesiones llegan de la más reciente a la más antigua)
  const actual = ejercicios.includes(elegido) ? elegido : sesiones.find(s => ejercicios.includes(s.ejercicio))?.ejercicio ?? ejercicios[0]
  const p = useMemo(() => actual ? progreso(sesiones, actual) : null, [sesiones, actual])
  const puntos = useMemo(() => actual ? pesoPorDia(sesiones, actual, r.desde).filter(p => p.fecha <= r.hasta) : [], [sesiones, actual, r.desde, r.hasta])
  const records = useMemo(() => ({ indices: indicesRecord(puntos), texto: 'récord' }), [puntos])
  if (!actual || !p) return null
  const cambio = cambioPeso(puntos)
  const cuando = enPeriodo(ventana, hoy)
  const record = p.record !== null ? ` · récord ${kg(p.record)}` : ''
  return (
    <section>
      <div className="bloque-pie"><h2>¿Estoy subiendo de peso?</h2><button className="enlace" onClick={alVer}>Ver →</button></div>
      <Selector id="filtro-ejercicio" titulo="Ejercicio" icono="🏋️" valor={actual} alCambiar={setElegido}>
        {ejercicios.map(e => <option key={e}>{e}</option>)}
      </Selector>
      {cambio !== null
        ? <p><strong className="cifra-media">{conSigno(cambio, 'kg')}</strong> <span className="tenue">{cuando}{record}</span></p>
        : <p className="tenue">Pocos registros con peso {cuando}{record}.</p>}
      {puntos.length > 0 && (
        <Grafico puntos={puntos} color={cssVar('--c1')} colorMeta={cssVar('--tenue')} formato={kg} destacados={records} desde={r.desde} hasta={r.hasta}
          descripcion={`Mayor peso de cada día en ${actual}; los puntos grandes son cada récord nuevo`} />
      )}
    </section>
  )
}

function Medida({ medida, registros, alCambiar }: { medida: Seguimiento; registros: RegistroGuardado[]; alCambiar: () => Promise<void> }) {
  const hoy = hoyIso()
  const [ventana, setVentana] = useState<Ventana>(ventanaInicial)
  const periodo = rangoDe(ventana.escala, ventana.ancla)
  const historial = useRegistrosDe(medida.id_seguimiento, rangoCarga(ventana), registros)
  const { nombre, unidad, meta } = medida
  const [valor, setValor] = useState('')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [editando, setEditando] = useState(false)
  const rango = normalizar(nombre) === 'peso' ? [20, 400] : [0.1, 1000]
  const puntos = useMemo(() => historial.filter(r => r.fecha >= periodo.desde && r.fecha <= periodo.hasta).slice().reverse(), [historial, periodo.desde, periodo.hasta])
  const ultimo = registros[0]

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const n = leerNumero(valor)
    if (!Number.isFinite(n) || n < rango[0] || n > rango[1]) return setError(`Escribe ${nombre.toLowerCase()} en ${unidad ?? 'números'}, por ejemplo 78,5.`)
    // un cambio de más del 10 % frente a la última suele ser un error de dedo
    if (ultimo && Math.abs(n - ultimo.valor) > ultimo.valor * 0.1
      && !confirm(`¿${formatoValor('numero', n, unidad)}? La última fue ${formatoValor('numero', ultimo.valor, unidad)}. ¿Guardar igual?`)) return
    if (ultimo?.fecha === hoy && !confirm(`Ya registraste ${nombre.toLowerCase()} hoy (${formatoValor('numero', ultimo.valor, unidad)}). ¿Guardar otro?`)) return
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
      <div className="bloque-pie"><h2>{nombre}</h2>
        <span className="chips acciones-categoria">
          <button className="secundario" aria-expanded={editando} onClick={() => setEditando(!editando)}>Editar</button>
          <button className="secundario" onClick={() => confirm(`¿Dejar de medir ${nombre}? Sale de Cuerpo, pero sus registros se conservan; si la vuelves a crear con el mismo nombre, regresan.`) &&
            quitarSeguimiento(medida.id_seguimiento).then(alCambiar, e => setError((e as Error).message))}>Ya no medir</button>
        </span></div>
      {editando && <EditarMedida medida={medida} alCancelar={() => setEditando(false)} alGuardar={async c => { await editarMedida(medida.id_seguimiento, c); setEditando(false); await alCambiar() }} />}
      {ultimo && <p><strong>{formatoValor('numero', ultimo.valor, unidad)}</strong> <span className="tenue">el {diaMes(ultimo.fecha)}{meta ? ` · meta ${formatoValor('numero', meta.valor, unidad)}` : ''}</span></p>}
      <form className="fila-presupuesto" onSubmit={guardar}>
        <label htmlFor={`m-${medida.id_seguimiento}`}>Hoy</label>
        <input id={`m-${medida.id_seguimiento}`} inputMode="decimal" maxLength={8} value={valor} onChange={ev => setValor(ev.target.value)} placeholder={`Tu medida de hoy (ej. 78,5${unidad ? ` ${unidad}` : ''})`} />
        <button className="secundario" disabled={enviando}>Guardar</button>
      </form>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {registros.length > 1 && <PeriodoNavegable valor={ventana} alCambiar={setVentana} />}
      {puntos.length > 0 && (
        <Grafico puntos={puntos} meta={meta?.valor} color={cssVar('--c1')} colorMeta={cssVar('--tenue')}
          formato={v => formatoValor('numero', v, unidad)} etiquetaMeta={meta ? `Meta ${formatoValor('numero', meta.valor, unidad)}` : undefined}
          desde={periodo.desde} hasta={periodo.hasta} descripcion={`${nombre} en ${periodo.titulo}${meta ? '; la línea punteada es la meta' : ''}`} />
      )}
      {registros.length > 0 && (
        <ul className="lista">
          {registros.slice(0, 3).map(r => (
            <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={formatoValor('numero', r.valor, unidad)} detalle={nombre}
              alBorrar={() => eliminarRegistro(r.id_registro).then(alCambiar)} />
          ))}
        </ul>
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

// Nombre y unidad de una medida; la unidad en botones (o escrita) para que se entienda cómo se mide.
function CamposMedida({ nombre, unidad, alCambiar }: { nombre: string; unidad: string; alCambiar: (c: { nombre: string; unidad: string }) => void }) {
  return (
    <>
      <label>Qué quieres medir<input required maxLength={60} value={nombre} onChange={ev => alCambiar({ nombre: ev.target.value, unidad })} placeholder="Ej.: Brazo, Cadera" autoComplete="off" /></label>
      <div className="chips" role="radiogroup" aria-label="Unidad">
        <span className="tenue">¿En qué lo mides?</span>
        {UNIDADES.map(u => <button key={u} type="button" role="radio" aria-checked={unidad === u} className="chip" onClick={() => alCambiar({ nombre, unidad: u })}>{u}</button>)}
      </div>
      <label>Otra unidad (opcional)<input maxLength={20} value={UNIDADES.includes(unidad) ? '' : unidad} onChange={ev => alCambiar({ nombre, unidad: ev.target.value })} placeholder="Ej.: pulgadas" autoComplete="off" /></label>
    </>
  )
}

function EditarMedida({ medida, alCancelar, alGuardar }: { medida: Seguimiento; alCancelar: () => void; alGuardar: (c: { nombre: string; unidad: string }) => Promise<void> }) {
  const [campos, setCampos] = useState({ nombre: medida.nombre, unidad: medida.unidad ?? '' })
  const [error, setError] = useState('')
  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const c = { nombre: campos.nombre.replace(/\s+/g, ' ').trim(), unidad: campos.unidad.trim() }
    if (!c.nombre || !c.unidad) return setError('Escribe qué mides y en qué unidad.')
    try { await alGuardar(c) } catch (e) { setError((e as Error).message) }
  }
  return (
    <form className="formulario editar-factura" onSubmit={guardar}>
      <h3>Editar medida</h3>
      <CamposMedida nombre={campos.nombre} unidad={campos.unidad} alCambiar={setCampos} />
      <div className="chips"><button className="principal">Guardar</button><button type="button" className="secundario" onClick={alCancelar}>Cancelar</button></div>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

function NuevaMedida({ inicial, vacio, existentes, alCrear }: {
  inicial?: boolean; vacio: boolean; existentes: string[]; alCrear: (nombre: string, unidad: string) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(!!inicial || vacio)
  const [otra, setOtra] = useState(false)
  const [campos, setCampos] = useState({ nombre: '', unidad: 'cm' })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const sugeridas = SUGERIDAS.filter(([n]) => !existentes.some(e => normalizar(e) === normalizar(n)))

  async function crear(nombre: string, unidad: string) {
    if (!nombre.trim() || !unidad.trim()) return setError('Escribe qué quieres medir y en qué unidad, por ejemplo "Brazo" en cm.')
    setEnviando(true)
    try {
      await alCrear(nombre.replace(/\s+/g, ' ').trim(), unidad.trim())
      setCampos({ nombre: '', unidad: 'cm' }); setOtra(false); setError(''); setAbierto(vacio)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      {vacio && <p className="tenue explica">Elige qué quieres medir de tu cuerpo y cómo medirlo. Puedes agregar o quitar medidas cuando quieras.</p>}
      {!vacio && <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? 'Cerrar' : '+ Agregar medida'}</button>}
      {abierto && (
        <div className="formulario">
          {sugeridas.length > 0 && (
            <div className="chips" role="group" aria-label="Medidas sugeridas">
              {sugeridas.map(([n, u]) => <button key={n} type="button" className="chip" disabled={enviando} onClick={() => crear(n, u)}>{n} ({u})</button>)}
              <button type="button" className="chip" aria-expanded={otra} onClick={() => setOtra(!otra)}>Otra</button>
            </div>
          )}
          {(otra || !sugeridas.length) && (
            <form className="formulario" onSubmit={ev => { ev.preventDefault(); crear(campos.nombre, campos.unidad) }}>
              <CamposMedida nombre={campos.nombre} unidad={campos.unidad} alCambiar={setCampos} />
              <button className="principal" disabled={enviando}>Agregar medida</button>
            </form>
          )}
          {error && <p role="alert" className="error">{error}</p>}
        </div>
      )}
    </section>
  )
}

// Gym y medidas juntos; las series del gym se leen de su tabla para mostrar el detalle.
function HistorialSalud({ gym, medidas, registros, alCambiar }: {
  gym: Seguimiento; medidas: Seguimiento[]; registros: RegistroGuardado[]; alCambiar: () => Promise<void>
}) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { obtenerSalud(gym.id_seguimiento, restarDias(hoyIso(), 366)).then(setDatos, e => setError((e as Error).message)) }, [gym.id_seguimiento, registros])
  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  const ejercicios = datos.nombres
  const series = new Map(datos.series.map(s => [s.id_registro, s]))
  const seguimientos = [gym, ...medidas]
  const nombreDe = (r: RegistroGuardado) => r.id_seguimiento === gym.id_seguimiento
    ? ejercicios.get(r.id_etiqueta ?? '') ?? 'Ejercicio'
    : seguimientos.find(s => s.id_seguimiento === r.id_seguimiento)?.nombre ?? ''
  return (
    <Historial
      ids={seguimientos.map(s => s.id_seguimiento)}
      registros={registros}
      filtros={[
        { nombre: 'Tipo', opciones: seguimientos.map(s => [s.id_seguimiento, s.nombre] as [string, string]), de: r => r.id_seguimiento },
        { nombre: 'Ejercicio', opciones: [...ejercicios].sort((a, b) => a[1].localeCompare(b[1])), de: r => r.id_etiqueta ?? '' },
      ]}
      suma={false}
      vista={elegidos => {
        const medida = medidas.find(m => m.id_seguimiento === elegidos.Tipo)
        if (elegidos.Ejercicio) return { modo: 'maximo', pregunta: `Peso máximo en ${ejercicios.get(elegidos.Ejercicio) ?? 'el ejercicio'}`, formato: kg }
        if (medida) return { modo: 'maximo', pregunta: `Tu ${medida.nombre.toLowerCase()}`, formato: (v: number) => formatoValor('numero', v, medida.unidad) }
        // sin filtro: series del gym (las viejas "4 × 10" cuentan 4)
        return { modo: 'conteo', pregunta: 'Series de gym de cada día', cuanto: (r: RegistroGuardado) => r.id_seguimiento === gym.id_seguimiento ? series.get(r.id_registro)?.cantidad_series ?? 1 : 0 }
      }}
      total={lista => {
        const entreno = new Set(lista.filter(r => r.id_seguimiento === gym.id_seguimiento).map(r => r.fecha)).size
        return `${entreno} ${entreno === 1 ? 'día' : 'días'} de gym`
      }}
      fila={r => {
        const s = series.get(r.id_registro)
        const medida = seguimientos.find(x => x.id_seguimiento === r.id_seguimiento)
        const detalle = s ? textoSerie({ series: s.cantidad_series, repeticiones: s.cantidad_repeticiones, peso: s.peso_kilogramos === null ? null : Number(s.peso_kilogramos) })
          : formatoValor('numero', r.valor, medida?.unidad)
        return <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={nombreDe(r)} detalle={detalle} alBorrar={() => eliminarRegistro(r.id_registro).then(alCambiar)} />
      }}
    />
  )
}
