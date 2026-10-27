import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import {
  asegurarPerfil, cerrarSesion, crearSeguimiento, eliminarRegistro, enviarCola, obtenerRegistros,
  obtenerSeguimientos, registrar, type RegistroGuardado, type Seguimiento,
} from './datos'
import {
  agregado, estado, formatoValor, inicioPeriodo, ordenEstado, periodoDe, seSuma, serie,
  type Direccion, type Estado, type Frecuencia, type Periodo, type TipoMedida,
} from './indicadores'
import Grafico from './Grafico'
import Privacidad from './Privacidad'
import Finanzas from './finanzas/Finanzas'
import Salud from './salud/Salud'

const TEXTO_ESTADO: Record<Estado, string> = { fuera: '✕ Fuera de la meta', cerca: '◐ Cerca de la meta', en_meta: '✓ Vas bien' }
const TEXTO_PERIODO: Record<Periodo, string> = { dia: 'día', semana: 'semana', mes: 'mes', ano: 'año' }
const TIPOS: Record<TipoMedida, string> = { dinero: 'Dinero', numero: 'Número', si_no: 'Sí o no', duracion: 'Duración (minutos)', escala: 'Escala del 1 al 10' }
const FRECUENCIAS: Record<Frecuencia, string> = { registro: 'Cada vez que pasa', dia: 'Cada día', semana: 'Cada semana', mes: 'Cada mes' }

const hoyIso = () => new Date().toLocaleDateString('en-CA')
const haceUnAno = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toLocaleDateString('en-CA') }
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()

function resumen(s: Seguimiento, registros: RegistroGuardado[]) {
  const desde = inicioPeriodo(periodoDe(s.frecuencia, s.meta), new Date())
  const delPeriodo = registros.filter(r => r.id_seguimiento === s.id_seguimiento && r.fecha >= desde)
  const valor = agregado(s.tipo_medida, delPeriodo)
  const puntos = seSuma(s.tipo_medida)
    ? serie(s.tipo_medida, delPeriodo)
    : serie(s.tipo_medida, registros.filter(r => r.id_seguimiento === s.id_seguimiento)).slice(-30)
  return { valor, puntos, estado: estado(valor, s.meta) }
}

function textoMeta(s: Seguimiento) {
  if (!s.meta) return 'Sin meta'
  const cuanto = formatoValor(s.tipo_medida, s.meta.valor, s.unidad)
  const por = TEXTO_PERIODO[s.meta.periodo]
  return s.meta.direccion === 'menos_es_mejor' ? `Máximo ${cuanto} por ${por}` : `Meta: ${cuanto} por ${por}`
}

export default function App() {
  const [sesion, setSesion] = useState<Session | null | undefined>(undefined)
  const [verPrivacidad, setVerPrivacidad] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, nueva) => setSesion(nueva))
    return () => data.subscription.unsubscribe()
  }, [])

  if (sesion === undefined) return <div className="contenedor"><p className="tenue">Cargando…</p></div>
  if (verPrivacidad) return <Privacidad alVolver={() => setVerPrivacidad(false)} />
  if (!sesion) return <Entrar alPrivacidad={() => setVerPrivacidad(true)} />
  return <Panel sesion={sesion} alPrivacidad={() => setVerPrivacidad(true)} />
}

function Entrar({ alPrivacidad }: { alPrivacidad: () => void }) {
  const [error, setError] = useState('')
  async function entrar() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
    })
    if (error) setError('No se pudo abrir el inicio de sesión. Inténtalo de nuevo.')
  }
  return (
    <div className="contenedor entrar">
      <h1>seguiapp</h1>
      <p className="lema">Lo que no se mide no se controla.</p>
      <p>Mide tus gastos, tu entreno, tus hábitos o lo que quieras, y mira en gráficos cómo vas frente a tu meta.</p>
      <button className="principal" onClick={entrar}>Entrar con Google</button>
      <p className="tenue">
        El acceso es solo por invitación. Al entrar aceptas la <button className="enlace" onClick={alPrivacidad}>política de privacidad</button>.
      </p>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  )
}

type Vista = { tipo: 'inicio' } | { tipo: 'nuevo' } | { tipo: 'salud' } | { tipo: 'detalle'; id: string }

