import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aprenderCategoria, cambiarEstadoRecibo, crearRecibo, deshacerPago, marcarSinPago, obtenerRecibos, pagarRecibo, quitarRecibo, renombrarRecibo, verNumeroCuenta,
} from '../datos'
import { formatoValor } from '../indicadores'
import Grafico from '../Grafico'
import { mesesAntes } from './calculos'
import { categoriaDe, leerMonto, leidoDe, MONTO_INVALIDO, normalizar, type Categoria } from './parseo'
import { diaAprendido, nombreRecibo, recibosDelMes, sinPagarMesAnterior, valoresEnElTiempo, type EstadoRecibo, type FilaRecibo } from './estadoRecibos'

type Datos = Awaited<ReturnType<typeof obtenerRecibos>>

const pesos = (v: number) => formatoValor('dinero', v)
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const nombreMes = (periodo: string) => new Date(`${periodo}T12:00`).toLocaleDateString('es-CO', { month: 'long' })
const confirmaPago = (nombre: string, valor: number) => confirm(`¿Pagar ${nombre} por ${pesos(valor)}?`)
const ESTADO: Record<EstadoRecibo, { texto: string; clase: string }> = {
  vencido: { texto: '✕ Vencido', clase: 'fuera' },
  por_pagar: { texto: '◐ Por pagar', clase: 'cerca' },
  sin_pendiente: { texto: 'Sin pendiente', clase: '' },
  pagado: { texto: '✓ Pagado', clase: 'en-meta' },
}

