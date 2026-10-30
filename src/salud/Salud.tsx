import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Selector from '../Selector'
import {
  aprenderNombre, crearEjercicio, crearMedida, crearSeguimiento, eliminarRegistro, guardarMeta, obtenerSalud, quitarSeguimiento, registrar, registrarSerie, renombrarEjercicio, renombrarMedida, corregirSerie,
  type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor, type Direccion } from '../indicadores'
import Grafico from '../Grafico'
import Periodo, { desdeRango, useRegistrosDe, type Rango } from '../Periodo'
import SinDatos from '../SinDatos'
import Historial, { FilaSimple } from '../historial/Historial'
import Barras from '../finanzas/Barras'
import CambiarNombre from '../CambiarNombre'
import { normalizar } from '../finanzas/parseo'
import {
  anteriorDe, comparar, conSigno, diasPorSemana, faltaParaMeta, estadoSemana, indicesRecord, kg, leerSerie, metaSemanal, parecido, pesoPorDia,
  progreso, restarDias, sugerencia,
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
// Gym y Peso se recrean si faltan (el inicio los usa); Cintura se puede dejar de medir.
const SIEMPRE = INICIALES.filter(i => i.nombre !== 'Cintura')

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
          <Gym vista="resumen" idGym={gym.id_seguimiento} metaDias={gym.meta?.valor} registros={registros.filter(r => r.id_seguimiento === gym.id_seguimiento)} alCambiar={alCambiar} />
          <CuerpoHoy medidas={medidas} registros={registros} alVer={() => setPestana('cuerpo')} />
        </>
      )}
      {gym && pestana === 'gym' && (
        <Gym vista="registrar" idGym={gym.id_seguimiento} registros={registros.filter(r => r.id_seguimiento === gym.id_seguimiento)} enfocar={abrir === 'ejercicio'} alCambiar={alCambiar} />
      )}
      {gym && pestana === 'historial' && <HistorialSalud gym={gym} medidas={medidas} registros={registros} alCambiar={alCambiar} />}
      {pestana === 'cuerpo' && (
        <>
          {medidas.map(m => (
            <Medida key={m.id_seguimiento} medida={m} registros={registros.filter(r => r.id_seguimiento === m.id_seguimiento)} alCambiar={alCambiar} />
          ))}
          <NuevaMedida inicial={abrir === 'medida'} alCrear={async (nombre, unidad) => {
            await crearMedida(nombre, unidad)
            await alCambiar()
          }} />
        </>
      )}
    </>
  )
}

