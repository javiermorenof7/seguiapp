import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Selector from '../Selector'
import {
  aprenderNombre, crearHabito, eliminarRegistro, guardarMeta, obtenerAlias, quitarSeguimiento, registrar, renombrarHabito, type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor } from '../indicadores'
import { normalizar } from '../finanzas/parseo'
import Grafico from '../Grafico'
import Periodo, { useRegistrosDe, type Rango } from '../Periodo'
import SinDatos from '../SinDatos'
import MapaSemanas from '../MapaSemanas'
import Barras from '../finanzas/Barras'
import { Avance } from '../finanzas/Medidas'
import Historial, { FilaSimple } from '../historial/Historial'
import { parecido, restarDias } from '../salud/calculos'
import { calendarioSemanas, cumplidosEstaSemana, dias, diasHechos, leerCantidad, mismoNombre, mejorRacha, racha, totalDelDia, ultimosDias, type Leido, type Marca } from './calculos'

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

export default function Habitos({ seguimientos, registros, enfocar, alVolver, alCambiar }: {
  seguimientos: Seguimiento[]
  enfocar?: boolean
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
  const [pregunta, setPregunta] = useState<{ leido: Leido; sugerido: string } | null>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmar, setConfirmar] = useState<string | null>(null)
  const [pestana, setPestana] = useState<'resumen' | 'habitos' | 'historial'>(enfocar ? 'habitos' : 'resumen')
  const [registrando, setRegistrando] = useState(!!enfocar)
  // el Resumen mira la última semana o el último mes, siempre hasta hoy
  const [periodo, setPeriodo] = useState<7 | 30>(7)
  // los que aún no se marcan hoy, primero los que más se marcan en este día de la semana
  const sugeridosHoy = useMemo(() => {
    const dia = new Date(`${hoy}T12:00`).getDay()
    const veces = (id: string) => (marcas.get(id) ?? []).filter(m => new Date(`${m.fecha}T12:00`).getDay() === dia).length
    return habitos.filter(h => !(marcas.get(h.id_seguimiento) ?? []).some(m => m.fecha === hoy))
      .sort((a, b) => veces(b.id_seguimiento) - veces(a.id_seguimiento)).slice(0, 5).map(h => h.nombre)
  }, [habitos, marcas, hoy])
  const deHoy = registros.filter(r => r.fecha === hoy && habitos.some(h => h.id_seguimiento === r.id_seguimiento))
  const [renombrando, setRenombrando] = useState<{ id: string; nombre: string } | null>(null)

  useEffect(() => { obtenerAlias('habito').then(setAlias).catch(e => setError((e as Error).message)) }, [])

  async function guardar(l: Leido) {
    const existente = habitos.find(h => mismoNombre(h.nombre, l.habito))
    const nombre = existente?.nombre ?? l.habito
    if (existente?.tipo_medida === 'numero' && l.valor === null) {
      return setError(`${nombre} se mide en ${existente.unidad ?? 'cantidad'}: escribe cuánto, por ejemplo "${nombre} 2".`)
    }
    // los de sí/no se cumplen una vez al día; los de cantidad sí se suman
    if (existente?.tipo_medida === 'si_no' && marcas.get(existente.id_seguimiento)?.some(m => m.fecha === l.fecha)
      && !confirm(`Ya marcaste ${nombre} ${l.fecha === hoy ? 'hoy' : `el ${diaMes(l.fecha)}`}. ¿Marcarlo otra vez?`)) return
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
  function enviar(leido: Leido) {
    setPregunta(null)
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
      <div className="chips pestanas" role="radiogroup" aria-label="Sección de Hábitos">
        {(['resumen', 'habitos', 'historial'] as const).map(p => (
          <button key={p} type="button" role="radio" aria-checked={pestana === p} className="chip" onClick={() => setPestana(p)}>
            {p === 'resumen' ? 'Resumen' : p === 'habitos' ? 'Mis hábitos' : 'Historial'}
          </button>
        ))}
      </div>
      {pestana === 'resumen' && (habitos.length ? (
        <>
          <div className="panel-periodo">
            <span className="etiqueta">Período</span>
            <div className="chips segmentado" role="radiogroup" aria-label="Período">
              {([[7, 'Última semana'], [30, 'Último mes']] as const).map(([n, texto]) => (
                <button key={n} type="button" role="radio" aria-checked={periodo === n} className="chip" onClick={() => setPeriodo(n)}>{texto}</button>
              ))}
            </div>
          </div>
          <CumplidosHoy habitos={habitos} marcas={marcas} hoy={hoy} alVer={() => setPestana('habitos')} />
          <Constancia habitos={habitos} marcas={marcas} hoy={hoy} dias={periodo} />
          <Rachas habitos={habitos} marcas={marcas} hoy={hoy} />
          <Detalle habitos={habitos} marcas={marcas} hoy={hoy} alCambiar={alCambiar} />
        </>
      ) : (
        <p className="tenue">Aún no hay hábitos. <button className="enlace" onClick={() => { setPestana('habitos'); setRegistrando(true) }}>Registra el primero</button>.</p>
      ))}
      {pestana === 'habitos' && (
        <>
      {registrando
        ? <Formulario habitos={habitos} sugeridos={sugeridosHoy} hoy={hoy} enviando={enviando || !alias} enfocar alEnviar={enviar} />
        : <section><button className="principal registrar-uno" onClick={() => setRegistrando(true)}>+ Registrar hábito</button></section>}
      {pregunta && (
        <div className="chips" role="group" aria-label="¿Quisiste decir…?">
          <span>¿Quisiste decir <strong>{pregunta.sugerido}</strong>?</span>
          <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.sugerido)}>Sí</button>
          <button type="button" className="chip" disabled={enviando} onClick={() => responder(pregunta.leido.habito)}>No, es nuevo</button>
        </div>
      )}
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {habitos.length === 0 && <p className="tenue">Aún no hay hábitos. Escribe el primero, por ejemplo "leer" o "agua".</p>}
      {habitos.length > 0 && (
        <>
          <section>
            <h2>Lo que marcaste hoy</h2>
            {deHoy.length ? (
              <ul className="lista">
                {deHoy.map(r => {
                  const h = habitos.find(x => x.id_seguimiento === r.id_seguimiento)!
                  return <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={h.nombre}
                    detalle={h.tipo_medida === 'si_no' ? 'hecho' : formatoValor('numero', r.valor, h.unidad)}
                    alBorrar={() => eliminarRegistro(r.id_registro).then(alCambiar)} />
                })}
              </ul>
            ) : <p className="tenue">Aún no marcas nada hoy.</p>}
          </section>
          <section>
            <h2>Mis hábitos hoy</h2>
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
        </>
      )}
        </>
      )}
      {pestana === 'historial' && (
        <Historial
          ids={habitos.map(h => h.id_seguimiento)}
          registros={registros}
          filtros={[{ nombre: 'Hábito', opciones: habitos.map(h => [h.id_seguimiento, h.nombre] as [string, string]), de: r => r.id_seguimiento }]}
          suma={false}
          vista={elegidos => ({ modo: 'conteo', pregunta: '¿Cuántos hábitos cumpliste cada día?', maximoDia: elegidos['Hábito'] ? 1 : habitos.length })}
          total={lista => `${new Set(lista.map(r => r.fecha)).size} días con hábitos`}
          fila={r => {
            const h = habitos.find(x => x.id_seguimiento === r.id_seguimiento)!
            return <FilaSimple key={r.id_registro} fecha={r.fecha} titulo={h.nombre}
              detalle={h.tipo_medida === 'si_no' ? 'hecho' : formatoValor('numero', r.valor, h.unidad)}
              alBorrar={() => eliminarRegistro(r.id_registro).then(alCambiar)} />
          }}
        />
      )}
    </>
  )
}

