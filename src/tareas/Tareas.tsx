import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { normalizar } from '../finanzas/parseo'
import { cambiarRecordatorio, crearRecordatorio, crearTarea, editarTarea, marcarTarea, obtenerTareas, quitarTarea } from '../datos'
import CambiarNombre from '../CambiarNombre'
import { Avance } from '../finanzas/Medidas'
import Barras from '../finanzas/Barras'
import {
  aTiempoPorSemana, aTiempoSemana,
  despuesDeListo, deHoy, fechaColombia, fechaCorta, hora12, proximoEnvio, sumarDias, type Recordatorio, type Repeticion, type Tarea,
} from './calculos'

type Datos = Awaited<ReturnType<typeof obtenerTareas>>

const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()

// Barras apiladas de las últimas 8 semanas: a tiempo encima de tarde.
function TiempoPorSemana({ semanas }: { semanas: ReturnType<typeof aTiempoPorSemana> }) {
  const series = useMemo(() => [
    { nombre: 'A tiempo', datos: semanas.map(w => w.aTiempo), color: cssVar('--en-meta') },
    { nombre: 'Tarde o sin hacer', datos: semanas.map(w => w.tarde), color: cssVar('--fuera') },
  ], [semanas])
  const etiquetas = useMemo(() => semanas.map(w => `${w.desde.slice(8, 10)}/${w.desde.slice(5, 7)}`), [semanas])
  return (
    <>
      <h3>Últimas 8 semanas</h3>
      <Barras apilado etiquetas={etiquetas} series={series} dias={{ titulos: etiquetas.map(e => `Semana del ${e}`) }} formato={v => `${Math.round(v)}`} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion={`Tareas a tiempo y tarde por semana: ${semanas.map(w => `${etiquetas[semanas.indexOf(w)]} ${w.aTiempo} a tiempo, ${w.tarde} tarde`).join('; ')}`} />
    </>
  )
}
export type AccionTareas = 'tarea' | 'recordatorio'

const PESTANAS = { hoy: 'Hoy', tareas: 'Tareas', recordatorios: 'Recordatorios' }
const MAX_DESCRIPCION = 300
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const REPETICION: Record<Repeticion, string> = { unico: 'Una vez', diario: 'Cada día', habiles: 'Lunes a viernes', semanal: 'Cada semana', mensual: 'Cada mes' }
const hoyColombia = () => fechaColombia(new Date())

function textoRepeticion(r: Recordatorio) {
  if (r.tipo_repeticion === 'semanal') return `Cada ${(r.dias_semana ?? []).map(d => DIAS[d - 1].toLowerCase()).join(', ')}`
  if (r.tipo_repeticion === 'mensual') return `Cada mes el ${r.dia_mes === 31 ? 'último día' : `día ${r.dia_mes}`}`
  return REPETICION[r.tipo_repeticion]
}