function Panel({ sesion, alPrivacidad }: { sesion: Session; alPrivacidad: () => void }) {
  const [vista, setVista] = useState<Vista>({ tipo: 'inicio' })
  const [seguimientos, setSeguimientos] = useState<Seguimiento[] | null>(null)
  const [registros, setRegistros] = useState<RegistroGuardado[]>([])
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([obtenerSeguimientos(), obtenerRegistros(haceUnAno())])
      setSeguimientos(s)
      setRegistros(r)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    const nombre = (sesion.user.user_metadata?.full_name as string | undefined)?.slice(0, 100) ?? null
    asegurarPerfil(nombre).catch(() => {}).then(() => enviarCola()).then(cargar)
    const alVolverConexion = () => { enviarCola().then(n => { if (n) cargar() }) }
    addEventListener('online', alVolverConexion)
    return () => removeEventListener('online', alVolverConexion)
  }, [sesion, cargar])

  const actual = vista.tipo === 'detalle' ? seguimientos?.find(s => s.id_seguimiento === vista.id) : undefined

  return (
    <div className="contenedor">
      {error && <p role="alert" className="error">{error}</p>}
      {vista.tipo === 'nuevo' && (
        <Nuevo
          alCancelar={() => setVista({ tipo: 'inicio' })}
          alCrear={async id => { await cargar(); setVista({ tipo: 'detalle', id }) }}
        />
      )}
      {vista.tipo === 'detalle' && actual?.codigo_plantilla === 'finanzas' && (
        <Finanzas seguimientos={seguimientos!} registros={registros} alVolver={() => setVista({ tipo: 'inicio' })} alCambiar={cargar} />
      )}
      {seguimientos && (vista.tipo === 'salud' || (actual && ['gym', 'cuerpo'].includes(actual.codigo_plantilla ?? ''))) && (
        <Salud seguimientos={seguimientos} registros={registros} alVolver={() => setVista({ tipo: 'inicio' })} alCambiar={cargar} />
      )}
      {vista.tipo === 'detalle' && actual && !['finanzas', 'gym', 'cuerpo'].includes(actual.codigo_plantilla ?? '') && (
        <Detalle
          seguimiento={actual}
          indice={seguimientos!.indexOf(actual)}
          registros={registros.filter(r => r.id_seguimiento === actual.id_seguimiento)}
          alVolver={() => setVista({ tipo: 'inicio' })}
          alCambiar={cargar}
        />
      )}
      {vista.tipo === 'inicio' && (
        <Inicio
          seguimientos={seguimientos}
          registros={registros}
          alNuevo={() => setVista({ tipo: 'nuevo' })}
          alSalud={() => setVista({ tipo: 'salud' })}
          alAbrir={id => setVista({ tipo: 'detalle', id })}
        />
      )}
      <footer className="pie"><button className="enlace" onClick={alPrivacidad}>Privacidad</button></footer>
    </div>
  )
}

