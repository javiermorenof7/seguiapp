import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aprenderCategoria, crearRecibo, deshacerPago, obtenerRecibos, pagarRecibo, quitarRecibo, renombrarRecibo, verNumeroCuenta,
} from '../datos'
import { formatoValor } from '../indicadores'
import Grafico from '../Grafico'
import Barras from './Barras'
import { mesesAntes } from './calculos'
import { categoriaDe, normalizar, type Categoria } from './parseo'
import { diaAprendido, nombreRecibo, recibosDelMes, totalesDelMes, valoresEnElTiempo, type EstadoRecibo, type FilaRecibo } from './estadoRecibos'

type Datos = Awaited<ReturnType<typeof obtenerRecibos>>

const pesos = (v: number) => formatoValor('dinero', v)
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const leerPesos = (texto: string) => {
  const limpio = texto.replace(/[.\s$]/g, '')
  const n = Number(limpio)
  return limpio && Number.isInteger(n) && n >= 0 && n < 1e12 ? n : null
}
const ESTADO: Record<EstadoRecibo, { texto: string; clase: string }> = {
  vencido: { texto: '✕ Vencido', clase: 'fuera' },
  por_pagar: { texto: '◐ Por pagar', clase: 'cerca' },
  sin_pendiente: { texto: 'Sin pendiente', clase: '' },
  pagado: { texto: '✓ Pagado', clase: 'en-meta' },
}