export default function Tareas({ abrir, alVolver }: { abrir?: AccionTareas; alVolver: () => void }) {
  const hoy = hoyColombia()
  const [pestana, setPestana] = useState<keyof typeof PESTANAS>(abrir === 'recordatorio' ? 'recordatorios' : abrir === 'tarea' ? 'tareas' : 'hoy')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  // id de la tarea o recordatorio que espera el "¿Seguro?" antes de quitarse
  const [porQuitar, setPorQuitar] = useState<string | null>(null)
  // id de la tarea o recordatorio con el texto abierto para editar
  const [editando, setEditando] = useState<string | null>(null)
  const botonEditar = (id: string) =>
    <button className="enlace" aria-expanded={editando === id} onClick={() => { setEditando(editando === id ? null : id); setPorQuitar(null) }}>Editar</button>
  const formEditar = (id: string, texto: string, cambiar: (nuevo: string) => Promise<unknown>) => editando === id && (
    <CambiarNombre inicial={texto} etiqueta="Nuevo texto" maximo={MAX_DESCRIPCION} alCancelar={() => setEditando(null)}
      alGuardar={async nuevo => { await guardar(() => cambiar(nuevo), `Cambiado: ${nuevo}.`); setEditando(null) }} />
  )
  const confirmarQuitar = (id: string, quitar: () => void) => porQuitar === id ? (
    <span className="chips">
      <span className="tenue">¿Seguro?</span>
      <button className="secundario" onClick={() => { setPorQuitar(null); quitar() }}>Sí, quitar</button>
      <button className="secundario" onClick={() => setPorQuitar(null)}>No</button>
    </span>
  ) : <button className="enlace" onClick={() => setPorQuitar(id)}>Quitar</button>

  const cargar = useCallback(async () => {
    try {
      setDatos(await obtenerTareas(sumarDias(hoy, -30)))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [hoy])
  useEffect(() => { cargar() }, [cargar])

  // Para los formularios: lanza el error para que lo muestren sin cerrarse.
  async function guardar(hacer: () => Promise<unknown>, mensaje: string) {
    await hacer()
    setAviso(mensaje)
    setError('')
    await cargar()
  }
  // Para los botones de una fila: el error va arriba.
  const accion = (hacer: () => Promise<unknown>, mensaje: string) => guardar(hacer, mensaje).catch(e => setError((e as Error).message))

  const filaTarea = (t: Tarea, conFecha = true) => (
    <li key={t.id_tarea} className="tres">
      <span className={t.estado === 'hecho' ? 'hecha' : undefined}>{t.descripcion}
        {conFecha && t.fecha_limite && <span className="tenue"> · {t.fecha_limite < hoy && t.estado === 'pendiente' ? 'venció ' : ''}{fechaCorta(t.fecha_limite)}</span>}
        {t.estado === 'pendiente' && <> {botonEditar(t.id_tarea)}</>}
      </span>
      {t.estado === 'pendiente'
        ? <button className="secundario" onClick={() => accion(() => marcarTarea(t.id_tarea, true), `Hecha: ${t.descripcion}.`)}>✓ Hecha</button>
        : <button className="enlace" onClick={() => accion(() => marcarTarea(t.id_tarea, false), `${t.descripcion} vuelve a pendiente.`)}>Deshacer</button>}
      {confirmarQuitar(t.id_tarea, () => accion(() => quitarTarea(t.id_tarea), `${t.descripcion} quitada.`))}
      {formEditar(t.id_tarea, t.descripcion, nuevo => editarTarea(t.id_tarea, nuevo))}
    </li>
  )

  return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado">
        <div>
          <h1>Tareas</h1>
          <p className="tenue">{new Date(`${hoy}T12:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      <div className="chips pestanas" role="radiogroup" aria-label="Sección de Tareas">
        {(Object.keys(PESTANAS) as (keyof typeof PESTANAS)[]).map(p => (
          <button key={p} type="button" role="radio" aria-checked={pestana === p} className="chip" onClick={() => { setPestana(p); setAviso('') }}>{PESTANAS[p]}</button>
        ))}
      </div>
      {!datos ? <p className="tenue">Cargando…</p> : (
        <>
          {pestana === 'hoy' && <Hoy datos={datos} hoy={hoy} fila={filaTarea}
            alListo={r => accion(() => cambiarRecordatorio(r.id_recordatorio, despuesDeListo(r, new Date())), `Listo: ${r.descripcion}.`)} />}
          {pestana === 'tareas' && (
            <>
              <NuevaTarea hoy={hoy} enfocar={abrir === 'tarea'}
                pendientes={datos.tareas.filter(t => t.estado === 'pendiente').map(t => t.descripcion)}
                repetidas={repetidas(datos.tareas)} alGuardar={t => guardar(() => crearTarea(t), `Tarea creada: ${t.descripcion}.`)} />
              <section>
                <h2>Pendientes</h2>
                {!datos.tareas.some(t => t.estado === 'pendiente') && <p className="tenue">No tienes tareas pendientes.</p>}
                <ul className="lista tareas">
                  {datos.tareas.filter(t => t.estado === 'pendiente')
                    .sort((a, b) => (a.fecha_limite ?? '9999').localeCompare(b.fecha_limite ?? '9999')).map(t => filaTarea(t))}
                </ul>
              </section>
              {datos.tareas.some(t => t.estado === 'hecho') && (
                <section>
                  <h2>Hechas (últimos 30 días)</h2>
                  <ul className="lista tareas">{datos.tareas.filter(t => t.estado === 'hecho').map(t => filaTarea(t))}</ul>
                </section>
              )}
            </>
          )}
          {pestana === 'recordatorios' && (
            <>
              <NuevoRecordatorio hoy={hoy} enfocar={abrir === 'recordatorio'}
                alGuardar={r => guardar(() => crearRecordatorio(r), `Recordatorio creado: ${r.descripcion}.`)} />
              <section>
                <h2>Tus recordatorios</h2>
                {!datos.recordatorios.length && <p className="tenue">Aún no tienes recordatorios. Los avisos al celular llegan en una próxima versión; por ahora salen en Hoy.</p>}
                <ul className="lista tareas">
                  {datos.recordatorios.map(r => (
                    <li key={r.id_recordatorio} className="tres">
                      <span>{r.descripcion}
                        <span className="tenue"> · {textoRepeticion(r)} a las {hora12(r.hora_envio)}
                          {r.estado === 'pausado' ? ' · en pausa' : r.fecha_proximo_envio ? ` · próximo ${fechaCorta(fechaColombia(r.fecha_proximo_envio))}` : ''}</span>
                        {' '}{botonEditar(r.id_recordatorio)}
                      </span>
                      {r.estado === 'activo'
                        ? <button className="enlace" onClick={() => accion(() => cambiarRecordatorio(r.id_recordatorio, { estado: 'pausado' }), `${r.descripcion} en pausa.`)}>Pausar</button>
                        : <button className="enlace" onClick={() => {
                          const proximo = proximoEnvio(r, new Date(), r.fecha_proximo_envio ? fechaColombia(r.fecha_proximo_envio) : undefined)
                          accion(() => cambiarRecordatorio(r.id_recordatorio, { fecha_proximo_envio: proximo, estado: proximo ? 'activo' : 'terminado' }),
                            proximo ? `${r.descripcion} activo otra vez.` : `${r.descripcion} ya pasó y quedó terminado.`)
                        }}>Reanudar</button>}
                      {confirmarQuitar(r.id_recordatorio, () => accion(() => cambiarRecordatorio(r.id_recordatorio, { estado: 'eliminado' }), `${r.descripcion} quitado.`))}
                      {formEditar(r.id_recordatorio, r.descripcion, nuevo => cambiarRecordatorio(r.id_recordatorio, { descripcion: nuevo }))}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}
    </>
  )
}

function Hoy({ datos, hoy, fila, alListo }: { datos: Datos; hoy: string; fila: (t: Tarea, conFecha?: boolean) => ReactNode; alListo: (r: Recordatorio) => void }) {
  const h = deHoy(datos.tareas, datos.recordatorios, hoy)
  const nada = !h.vencidas.length && !h.deHoy.length && !h.sinFecha.length && !h.recordatorios.length
  const delDia = h.hechasHoy.length + h.deHoy.length + h.vencidas.length
  const semana = aTiempoSemana(datos.tareas, hoy)
  const semanas = aTiempoPorSemana(datos.tareas, hoy)
  const conVencidas = semanas.some(w => w.aTiempo || w.tarde)
  const color = (bien: boolean) => getComputedStyle(document.documentElement).getPropertyValue(bien ? '--en-meta' : '--c1').trim()
  return (
    <>
      {delDia > 0 && (
        <section>
          <h2>¿Cómo voy hoy?</h2>
          <p><strong className="cifra-media">{h.hechasHoy.length} de {delDia}</strong> <span className="tenue">tareas del día hechas{h.vencidas.length ? ` · ${h.vencidas.length} vencidas` : ''}</span></p>
          <Avance valor={h.hechasHoy.length} tope={delDia} color={color(h.hechasHoy.length === delDia)} descripcion={`Hoy: ${h.hechasHoy.length} de ${delDia} tareas hechas`} />
        </section>
      )}
      {semana.total > 0 && (
        <section>
          <h2>¿Las hago a tiempo?</h2>
          <p><strong className="cifra-media">{Math.round((semana.aTiempo / semana.total) * 100)} %</strong> <span className="tenue">a tiempo esta semana ({semana.aTiempo} de {semana.total})</span></p>
          <Avance valor={semana.aTiempo} tope={semana.total} color={color(semana.aTiempo === semana.total)} descripcion={`Esta semana: ${semana.aTiempo} de ${semana.total} tareas a tiempo`} />
          {conVencidas && <TiempoPorSemana semanas={semanas} />}
        </section>
      )}
      {nada && <p className="tenue">Nada pendiente para hoy. Crea tareas o recordatorios en sus pestañas.</p>}
      {h.recordatorios.length > 0 && (
        <section>
          <h2>Recordatorios</h2>
          <ul className="lista tareas">
            {h.recordatorios.map(r => (
              <li key={r.id_recordatorio} className="tres">
                <span>{r.descripcion}<span className="tenue"> · {fechaColombia(r.fecha_proximo_envio!) < hoy ? `atrasado desde ${fechaCorta(fechaColombia(r.fecha_proximo_envio!))}` : hora12(r.hora_envio)}</span></span>
                <button className="secundario" onClick={() => alListo(r)}>✓ Listo</button>
                <span />
              </li>
            ))}
          </ul>
        </section>
      )}
      {([['Vencidas', h.vencidas, true], ['Para hoy', h.deHoy, false], ['Sin fecha', h.sinFecha, false]] as const).map(([titulo, lista, conFecha]) => lista.length > 0 && (
        <section key={titulo}>
          <h2>{titulo}</h2>
          <ul className="lista tareas">{lista.map(t => fila(t, conFecha))}</ul>
        </section>
      ))}
      {h.hechasHoy.length > 0 && (
        <section>
          <h2>Hechas hoy</h2>
          <ul className="lista tareas">{h.hechasHoy.map(t => fila(t, false))}</ul>
        </section>
      )}
    </>
  )
}

// las que ya creó 2 veces o más y no tiene pendientes ahora
const repetidas = (tareas: Tarea[]) => {
  const veces = new Map<string, { texto: string; n: number }>()
  for (const t of tareas) {
    const k = normalizar(t.descripcion)
    veces.set(k, { texto: t.descripcion, n: (veces.get(k)?.n ?? 0) + 1 })
  }
  const pendientes = new Set(tareas.filter(t => t.estado === 'pendiente').map(t => normalizar(t.descripcion)))
  return [...veces.entries()].filter(([k, v]) => v.n >= 2 && !pendientes.has(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([, v]) => v.texto)
}

function NuevaTarea({ hoy, enfocar, pendientes, repetidas: sugeridas, alGuardar }: {
  hoy: string; enfocar?: boolean; pendientes: string[]; repetidas: string[]; alGuardar: (t: { descripcion: string; fecha_limite: string | null }) => Promise<void>
}) {
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const limpia = descripcion.replace(/\s+/g, ' ').trim()
    if (!limpia) return setError('Escribe qué tienes que hacer.')
    if (pendientes.some(p => normalizar(p) === normalizar(limpia)) && !confirm(`Ya tienes pendiente "${limpia}". ¿Crearla otra vez?`)) return
    setEnviando(true)
    try {
      await alGuardar({ descripcion: limpia, fecha_limite: fecha || null })
      setDescripcion(''); setFecha(''); setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <label>Nueva tarea<input required maxLength={MAX_DESCRIPCION} value={descripcion} onChange={ev => setDescripcion(ev.target.value)}
        placeholder="Qué tienes que hacer" autoComplete="off" autoFocus={enfocar} /><small className="ayuda">Ej.: pagar el arriendo, llamar al banco</small></label>
      {sugeridas.length > 0 && !descripcion.trim() && (
        <div className="sugeridos">
          <span className="tenue">Las que sueles repetir</span>
          <div className="chips">{sugeridas.map(t => <button key={t} type="button" className="chip" onClick={() => setDescripcion(t)}>{t}</button>)}</div>
        </div>
      )}
      <label>Para cuándo (opcional)
        <input type="date" value={fecha} min={hoy} onChange={ev => setFecha(ev.target.value)} />
        <small className="ayuda">Sin fecha sale cada día en Hoy hasta que la hagas</small>
      </label>
      <button className="principal" disabled={enviando}>Guardar tarea</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

function NuevoRecordatorio({ hoy, enfocar, alGuardar }: { hoy: string; enfocar?: boolean; alGuardar: (r: Omit<Recordatorio, 'id_recordatorio' | 'estado'>) => Promise<void> }) {
  const [descripcion, setDescripcion] = useState('')
  const [hora, setHora] = useState('09:00')
  const [tipo, setTipo] = useState<Repeticion>('diario')
  const [fecha, setFecha] = useState(hoy)
  const [dias, setDias] = useState<number[]>([])
  const [diaMes, setDiaMes] = useState('1')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const limpia = descripcion.replace(/\s+/g, ' ').trim()
    const dia = Number(diaMes)
    if (!limpia) return setError('Escribe qué te recuerdo.')
    if (!/^\d{2}:\d{2}$/.test(hora)) return setError('Elige la hora.')
    if (tipo === 'semanal' && !dias.length) return setError('Elige al menos un día de la semana.')
    if (tipo === 'mensual' && !(Number.isInteger(dia) && dia >= 1 && dia <= 31)) return setError('Escribe el día del mes, de 1 a 31.')
    const regla = { tipo_repeticion: tipo, dias_semana: tipo === 'semanal' ? [...dias].sort() : null, dia_mes: tipo === 'mensual' ? dia : null, hora_envio: hora }
    const proximo = proximoEnvio(regla, new Date(), tipo === 'unico' ? fecha : undefined)
    if (!proximo) return setError(tipo === 'unico' ? 'Esa fecha y hora ya pasaron.' : 'No encuentro un próximo día para ese recordatorio.')
    setEnviando(true)
    try {
      await alGuardar({ descripcion: limpia, ...regla, fecha_proximo_envio: proximo })
      setDescripcion(''); setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <label>Nuevo recordatorio<input required maxLength={MAX_DESCRIPCION} value={descripcion} onChange={ev => setDescripcion(ev.target.value)}
        placeholder="Qué te recuerdo" autoComplete="off" autoFocus={enfocar} /><small className="ayuda">Ej.: tomar la pastilla, sacar la basura</small></label>
      <fieldset>
        <legend>¿Cada cuánto?</legend>
        <div className="chips" role="radiogroup" aria-label="Repetición">
          {(Object.keys(REPETICION) as Repeticion[]).map(t => (
            <button key={t} type="button" role="radio" aria-checked={tipo === t} className="chip" onClick={() => setTipo(t)}>{REPETICION[t]}</button>
          ))}
        </div>
      </fieldset>
      {tipo === 'unico' && <label>Día<input type="date" required value={fecha} min={hoy} onChange={ev => setFecha(ev.target.value)} /></label>}
      {tipo === 'semanal' && (
        <fieldset>
          <legend>¿Qué días?</legend>
          <div className="chips">
            {DIAS.map((d, i) => (
              <button key={d} type="button" role="checkbox" aria-checked={dias.includes(i + 1)} className="chip"
                onClick={() => setDias(dias.includes(i + 1) ? dias.filter(x => x !== i + 1) : [...dias, i + 1])}>{d}</button>
            ))}
          </div>
        </fieldset>
      )}
      {tipo === 'mensual' && (
        <label>Día del mes<input required inputMode="numeric" maxLength={2} value={diaMes} onChange={ev => setDiaMes(ev.target.value.replace(/\D/g, ''))} />
          <small className="ayuda">31 = el último día de cada mes</small></label>
      )}
      <label>Hora<input type="time" required value={hora} onChange={ev => setHora(ev.target.value)} /></label>
      <button className="principal" disabled={enviando}>Guardar recordatorio</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}