function Inicio({ seguimientos, registros, alNuevo, alSalud, alAbrir }: {
  seguimientos: Seguimiento[] | null
  registros: RegistroGuardado[]
  alNuevo: () => void
  alSalud: () => void
  alAbrir: (id: string) => void
}) {
  const tarjetas = useMemo(() => (seguimientos ?? [])
    .map((s, indice) => ({ s, indice, ...resumen(s, registros) }))
    .sort((a, b) => ordenEstado(a.estado) - ordenEstado(b.estado)), [seguimientos, registros])

  return (
    <>
      <header className="encabezado">
        <div>
          <h1>Mi seguimiento</h1>
          <p className="tenue">{new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="acciones">
          <button className="principal" onClick={alNuevo}>Nuevo seguimiento</button>
          <button className="secundario" onClick={alSalud}>Salud</button>
          <button className="secundario" onClick={cerrarSesion}>Salir</button>
        </div>
      </header>
      {seguimientos === null && <p className="tenue">Cargando…</p>}
      {seguimientos?.length === 0 && (
        <section className="tarjeta vacia t1">
          <h2>Aún no tienes seguimientos</h2>
          <p>Crea el primero: gastos, entreno, hábitos o lo que quieras medir.</p>
          <button className="claro" onClick={alNuevo}>Crear el primero</button>
        </section>
      )}
      <main className="cuadricula" aria-label="Seguimientos activos">
        {tarjetas.map(({ s, indice, valor, puntos, estado }) => (
          <button key={s.id_seguimiento} className={`tarjeta t${(indice % 7) + 1}`} onClick={() => alAbrir(s.id_seguimiento)}>
            <h2>{s.nombre}</h2>
            <span className="cifra">{formatoValor(s.tipo_medida, valor, s.unidad)}</span>
            <span className="sub">{textoMeta(s)}</span>
            {puntos.length > 1 && (
              <Grafico
                compacto
                puntos={puntos}
                meta={s.meta?.valor}
                color="#FFFFFF"
                colorMeta="#FFFFFFBF"
                descripcion={`Tendencia de ${s.nombre}`}
              />
            )}
            {estado && <span className="estado">{TEXTO_ESTADO[estado]}</span>}
          </button>
        ))}
      </main>
    </>
  )
}

function validarValor(tipo: TipoMedida, valor: number): string {
  if (!Number.isFinite(valor)) return 'Escribe un número.'
  if ((tipo === 'dinero' || tipo === 'duracion') && valor < 0) return 'El valor no puede ser negativo.'
  if (tipo === 'dinero' && !Number.isInteger(valor)) return 'Escribe pesos sin decimales.'
  if (tipo === 'escala' && (!Number.isInteger(valor) || valor < 1 || valor > 10)) return 'Escribe un número entero del 1 al 10.'
  if (Math.abs(valor) >= 1e12) return 'El valor es demasiado grande.'
  return ''
}

function Detalle({ seguimiento: s, indice, registros, alVolver, alCambiar }: {
  seguimiento: Seguimiento
  indice: number
  registros: RegistroGuardado[]
  alVolver: () => void
  alCambiar: () => Promise<void>
}) {
  const [valor, setValor] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [nota, setNota] = useState('')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const { valor: actual, puntos, estado: e } = resumen(s, registros)
  const color = cssVar(`--t${(indice % 7) + 1}`)
  const formato = useCallback((v: number) => formatoValor(s.tipo_medida, v, s.unidad), [s])

  async function guardar(evento?: FormEvent) {
    evento?.preventDefault()
    const numero = s.tipo_medida === 'si_no' ? 1 : Number(valor.replace(',', '.'))
    const problema = validarValor(s.tipo_medida, numero)
    if (problema || !fecha || fecha > hoyIso()) return setError(problema || 'Elige una fecha de hoy o anterior.')
    setEnviando(true)
    try {
      const resultado = await registrar({ id_seguimiento: s.id_seguimiento, fecha_registro: fecha, valor: numero, nota: nota.trim() || null })
      setAviso(resultado === 'guardado'
        ? `Registrado: ${formato(numero)}.`
        : 'Sin conexión: quedó guardado en este equipo y se enviará al volver la conexión.')
      setValor('')
      setNota('')
      setError('')
      await alCambiar()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado">
        <div>
          <h1>{s.nombre}</h1>
          <p className="tenue">{textoMeta(s)}</p>
        </div>
      </header>
      <section className="resumen">
        <span className="cifra" style={{ color }}>{formatoValor(s.tipo_medida, actual, s.unidad)}</span>
        {e && <span className={`estado ${e}`}>{TEXTO_ESTADO[e]}</span>}
      </section>
      {puntos.length > 0
        ? <Grafico puntos={puntos} meta={s.meta?.valor} color={color} colorMeta={cssVar('--tenue')} formato={formato}
            descripcion={`${s.nombre}: ${seSuma(s.tipo_medida) ? 'acumulado del período' : 'últimos registros'} frente a la meta`} />
        : <p className="tenue">Todavía no hay registros en este período.</p>}

      <form className="formulario" onSubmit={guardar}>
        <h2>Registrar</h2>
        {s.tipo_medida !== 'si_no' && (
          <label>Valor{s.unidad ? ` (${s.unidad})` : ''}
            <input inputMode="decimal" required value={valor} onChange={ev => setValor(ev.target.value)} maxLength={16} />
          </label>
        )}
        <label>Fecha
          <input type="date" required value={fecha} max={hoyIso()} onChange={ev => setFecha(ev.target.value)} />
        </label>
        <label>Nota (opcional)
          <input value={nota} onChange={ev => setNota(ev.target.value)} maxLength={500} />
        </label>
        <button className="principal" disabled={enviando}>{s.tipo_medida === 'si_no' ? 'Marcar hecho' : 'Registrar'}</button>
        {aviso && <p role="status" className="aviso">{aviso}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </form>

      {registros.length > 0 && (
        <section>
          <h2>Últimos registros</h2>
          <ul className="lista">
            {registros.slice(0, 10).map(r => (
              <li key={r.id_registro}>
                <span>{r.fecha.split('-').reverse().join('/')}</span>
                <strong>{formato(r.valor)}</strong>
                <span className="tenue">{r.nota}</span>
                <button className="secundario" onClick={() => eliminarRegistro(r.id_registro).then(alCambiar, err => setError(err.message))}>Borrar</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function Nuevo({ alCrear, alCancelar }: { alCrear: (id: string) => Promise<void>; alCancelar: () => void }) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoMedida>('numero')
  const [unidad, setUnidad] = useState('')
  const [frecuencia, setFrecuencia] = useState<Frecuencia>('dia')
  const [conMeta, setConMeta] = useState(false)
  const [valorMeta, setValorMeta] = useState('')
  const [direccion, setDireccion] = useState<Direccion>('mas_es_mejor')
  const [periodo, setPeriodo] = useState<Periodo>('semana')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function crear(evento: FormEvent) {
    evento.preventDefault()
    const metaNumero = Number(valorMeta.replace(',', '.'))
    if (!nombre.trim()) return setError('Ponle un nombre.')
    if (conMeta && !Number.isFinite(metaNumero)) return setError('Escribe la meta como número.')
    setEnviando(true)
    try {
      const id = await crearSeguimiento(
        { nombre: nombre.trim(), tipo_medida: tipo, unidad: tipo === 'numero' && unidad.trim() ? unidad.trim() : null, frecuencia },
        conMeta ? { valor: metaNumero, direccion, periodo } : null,
      )
      await alCrear(id)
    } catch (err) {
      setError((err as Error).message)
      setEnviando(false)
    }
  }

  return (
    <>
      <button className="volver" onClick={alCancelar}>← Mi seguimiento</button>
      <form className="formulario" onSubmit={crear}>
        <h1>Nuevo seguimiento</h1>
        <label>Qué quieres medir
          <input required maxLength={60} value={nombre} onChange={ev => setNombre(ev.target.value)} placeholder="Gastos, Peso, Lectura…" />
        </label>
        <label>Cómo se mide
          <select value={tipo} onChange={ev => setTipo(ev.target.value as TipoMedida)}>
            {Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        {tipo === 'numero' && (
          <label>Unidad (opcional)
            <input maxLength={20} value={unidad} onChange={ev => setUnidad(ev.target.value)} placeholder="kg, vasos, páginas…" />
          </label>
        )}
        <label>Cada cuánto
          <select value={frecuencia} onChange={ev => setFrecuencia(ev.target.value as Frecuencia)}>
            {Object.entries(FRECUENCIAS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label className="casilla">
          <input type="checkbox" checked={conMeta} onChange={ev => setConMeta(ev.target.checked)} /> Ponerle una meta
        </label>
        {conMeta && (
          <fieldset>
            <label>Hacia dónde
              <select value={direccion} onChange={ev => setDireccion(ev.target.value as Direccion)}>
                <option value="mas_es_mejor">Más es mejor (llegar a la meta)</option>
                <option value="menos_es_mejor">Menos es mejor (no pasarse)</option>
              </select>
            </label>
            <label>Meta
              <input inputMode="decimal" required maxLength={16} value={valorMeta} onChange={ev => setValorMeta(ev.target.value)} />
            </label>
            <label>Por
              <select value={periodo} onChange={ev => setPeriodo(ev.target.value as Periodo)}>
                {Object.entries(TEXTO_PERIODO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          </fieldset>
        )}
        <button className="principal" disabled={enviando}>Crear seguimiento</button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </>
  )
}