function Gym({ vista, idGym, metaDias, registros: delAno, enfocar, alCambiar }: {
  vista: 'resumen' | 'registrar'
  idGym: string; metaDias?: number; registros: RegistroGuardado[]; enfocar?: boolean; alCambiar: () => Promise<void>
}) {
  const [rango, setRango] = useState<Rango>(90)
  const registros = useRegistrosDe(idGym, rango, delAno) as RegistroGuardado[]
  const hoy = hoyIso()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [ejercicio, setEjercicio] = useState('')
  const [campos, setCampos] = useState({ series: '', repeticiones: '', peso: '' })
  const [pregunta, setPregunta] = useState<{ leido: Leido; sugerido: string } | null>(null)
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

  const leido = leerSerie(ejercicio, campos.series, campos.repeticiones, campos.peso)
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
    const anterior = anteriorDe(sesiones, datos?.alias.get(nombre) ?? nombre)
    if (anterior) setCampos({ series: String(anterior.series), repeticiones: String(anterior.repeticiones), peso: anterior.peso === null ? '' : String(anterior.peso).replace('.', ',') })
  }

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
      setEjercicio('')
      setCampos({ series: '', repeticiones: '', peso: '' })
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
    if (!leido) return setError('Revisa los campos: series de 1 a 100, repeticiones de 1 a 1.000 y el peso en kg (vacío si es con tu cuerpo).')
    if (!datos) return
    const aprendido = datos.alias.get(leido.ejercicio)
    if (conocidos.includes(leido.ejercicio)) return guardar(leido)
    if (aprendido) return guardar({ ...leido, ejercicio: aprendido })
    const sugerido = parecido(leido.ejercicio, conocidos)
    if (sugerido) return setPregunta({ leido, sugerido })
    guardar(leido)
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

  async function responder(correcto: string) {
    if (!pregunta) return
    await aprenderNombre('ejercicio', pregunta.leido.ejercicio, correcto).catch(() => {})
    await guardar({ ...pregunta.leido, ejercicio: correcto })
  }

  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  if (vista === 'resumen') return !sesiones.length ? (
    <SinDatos titulo="Aún no registras ejercicios" detalle="Cuando registres tu primer ejercicio en Gym, aquí verás tu constancia y tu progreso." />
  ) : (
    <>
      <Constancia sesiones={sesiones} hoy={hoy} idGym={idGym} metaDias={metaDias} alCambiar={alCambiar} />
      <Progreso sesiones={sesiones} ejercicios={datos.ejercicios.map(e => e.nombre).sort()} hoy={hoy} rango={rango} alCambiarRango={setRango} />
    </>
  )
  const nombres = new Map(datos.ejercicios.map(e => [e.id_etiqueta, e.nombre]))
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
            <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={actual.ejercicio} detalle={serie(actual)}
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
            <button className="enlace" aria-expanded={renombrando === e} onClick={() => setRenombrando(renombrando === e ? null : e)}>Renombrar</button>
            {renombrando === e && <CambiarNombre inicial={e} alCancelar={() => setRenombrando(null)} alGuardar={nuevo => renombrar(e, nuevo)} />}
          </li>
        ))}
      </ul>
    </section>
  )
  if (!abierto) return (
    <>
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
              {frecuentes.map(f => <button key={f.ejercicio} type="button" className="chip" onClick={() => elegirEjercicio(f.ejercicio)}>{f.ejercicio} · {serie(f)}</button>)}
            </div>
          </div>
        )}
        <div className="campos">
          <label>Series
            <input required inputMode="numeric" maxLength={3} value={campos.series} placeholder="Cuántas series" aria-describedby="ayuda-serie"
              onChange={ev => { setCampos({ ...campos, series: ev.target.value }); setPregunta(null) }} />
          </label>
          <label>Repeticiones
            <input required inputMode="numeric" maxLength={4} value={campos.repeticiones} placeholder="Cuántas por serie" aria-describedby="ayuda-serie"
              onChange={ev => { setCampos({ ...campos, repeticiones: ev.target.value }); setPregunta(null) }} />
          </label>
          <label>Peso (kg)
            <input inputMode="decimal" maxLength={8} value={campos.peso} placeholder="Kilos (vacío = tu cuerpo)" aria-describedby="ayuda-serie"
              onChange={ev => { setCampos({ ...campos, peso: ev.target.value }); setPregunta(null) }} />
          </label>
        </div>
        <small id="ayuda-serie" className="ayuda">Ej.: 4 series de 10 repeticiones con 60 kg (o 82,5). Peso vacío si es con tu cuerpo.</small>
        {pregunta ? (
          <div className="chips" role="group" aria-label="¿Quisiste decir…?">
            <span>¿Quisiste decir <strong>{pregunta.sugerido}</strong>?</span>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.sugerido)}>Sí</button>
            <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.leido.ejercicio)}>No, es nuevo</button>
          </div>
        ) : <button className="principal" disabled={enviando}>
          Guardar {campos.series && campos.repeticiones ? `${campos.series} × ${campos.repeticiones}${campos.peso ? ` con ${campos.peso} kg` : ''}` : 'ejercicio'}
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