export default function Recibos({ idGastos, categorias, aprendido, abrirNueva, alCambiar }: {
  idGastos: string
  abrirNueva?: boolean
  categorias: Categoria[]
  aprendido: Map<string, string>
  alCambiar: () => Promise<void>
}) {
  const hoy = hoyIso()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    try {
      setDatos(await obtenerRecibos(`${mesesAntes(hoy.slice(0, 7), 12)}-01`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [hoy])
  useEffect(() => { cargar() }, [cargar])

  const activos = useMemo(() => datos?.recibos.filter(r => r.estado !== 'no_se_paga') ?? [], [datos])
  const pausados = datos?.recibos.filter(r => r.estado === 'no_se_paga') ?? []
  const filas = useMemo(() => datos ? recibosDelMes(activos, datos.pagos, hoy) : [], [datos, activos, hoy])
  const [grupo, setGrupo] = useState<'por_pagar' | 'pagadas' | 'pausa'>('por_pagar')
  const porPagar = filas.filter(f => f.estado === 'vencido' || f.estado === 'por_pagar')
  const pagadas = filas.filter(f => f.estado === 'pagado' || f.estado === 'sin_pendiente')
  const visibles = grupo === 'pagadas' ? pagadas : porPagar
  const atrasados = useMemo(() => datos ? sinPagarMesAnterior(activos, datos.pagos, hoy) : [], [datos, activos, hoy])
  const idHogar = categorias.find(c => normalizar(c.nombre).startsWith('hogar'))?.id_etiqueta ?? null

  // Hogar va a básico en Hogar; personal, a personal en la categoría aprendida o la elegida (que se aprende).
  // periodo: otro mes (lo que quedó sin pagar); entonces no mueve el día aprendido.
  async function pagar(idRecibo: string, nombre: string, servicio: string, tipo: 'hogar' | 'personal', valor: number, categoria: Categoria | null,
    periodo?: string) {
    const propuesta = categoriaDe(servicio, aprendido, categorias)
    await pagarRecibo({
      id_recibo: idRecibo, fecha_periodo: periodo ?? `${hoy.slice(0, 7)}-01`, valor, fecha_pago: hoy,
      dia_pago: periodo ? null : diaAprendido([...(datos?.pagos.filter(p => p.id_recibo === idRecibo) ?? []),
        { id_pago_recibo: '', id_recibo: idRecibo, id_registro: null, fecha_periodo: '', valor, fecha_pago: hoy, estado: 'pagado' }]),
      gasto: {
        id_seguimiento: idGastos, nota: `Factura ${nombre}`,
        id_etiqueta: tipo === 'hogar' ? idHogar : categoria?.id_etiqueta ?? null,
        // la factura personal toma el grupo de su categoría, como un gasto normal
        grupo: tipo === 'hogar' ? 'basico' : null,
      },
    })
    if (tipo === 'personal' && categoria && categoria.id_etiqueta !== propuesta?.id_etiqueta)
      await aprenderCategoria(normalizar(servicio), categoria.nombre).catch(() => {})
    setAviso(`Pagado ${nombre}: ${pesos(valor)}.`)
    await Promise.all([cargar(), alCambiar()])
  }

  async function accion(hacer: () => Promise<unknown>, mensaje: string) {
    try {
      await hacer()
      setAviso(mensaje)
      setError('')
      await Promise.all([cargar(), alCambiar()])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  return (
    <>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <p className="tenue explica">Aquí guardas tus facturas fijas (luz, agua, internet…). Cada mes vuelven a quedar por pagar; las que pausas no cuentan hasta que las actives.</p>
      <NuevoRecibo inicial={abrirNueva} categorias={categorias} alGuardar={async (nuevo, valor, categoria) => {
        const nombre = nuevo.nombre_ubicacion ? `${nuevo.nombre_servicio} · ${nuevo.nombre_ubicacion}` : nuevo.nombre_servicio
        if (valor === null) {
          await crearRecibo({ ...nuevo, estado: 'no_se_paga' })
          setAviso(`${nombre} guardada en pausa.`)
          return cargar()
        }
        const id = await crearRecibo({ ...nuevo, estado: 'activo' })
        await pagar(id, nombre, nuevo.nombre_servicio, nuevo.tipo_recibo, valor, categoria)
      }} />
      {atrasados.length > 0 && (
        <section>
          <h2>Quedaron sin pagar en {nombreMes(atrasados[0].periodo)}</h2>
          <ul className="lista">
            {atrasados.map(a => (
              <SinPagar key={a.recibo.id_recibo} nombre={a.nombre} valor={a.valor}
                propuesta={a.recibo.tipo_recibo === 'personal' ? categoriaDe(a.recibo.nombre_servicio, aprendido, categorias) : null}
                alPagar={valor => !confirmaPago(`${a.nombre} de ${nombreMes(a.periodo)}`, valor) ? Promise.resolve()
                  : pagar(a.recibo.id_recibo, a.nombre, a.recibo.nombre_servicio, a.recibo.tipo_recibo, valor,
                    a.recibo.tipo_recibo === 'personal' ? categoriaDe(a.recibo.nombre_servicio, aprendido, categorias) : null, a.periodo)}
                alDescartar={() => accion(() => marcarSinPago(a.recibo.id_recibo, a.periodo), `${a.nombre}: ${nombreMes(a.periodo)} quedó como no pagado.`)} />
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2>Mis facturas</h2>
        <div className="chips" role="radiogroup" aria-label="Ver facturas">
          {([['por_pagar', 'Por pagar', porPagar.length], ['pagadas', 'Pagadas', pagadas.length], ['pausa', 'En pausa', pausados.length]] as const).map(([g, texto, n]) => (
            <button key={g} type="button" role="radio" aria-checked={grupo === g} className="chip" onClick={() => setGrupo(g)}>{texto} ({n})</button>
          ))}
        </div>
      </section>
      {grupo !== 'pausa' && (
        <ul className="lista">
          {!visibles.length && <li className="tenue">{grupo === 'por_pagar' ? 'No tienes facturas por pagar este mes.' : 'Aún no has pagado facturas este mes.'}</li>}
          {visibles.map(f => (
            <FilaDeRecibo key={f.recibo.id_recibo} fila={f} categorias={categorias}
              propuesta={f.recibo.tipo_recibo === 'personal' ? categoriaDe(f.recibo.nombre_servicio, aprendido, categorias) : null}
              alPagar={(valor, categoria) => pagar(f.recibo.id_recibo, f.nombre, f.recibo.nombre_servicio, f.recibo.tipo_recibo, valor, categoria)
                .then(() => setError(''))}
              alDeshacer={() => accion(() => deshacerPago(f.pago!), `Deshecho el pago de ${f.nombre}.`)}
              alPausar={() => accion(() => cambiarEstadoRecibo(f.recibo.id_recibo, 'no_se_paga'), `${f.nombre} quedó en pausa.`)}
              alQuitar={() => confirm(`¿Quitar ${f.nombre}? Su historial de pagos se conserva.`) &&
                accion(() => quitarRecibo(f.recibo.id_recibo), `${f.nombre} quitada.`)}
              alRenombrar={async nombres => {
                await renombrarRecibo(f.recibo.id_recibo, nombres)
                setAviso(`${f.nombre} ahora se llama ${nombreRecibo({ ...f.recibo, ...nombres })}.`)
                setError('')
                await Promise.all([cargar(), alCambiar()])
              }} />
          ))}
        </ul>
      )}
      {grupo === 'pausa' && (
        <>
          <p className="tenue">No cuentan en el mes ni en los avisos. Actívalas cuando vuelvas a pagarlas.</p>
          {!pausados.length && <p className="tenue">No tienes facturas en pausa.</p>}
          <ul className="lista">
            {pausados.map(r => (
              <li key={r.id_recibo} className="dos">
                <span>{nombreRecibo(r)}</span>
                <button className="secundario" onClick={() => accion(() => cambiarEstadoRecibo(r.id_recibo, 'activo'), `${nombreRecibo(r)} está activa.`)}>Activar</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <EnElTiempo filas={filas} datos={datos} />
    </>
  )
}

function FilaDeRecibo({ fila, categorias, propuesta, alPagar, alDeshacer, alPausar, alQuitar, alRenombrar }: {
  fila: FilaRecibo
  categorias: Categoria[]
  propuesta: Categoria | null
  alPagar: (valor: number, categoria: Categoria | null) => Promise<void>
  alDeshacer: () => void
  alPausar: () => void
  alQuitar: () => void
  alRenombrar: (nombres: { nombre_servicio: string; nombre_ubicacion: string | null }) => Promise<void>
}) {
  const { recibo, nombre, estado, valor, dia } = fila
  const [monto, setMonto] = useState(valor ? Math.round(valor).toLocaleString('es-CO') : '')
  const [elegida, setElegida] = useState(propuesta?.id_etiqueta ?? '')
  const [numero, setNumero] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [renombrando, setRenombrando] = useState<{ servicio: string; ubicacion: string } | null>(null)
  const pideCategoria = recibo.tipo_recibo === 'personal'
  const [pagando, setPagando] = useState(false)

  async function pagar(evento: FormEvent) {
    evento.preventDefault()
    const n = leerMonto(monto)
    if (n === null) return setMensaje(MONTO_INVALIDO)
    if (pideCategoria && !elegida) return setMensaje('Elige en qué categoría va.')
    setEnviando(true)
    try {
      await alPagar(n, categorias.find(c => c.id_etiqueta === elegida) ?? null)
      setMensaje('')
      setPagando(false)
    } catch (e) {
      setMensaje((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  async function renombrar(evento: FormEvent) {
    evento.preventDefault()
    const limpio = (t: string) => t.replace(/\s+/g, ' ').trim()
    const servicio = limpio(renombrando?.servicio ?? '')
    const ubicacion = recibo.tipo_recibo === 'hogar' ? limpio(renombrando?.ubicacion ?? '') : ''
    if (!servicio || servicio.length > 60) return setMensaje('Escribe el servicio, de 1 a 60 letras.')
    if (recibo.tipo_recibo === 'hogar' && (!ubicacion || ubicacion.length > 60)) return setMensaje('Escribe la ubicación, de 1 a 60 letras.')
    if (servicio === recibo.nombre_servicio && (ubicacion || null) === recibo.nombre_ubicacion) return setRenombrando(null)
    setEnviando(true)
    try {
      await alRenombrar({ nombre_servicio: servicio, nombre_ubicacion: ubicacion || null })
      setRenombrando(null)
      setMensaje('')
    } catch (e) {
      setMensaje((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  async function alternarNumero() {
    try {
      setNumero(numero ? null : await verNumeroCuenta(recibo.id_recibo))
    } catch (e) {
      setMensaje((e as Error).message)
    }
  }

  const leido = leerMonto(monto)
  return (
    <li className="recibo">
      <span>
        {nombre}
        <span className="tenue">{dia ? ` · día ${dia}` : ''}</span>
      </span>
      <strong>{valor !== null ? pesos(valor) : ''}</strong>
      <span className={`estado ${ESTADO[estado].clase}`}>{ESTADO[estado].texto}</span>
      {estado === 'pagado'
        ? <button className="secundario" onClick={alDeshacer}>Deshacer</button>
        : <button className="principal" aria-expanded={pagando} onClick={() => { setPagando(!pagando); setMensaje('') }}>{pagando ? 'Cancelar' : 'Pagar'}</button>}
      {pagando && estado !== 'pagado' && (
        <form className="fila-presupuesto" onSubmit={pagar}>
          <label htmlFor={`r-${recibo.id_recibo}`}>Valor pagado</label>
          <input id={`r-${recibo.id_recibo}`} maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder="Ej. 85 mil" autoFocus />
          <button className="principal" disabled={enviando || leido === null}>Confirmar pago{leido !== null ? ` de ${pesos(leido)}` : ''}</button>
          {pideCategoria && (
            <select aria-label={`Categoría de ${nombre}`} value={elegida} onChange={ev => setElegida(ev.target.value)}>
              <option value="">Categoría…</option>
              {categorias.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
            </select>
          )}
        </form>
      )}
      <details className="mas">
        <summary>Más</summary>
        <div className="chips">
          <button type="button" className="chip" onClick={() => {
            setRenombrando(renombrando ? null : { servicio: recibo.nombre_servicio, ubicacion: recibo.nombre_ubicacion ?? '' }); setMensaje('')
          }}>Renombrar</button>
          {recibo.numero_cuenta_enmascarado && (
            <button type="button" className="chip" onClick={alternarNumero}>{numero ? `Ocultar ${numero}` : `Ver número ${recibo.numero_cuenta_enmascarado}`}</button>
          )}
          {estado !== 'pagado' && <button type="button" className="chip" onClick={alPausar}>Pausar</button>}
          <button type="button" className="chip" onClick={alQuitar}>Quitar factura</button>
        </div>
      </details>
      {renombrando && (
        <form className="chips" onSubmit={renombrar}>
          <label>Servicio
            <input required maxLength={60} value={renombrando.servicio} autoComplete="off"
              onChange={ev => setRenombrando({ ...renombrando, servicio: ev.target.value })} />
          </label>
          {recibo.tipo_recibo === 'hogar' && (
            <label>Ubicación
              <input required maxLength={60} value={renombrando.ubicacion} autoComplete="off"
                onChange={ev => setRenombrando({ ...renombrando, ubicacion: ev.target.value })} />
            </label>
          )}
          <button className="chip" disabled={enviando}>Guardar</button>
          <button type="button" className="chip" onClick={() => { setRenombrando(null); setMensaje('') }}>Cancelar</button>
        </form>
      )}
      {mensaje && <p role="alert" className="error">{mensaje}</p>}
    </li>
  )
}

function NuevoRecibo({ inicial, categorias, alGuardar }: {
  inicial?: boolean
  categorias: Categoria[]
  // valor null = guardar sin pagar; false = no confirmó el pago
  alGuardar: (nuevo: Omit<Parameters<typeof crearRecibo>[0], 'estado'>, valor: number | null, categoria: Categoria | null) => Promise<unknown>
}) {
  const [abierto, setAbierto] = useState(!!inicial)
  const [servicio, setServicio] = useState('')
  const [tipo, setTipo] = useState<'hogar' | 'personal'>('hogar')
  const [ubicacion, setUbicacion] = useState('')
  const [numero, setNumero] = useState('')
  const [monto, setMonto] = useState('')
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pagarAhora, setPagarAhora] = useState(true)

  async function guardar() {
    const valor = pagarAhora ? leerMonto(monto) : null
    if (!servicio.trim()) return setError('Escribe el servicio, por ejemplo "Luz".')
    if (tipo === 'hogar' && !ubicacion.trim()) return setError('Escribe la ubicación del hogar.')
    if (pagarAhora && valor === null) return setError(MONTO_INVALIDO)
    if (pagarAhora && tipo === 'personal' && !elegida) return setError('Elige en qué categoría va.')
    setEnviando(true)
    try {
      if (await alGuardar({
        nombre_servicio: servicio.trim(), tipo_recibo: tipo,
        nombre_ubicacion: tipo === 'hogar' ? ubicacion.trim() : null, numero_cuenta: numero.trim() || null,
      }, valor, categorias.find(c => c.id_etiqueta === elegida) ?? null) === false) return
      setServicio(''); setUbicacion(''); setNumero(''); setMonto(''); setElegida(''); setError(''); setAbierto(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      <button className={abierto ? 'secundario' : 'principal'} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? 'Cerrar' : '+ Agregar factura'}
      </button>
      {abierto && (
        <form className="formulario" onSubmit={ev => { ev.preventDefault(); guardar() }}>
          <div className="chips" role="radiogroup" aria-label="Tipo de factura">
            {(['hogar', 'personal'] as const).map(t => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} className="chip" onClick={() => setTipo(t)}>
                {t === 'hogar' ? 'Hogar' : 'Personal'}
              </button>
            ))}
          </div>
          <label>Servicio<input required maxLength={60} value={servicio} onChange={ev => setServicio(ev.target.value)} placeholder="Qué servicio pagas" autoComplete="off" autoFocus={inicial} /><small className="ayuda">Ej.: Luz, Agua, Internet</small></label>
          {tipo === 'hogar' && (
            <label>Ubicación<input required maxLength={60} value={ubicacion} onChange={ev => setUbicacion(ev.target.value)} placeholder="Dónde llega la factura" autoComplete="off" /><small className="ayuda">Ej.: Casa, La Mesa</small></label>
          )}
          {tipo === 'personal' && pagarAhora && (
            <label>Categoría
              <select value={elegida} onChange={ev => setElegida(ev.target.value)}>
                <option value="">Elige…</option>
                {categorias.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
              </select>
            </label>
          )}
          <label>Número de cuenta (opcional)
            <input maxLength={40} value={numero} onChange={ev => setNumero(ev.target.value)} autoComplete="off" />
            <small className="ayuda">El de la factura; se muestra oculto (****1234)</small>
          </label>
          <div className="chips" role="radiogroup" aria-label="¿La pagas ahora?">
            <span className="tenue">¿La pagas ahora?</span>
            <button type="button" role="radio" aria-checked={pagarAhora} className="chip" onClick={() => setPagarAhora(true)}>Sí, la pago ahora</button>
            <button type="button" role="radio" aria-checked={!pagarAhora} className="chip" onClick={() => setPagarAhora(false)}>No, solo guardarla</button>
          </div>
          {pagarAhora && <label>Valor pagado<input maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder="Valor que pagaste" /><small className="ayuda" aria-live="polite">{leidoDe(monto) || 'Ej.: 85 mil o 85.000'}</small></label>}
          <button className="principal" disabled={enviando}>
            {pagarAhora ? `Guardar y pagar${leerMonto(monto) !== null ? ` ${pesos(leerMonto(monto)!)}` : ''}` : 'Guardar en pausa'}
          </button>
          {!pagarAhora && <small className="ayuda">Queda en "En pausa": no cuenta hasta que la actives.</small>}
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </section>
  )
}

function SinPagar({ nombre, valor, propuesta, alPagar, alDescartar }: {
  nombre: string; valor: number; propuesta: Categoria | null; alPagar: (valor: number) => Promise<unknown>; alDescartar: () => void
}) {
  const [monto, setMonto] = useState(Math.round(valor).toLocaleString('es-CO'))
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function pagar(evento: FormEvent) {
    evento.preventDefault()
    const n = leerMonto(monto)
    if (n === null) return setMensaje(MONTO_INVALIDO)
    setEnviando(true)
    try {
      await alPagar(n)
      setMensaje('')
    } catch (e) {
      setMensaje((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <li className="recibo">
      <span>{nombre}{propuesta && <span className="tenue"> · {propuesta.nombre}</span>}</span>
      <strong>{pesos(valor)}</strong>
      <span className="estado fuera">✕ Sin pagar</span>
      <form className="fila-presupuesto" onSubmit={pagar}>
        <label htmlFor={`a-${nombre}`}>Valor real</label>
        <input id={`a-${nombre}`} maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} />
        <button className="secundario" disabled={enviando}>Pagar</button>
        <button type="button" className="enlace" onClick={alDescartar}>No se pagó ese mes</button>
      </form>
      {mensaje && <p role="alert" className="error">{mensaje}</p>}
    </li>
  )
}

function EnElTiempo({ filas, datos }: { filas: FilaRecibo[]; datos: Datos }) {
  const conPagos = filas.filter(f => valoresEnElTiempo(datos.pagos, f.recibo.id_recibo).length > 1)
  const [elegido, setElegido] = useState('')
  const actual = conPagos.find(f => f.recibo.id_recibo === elegido) ?? conPagos[0]
  const puntos = useMemo(() => actual ? valoresEnElTiempo(datos.pagos, actual.recibo.id_recibo) : [], [actual, datos])
  if (!actual) return null
  return (
    <section>
      <h2>¿Cómo ha cambiado el valor de cada factura?</h2>
      <div className="formulario">
        <label>Factura
          <select value={actual.recibo.id_recibo} onChange={ev => setElegido(ev.target.value)}>
            {conPagos.map(f => <option key={f.recibo.id_recibo} value={f.recibo.id_recibo}>{f.nombre}</option>)}
          </select>
        </label>
      </div>
      <Grafico puntos={puntos} color={cssVar('--acento')} colorMeta={cssVar('--tenue')} formato={pesos}
        formatoEje={v => `$${new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}`}
        descripcion={`Valor pagado de ${actual.nombre} en el último año`} />
    </section>
  )
}
