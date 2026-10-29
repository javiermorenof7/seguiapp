import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { normalizar } from '../finanzas/parseo'
import { cambiarRecordatorio, crearRecordatorio, crearTarea, marcarTarea, obtenerTareas, quitarTarea } from '../datos'
import {
  despuesDeListo, deHoy, fechaColombia, proximoEnvio, sumarDias, type Recordatorio, type Repeticion, type Tarea,
} from './calculos'

type Datos = Awaited<ReturnType<typeof obtenerTareas>>
export type AccionTareas = 'tarea' | 'recordatorio'

const PESTANAS = { hoy: 'Hoy', tareas: 'Tareas', recordatorios: 'Recordatorios' }
const MAX_DESCRIPCION = 300
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const REPETICION: Record<Repeticion, string> = { unico: 'Una vez', diario: 'Cada día', habiles: 'Lunes a viernes', semanal: 'Cada semana', mensual: 'Cada mes' }
const hoyColombia = () => fechaColombia(new Date())
const fechaCorta = (f: string) => new Date(`${f}T12:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
const hora12 = (h: string) => new Date(`2000-01-01T${h.slice(0, 5)}`).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })

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
      </span>
      {t.estado === 'pendiente'
        ? <button className="secundario" onClick={() => accion(() => marcarTarea(t.id_tarea, true), `Hecha: ${t.descripcion}.`)}>✓ Hecha</button>
        : <button className="enlace" onClick={() => accion(() => marcarTarea(t.id_tarea, false), `${t.descripcion} vuelve a pendiente.`)}>Deshacer</button>}
      {t.estado === 'pendiente'
        ? <button className="enlace" onClick={() => accion(() => quitarTarea(t.id_tarea), `${t.descripcion} quitada.`)}>Quitar</button>
        : <span />}
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
                pendientes={datos.tareas.filter(t => t.estado === 'pendiente').map(t => t.descripcion)} alGuardar={t => guardar(() => crearTarea(t), `Tarea creada: ${t.descripcion}.`)} />
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
                      </span>
                      {r.estado === 'activo'
                        ? <button className="enlace" onClick={() => accion(() => cambiarRecordatorio(r.id_recordatorio, { estado: 'pausado' }), `${r.descripcion} en pausa.`)}>Pausar</button>
                        : <button className="enlace" onClick={() => {
                          const proximo = proximoEnvio(r, new Date(), r.fecha_proximo_envio ? fechaColombia(r.fecha_proximo_envio) : undefined)
                          accion(() => cambiarRecordatorio(r.id_recordatorio, { fecha_proximo_envio: proximo, estado: proximo ? 'activo' : 'terminado' }),
                            proximo ? `${r.descripcion} activo otra vez.` : `${r.descripcion} ya pasó y quedó terminado.`)
                        }}>Reanudar</button>}
                      <button className="enlace" onClick={() => accion(() => cambiarRecordatorio(r.id_recordatorio, { estado: 'eliminado' }), `${r.descripcion} quitado.`)}>Quitar</button>
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
  return (
    <>
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

function NuevaTarea({ hoy, enfocar, pendientes, alGuardar }: {
  hoy: string; enfocar?: boolean; pendientes: string[]; alGuardar: (t: { descripcion: string; fecha_limite: string | null }) => Promise<void>
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