// Registrar uno de los hábitos que ya existen: elegirlo, la cantidad si es de cantidad y el día.
// Un campo por dato: hábito (de la lista o nuevo), cantidad si se mide así y el día.
function Formulario({ habitos, sugeridos = [], hoy, enviando, enfocar, alEnviar }: {
  habitos: Seguimiento[]; sugeridos?: string[]; hoy: string; enviando: boolean; enfocar?: boolean; alEnviar: (l: Leido) => void
}) {
  const [nombre, setNombre] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [dia, setDia] = useState<'hoy' | 'ayer' | 'otro'>('hoy')
  const [fecha, setFecha] = useState(hoy)
  const [error, setError] = useState('')
  const existente = habitos.find(h => mismoNombre(h.nombre, nombre))
  const conCantidad = !existente || existente.tipo_medida === 'numero'

  function guardar(evento: FormEvent) {
    evento.preventDefault()
    const habito = nombre.replace(/\s+/g, ' ').trim()
    const elegida = dia === 'hoy' ? hoy : dia === 'ayer' ? restarDias(hoy, 1) : fecha
    if (!habito || habito.length > 60) return setError('Escribe el hábito, de 1 a 60 letras.')
    if (!elegida || elegida > hoy) return setError('Elige hoy o un día anterior.')
    const leida = cantidad.trim() ? leerCantidad(cantidad) : null
    if (cantidad.trim() && !leida) return setError('Escribe la cantidad con números, por ejemplo 2 o "2 litros".')
    if (existente?.tipo_medida === 'numero' && !leida) return setError(`${existente.nombre} se mide en ${existente.unidad ?? 'cantidad'}: escribe cuánto.`)
    setError('')
    alEnviar({ habito, valor: conCantidad ? leida?.valor ?? null : null, unidad: leida?.unidad ?? '', fecha: elegida })
    setNombre('')
    setCantidad('')
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <h2>Registrar hábito</h2>
      <label>Hábito
        <input required maxLength={60} value={nombre} list="habitos" onChange={ev => setNombre(ev.target.value)}
          placeholder="Qué hábito hiciste" autoComplete="off" autoFocus={enfocar} />
        <small className="ayuda">Ej.: agua, leer, meditar</small>
        {sugeridos.length > 0 && !nombre.trim() && (
          <span className="sugeridos">
            <span className="tenue">Te falta hoy (los que más haces este día)</span>
            <span className="chips">{sugeridos.map(n => <button key={n} type="button" className="chip" onClick={() => setNombre(n)}>{n}</button>)}</span>
          </span>
        )}
        <datalist id="habitos">{habitos.map(h => <option key={h.id_seguimiento} value={h.nombre} />)}</datalist>
      </label>
      {conCantidad && (
        <label>{existente ? `Cuánto${existente.unidad ? ` (${existente.unidad})` : ''}` : 'Cuánto (opcional, si lo mides)'}
          <input required={!!existente} inputMode="decimal" maxLength={20} value={cantidad} onChange={ev => setCantidad(ev.target.value)}
            placeholder={existente ? 'Cuánto hiciste' : 'Cuánto hiciste (opcional)'} autoComplete="off" />
          <small className="ayuda">{existente ? `Ej.: 2${existente.unidad ? ` ${existente.unidad}` : ''}` : 'Ej.: 2 litros o 10 minutos. Vacío si solo es hecho o no hecho.'}</small>
        </label>
      )}
      <fieldset>
        <legend>Día</legend>
        <div className="chips" role="radiogroup" aria-label="Día">
          {(['hoy', 'ayer', 'otro'] as const).map(d => (
            <button key={d} type="button" role="radio" aria-checked={dia === d} className="chip" onClick={() => setDia(d)}>
              {d === 'hoy' ? 'Hoy' : d === 'ayer' ? 'Ayer' : 'Otro día'}
            </button>
          ))}
        </div>
        {dia === 'otro' && <input type="date" aria-label="Fecha" required value={fecha} max={hoy} onChange={ev => setFecha(ev.target.value)} />}
      </fieldset>
      <button className="principal" disabled={enviando}>{existente?.tipo_medida === 'si_no' ? 'Hecho' : 'Guardar'}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

function Constancia({ habitos, marcas, hoy, dias: n }: { habitos: Seguimiento[]; marcas: Map<string, Marca[]>; hoy: string; dias: 7 | 30 }) {
  const filas = useMemo(() => habitos.map(h => ({ nombre: h.nombre, dias: diasHechos(marcas.get(h.id_seguimiento) ?? [], hoy, metaDe(h), n) }))
    .sort((a, b) => b.dias - a.dias), [habitos, marcas, hoy, n])
  const color = (d: number) => cssVar(d >= n ? '--en-meta' : d >= n / 2 ? '--cerca' : '--fuera')
  const series = useMemo(() => [{ nombre: 'Días', color: filas.map(f => color(f.dias)), datos: filas.map(f => f.dias) }], [filas]) // color solo depende de n
  const etiquetas = useMemo(() => filas.map(f => f.nombre), [filas])
  if (filas.every(f => !f.dias)) return (
    <SinDatos titulo={`No cumpliste hábitos en los últimos ${n} días`} detalle="Marca uno hoy en Mis hábitos para empezar una racha." />
  )
  return (
    <section>
      <h2>¿Cuántos días los cumplo?</h2>
      <p className="tenue">De los últimos {n} días</p>
      <p className="leyenda-estado">
        <span><i style={{ background: cssVar('--en-meta') }} />Todos los días</span>
        <span><i style={{ background: cssVar('--cerca') }} />La mitad o más</span>
        <span><i style={{ background: cssVar('--fuera') }} />Menos de la mitad</span>
      </p>
      <Barras horizontal maximo={n} etiquetas={etiquetas} series={series} formato={v => `${Math.round(v)} de ${n}`}
        colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion={`Días cumplidos en los últimos ${n}: ${filas.map(f => `${f.nombre} ${f.dias}`).join(', ')}`} />
    </section>
  )
}

function CumplidosHoy({ habitos, marcas, hoy, alVer }: { habitos: Seguimiento[]; marcas: Map<string, Marca[]>; hoy: string; alVer: () => void }) {
  const hechos = habitos.filter(h => diasHechos(marcas.get(h.id_seguimiento) ?? [], hoy, metaDe(h), 1) === 1).length
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cuántos cumplí hoy?</h2><button className="enlace" onClick={alVer}>Registrar →</button></div>
      <p><strong className="cifra-media">{hechos} de {habitos.length}</strong> <span className="tenue">{hechos === habitos.length ? '✓ Todos hechos' : `faltan ${habitos.length - hechos}`}</span></p>
      <Avance valor={hechos} tope={habitos.length} color={cssVar(hechos === habitos.length ? '--en-meta' : '--c1')} descripcion={`Hoy: ${hechos} de ${habitos.length} hábitos hechos`} />
    </section>
  )
}

function Rachas({ habitos, marcas, hoy }: { habitos: Seguimiento[]; marcas: Map<string, Marca[]>; hoy: string }) {
  const filas = habitos.map(h => {
    const suyas = marcas.get(h.id_seguimiento) ?? []
    return { h, actual: racha(suyas, hoy, metaDe(h)), mejor: mejorRacha(suyas, metaDe(h)) }
  }).sort((a, b) => b.actual - a.actual)
  return (
    <section>
      <h2>¿Cómo van mis rachas?</h2>
      <ul className="lista">
        {filas.map(f => (
          <li key={f.h.id_seguimiento} className="meta-avance">
            <span>{f.h.nombre}</span>
            <strong>{dias(f.actual)}<span className="tenue"> · mejor {dias(f.mejor)}</span></strong>
            <Avance valor={f.actual} tope={Math.max(f.mejor, 1)} color={cssVar('--c2')} descripcion={`${f.h.nombre}: racha de ${dias(f.actual)}, la mejor fue ${dias(f.mejor)}`} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Detalle({ habitos, marcas, hoy, alCambiar }: {
  habitos: Seguimiento[]; marcas: Map<string, Marca[]>; hoy: string; alCambiar: () => Promise<void>
}) {
  const [elegido, setElegido] = useState('')
  const h = habitos.find(x => x.id_seguimiento === elegido) ?? habitos[0]
  const [rango, setRango] = useState<Rango>(30)
  const suyas = marcas.get(h.id_seguimiento) ?? []
  const historial = useRegistrosDe(h.id_seguimiento, h.tipo_medida === 'numero' ? rango : 30, suyas)
  const meta = metaDe(h)
  // con "Todo" se ve desde la primera marca
  const enRango = useMemo(() => ultimosDias(historial, hoy, rango || Math.max(2, ...historial.map(r => Math.round((Date.parse(hoy) - Date.parse(r.fecha)) / 864e5) + 1))),
    [historial, hoy, rango])
  const calendario = useMemo(() => calendarioSemanas(suyas, hoy, meta), [suyas, hoy, meta])
  return (
    <section>
      <h2>¿Cómo voy en cada hábito?</h2>
      <Selector id="filtro-habito" titulo="Hábito" icono="🎯" valor={h.id_seguimiento} alCambiar={setElegido}>
        {habitos.map(x => <option key={x.id_seguimiento} value={x.id_seguimiento}>{x.nombre}</option>)}
      </Selector>
      <p><strong>Racha: {dias(racha(suyas, hoy, meta))}</strong> <span className="tenue">· mejor {dias(mejorRacha(suyas, meta))}</span></p>
      <h3>Últimas 12 semanas</h3>
      <MapaSemanas dias={calendario} hoy={hoy}
        descripcion={`${h.nombre}: cumplido ${calendario.filter(d => d.nivel === 2).length} de los últimos ${calendario.filter(d => d.nivel !== null).length} días`}
        textos={{ hecho: 'Cumplido', parcial: h.tipo_medida === 'numero' ? 'Sin llegar a la meta' : undefined, nada: 'Nada' }}
        resumen={<p>Esta semana: <strong>{dias(cumplidosEstaSemana(calendario))} de 7</strong></p>} />
      {h.tipo_medida === 'numero' && (
        <>
          <Periodo valor={rango} alCambiar={setRango} />
          <Grafico puntos={enRango} meta={meta} color={cssVar('--c1')} colorMeta={cssVar('--tenue')}
            formato={v => formatoValor('numero', v, h.unidad)} etiquetaMeta={meta ? `Meta ${formatoValor('numero', meta, h.unidad)}` : undefined}
            descripcion={`${h.nombre} por día ${rango ? `en los últimos ${rango} días` : 'en todo el historial'}${meta ? '; la línea punteada es la meta diaria' : ''}`} />
        </>
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
