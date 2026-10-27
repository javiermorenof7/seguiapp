import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aprenderNombre, crearSeguimiento, guardarMeta, obtenerAlias, registrar, type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor } from '../indicadores'
import Grafico from '../Grafico'
import Barras from '../finanzas/Barras'
import { parecido } from '../salud/calculos'
import { dias, diasHechos, leerHabito, mejorRacha, racha, totalDelDia, ultimosDias, type Leido, type Marca } from './calculos'

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

  useEffect(() => { obtenerAlias('habito').then(setAlias).catch(e => setError((e as Error).message)) }, [])

  const leido = leerHabito(texto, hoy)

  async function guardar(l: Leido) {
    const existente = habitos.find(h => h.nombre === l.habito)
    if (existente?.tipo_medida === 'numero' && l.valor === null) {
      return setError(`${l.habito} se mide en ${existente.unidad ?? 'cantidad'}: escribe cuánto, por ejemplo "${l.habito} 2".`)
    }
    setEnviando(true)
    try {
      const esSiNo = existente ? existente.tipo_medida === 'si_no' : l.valor === null
      const id = existente?.id_seguimiento ?? await crearSeguimiento({
        nombre: l.habito, tipo_medida: esSiNo ? 'si_no' : 'numero', unidad: esSiNo ? null : l.unidad || null,
        frecuencia: 'dia', codigo_plantilla: 'habitos',
      }, null)
      const valor = esSiNo ? 1 : l.valor!
      const resultado = await registrar({ id_seguimiento: id, fecha_registro: l.fecha, valor, nota: null })
      const h = existente ?? { tipo_medida: esSiNo ? 'si_no' : 'numero', unidad: l.unidad || null, meta: null } as Seguimiento
      const nuevas = [...(marcas.get(id) ?? []), { fecha: l.fecha, valor }]
      setAviso(resultado === 'en_cola' ? 'Sin conexión: quedó guardado en este equipo y se enviará al volver la conexión.' : [
        `${l.habito}${l.fecha === hoy ? ' hoy' : ` el ${diaMes(l.fecha)}`}: ${delDia(h, nuevas, l.fecha)}.`,
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
    const conocidos = habitos.map(h => h.nombre)
    const aprendido = alias.get(leido.habito)
    if (conocidos.includes(leido.habito)) return guardar(leido)
    if (aprendido) return guardar({ ...leido, habito: aprendido })
    const sugerido = parecido(leido.habito, conocidos)
    if (sugerido) return setPregunta({ leido, sugerido })
    guardar(leido)
  }

  async function responder(correcto: string) {
    if (!pregunta) return
    await aprenderNombre('habito', pregunta.leido.habito, correcto).catch(() => {})
    await guardar({ ...pregunta.leido, habito: correcto })
  }

  return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado"><div><h1>Hábitos</h1></div></header>
      <form className="formulario" onSubmit={enviar}>
        <h2>Registrar hábito</h2>
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
                    <span>racha <strong>{dias(racha(suyas, hoy, metaDe(h)))}</strong> <span className="tenue">· mejor {dias(mejorRacha(suyas, metaDe(h)))}</span></span>
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