// El gráfico de cada medida vive en la pestaña Cuerpo; aquí, lo último con su cambio y lo que falta para la meta.
function CuerpoHoy({ medidas, registros, alVer }: { medidas: Seguimiento[]; registros: RegistroGuardado[]; alVer: () => void }) {
  if (!medidas.length) return null
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cómo va mi cuerpo?</h2><button className="enlace" onClick={alVer}>Ver →</button></div>
      <ul className="lista">
        {medidas.map(m => {
          const [ultimo, anterior] = registros.filter(r => r.id_seguimiento === m.id_seguimiento).sort((a, b) => b.fecha.localeCompare(a.fecha))
          const falta = ultimo && m.meta && faltaParaMeta(ultimo.valor, m.meta.valor, m.meta.direccion)
          return (
            <li key={m.id_seguimiento} className="dos">
              <span>{m.nombre}
                {ultimo && <span className="tenue">{anterior ? ` · ${conSigno(ultimo.valor - anterior.valor, m.unidad)} desde el ${diaMes(anterior.fecha)}` : ''}
                  {m.meta ? ` · ${falta ? `faltan ${formatoValor('numero', falta, m.unidad)} para la meta` : 'meta cumplida'}` : ''}</span>}
              </span>
              {ultimo
                ? <strong>{formatoValor('numero', ultimo.valor, m.unidad)}<span className="tenue"> · {diaMes(ultimo.fecha)}</span></strong>
                : <button className="enlace" onClick={alVer}>Registrar</button>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// "20–26 oct" o "29 sep–5 oct" para la semana que empieza ese lunes
function rangoSemana(lunes: string) {
  const domingo = restarDias(lunes, -6)
  const dia = (f: string) => Number(f.slice(8, 10)), mes = (f: string) => MESES[Number(f.slice(5, 7)) - 1]
  return mes(lunes) === mes(domingo) ? `${dia(lunes)}–${dia(domingo)} ${mes(domingo)}` : `${dia(lunes)} ${mes(lunes)}–${dia(domingo)} ${mes(domingo)}`
}

const TEXTO_SEMANA = { en_meta: '✓ En meta esta semana', cerca: '◐ Cerca de la meta esta semana', fuera: '✕ Lejos de la meta esta semana' }

function Constancia({ sesiones, hoy, idGym, metaDias, alCambiar }: {
  sesiones: Sesion[]; hoy: string; idGym: string; metaDias?: number; alCambiar: () => Promise<void>
}) {
  const semanas = useMemo(() => diasPorSemana(sesiones, hoy), [sesiones, hoy])
  // el promedio sale de las semanas cerradas: la que va todavía puede subir
  const meta = metaSemanal(semanas.slice(0, -1), metaDias)
  const estaSemana = semanas[semanas.length - 1].dias
  const esta = meta && estadoSemana(estaSemana, meta.valor)
  const color = (dias: number) => cssVar(!meta ? '--c1' : `--${estadoSemana(dias, meta.valor).replace('_', '-')}`)
  const series = useMemo(() => [{ nombre: 'Días entrenados', datos: semanas.map(s => s.dias), color: semanas.map(s => color(s.dias)), leyenda: cssVar('--c1') }],
    [semanas, meta?.valor]) // color solo depende de la meta
  const linea = useMemo(() => meta ? { nombre: meta.propia ? 'Meta' : 'Tu promedio', datos: semanas.map(() => meta.valor), color: cssVar('--tinta'), punteada: true } : undefined,
    [semanas, meta?.valor, meta?.propia])
  return (
    <section>
      <h2>¿Estoy entrenando seguido?</h2>
      <p>Esta semana: <strong className="cifra-media">{estaSemana}</strong> <span className="tenue">{meta ? `de ${meta.valor} días` : estaSemana === 1 ? 'día' : 'días'}</span></p>
      {meta ? <p className="con-estado"><span className={`estado ${esta!.replace('_', '-')}`}>{TEXTO_SEMANA[esta!]}</span>
        <span className="tenue"> {meta.propia ? `Meta: ${meta.valor} días por semana` : `Sin meta: se compara con tu promedio (${meta.valor} días por semana)`}</span></p>
        : <p className="tenue">Pon tu meta de días por semana para saber si vas en meta, cerca o lejos.</p>}
      <Barras etiquetas={semanas.map(s => rangoSemana(s.desde))} series={series} linea={linea} maximo={7} leyenda={false}
        formato={v => `${Math.round(v)} ${Math.round(v) === 1 ? 'día' : 'días'}`} formatoEje={v => `${v}`}
        colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion={`Días entrenados por semana, de lunes a domingo: ${semanas.map(s => `${rangoSemana(s.desde)} ${s.dias}`).join(', ')}${meta ? `; la línea es ${meta.propia ? 'la meta' : 'tu promedio'} de ${meta.valor} días` : ''}`} />
      {meta && <p className="leyenda-estado">
        {(['en-meta', 'cerca', 'fuera'] as const).map(c => <span key={c}><i style={{ background: cssVar(`--${c}`) }} />{c === 'en-meta' ? 'En meta' : c === 'cerca' ? 'Cerca' : 'Lejos'}</span>)}
        <span><i className="linea-meta" />{meta.propia ? 'Meta' : 'Tu promedio'}</span>
      </p>}
      <MetaGym idGym={idGym} meta={metaDias} alCambiar={alCambiar} />
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
      setMensaje(n === null ? 'Meta quitada: se compara con tu promedio.' : 'Meta guardada.')
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
          <label>Días por semana (vacío para comparar con tu promedio)
            <input inputMode="numeric" maxLength={1} value={valor} onChange={ev => setValor(ev.target.value)} placeholder="Ej. 4" />
          </label>
          <button className="principal">Guardar meta</button>
          {mensaje && <p role="status" className="tenue">{mensaje}</p>}
        </form>
      )}
    </>
  )
}

function Progreso({ sesiones, ejercicios, hoy, rango, alCambiarRango }: {
  sesiones: Sesion[]; ejercicios: string[]; hoy: string; rango: Rango; alCambiarRango: (r: Rango) => void
}) {
  const [elegido, setElegido] = useState('')
  const actual = ejercicios.includes(elegido) ? elegido : ejercicios[0]
  const p = useMemo(() => actual ? progreso(sesiones, actual) : null, [sesiones, actual])
  const puntos = useMemo(() => actual ? pesoPorDia(sesiones, actual, desdeRango(rango, hoy)) : [], [sesiones, actual, rango, hoy])
  const records = useMemo(() => ({ indices: indicesRecord(puntos), texto: 'récord' }), [puntos])
  const diasConPeso = useMemo(() => actual ? pesoPorDia(sesiones, actual).length : 0, [sesiones, actual])
  if (!actual || !p) return null
  return (
    <section>
      <h2>¿Cómo voy en cada ejercicio?</h2>
      <Selector id="filtro-ejercicio" titulo="Ejercicio" icono="🏋️" valor={actual} alCambiar={setElegido}>
        {ejercicios.map(e => <option key={e}>{e}</option>)}
      </Selector>
      <ul className="lista">
        {p.ultimas.map((s, i) => <li key={i} className="dos"><span>{diaMes(s.fecha)}</span><strong>{serie(s)}</strong></li>)}
      </ul>
      {p.record !== null && <p>Récord: <strong>{kg(p.record)}</strong>{p.desdePrimera !== null && <span className="tenue"> · desde la primera {conSigno(p.desdePrimera, 'kg')}</span>}</p>}
      {diasConPeso > 1 && <Periodo valor={rango} alCambiar={alCambiarRango} />}
      {puntos.length > 1 ? (
        <Grafico puntos={puntos} color={cssVar('--acento')} colorMeta={cssVar('--tenue')} formato={kg} destacados={records}
          descripcion={`Mayor peso de cada día en ${actual}; los puntos grandes son cada récord nuevo`} />
      ) : <p className="tenue">{diasConPeso > 1 ? 'Pocos registros con peso en este período.' : `Registra otra sesión de ${actual} con peso para ver tu avance.`}</p>}
    </section>
  )
}

function Medida({ medida, registros, alCambiar }: { medida: Seguimiento; registros: RegistroGuardado[]; alCambiar: () => Promise<void> }) {
  const hoy = hoyIso()
  const [ventana, setVentana] = useState<Rango>(90)
  const historial = useRegistrosDe(medida.id_seguimiento, ventana, registros)
  const { nombre, unidad, meta } = medida
  const [valor, setValor] = useState('')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [renombrando, setRenombrando] = useState(false)
  // Peso no se renombra ni se quita: el módulo lo recrea y el inicio lo busca por nombre
  const fija = SIEMPRE.some(i => i.codigo_plantilla === 'cuerpo' && i.nombre === nombre)
  const rango = normalizar(nombre) === 'peso' ? [20, 400] : [0.1, 1000]
  const puntos = useMemo(() => historial.filter(r => r.fecha >= desdeRango(ventana, hoy)).slice().reverse(), [historial, ventana, hoy])
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
        {!fija && <span className="chips">
          <button className="enlace" aria-expanded={renombrando} onClick={() => setRenombrando(!renombrando)}>Renombrar</button>
          <button className="enlace" onClick={() => confirm(`¿Dejar de medir ${nombre}? Desaparece de Cuerpo, pero sus registros se conservan.`) &&
            quitarSeguimiento(medida.id_seguimiento).then(alCambiar, e => setError((e as Error).message))}>Ya no medir</button>
        </span>}</div>
      {renombrando && (
        <CambiarNombre inicial={nombre} alCancelar={() => setRenombrando(false)}
          alGuardar={async nuevo => { await renombrarMedida(medida.id_seguimiento, nuevo); setRenombrando(false); await alCambiar() }} />
      )}
      {ultimo && <p><strong>{formatoValor('numero', ultimo.valor, unidad)}</strong> <span className="tenue">el {diaMes(ultimo.fecha)}{meta ? ` · meta ${formatoValor('numero', meta.valor, unidad)}` : ''}</span></p>}
      <form className="fila-presupuesto" onSubmit={guardar}>
        <label htmlFor={`m-${medida.id_seguimiento}`}>Hoy</label>
        <input id={`m-${medida.id_seguimiento}`} inputMode="decimal" maxLength={8} value={valor} onChange={ev => setValor(ev.target.value)} placeholder={`Tu medida de hoy (ej. 78,5${unidad ? ` ${unidad}` : ''})`} />
        <button className="secundario" disabled={enviando}>Guardar</button>
      </form>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {registros.length > 1 && <Periodo valor={ventana} alCambiar={setVentana} />}
      {puntos.length > 1 && (
        <Grafico puntos={puntos} meta={meta?.valor} color={cssVar('--acento')} colorMeta={cssVar('--tenue')}
          formato={v => formatoValor('numero', v, unidad)} etiquetaMeta={meta ? `Meta ${formatoValor('numero', meta.valor, unidad)}` : undefined}
          descripcion={`${nombre} ${ventana ? `en los últimos ${ventana} días` : 'en todo el historial'}${meta ? '; la línea punteada es la meta' : ''}`} />
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
          <label>Nombre<input required maxLength={60} value={nombre} onChange={ev => setNombre(ev.target.value)} placeholder="Qué quieres medir" autoComplete="off" autoFocus={inicial} /><small className="ayuda">Ej.: Brazo, Cadera, Grasa corporal</small></label>
          <label>Unidad<input required maxLength={20} value={unidad} onChange={ev => setUnidad(ev.target.value)} /></label>
          <button className="principal">Agregar</button>
          {error && <p role="alert" className="error">{error}</p>}
        </form>
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
  const ejercicios = new Map(datos.ejercicios.map(e => [e.id_etiqueta, e.nombre]))
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
      total={lista => {
        const entreno = new Set(lista.filter(r => r.id_seguimiento === gym.id_seguimiento).map(r => r.fecha)).size
        return `${entreno} ${entreno === 1 ? 'día' : 'días'} de gym`
      }}
      fila={r => {
        const s = series.get(r.id_registro)
        const medida = seguimientos.find(x => x.id_seguimiento === r.id_seguimiento)
        const detalle = s ? serie({ ejercicio: '', series: s.cantidad_series, repeticiones: s.cantidad_repeticiones, peso: s.peso_kilogramos === null ? null : Number(s.peso_kilogramos) })
          : formatoValor('numero', r.valor, medida?.unidad)
        return <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={nombreDe(r)} detalle={detalle} alBorrar={() => eliminarRegistro(r.id_registro).then(alCambiar)} />
      }}
    />
  )
}