export default function Recibos({ idGastos, categorias, aprendido, alCambiar }: {
  idGastos: string
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

  const filas = useMemo(() => datos ? recibosDelMes(datos.recibos, datos.pagos, hoy) : [], [datos, hoy])
  const idHogar = categorias.find(c => normalizar(c.nombre).startsWith('hogar'))?.id_etiqueta ?? null

  // Hogar va a básico en Hogar; personal, a personal en la categoría aprendida o la elegida (que se aprende).
  async function pagar(idRecibo: string, nombre: string, servicio: string, tipo: 'hogar' | 'personal', valor: number, categoria: Categoria | null) {
    const propuesta = categoriaDe(servicio, aprendido, categorias)
    await pagarRecibo({
      id_recibo: idRecibo, fecha_periodo: `${hoy.slice(0, 7)}-01`, valor, fecha_pago: hoy,
      dia_pago: diaAprendido([...(datos?.pagos.filter(p => p.id_recibo === idRecibo) ?? []),
        { id_pago_recibo: '', id_recibo: idRecibo, id_registro: null, fecha_periodo: '', valor, fecha_pago: hoy, estado: 'pagado' }]),
      gasto: {
        id_seguimiento: idGastos, nota: `Factura ${nombre}`,
        id_etiqueta: tipo === 'hogar' ? idHogar : categoria?.id_etiqueta ?? null,
        grupo: tipo === 'hogar' ? 'basico' : 'personal',
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
      <DelMes filas={filas} />
      <section>
        <h2>Facturas del mes</h2>
        {!filas.length && <p className="tenue">Aún no tienes facturas. Agrega una abajo al pagarla.</p>}
        <ul className="lista">
          {filas.map(f => (
            <FilaDeRecibo key={f.recibo.id_recibo} fila={f} categorias={categorias}
              propuesta={f.recibo.tipo_recibo === 'personal' ? categoriaDe(f.recibo.nombre_servicio, aprendido, categorias) : null}
              alPagar={(valor, categoria) => pagar(f.recibo.id_recibo, f.nombre, f.recibo.nombre_servicio, f.recibo.tipo_recibo, valor, categoria)
                .then(() => setError(''))}
              alDeshacer={() => accion(() => deshacerPago(f.pago!), `Deshecho el pago de ${f.nombre}.`)}
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
      </section>
      <NuevoRecibo categorias={categorias} alGuardar={async (nuevo, valor, categoria) => {
        const id = await crearRecibo(nuevo)
        const nombre = nuevo.nombre_ubicacion ? `${nuevo.nombre_servicio} · ${nuevo.nombre_ubicacion}` : nuevo.nombre_servicio
        await pagar(id, nombre, nuevo.nombre_servicio, nuevo.tipo_recibo, valor, categoria)
      }} />
      <EnElTiempo filas={filas} datos={datos} />
    </>
  )
}

function FilaDeRecibo({ fila, categorias, propuesta, alPagar, alDeshacer, alQuitar, alRenombrar }: {
  fila: FilaRecibo
  categorias: Categoria[]
  propuesta: Categoria | null
  alPagar: (valor: number, categoria: Categoria | null) => Promise<void>
  alDeshacer: () => void
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

  async function pagar(evento: FormEvent) {
    evento.preventDefault()
    const n = leerPesos(monto)
    if (n === null) return setMensaje('Escribe el valor pagado en pesos sin decimales.')
    if (pideCategoria && !elegida) return setMensaje('Elige en qué categoría va.')
    setEnviando(true)
    try {
      await alPagar(n, categorias.find(c => c.id_etiqueta === elegida) ?? null)
      setMensaje('')
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

  return (
    <li className="recibo">
      <span>
        {nombre}
        <span className="tenue">
          {dia ? ` · día ${dia}` : ''}
          {recibo.numero_cuenta_enmascarado && <> · {numero ?? recibo.numero_cuenta_enmascarado}{' '}
            <button type="button" className="enlace" onClick={alternarNumero}>{numero ? 'ocultar' : 'ver'}</button></>}
          {' · '}<button type="button" className="enlace" aria-expanded={!!renombrando} onClick={() => {
            setRenombrando(renombrando ? null : { servicio: recibo.nombre_servicio, ubicacion: recibo.nombre_ubicacion ?? '' }); setMensaje('')
          }}>Renombrar</button>
        </span>
      </span>
      <strong>{valor !== null ? pesos(valor) : ''}</strong>
      <span className={`estado ${ESTADO[estado].clase}`}>{ESTADO[estado].texto}</span>
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
      {estado === 'pagado'
        ? <div className="acciones"><button className="secundario" onClick={alDeshacer}>Deshacer</button></div>
        : (
          <form className="fila-presupuesto" onSubmit={pagar}>
            <label htmlFor={`r-${recibo.id_recibo}`}>Valor real</label>
            <input id={`r-${recibo.id_recibo}`} inputMode="numeric" maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder="0" />
            <button className="secundario" disabled={enviando}>Pagar</button>
            {pideCategoria && (
              <select aria-label={`Categoría de ${nombre}`} value={elegida} onChange={ev => setElegida(ev.target.value)}>
                <option value="">Categoría…</option>
                {categorias.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
              </select>
            )}
            <button type="button" className="enlace" onClick={alQuitar}>Quitar factura</button>
          </form>
        )}
      {mensaje && <p role="alert" className="error">{mensaje}</p>}
    </li>
  )
}

function NuevoRecibo({ categorias, alGuardar }: {
  categorias: Categoria[]
  alGuardar: (nuevo: Parameters<typeof crearRecibo>[0], valor: number, categoria: Categoria | null) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const [servicio, setServicio] = useState('')
  const [tipo, setTipo] = useState<'hogar' | 'personal'>('hogar')
  const [ubicacion, setUbicacion] = useState('')
  const [numero, setNumero] = useState('')
  const [monto, setMonto] = useState('')
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const valor = leerPesos(monto)
    if (!servicio.trim()) return setError('Escribe el servicio, por ejemplo "Luz".')
    if (tipo === 'hogar' && !ubicacion.trim()) return setError('Escribe la ubicación del hogar.')
    if (valor === null) return setError('Escribe el valor pagado en pesos sin decimales.')
    if (tipo === 'personal' && !elegida) return setError('Elige en qué categoría va.')
    setEnviando(true)
    try {
      await alGuardar({
        nombre_servicio: servicio.trim(), tipo_recibo: tipo,
        nombre_ubicacion: tipo === 'hogar' ? ubicacion.trim() : null, numero_cuenta: numero.trim() || null,
      }, valor, categorias.find(c => c.id_etiqueta === elegida) ?? null)
      setServicio(''); setUbicacion(''); setNumero(''); setMonto(''); setElegida(''); setError(''); setAbierto(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? 'Cerrar' : 'Pagar una factura nueva'}
      </button>
      {abierto && (
        <form className="formulario" onSubmit={guardar}>
          <div className="chips" role="radiogroup" aria-label="Tipo de factura">
            {(['hogar', 'personal'] as const).map(t => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} className="chip" onClick={() => setTipo(t)}>
                {t === 'hogar' ? 'Hogar' : 'Personal'}
              </button>
            ))}
          </div>
          <label>Servicio<input required maxLength={60} value={servicio} onChange={ev => setServicio(ev.target.value)} placeholder="Luz" autoComplete="off" /></label>
          {tipo === 'hogar' && (
            <label>Ubicación<input required maxLength={60} value={ubicacion} onChange={ev => setUbicacion(ev.target.value)} placeholder="La Mesa" autoComplete="off" /></label>
          )}
          {tipo === 'personal' && (
            <label>Categoría
              <select value={elegida} onChange={ev => setElegida(ev.target.value)}>
                <option value="">Elige…</option>
                {categorias.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
              </select>
            </label>
          )}
          <label>Número de cuenta (opcional)
            <input maxLength={40} value={numero} onChange={ev => setNumero(ev.target.value)} autoComplete="off" />
          </label>
          <label>Valor pagado<input required inputMode="numeric" maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder="0" /></label>
          <button className="principal" disabled={enviando}>Guardar y pagar</button>
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </section>
  )
}

function DelMes({ filas }: { filas: FilaRecibo[] }) {
  const t = totalesDelMes(filas)
  const series = useMemo(() => [{
    nombre: 'Este mes', datos: [t.pagado, t.porPagar, t.vencido], color: [cssVar('--en-meta'), cssVar('--cerca'), cssVar('--fuera')],
  }], [t.pagado, t.porPagar, t.vencido])
  if (!t.pagado && !t.porPagar && !t.vencido) return null
  return (
    <section>
      <h2>¿Cómo voy con las facturas del mes?</h2>
      <Barras horizontal etiquetas={['Pagado', 'Por pagar', 'Vencido']} series={series} formato={pesos}
        colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion={`Facturas del mes: pagado ${pesos(t.pagado)}, por pagar ${pesos(t.porPagar)}, vencido ${pesos(t.vencido)}`} />
    </section>
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
        descripcion={`Valor pagado de ${actual.nombre} en el último año`} />
    </section>
  )
}
