import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Selector from '../Selector'
import {
  aprenderNombre, crearEjercicio, crearMedida, crearSeguimiento, eliminarRegistro, guardarFichaEjercicio, guardarMeta, obtenerSalud, quitarEjercicio, quitarSeguimiento, registrar, registrarSeries, renombrarEjercicio, editarMedida, corregirSerie,
  type FichaEjercicio, type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor, type Direccion } from '../indicadores'
import Grafico from '../Grafico'
import { rangoCarga, useRegistrosDe, ventanaInicial, type Ventana } from '../Periodo'
import { mover, rango as rangoDe } from '../historial/periodo'
import SinDatos from '../SinDatos'
import Historial, { FilaSimple } from '../historial/Historial'
import Barras from '../finanzas/Barras'
import { normalizar } from '../finanzas/parseo'
import {
  cambioPeso, coincidencias, comparar, conPaso, conSigno, constancia, enUnidad, faltaParaMeta, fechasDeRecord, recordsSegunMeta, indicesRecord, kg, leerSerie, parecido, parteDe, pasoDe, pesoPorDia,
  PARTES, progreso, restarDias, seriesDeUltima, textoSerie, textoSeries,
  type Parte, type Sesion, type Unidad,
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
          <Gym vista="resumen" idGym={gym.id_seguimiento} metaDias={gym.meta?.valor} registros={registros.filter(r => r.id_seguimiento === gym.id_seguimiento)} alCambiar={alCambiar} alVer={setPestana}
            medidas={medidas} registrosCuerpo={registros} />
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

function Gym({ vista, idGym, metaDias, registros: delAno, enfocar, alCambiar, alVer, medidas = [], registrosCuerpo = [] }: {
  vista: 'resumen' | 'registrar'
  idGym: string; metaDias?: number; registros: RegistroGuardado[]; enfocar?: boolean; alCambiar: () => Promise<void>
  alVer?: (pestana: 'gym' | 'cuerpo' | 'historial') => void; medidas?: Seguimiento[]; registrosCuerpo?: RegistroGuardado[]
}) {
  // el Resumen abre en la semana actual; la pestaña Gym, en el mes
  const [ventana, setVentana] = useState<Ventana>(() => vista === 'resumen' ? { escala: 'semana', ancla: hoyIso() } : ventanaInicial())
  const todo = rangoCarga(ventana) === 0
  const registros = useRegistrosDe(idGym, rangoCarga(ventana), delAno) as RegistroGuardado[]
  const hoy = hoyIso()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [ejercicio, setEjercicio] = useState('')
  const autollenadas = useRef(false)
  // una fila por grupo de series iguales: cuántas, con qué peso y cuántas repeticiones
  const [filas, setFilas] = useState([{ series: '1', repeticiones: '', peso: '' }])
  // el peso se escribe en la unidad elegida y se guarda en kg; la parte se propone por el nombre hasta que la elija a mano
  const [unidad, setUnidad] = useState<Unidad>('kg')
  const [parte, setParte] = useState<Parte | ''>('')
  const parteAMano = useRef(false)
  const [pregunta, setPregunta] = useState<{ leidas: Leido[]; sugerido: string } | null>(null)
  const [aviso, setAviso] = useState('')
  const [abierto, setAbierto] = useState(!!enfocar)
  const [editando, setEditando] = useState<string | null>(null)
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null)
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      // las series acompañan a los registros cargados: el último año (con margen) o todo el historial al mirar más atrás
      setDatos(await obtenerSalud(idGym, todo ? '2000-01-01' : restarDias(hoyIso(), 370)))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [idGym, todo])
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

  const leidas = filas.map(f => leerSerie(ejercicio, f.series, f.repeticiones, f.peso, unidad))
  const unidadDe = (nombre: string): Unidad => datos?.fichas.get(nombre)?.unidad_peso ?? 'kg'
  const parteGuardada = (nombre: string) => (datos?.fichas.get(nombre)?.parte_cuerpo as Parte | null | undefined) ?? parteDe(nombre)
  const totalSeries = filas.reduce((t, f) => t + (/^\d+$/.test(f.series.trim()) ? Number(f.series) : 0), 0)
  const escrito = ejercicio.replace(/\s+/g, ' ').trim()
  const cambiarFila = (i: number, cambio: Partial<typeof filas[number]>) => { autollenadas.current = false; setFilas(filas.map((f, j) => j === i ? { ...f, ...cambio } : f)); setPregunta(null) }
  const conocidos = useMemo(() => datos?.ejercicios.map(e => e.nombre).sort((a, b) => a.localeCompare(b)) ?? [], [datos])
  const parecidos = useMemo(() => coincidencias(ejercicio, conocidos, sesiones), [ejercicio, conocidos, sesiones])
  // El nombre tal como quedó guardado, también el de un ejercicio quitado; escribirlo distinto no crea otro.
  const nombreGuardado = (texto: string) => datos && [...datos.nombres.values()].find(n => normalizar(n) === normalizar(texto))

  // al elegir un ejercicio que ya hizo, trae lo de la vez anterior para cambiar solo lo que subió
  // los 5 ejercicios más hechos en los últimos 30 días, con su última serie
  const frecuentes = useMemo(() => {
    const desde = restarDias(hoy, 30)
    const cuenta = new Map<string, { veces: number; ultima: Sesion }>()
    for (const x of sesiones) {
      if (x.fecha < desde || !conocidos.includes(x.ejercicio)) continue
      const c = cuenta.get(x.ejercicio)
      if (!c) cuenta.set(x.ejercicio, { veces: 1, ultima: x })
      else { c.veces++; if (x.fecha > c.ultima.fecha) c.ultima = x }
    }
    return [...cuenta.values()].sort((a, b) => b.veces - a.veces).slice(0, 5).map(c => c.ultima)
  }, [sesiones, hoy, conocidos])

  function elegirEjercicio(texto: string) {
    setEjercicio(texto)
    setPregunta(null)
    const nombre = normalizar(texto)
    const guardado = nombreGuardado(texto) ?? nombreGuardado(datos?.alias.get(nombre) ?? '')
    const suya = guardado ? unidadDe(guardado) : unidad
    if (guardado) { setUnidad(suya); setParte(parteGuardada(guardado) ?? ''); parteAMano.current = false }
    else if (!parteAMano.current) setParte(parteDe(texto) ?? '')
    const previas = seriesDeUltima(sesiones, guardado ?? nombre)
    if (previas.length) {
      setFilas(previas.map(p => ({ series: String(p.series), repeticiones: String(p.repeticiones), peso: p.peso === null ? '' : String(enUnidad(p.peso, suya)).replace('.', ',') })))
      autollenadas.current = true
    } else if (autollenadas.current) {
      // las series eran de otro ejercicio; lo escrito a mano no se toca
      setFilas([{ series: '1', repeticiones: '', peso: '' }])
      autollenadas.current = false
    }
  }

  // Cada fila es un registro con sus series iguales; el aviso compara el peso máximo con la sesión anterior.
  // Desde el formulario llega la ficha (parte y unidad elegidas) y el ejercicio la recuerda; "igual que la última vez" no la cambia.
  async function guardar(escrito: string, lista: Leido[], elegida?: { parte: Parte | ''; unidad: Unidad }) {
    if (!datos) return
    const nombre = nombreGuardado(escrito) ?? escrito
    const u = elegida?.unidad ?? unidadDe(nombre)
    setEnviando(true)
    try {
      const existente = datos.ejercicios.find(e => e.nombre === nombre)
      const ficha = elegida && { parte_cuerpo: elegida.parte || null, unidad_peso: elegida.unidad }
      const idEtiqueta = existente?.id_etiqueta ?? await crearEjercicio(idGym, nombre, ficha)
      if (existente && ficha && (existente.parte_cuerpo !== ficha.parte_cuerpo || (existente.unidad_peso ?? 'kg') !== ficha.unidad_peso)) await guardarFichaEjercicio(idEtiqueta, ficha)
      const antes = pesoPorDia(sesiones, nombre).filter(p => p.fecha < hoy).pop()
      await registrarSeries({ id_seguimiento: idGym, id_etiqueta: idEtiqueta, fecha: hoy }, lista)
      const hechas = lista.reduce((t, x) => t + x.series, 0)
      const pesos = lista.flatMap(x => x.peso === null ? [] : [x.peso])
      const maximo = pesos.length ? Math.max(...pesos) : null
      setAviso([
        `${nombre}: ${hechas} ${hechas === 1 ? 'serie' : 'series'} (${lista.map(x => textoSerie(x, u)).join(', ')}).`,
        maximo !== null && antes ? `Peso máximo ${kg(maximo, u)} (${conSigno(enUnidad(maximo, u) - enUnidad(antes.valor, u), u)} frente al ${diaMes(antes.fecha)}).` : '',
      ].filter(Boolean).join(' '))
      setEjercicio('')
      setFilas([{ series: '1', repeticiones: '', peso: '' }])
      autollenadas.current = false
      setUnidad('kg')
      setParte('')
      parteAMano.current = false
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
    if (leidas.some(l => !l)) return setError(`Revisa cada fila: series de 1 a 100, repeticiones de 1 a 1.000 y el peso en ${unidad} (vacío si es con tu cuerpo).`)
    if (!datos) return
    const lista = leidas as Leido[]
    const nombre = lista[0].ejercicio
    const aprendido = datos.alias.get(nombre)
    const elegida = { parte, unidad }
    if (conocidos.some(c => normalizar(c) === nombre)) return guardar(nombre, lista, elegida)
    if (aprendido) return guardar(aprendido, lista, elegida)
    const sugerido = parecido(nombre, conocidos.map(normalizar))
    const conocido = sugerido && conocidos.find(c => normalizar(c) === sugerido)
    if (conocido) return setPregunta({ leidas: lista, sugerido: conocido })
    guardar(escrito, lista, elegida)
  }

  // Se guardan como los escribe y se comparan normalizados; escribir el nombre viejo sigue llevando a este.
  async function editarEjercicio(viejo: string, nuevo: string, ficha: FichaEjercicio) {
    if (!datos) return
    const id = datos.ejercicios.find(e => e.nombre === viejo)!.id_etiqueta
    if (nuevo !== viejo) {
      if ([...datos.nombres.values()].some(n => n !== viejo && normalizar(n) === normalizar(nuevo))) throw new Error(`Ya existe un ejercicio llamado ${nuevo} (o lo tuviste antes).`)
      await renombrarEjercicio(id, viejo, nuevo)
      await aprenderNombre('ejercicio', normalizar(viejo), nuevo).catch(() => {})
    }
    await guardarFichaEjercicio(id, ficha)
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
    await guardar(correcto, pregunta.leidas, { parte, unidad })
  }

  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  if (vista === 'resumen') return (
    <ResumenSalud sesiones={sesiones} hoy={hoy} metaDias={metaDias} ejercicios={conocidos} fichas={datos.fichas} medidas={medidas}
      registros={registrosCuerpo} ventana={ventana} alCambiarVentana={setVentana} alVer={p => alVer?.(p)} />
  )
  const nombres = datos.nombres
  const deSerie = new Map(datos.series.map(x => [x.id_registro, x]))
  // un renglón por ejercicio y día (los 6 más recientes); sus series se abren para editarlas o borrarlas
  const grupos = new Map<string, { fecha: string; ejercicio: string; series: { id: string; series: number; repeticiones: number; peso: number | null }[] }>()
  for (const r of registros) {
    const x = deSerie.get(r.id_registro)
    if (!x) continue
    const clave = `${r.fecha}|${r.id_etiqueta}`
    if (!grupos.has(clave)) grupos.set(clave, { fecha: r.fecha, ejercicio: nombres.get(r.id_etiqueta ?? '') ?? 'Ejercicio', series: [] })
    // llegan de la más reciente a la más antigua: al frente para leerlas en el orden en que se hicieron
    grupos.get(clave)!.series.unshift({ id: r.id_registro, series: x.cantidad_series, repeticiones: x.cantidad_repeticiones, peso: x.peso_kilogramos === null ? null : Number(x.peso_kilogramos) })
  }
  const ultimos = [...grupos].slice(0, 6)
  const loUltimo = ultimos.length > 0 && (
    <section>
      <h2>Lo último que registraste</h2>
      <ul className="lista">
        {ultimos.map(([clave, g]) => (
          <li key={clave} className="ultimo grupo-gym">
            <span>{g.fecha.split('-').reverse().join('/')}</span>
            <strong>{g.ejercicio}</strong>
            <span className="tenue">{textoSeries(g.series, unidadDe(g.ejercicio))}</span>
            <span className="chips">
              <button className="secundario" aria-expanded={grupoAbierto === clave} onClick={() => { setGrupoAbierto(grupoAbierto === clave ? null : clave); setEditando(null) }}>
                {grupoAbierto === clave ? 'Cerrar' : 'Editar'}
              </button>
            </span>
            {grupoAbierto === clave && (
              <ul className="lista series-del-grupo">
                {g.series.map((s, i) => {
                  const actual = { ejercicio: g.ejercicio, series: s.series, repeticiones: s.repeticiones, peso: s.peso }
                  return (
                    <FilaSimple key={s.id} fecha="" titulo={`Fila ${i + 1}`} detalle={textoSerie(actual, unidadDe(g.ejercicio))}
                      alBorrar={() => eliminarRegistro(s.id).then(alCambiar)} sinAcciones={editando === s.id} alEditar={() => setEditando(s.id)}>
                      {editando === s.id && (
                        <EditarSerie actual={actual} unidad={unidadDe(g.ejercicio)} alCancelar={() => setEditando(null)}
                          alGuardar={async nueva => { await corregirSerie(s.id, nueva); setEditando(null); await Promise.all([cargar(), alCambiar()]) }} />
                      )}
                    </FilaSimple>
                  )
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
  const misEjercicios = conocidos.length > 0 && (
    <section>
      <h2>Mis ejercicios</h2>
      {[...Object.keys(PARTES) as Parte[], null].map(c => {
        const suyos = conocidos.filter(e => (parteGuardada(e) ?? null) === c)
        return suyos.length > 0 && (
          <div key={c ?? 'sin'} className="parte-cuerpo">
            <h3>{c ? PARTES[c] : 'Sin parte del cuerpo'} <span className="tenue">{suyos.length}</span></h3>
            <ul className="lista">
              {suyos.map(e => (
                <li key={e} className="dos">
                  <span>{e}{unidadDe(e) === 'lb' && <small className="tenue"> · en libras</small>}</span>
                  {renombrando !== e && (
                    <span>
                      <button className="enlace" onClick={() => setRenombrando(e)}>Editar</button>
                      {' · '}
                      <button className="enlace" onClick={() => quitar(e)}>Quitar</button>
                    </span>
                  )}
                  {renombrando === e && <EditarEjercicio nombre={e} parte={c} unidad={unidadDe(e)} alCancelar={() => setRenombrando(null)} alGuardar={(nuevo, ficha) => editarEjercicio(e, nuevo, ficha)} />}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
  if (!abierto) return (
    <>
      <section>
        <MetaGym idGym={idGym} meta={metaDias} alCambiar={alCambiar} />
      </section>
      <section>
        <button className="principal registrar-uno" onClick={() => setAbierto(true)}>+ Registrar ejercicio</button>
        {frecuentes.length > 0 && (
          <div className="sugeridos repetir-gym">
            <span className="tenue">Igual que la última vez (se guarda con un toque)</span>
            <div className="chips">
              {frecuentes.map(f => {
                const previas = seriesDeUltima(sesiones, f.ejercicio)
                return <button key={f.ejercicio} type="button" className="chip" disabled={enviando}
                  onClick={() => guardar(f.ejercicio, previas.map(p => ({ ejercicio: f.ejercicio, ...p })))}>{f.ejercicio} · {textoSeries(previas, unidadDe(f.ejercicio))}</button>
              })}
            </div>
          </div>
        )}
        {aviso && <p role="status" className="aviso">{aviso}</p>}
        {error && <p role="alert" className="error">{error}</p>}
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
          <input required maxLength={60} value={ejercicio} onChange={ev => elegirEjercicio(ev.target.value)}
            placeholder="Qué ejercicio hiciste" autoComplete="off" autoFocus={enfocar} />
          <small className="ayuda">Ej.: press banca, sentadilla, dominadas</small>
        </label>
        {parecidos.length > 0 && (
          <div className="sugeridos">
            <span className="tenue">Ya registrados</span>
            <div className="chips">
              {parecidos.map(e => <button key={e} type="button" className="chip" onClick={() => elegirEjercicio(e)}>{e}</button>)}
            </div>
          </div>
        )}
        {frecuentes.length > 0 && !ejercicio.trim() && (
          <div className="sugeridos">
            <span className="tenue">Usar otra vez (con tu última serie)</span>
            <div className="chips">
              {frecuentes.map(f => <button key={f.ejercicio} type="button" className="chip" onClick={() => elegirEjercicio(f.ejercicio)}>{f.ejercicio} · {textoSerie(f, unidadDe(f.ejercicio))}</button>)}
            </div>
          </div>
        )}
        <label>Parte del cuerpo
          <select value={parte} onChange={ev => { parteAMano.current = true; setParte(ev.target.value as Parte | '') }}>
            <option value="">Sin elegir</option>
            {Object.entries(PARTES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
        <fieldset className="series-gym">
          <legend>Series</legend>
          <div className="chips segmentado" role="radiogroup" aria-label="Unidad del peso">
            {(['kg', 'lb'] as const).map(u => (
              <button key={u} type="button" role="radio" aria-checked={unidad === u} className="chip" onClick={() => { setUnidad(u); setPregunta(null) }}>{u === 'kg' ? 'Kilos' : 'Libras'}</button>
            ))}
          </div>
          {filas.map((f, i) => (
            <div key={i} className="serie-fila">
              <Pasos titulo="Series" que={`series de la fila ${i + 1}`} alSumar={paso => cambiarFila(i, { series: conPaso(f.series, paso, 1) })}>
                <input required inputMode="numeric" maxLength={3} value={f.series} aria-label={`Cuántas series iguales en la fila ${i + 1}`}
                  onChange={ev => cambiarFila(i, { series: ev.target.value })} />
              </Pasos>
              <Pasos titulo="Repeticiones" que={`repeticiones de la fila ${i + 1}`} alSumar={paso => cambiarFila(i, { repeticiones: conPaso(f.repeticiones, paso, 1) })}>
                <input required inputMode="numeric" maxLength={4} value={f.repeticiones} placeholder="Reps" aria-label={`Repeticiones de la fila ${i + 1}`}
                  onChange={ev => cambiarFila(i, { repeticiones: ev.target.value })} />
              </Pasos>
              <Pasos titulo={`Peso (${unidad})`} que={`peso de la fila ${i + 1}`} alSumar={paso => cambiarFila(i, { peso: conPaso(f.peso, paso * pasoDe(unidad), 0) })}>
                <input inputMode="decimal" maxLength={8} value={f.peso} placeholder="Peso de la máquina" aria-label={`Peso de la fila ${i + 1}`}
                  onChange={ev => cambiarFila(i, { peso: ev.target.value })} />
              </Pasos>
              {filas.length > 1 && <button type="button" className="quitar" aria-label={`Quitar la fila ${i + 1}`}
                onClick={() => { autollenadas.current = false; setFilas(filas.filter((_, j) => j !== i)); setPregunta(null) }}>✕</button>}
            </div>
          ))}
          <button type="button" className="secundario" disabled={filas.length >= 30}
            onClick={() => { autollenadas.current = false; setFilas([...filas, { ...filas[filas.length - 1], series: '1' }]); setPregunta(null) }}>+ Serie distinta</button>
          <small className="ayuda">Si todas salieron iguales, una sola fila: 4 series, {unidad === 'lb' ? '135 lb' : '60 kg'}, 10 reps. Si alguna varió, "+ Serie distinta" copia la anterior para que cambies solo eso. Con − y + el peso va de {unidad === 'lb' ? '5 en 5' : '2,5 en 2,5'}; vacío es con tu cuerpo. El ejercicio recuerda si lo registras en kilos o en libras.</small>
        </fieldset>
        {pregunta ? (
          <div className="chips" role="group" aria-label="¿Quisiste decir…?">
            <span>¿Quisiste decir <strong>{pregunta.sugerido}</strong>?</span>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.sugerido)}>Sí</button>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(escrito)}>No, es nuevo</button>
          </div>
        ) : <button className="principal" disabled={enviando}>
          Guardar {totalSeries || ''} {totalSeries === 1 ? 'serie' : 'series'}
        </button>}
        {aviso && <p role="status" className="aviso">{aviso}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </form>
      {loUltimo}
      {misEjercicios}
    </>
  )
}

// Un campo de la fila con − y + a los lados, para no abrir el teclado en el gimnasio.
function Pasos({ titulo, que, alSumar, children }: { titulo: string; que: string; alSumar: (paso: 1 | -1) => void; children: ReactNode }) {
  return (
    <div className="campo-pasos">
      <span aria-hidden="true">{titulo}</span>
      <div className="pasos">
        <button type="button" aria-label={`Menos ${que}`} onClick={() => alSumar(-1)}>−</button>
        {children}
        <button type="button" aria-label={`Más ${que}`} onClick={() => alSumar(1)}>+</button>
      </div>
    </div>
  )
}

// Corrige series, repeticiones y kilos; se valida igual que al registrar.
// Nombre, parte del cuerpo y unidad de un ejercicio; cambiar la unidad no toca lo guardado, solo cómo se escribe y se lee.
function EditarEjercicio({ nombre, parte, unidad, alGuardar, alCancelar }: {
  nombre: string; parte: Parte | null; unidad: Unidad; alGuardar: (nombre: string, ficha: FichaEjercicio) => Promise<void>; alCancelar: () => void
}) {
  const [campos, setCampos] = useState({ nombre, parte: parte ?? '', unidad })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const nuevo = campos.nombre.replace(/\s+/g, ' ').trim()
    if (!nuevo) return setError('Escribe el nombre del ejercicio.')
    setEnviando(true)
    try {
      await alGuardar(nuevo, { parte_cuerpo: campos.parte || null, unidad_peso: campos.unidad })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="formulario corregir" onSubmit={guardar}>
      <label>Nombre
        <input required maxLength={60} value={campos.nombre} autoComplete="off" autoFocus onChange={ev => setCampos({ ...campos, nombre: ev.target.value })} />
      </label>
      <div className="campos">
        <label>Parte del cuerpo
          <select value={campos.parte} onChange={ev => setCampos({ ...campos, parte: ev.target.value })}>
            <option value="">Sin elegir</option>
            {Object.entries(PARTES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
        <label>Peso en
          <select value={campos.unidad} onChange={ev => setCampos({ ...campos, unidad: ev.target.value as Unidad })}>
            <option value="kg">Kilos</option>
            <option value="lb">Libras</option>
          </select>
        </label>
      </div>
      <div className="chips">
        <button className="principal" disabled={enviando}>Guardar</button>
        <button type="button" className="secundario" onClick={alCancelar}>Cancelar</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

function EditarSerie({ actual, unidad, alGuardar, alCancelar }: {
  actual: Omit<Sesion, 'fecha'>; unidad: Unidad; alGuardar: (s: Omit<Sesion, 'fecha'>) => Promise<void>; alCancelar: () => void
}) {
  const [campos, setCampos] = useState({ series: String(actual.series), repeticiones: String(actual.repeticiones), peso: actual.peso === null ? '' : String(enUnidad(actual.peso, unidad)).replace('.', ',') })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const s = leerSerie(actual.ejercicio, campos.series, campos.repeticiones, campos.peso, unidad)
    if (!s) return setError(`Revisa: series de 1 a 100, repeticiones de 1 a 1.000 y el peso en ${unidad} (vacío si es con tu cuerpo).`)
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
    <form className="formulario corregir" onSubmit={guardar}>
      <div className="campos campos-serie">
        <label>Series<input required inputMode="numeric" maxLength={3} value={campos.series} onChange={ev => setCampos({ ...campos, series: ev.target.value })} /></label>
        <label>Repeticiones<input required inputMode="numeric" maxLength={4} value={campos.repeticiones} onChange={ev => setCampos({ ...campos, repeticiones: ev.target.value })} /></label>
        <label>{unidad === 'lb' ? 'Libras' : 'Kilos'}<input inputMode="decimal" maxLength={8} value={campos.peso} placeholder="Peso de la máquina" onChange={ev => setCampos({ ...campos, peso: ev.target.value })} /></label>
      </div>
      <div className="chips">
        <button className="principal" disabled={enviando}>Guardar</button>
        <button type="button" className="secundario" onClick={alCancelar}>Cancelar</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const decimal = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 1 })
// "esta semana", "la semana del 20/10", "en octubre", "en 2025": va en las cifras de cada bloque.
function enPeriodo(ventana: Ventana, hoy: string) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  if (ventana.escala === 'semana') return r.desde <= hoy && hoy <= r.hasta ? 'esta semana' : `la ${r.titulo.toLowerCase()}`
  if (ventana.escala === 'mes') return `en ${r.desde.slice(0, 4) === hoy.slice(0, 4) ? r.titulo.split(' ')[0] : r.titulo}`
  return `en ${r.titulo}`
}

// Igual al panel del Resumen de Finanzas: atajos, otro mes o año con datos, ◀ ▶ y aviso para volver.
function PanelSalud({ ventana, alCambiar, hoy, fechas }: { ventana: Ventana; alCambiar: (v: Ventana) => void; hoy: string; fechas: string[] }) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  const atajos: [Ventana, string][] = [
    [{ escala: 'semana', ancla: hoy }, 'Esta semana'], [{ escala: 'semana', ancla: restarDias(hoy, 7) }, 'Semana pasada'],
    [{ escala: 'mes', ancla: hoy }, 'Este mes'], [{ escala: 'ano', ancla: hoy }, 'Este año'],
  ]
  const es = (v: Ventana) => v.escala === ventana.escala && rangoDe(v.escala, v.ancla).desde === r.desde
  const meses = [...new Set(fechas.filter(f => f <= hoy).map(f => f.slice(0, 7)))].sort().reverse()
  const anos = [...new Set(meses.map(m => m.slice(0, 4)))]
  const primero = fechas.reduce((a, f) => f < a ? f : a, hoy)
  const elegido = atajos.some(([v]) => es(v)) || ventana.escala === 'semana' ? '' : ventana.escala === 'ano' ? r.desde.slice(0, 4) : r.desde.slice(0, 7)
  const actual = ventana.escala === 'semana' && r.desde <= hoy && hoy <= r.hasta
  const nombre = ventana.escala === 'semana' ? `la ${r.titulo.toLowerCase()}` : ventana.escala === 'mes' ? r.titulo : `todo ${r.titulo}`
  return (
    <div className="panel-periodo">
      <span className="etiqueta">Período</span>
      <div className="fila-filtros">
        <div className="chips segmentado" role="radiogroup" aria-label="Período del resumen">
          {atajos.map(([v, texto]) => (
            <button key={texto} type="button" role="radio" aria-checked={es(v)} className="chip" onClick={() => alCambiar(v)}>{texto}</button>
          ))}
        </div>
        <Selector id="filtro-periodo-salud" titulo="Otro mes o año" icono="📅" valor={elegido}
          alCambiar={v => v && alCambiar(v.length === 4 ? { escala: 'ano', ancla: `${v}-01-01` } : { escala: 'mes', ancla: `${v}-01` })}>
          <option value="">Elegir…</option>
          {anos.map(a => (
            <optgroup key={a} label={a}>
              <option value={a}>Todo {a}</option>
              {meses.filter(m => m.startsWith(a)).map(m => <option key={m} value={m}>{MESES_LARGOS[Number(m.slice(5, 7)) - 1]} de {a}</option>)}
            </optgroup>
          ))}
        </Selector>
      </div>
      {ventana.escala !== 'ano' && (
        <div className="periodo">
          <button className="secundario" aria-label="Período anterior" disabled={r.desde <= primero} onClick={() => alCambiar({ ...ventana, ancla: mover(ventana.escala, ventana.ancla, -1) })}>◀</button>
          <strong>{r.titulo}</strong>
          <button className="secundario" aria-label="Período siguiente" disabled={r.hasta >= hoy} onClick={() => alCambiar({ ...ventana, ancla: mover(ventana.escala, ventana.ancla, 1) })}>▶</button>
        </div>
      )}
      {!actual && (
        <p role="status" className="aviso">Estás viendo {nombre}. <button className="enlace" onClick={() => alCambiar({ escala: 'semana', ancla: hoy })}>Volver a esta semana</button></p>
      )}
    </div>
  )
}

// Todo lo de Salud que se mira vive aquí; las pestañas Gym y Cuerpo son para registrar y corregir.
function ResumenSalud({ sesiones, hoy, metaDias, ejercicios, fichas, medidas, registros, ventana, alCambiarVentana, alVer }: {
  sesiones: Sesion[]; hoy: string; metaDias?: number; ejercicios: string[]; fichas: Datos['fichas']; medidas: Seguimiento[]; registros: RegistroGuardado[]
  ventana: Ventana; alCambiarVentana: (v: Ventana) => void; alVer: (pestana: 'gym' | 'cuerpo' | 'historial') => void
}) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  const records = useMemo(() => fechasDeRecord(sesiones), [sesiones])
  const enRango = sesiones.filter(s => s.fecha >= r.desde && s.fecha <= r.hasta && s.fecha <= hoy)
  const dias = new Set(enRango.map(s => s.fecha)).size
  const series = enRango.reduce((t, s) => t + s.series, 0)
  const recordsEnRango = records.filter(f => f >= r.desde && f <= r.hasta).length
  const cuando = enPeriodo(ventana, hoy)
  const peso = medidas.find(m => normalizar(m.nombre) === 'peso')
  const ultimoPeso = peso && registros.filter(x => x.id_seguimiento === peso.id_seguimiento).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
  const meta = ventana.escala === 'semana' ? metaDias : undefined
  const volver = { texto: 'Volver a esta semana', hacer: () => alCambiarVentana({ escala: 'semana', ancla: hoy }) }
  return (
    <>
      <PanelSalud ventana={ventana} alCambiar={alCambiarVentana} hoy={hoy} fechas={[...sesiones.map(s => s.fecha), ...registros.map(x => x.fecha)]} />
      {!sesiones.length ? (
        <SinDatos titulo="Aún no registras ejercicios" detalle="Cuando registres tu primer ejercicio en Gym, aquí verás tu constancia y tu progreso."
          acciones={[{ texto: '+ Registrar ejercicio', hacer: () => alVer('gym') }]} />
      ) : !dias ? (
        <SinDatos titulo={`No entrenaste ${cuando}`} detalle="No registraste ejercicios en ese período."
          acciones={[volver, { texto: '+ Registrar ejercicio', hacer: () => alVer('gym') }]} />
      ) : (
        <>
          <section className="resumen-finanzas" aria-label="Días entrenados">
            <div>
              <p className="tenue">Días entrenados {cuando}</p>
              <span className="cifra">{dias}{meta ? ` de ${meta}` : ''}</span>
              {meta && dias >= meta && <span className="estado en-meta">✓ Cumpliste tu meta</span>}
              <p className="tenue">{[`${series} ${series === 1 ? 'serie' : 'series'}`, `${recordsEnRango} ${recordsEnRango === 1 ? 'récord' : 'récords'}`,
                ultimoPeso && peso && `Peso ${formatoValor('numero', ultimoPeso.valor, peso.unidad)}`].filter(Boolean).join(' · ')}</p>
            </div>
          </section>
          <Constancia sesiones={sesiones} hoy={hoy} ventana={ventana} alVer={() => alVer('gym')} />
          <Progreso sesiones={sesiones} hoy={hoy} ejercicios={ejercicios} fichas={fichas} ventana={ventana} alVer={() => alVer('historial')} />
        </>
      )}
      <CuerpoHoy medidas={medidas} registros={registros} ventana={ventana} hoy={hoy} alVer={() => alVer('cuerpo')} />
      {sesiones.length > 0 && <Impacto sesiones={sesiones} hoy={hoy} metaDias={metaDias} />}
    </>
  )
}

// Una barra por día (semana), por semana (mes) o por mes (año) con las series hechas. Sin leyenda ni línea de meta.
function Constancia({ sesiones, hoy, ventana, alVer }: { sesiones: Sesion[]; hoy: string; ventana: Ventana; alVer: () => void }) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  const grupos = useMemo(() => {
    const todos = constancia(sesiones, ventana.escala, r.desde, r.hasta, hoy)
    // año en celular: los últimos 6 meses que ya empezaron
    return ventana.escala === 'ano' && matchMedia('(max-width: 560px)').matches ? todos.filter(g => !g.futuro).slice(-6) : todos
  }, [sesiones, ventana.escala, r.desde, r.hasta, hoy])
  const total = sesiones.filter(s => s.fecha >= r.desde && s.fecha <= r.hasta && s.fecha <= hoy).reduce((t, s) => t + s.series, 0)
  const etiquetas = grupos.map((g, i) => ventana.escala === 'semana' ? 'LMXJVSD'[i] : ventana.escala === 'mes' ? diaMes(g.desde) : MESES[Number(g.desde.slice(5, 7)) - 1])
  const titulos = grupos.map((g, i) => ventana.escala === 'semana' ? g.desde.split('-').reverse().join('/') : ventana.escala === 'mes' ? `Semana del ${etiquetas[i]}` : `${etiquetas[i]} ${g.desde.slice(0, 4)}`)
  const series = useMemo(() => [{ nombre: 'Series', color: cssVar('--c1'),
    datos: grupos.map(g => g.futuro ? null : sesiones.filter(s => s.fecha >= g.desde && s.fecha <= g.hasta).reduce((t, s) => t + s.series, 0)) }], [grupos, sesiones])
  const nSeries = (v: number) => `${Math.round(v)} ${Math.round(v) === 1 ? 'serie' : 'series'}`
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cuánto entrené?</h2><button className="enlace" onClick={alVer}>Ver →</button></div>
      <p><strong className="cifra-media">{total}</strong> <span className="tenue">{total === 1 ? 'serie' : 'series'} {enPeriodo(ventana, hoy)}</span></p>
      <Barras etiquetas={etiquetas} series={series} leyenda={false} dias={{ titulos }}
        formato={nSeries} formatoEje={v => `${v}`} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion={`Series por ${ventana.escala === 'semana' ? 'día' : ventana.escala === 'mes' ? 'semana' : 'mes'} (${r.titulo}): ${series[0].datos.map((v, i) => v === null ? '' : `${etiquetas[i]} ${v}`).filter(Boolean).join(', ')}`} />
    </section>
  )
}

// Una cosa frente a otra: récords por semana cuando se cumple la meta de días y cuando no. No sigue al filtro.
function Impacto({ sesiones, hoy, metaDias }: { sesiones: Sesion[]; hoy: string; metaDias?: number }) {
  const r = useMemo(() => recordsSegunMeta(sesiones, hoy, metaDias ?? null), [sesiones, hoy, metaDias])
  const cumple = metaDias ? 'cuando cumples tu meta' : `con ${r.umbral} ${r.umbral === 1 ? 'día' : 'días'} o más`
  const etiquetas = [metaDias ? `Cumpliste (${r.cumplidas.semanas} sem.)` : `${r.umbral}+ días (${r.cumplidas.semanas} sem.)`,
    metaDias ? `No cumpliste (${r.otras.semanas} sem.)` : `Menos (${r.otras.semanas} sem.)`]
  const series = useMemo(() => [{ nombre: 'Récords por semana', datos: [r.cumplidas.promedio, r.otras.promedio], color: cssVar('--c1') }], [r])
  return (
    <section>
      <h2>¿Cumplir me hace más fuerte?</h2>
      {r.cumplidas.semanas < 2 || r.otras.semanas < 2 ? (
        <p className="tenue">Aún faltan semanas para comparar: hacen falta al menos 2 semanas {cumple} y 2 sin cumplir en las últimas 12.</p>
      ) : (
        <>
          <p><strong className="cifra-media">{decimal(r.cumplidas.promedio)}</strong> <span className="tenue">récords por semana {cumple} · {decimal(r.otras.promedio)} cuando no · últimas 12 semanas</span></p>
          <Barras etiquetas={etiquetas} series={series} horizontal leyenda={false}
            formato={v => `${decimal(v)} ${v === 1 ? 'récord' : 'récords'} por semana`} formatoEje={decimal}
            colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
            descripcion={`Récords por semana en las últimas 12 semanas: ${etiquetas[0]} ${decimal(r.cumplidas.promedio)}, ${etiquetas[1]} ${decimal(r.otras.promedio)}`} />
        </>
      )}
    </section>
  )
}

// La medida elegida en el período, con su meta punteada; debajo, el último valor de las demás.
function CuerpoHoy({ medidas, registros, ventana, hoy, alVer }: { medidas: Seguimiento[]; registros: RegistroGuardado[]; ventana: Ventana; hoy: string; alVer: () => void }) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  const [elegida, setElegida] = useState('')
  const conDatos = medidas.filter(m => registros.some(x => x.id_seguimiento === m.id_seguimiento))
  const actual = conDatos.find(m => m.id_seguimiento === elegida) ?? conDatos.find(m => normalizar(m.nombre) === 'peso') ?? conDatos[0]
  const puntos = useMemo(() => !actual ? [] : registros.filter(x => x.id_seguimiento === actual.id_seguimiento && x.fecha >= r.desde && x.fecha <= r.hasta)
    .map(x => ({ fecha: x.fecha, valor: x.valor })).sort((a, b) => a.fecha.localeCompare(b.fecha)), [registros, actual, r.desde, r.hasta])
  if (!medidas.length) return null
  const ultimoDe = (m: Seguimiento) => registros.filter(x => x.id_seguimiento === m.id_seguimiento).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
  const metaTexto = (m: Seguimiento, valor: number) => m.meta && (faltaParaMeta(valor, m.meta.valor, m.meta.direccion)
    ? `faltan ${formatoValor('numero', faltaParaMeta(valor, m.meta.valor, m.meta.direccion), m.unidad)}` : '✓ meta cumplida')
  const cuando = enPeriodo(ventana, hoy)
  const ultimo = actual && ultimoDe(actual)
  const cambio = cambioPeso(puntos)
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cómo va mi cuerpo?</h2><button className="enlace" onClick={alVer}>Ver →</button></div>
      {!actual || !ultimo ? (
        <SinDatos titulo="Aún no registras medidas" detalle="Registra tu peso u otra medida en Cuerpo para ver cómo cambia." acciones={[{ texto: '+ Registrar medida', hacer: alVer }]} />
      ) : (
        <>
          {conDatos.length > 1 && (
            <Selector id="filtro-medida" titulo="Medida" icono="📏" valor={actual.id_seguimiento} alCambiar={setElegida}>
              {conDatos.map(m => <option key={m.id_seguimiento} value={m.id_seguimiento}>{m.nombre}</option>)}
            </Selector>
          )}
          <p><strong className="cifra-media">{formatoValor('numero', ultimo.valor, actual.unidad)}</strong> <span className="tenue">
            {[cambio !== null && `${conSigno(cambio, actual.unidad)} ${cuando}`, metaTexto(actual, ultimo.valor)].filter(Boolean).join(' · ') || `${actual.nombre} el ${diaMes(ultimo.fecha)}`}</span></p>
          {puntos.length > 0 ? (
            <Grafico puntos={puntos} meta={actual.meta?.valor} color={cssVar('--c1')} colorMeta={cssVar('--tenue')}
              formato={v => formatoValor('numero', v, actual.unidad)} etiquetaMeta={actual.meta ? `Meta ${formatoValor('numero', actual.meta.valor, actual.unidad)}` : undefined}
              desde={r.desde} hasta={r.hasta} descripcion={`${actual.nombre} ${cuando}${actual.meta ? '; la línea punteada es la meta' : ''}`} />
          ) : <p className="tenue">Sin registros de {actual.nombre.toLowerCase()} {cuando}.</p>}
        </>
      )}
      {medidas.filter(m => m !== actual).length > 0 && (
        <ul className="lista">
          {medidas.filter(m => m !== actual).map(m => {
            const u = ultimoDe(m)
            return (
              <li key={m.id_seguimiento} className="dos medida-hoy">
                <span>{m.nombre}{u && m.meta && <span className="tenue">{metaTexto(m, u.valor)}</span>}</span>
                {u ? <strong>{formatoValor('numero', u.valor, m.unidad)}</strong> : <button className="enlace" onClick={alVer}>Registrar</button>}
              </li>
            )
          })}
        </ul>
      )}
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

const TODOS = '*'
function Progreso({ sesiones, hoy, ejercicios, fichas, ventana, alVer }: { sesiones: Sesion[]; hoy: string; ejercicios: string[]; fichas: Datos['fichas']; ventana: Ventana; alVer: () => void }) {
  const r = rangoDe(ventana.escala, ventana.ancla)
  const [elegido, setElegido] = useState('')
  // abre en el último ejercicio entrenado (las sesiones llegan de la más reciente a la más antigua)
  const todos = elegido === TODOS
  const actual = ejercicios.includes(elegido) ? elegido : sesiones.find(s => ejercicios.includes(s.ejercicio))?.ejercicio ?? ejercicios[0]
  const p = useMemo(() => actual ? progreso(sesiones, actual) : null, [sesiones, actual])
  const puntos = useMemo(() => actual ? pesoPorDia(sesiones, actual, r.desde).filter(p => p.fecha <= r.hasta) : [], [sesiones, actual, r.desde, r.hasta])
  const records = useMemo(() => ({ indices: indicesRecord(puntos), texto: 'récord' }), [puntos])
  // Todos: cambio de cada ejercicio con 2 días o más con peso en el período, de mayor a menor
  const cambios = useMemo(() => !todos ? [] : ejercicios
    .map(e => ({ ejercicio: e, cambio: cambioPeso(pesoPorDia(sesiones, e, r.desde).filter(p => p.fecha <= r.hasta)) }))
    .filter((c): c is { ejercicio: string; cambio: number } => c.cambio !== null).sort((a, b) => b.cambio - a.cambio), [todos, ejercicios, sesiones, r.desde, r.hasta])
  const seriesTodos = useMemo(() => [{ nombre: 'Cambio de peso', datos: cambios.map(c => c.cambio), color: cssVar('--c1') }], [cambios])
  if (!actual || !p) return null
  const cambio = cambioPeso(puntos)
  const cuando = enPeriodo(ventana, hoy)
  // un ejercicio se lee en su unidad; "Todos" compara en kg, que es como se guarda
  const u: Unidad = fichas.get(actual)?.unidad_peso ?? 'kg'
  const record = p.record !== null ? ` · récord ${kg(p.record, u)}` : ''
  const partes = [...Object.keys(PARTES) as Parte[], null].map(c => ({ parte: c, suyos: ejercicios.filter(e => ((fichas.get(e)?.parte_cuerpo as Parte | null | undefined) ?? parteDe(e)) === c) })).filter(g => g.suyos.length)
  const subieron = cambios.filter(c => c.cambio > 0).length
  return (
    <section>
      <div className="bloque-pie"><h2>¿Estoy subiendo de peso?</h2><button className="enlace" onClick={alVer}>Ver →</button></div>
      <Selector id="filtro-ejercicio" titulo="Ejercicio" icono="🏋️" valor={todos ? TODOS : actual} alCambiar={setElegido}>
        <option value={TODOS}>Todos</option>
        {partes.map(g => (
          <optgroup key={g.parte ?? 'sin'} label={g.parte ? PARTES[g.parte] : 'Sin parte del cuerpo'}>
            {g.suyos.map(e => <option key={e}>{e}</option>)}
          </optgroup>
        ))}
      </Selector>
      {todos ? (cambios.length ? (
        <>
          <p>Subiste en <strong className="cifra-media">{subieron}</strong> <span className="tenue">de {cambios.length} {cambios.length === 1 ? 'ejercicio' : 'ejercicios'} {cuando}</span></p>
          <Barras etiquetas={cambios.map(c => c.ejercicio)} series={seriesTodos} horizontal leyenda={false}
            formato={v => conSigno(v, 'kg')} formatoEje={v => `${v}`} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
            descripcion={`Cambio del mejor peso ${cuando}: ${cambios.map(c => `${c.ejercicio} ${conSigno(c.cambio, 'kg')}`).join(', ')}`} />
        </>
      ) : <p className="tenue">Pocos registros con peso {cuando}: hacen falta 2 días con peso en un mismo ejercicio.</p>) : (
        <>
          {cambio !== null
            ? <p><strong className="cifra-media">{conSigno(enUnidad(puntos[puntos.length - 1].valor, u) - enUnidad(puntos[0].valor, u), u)}</strong> <span className="tenue">{cuando}{record}</span></p>
            : <p className="tenue">Pocos registros con peso {cuando}{record}.</p>}
          {puntos.length > 0 && (
            <Grafico puntos={puntos} color={cssVar('--c1')} colorMeta={cssVar('--tenue')} formato={v => kg(v, u)} destacados={records} desde={r.desde} hasta={r.hasta}
              descripcion={`Mayor peso de cada día en ${actual}; los puntos grandes son cada récord nuevo`} />
          )}
        </>
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
  const [editando, setEditando] = useState(false)
  const rango = normalizar(nombre) === 'peso' ? [20, 400] : [0.1, 1000]
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
  const unidadDe = (idEtiqueta: string | null): Unidad => datos.fichas.get(ejercicios.get(idEtiqueta ?? '') ?? '')?.unidad_peso ?? 'kg'
  const parteDeRegistro = (r: RegistroGuardado) => {
    const nombre = r.id_seguimiento === gym.id_seguimiento ? ejercicios.get(r.id_etiqueta ?? '') : undefined
    return nombre ? (datos.fichas.get(nombre)?.parte_cuerpo ?? parteDe(nombre) ?? '') : ''
  }
  const nombreDe = (r: RegistroGuardado) => r.id_seguimiento === gym.id_seguimiento
    ? ejercicios.get(r.id_etiqueta ?? '') ?? 'Ejercicio'
    : seguimientos.find(s => s.id_seguimiento === r.id_seguimiento)?.nombre ?? ''
  return (
    <Historial
      ids={seguimientos.map(s => s.id_seguimiento)}
      registros={registros}
      filtros={[
        { nombre: 'Tipo', opciones: seguimientos.map(s => [s.id_seguimiento, s.nombre] as [string, string]), de: r => r.id_seguimiento },
        { nombre: 'Parte del cuerpo', opciones: Object.entries(PARTES), de: parteDeRegistro },
        { nombre: 'Ejercicio', opciones: [...ejercicios].sort((a, b) => a[1].localeCompare(b[1])), de: r => r.id_etiqueta ?? '' },
      ]}
      suma={false}
      vista={elegidos => {
        const medida = medidas.find(m => m.id_seguimiento === elegidos.Tipo)
        if (elegidos.Ejercicio) return { modo: 'maximo', pregunta: `Peso máximo en ${ejercicios.get(elegidos.Ejercicio) ?? 'el ejercicio'}`, formato: (v: number) => kg(v, unidadDe(elegidos.Ejercicio)) }
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
        const detalle = s ? textoSerie({ series: s.cantidad_series, repeticiones: s.cantidad_repeticiones, peso: s.peso_kilogramos === null ? null : Number(s.peso_kilogramos) }, unidadDe(r.id_etiqueta))
          : formatoValor('numero', r.valor, medida?.unidad)
        return <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={nombreDe(r)} detalle={detalle} alBorrar={() => eliminarRegistro(r.id_registro).then(alCambiar)} />
      }}
    />
  )
}
