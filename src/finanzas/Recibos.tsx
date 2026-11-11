import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  aprenderCategoria, cambiarEstadoRecibo, crearRecibo, deshacerPago, editarRecibo, gastosDeRecibo, marcarSinPago, obtenerRecibos, pagarRecibo, quitarGastos, quitarRecibo, verNumeroCuenta,
} from '../datos'
import { formatoValor } from '../indicadores'
import Selector from '../Selector'
import SinDatos from '../SinDatos'
import { Avance } from './Medidas'
import { mesesAntes } from './calculos'
import { categoriaDe, leerMonto, leidoDe, MONTO_INVALIDO, normalizar, type Categoria } from './parseo'
import {
  avanceDelMes, mosaicoRecibos, finDeMes, nombreRecibo, numeroParaCopiar, recibosDelMes, ubicacionDe, ubicacionParecida, ubicacionesConConteo, vencidasAnteriores, vencidasPorFactura, type EstadoRecibo, type FilaRecibo, type ReciboVisible,
} from './estadoRecibos'

type Datos = Awaited<ReturnType<typeof obtenerRecibos>>

const pesos = (v: number) => formatoValor('dinero', v)
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const nombreMes = (periodo: string) => new Date(`${periodo}T12:00`).toLocaleDateString('es-CO', { month: 'long' })
const ESTADO: Record<EstadoRecibo, { texto: string; clase: string }> = {
  vencido: { texto: '✕ Vencido', clase: 'fuera' },
  por_pagar: { texto: '◐ Por pagar', clase: 'cerca' },
  sin_pendiente: { texto: 'Sin valor', clase: '' },
  omitida: { texto: 'Omitida este mes', clase: '' },
  pagado: { texto: '✓ Pagado', clase: 'en-meta' },
}

// gastosAQuitar: ids de los gastos ya creados que la persona pidió quitar al dejar de descontar
type AlEditar = (cambios: Parameters<typeof editarRecibo>[1], gastosAQuitar: string[]) => Promise<void>

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
  const filas = useMemo(() => datos ? recibosDelMes(activos, datos.pagos, hoy) : [], [datos, activos, hoy])
  const [soloFalta, setSoloFalta] = useState(false)
  // '' = todas las ubicaciones
  const [lugar, setLugar] = useState('')
  const [abierta, setAbierta] = useState('')
  const [verPausadas, setVerPausadas] = useState(false)
  const enLugar = (r: ReciboVisible) => !lugar || ubicacionDe(r) === lugar
  const pausados = datos?.recibos.filter(r => r.estado === 'no_se_paga' && enLugar(r)) ?? []
  const delVer = soloFalta ? filas.filter(f => f.estado === 'vencido' || f.estado === 'por_pagar') : filas
  const ubicaciones = ubicacionesConConteo(datos?.recibos ?? [], delVer.map(f => f.recibo))
  const visibles = delVer.filter(f => enLugar(f.recibo))
  const mosaico = mosaicoRecibos(visibles)
  const avance = avanceDelMes(filas)
  const detalle = visibles.find(f => f.recibo.id_recibo === abierta)
  const refDetalle = useRef<HTMLElement>(null)
  // el detalle abre debajo de todo el bloque: en el celular quedaría fuera de la pantalla
  useEffect(() => { if (abierta) refDetalle.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [abierta])
  const atrasados = useMemo(() => datos ? vencidasAnteriores(activos, datos.pagos, hoy) : [], [datos, activos, hoy])
  // ubicaciones de hogar ya usadas, para sugerirlas al escribir
  const lugares = useMemo(() => [...new Set((datos?.recibos ?? []).flatMap(r => r.nombre_ubicacion ? [r.nombre_ubicacion] : []))].sort((a, b) => a.localeCompare(b, 'es')), [datos])
  const idHogar = categorias.find(c => normalizar(c.nombre).startsWith('hogar'))?.id_etiqueta ?? null

  // Hogar va a básico en Hogar; personal, a personal en la categoría aprendida o la elegida (que se aprende).
  // atrasado: período de otro mes y día al que va el gasto; el pago guarda el día real, así no mueve el día aprendido.
  async function pagar(idRecibo: string, nombre: string, servicio: string, tipo: 'hogar' | 'personal', valor: number, categoria: Categoria | null,
    descuenta = true, atrasado?: { periodo: string; fecha: string }) {
    const propuesta = categoriaDe(servicio, aprendido, categorias)
    await pagarRecibo({
      id_recibo: idRecibo, fecha_periodo: atrasado?.periodo ?? `${hoy.slice(0, 7)}-01`, valor, fecha_pago: hoy,
      // el día guardado es solo el que pone la persona; el aprendido se calcula al mostrar
      dia_pago: null,
      gasto: !descuenta ? null : {
        id_seguimiento: idGastos, nota: `Factura ${nombre}`, fecha: atrasado?.fecha ?? hoy,
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

  // gastosAQuitar: los que ya había creado una factura que deja de descontar, si la persona pidió quitarlos
  async function editar(recibo: ReciboVisible, cambios: Parameters<typeof editarRecibo>[1], gastosAQuitar: string[] = []) {
    await editarRecibo(recibo.id_recibo, cambios)
    if (gastosAQuitar.length) await quitarGastos(gastosAQuitar)
    const quitados = gastosAQuitar.length ? ` Se ${gastosAQuitar.length === 1 ? 'quitó 1 gasto' : `quitaron ${gastosAQuitar.length} gastos`}; sus pagos siguen.` : ''
    setAviso(`${nombreRecibo({ ...recibo, ...cambios })} quedó guardada.${quitados}`)
    setError('')
    await Promise.all([cargar(), alCambiar()])
  }

  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  return (
    <>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <p className="tenue explica">Aquí guardas tus facturas fijas (luz, agua, internet…). Cada mes vuelven a quedar por pagar; las que pausas no cuentan hasta que las actives.</p>
      <NuevoRecibo inicial={abrirNueva} categorias={categorias} ubicaciones={lugares} alGuardar={async (nuevo, pago, categoria) => {
        const nombre = nuevo.nombre_ubicacion ? `${nuevo.nombre_servicio} · ${nuevo.nombre_ubicacion}` : nuevo.nombre_servicio
        if (typeof pago !== 'number') {
          await crearRecibo({ ...nuevo, estado: pago === 'pausa' ? 'no_se_paga' : 'activo' })
          setAviso(pago === 'pausa' ? `${nombre} guardada en pausa.` : `${nombre} guardada: queda por pagar este mes.`)
          return Promise.all([cargar(), alCambiar()])
        }
        const id = await crearRecibo({ ...nuevo, estado: 'activo' })
        await pagar(id, nombre, nuevo.nombre_servicio, nuevo.tipo_recibo, pago, categoria, nuevo.descuenta_saldo)
      }} />
      <section>
        <h2>¿Qué facturas me faltan este mes?</h2>
        {avance.total > 0 && (
          <>
            <p className="tenue">{avance.pagadas} de {avance.total} pagadas{avance.falta ? ` · faltan ${pesos(avance.falta)}` : ''}</p>
            <Avance valor={avance.pagadas} tope={avance.total} color={cssVar('--en-meta')} descripcion={`${avance.pagadas} de ${avance.total} facturas pagadas este mes`} />
          </>
        )}
        <div className="panel-periodo">
          <span className="etiqueta">Ver</span>
          <div className="fila-filtros">
          <div className="chips segmentado" role="radiogroup" aria-label="Ver facturas">
            {([[false, 'Todas'], [true, 'Lo que falta']] as const).map(([valor, texto]) => (
              <button key={texto} type="button" role="radio" aria-checked={soloFalta === valor} className="chip" onClick={() => setSoloFalta(valor)}>{texto}</button>
            ))}
          </div>
          {ubicaciones.length > 1 && (
            <Selector id="filtro-ubicacion" titulo="Ubicación" icono="📍" valor={lugar} alCambiar={setLugar} alLimpiar={() => setLugar('')}>
              <option value="">Todas · {delVer.length} {delVer.length === 1 ? 'factura' : 'facturas'}</option>
              {ubicaciones.filter(u => u.facturas).map(u => <option key={u.ubicacion} value={u.ubicacion}>{u.ubicacion} · {u.facturas}</option>)}
              {ubicaciones.some(u => !u.facturas) && (
                <optgroup label="Sin facturas">
                  {ubicaciones.filter(u => !u.facturas).map(u => <option key={u.ubicacion} value={u.ubicacion}>{u.ubicacion} · 0</option>)}
                </optgroup>
              )}
            </Selector>
          )}
          </div>
        </div>
        {!visibles.length && (filas.length
          ? <SinDatos titulo={`No te falta nada${lugar ? ` en ${lugar}` : ''} este mes`} acciones={[{ texto: 'Quitar filtros', hacer: () => { setSoloFalta(false); setLugar('') } }]} />
          : <SinDatos titulo="Aún no tienes facturas activas" detalle="Agrega una factura o activa una de las que están en pausa." />)}
        {mosaico.hogares.length > 0 && (
          <>
            <h3 className="pregunta-grafico">Hogares</h3>
            <div className="tabla-recibos">
              <table style={{ '--servicios': mosaico.servicios.length } as CSSProperties}>
                <thead>
                  <tr><td />{mosaico.servicios.map(s => <th key={s} scope="col">{s}</th>)}</tr>
                </thead>
                <tbody>
                  {mosaico.hogares.map(h => (
                    <tr key={h.lugar}>
                      <th scope="row">{h.lugar}</th>
                      {h.celdas.map((f, i) => (
                        <td key={mosaico.servicios[i]}>
                          {f ? <CeldaRecibo fila={f} abierta={abierta === f.recibo.id_recibo} alTocar={() => setAbierta(abierta === f.recibo.id_recibo ? '' : f.recibo.id_recibo)}
                            texto={<span>{montoCorto(f)}</span>} />
                            : <span className="tenue" aria-label={`${h.lugar} no tiene ${mosaico.servicios[i]}`}>·</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {mosaico.sueltas.length > 0 && (
          <>
            <h3 className="pregunta-grafico">Personal</h3>
            <div className="cuadros-recibos">
              {mosaico.sueltas.map(f => (
                <CeldaRecibo key={f.recibo.id_recibo} fila={f} abierta={abierta === f.recibo.id_recibo} alTocar={() => setAbierta(abierta === f.recibo.id_recibo ? '' : f.recibo.id_recibo)}
                  texto={<><strong>{f.nombre}</strong><span>{f.estado === 'omitida' ? 'Omitida este mes' : f.valor !== null ? pesos(f.valor) : 'Sin valor'}</span>{f.estado === 'vencido' && f.dia ? <small>venció el {f.dia}</small> : null}</>} />
              ))}
            </div>
          </>
        )}
      </section>
      {detalle && (
        <section ref={refDetalle}>
          <ul className="lista detalle-recibo">
            <FilaDeRecibo key={detalle.recibo.id_recibo} fila={detalle} categorias={categorias}
              propuesta={detalle.recibo.tipo_recibo === 'personal' ? categoriaDe(detalle.recibo.nombre_servicio, aprendido, categorias) : null}
              alPagar={(valor, categoria) => pagar(detalle.recibo.id_recibo, detalle.nombre, detalle.recibo.nombre_servicio, detalle.recibo.tipo_recibo, valor, categoria, detalle.recibo.descuenta_saldo !== false)
                .then(() => setError(''))}
              alDeshacer={() => accion(() => deshacerPago(detalle.pago!), detalle.estado === 'omitida' ? `${detalle.nombre} vuelve a contar este mes.` : `Deshecho el pago de ${detalle.nombre}.`)}
              alOmitir={() => accion(() => marcarSinPago(detalle.recibo.id_recibo, `${hoy.slice(0, 7)}-01`), `${detalle.nombre} no se paga este mes.`)}
              alPausar={() => accion(() => cambiarEstadoRecibo(detalle.recibo.id_recibo, 'no_se_paga'), `${detalle.nombre} quedó en pausa.`)}
              alQuitar={() => confirm(`¿Quitar ${detalle.nombre}? Su historial de pagos se conserva.`) &&
                accion(() => quitarRecibo(detalle.recibo.id_recibo), `${detalle.nombre} quitada.`)}
              alEditar={(cambios, gastos) => editar(detalle.recibo, cambios, gastos)} ubicaciones={lugares} />
          </ul>
        </section>
      )}
      {atrasados.length > 0 && (
        <section>
          <details className="vencidas-anteriores">
            <summary>{atrasados.length} de meses anteriores sin pagar</summary>
            {vencidasPorFactura(atrasados).map(g => (
              <div key={g.recibo.id_recibo}>
                <div className="bloque-pie">
                  <h3 className="pregunta-grafico">{g.nombre}: {g.periodos.length} {g.periodos.length === 1 ? 'mes' : 'meses'}</h3>
                  {g.periodos.length > 1 && (
                    <button type="button" className="enlace" onClick={() => confirm(`¿Omitir los ${g.periodos.length} meses de ${g.nombre}? No crea gastos.`) &&
                      accion(() => Promise.all(g.periodos.map(a => marcarSinPago(g.recibo.id_recibo, a.periodo))), `${g.nombre}: ${g.periodos.length} meses omitidos.`)}>Omitir todos</button>
                  )}
                </div>
                <ul className="lista">
                  {g.periodos.map(a => (
                    <SinPagar key={`${a.recibo.id_recibo}-${a.periodo}`} nombre={a.nombre} valor={a.valor} periodo={a.periodo} hoy={hoy} descuenta={a.recibo.descuenta_saldo !== false}
                      propuesta={a.recibo.tipo_recibo === 'personal' ? categoriaDe(a.recibo.nombre_servicio, aprendido, categorias) : null}
                      alPagar={(valor, fecha) => pagar(a.recibo.id_recibo, a.nombre, a.recibo.nombre_servicio, a.recibo.tipo_recibo, valor,
                          a.recibo.tipo_recibo === 'personal' ? categoriaDe(a.recibo.nombre_servicio, aprendido, categorias) : null, a.recibo.descuenta_saldo !== false, { periodo: a.periodo, fecha })}
                      alOmitir={() => accion(() => marcarSinPago(a.recibo.id_recibo, a.periodo), `${a.nombre}: ${nombreMes(a.periodo)} quedó omitido.`)} />
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </section>
      )}
      {pausados.length > 0 && (
        <section>
          <button type="button" className="enlace" aria-expanded={verPausadas} onClick={() => setVerPausadas(!verPausadas)}>
            {verPausadas ? 'Ocultar' : 'Ver'} {pausados.length} en pausa
          </button>
          {verPausadas && (
            <>
              <p className="tenue">No cuentan en el mes ni en los avisos. Actívalas cuando vuelvas a pagarlas.</p>
              <ul className="lista">
                {pausados.map(r => (
                  <FilaPausada key={r.id_recibo} recibo={r} ubicaciones={lugares} alEditar={(cambios, gastos) => editar(r, cambios, gastos)}
                    alActivar={() => accion(() => cambiarEstadoRecibo(r.id_recibo, 'activo'), `${nombreRecibo(r)} está activa.`)} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  )
}

const ICONO: Record<EstadoRecibo, string> = { vencido: '✕', por_pagar: '◐', sin_pendiente: '–', omitida: '–', pagado: '✓' }
const montoCorto = (f: FilaRecibo) => f.estado === 'omitida' ? 'Omitida' : f.valor === null ? 'Sin valor'
  : `$${new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(f.valor)}`

function CeldaRecibo({ fila, abierta, texto, alTocar }: { fila: FilaRecibo; abierta: boolean; texto: ReactNode; alTocar: () => void }) {
  return (
    <button type="button" className={`celda-recibo ${ESTADO[fila.estado].clase}`} aria-expanded={abierta} onClick={alTocar}
      aria-label={`${fila.nombre}: ${fila.valor !== null ? pesos(fila.valor) : 'sin valor'}, ${ESTADO[fila.estado].texto.replace(/^[^\p{L}]+/u, '').toLowerCase()}`}>
      <span aria-hidden="true">{ICONO[fila.estado]}</span>
      {texto}
    </button>
  )
}

// El número completo solo se pide a la base al tocar; la copia sale del mismo toque porque Safari no deja copiar después de esperar.
function NumeroPago({ recibo }: { recibo: ReciboVisible }) {
  const [numero, setNumero] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [error, setError] = useState('')
  const pedir = async () => {
    const n = await verNumeroCuenta(recibo.id_recibo)
    if (!n) throw new Error('Esta factura no tiene número guardado.')
    return numeroParaCopiar(n)
  }

  async function copiar() {
    setError('')
    const pedido = pedir()
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': pedido.then(n => new Blob([n], { type: 'text/plain' })) })])
      setManual(null)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      try {
        setManual(await pedido)
      } catch (e) {
        setError((e as Error).message)
      }
    }
  }

  async function alternar() {
    try {
      setNumero(numero ? null : await pedir())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="numero-pago">
      <span className="etiqueta">Número de pago</span>
      <button type="button" className="copiar-numero" onClick={copiar}>
        <span>{numero ?? recibo.numero_cuenta_enmascarado}</span>
        <strong role="status">{copiado ? '✓ Copiado' : '⧉ Copiar'}</strong>
      </button>
      {manual && (
        <label>No se pudo copiar solo; cópialo desde aquí
          <input readOnly value={manual} autoFocus onFocus={ev => ev.target.select()} />
        </label>
      )}
      <button type="button" className="enlace" aria-expanded={!!numero} onClick={alternar}>{numero ? 'Ocultar' : 'Ver completo'}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  )
}

function FilaDeRecibo({ fila, categorias, propuesta, ubicaciones, alPagar, alDeshacer, alOmitir, alPausar, alQuitar, alEditar }: {
  fila: FilaRecibo
  categorias: Categoria[]
  propuesta: Categoria | null
  alPagar: (valor: number, categoria: Categoria | null) => Promise<void>
  alDeshacer: () => void
  alOmitir: () => void
  alPausar: () => void
  alQuitar: () => void
  alEditar: AlEditar
  ubicaciones: string[]
}) {
  const { recibo, nombre, estado, valor, dia } = fila
  const [monto, setMonto] = useState(valor ? Math.round(valor).toLocaleString('es-CO') : '')
  const [elegida, setElegida] = useState(propuesta?.id_etiqueta ?? '')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [editando, setEditando] = useState(false)
  // sin gasto no hay categoría que elegir
  const pideCategoria = recibo.tipo_recibo === 'personal' && recibo.descuenta_saldo !== false
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

  const leido = leerMonto(monto)
  return (
    <li className="recibo">
      <span>
        {nombre}
        <span className="tenue">{dia ? `vence el día ${dia}` : ''}</span>
        {recibo.requiere_numero_pago && !recibo.numero_cuenta_enmascarado && (
          <button type="button" className="enlace" onClick={() => setEditando(true)}>Sin número de pago · Agregar</button>
        )}
      </span>
      <strong>{valor !== null ? pesos(valor) : ''}</strong>
      <span className={`estado ${ESTADO[estado].clase}`}>{ESTADO[estado].texto}</span>
      {recibo.numero_cuenta_enmascarado && <NumeroPago recibo={recibo} />}
      {estado === 'pagado' || estado === 'omitida'
        ? <button className="secundario" onClick={alDeshacer}>{estado === 'omitida' ? 'Volver a contarla' : 'Deshacer'}</button>
        : !pagando && <button className="principal" aria-expanded={pagando} onClick={() => { setPagando(true); setMensaje('') }}>Pagar</button>}
      {pagando && estado !== 'pagado' && estado !== 'omitida' && (
        <form className="formulario corregir" onSubmit={pagar}>
          <label>Valor pagado
            <input maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder="Ej. 85 mil" autoFocus />
          </label>
          {pideCategoria && (
            <label>Categoría
              <select value={elegida} onChange={ev => setElegida(ev.target.value)}>
                <option value="">Elige…</option>
                {categorias.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
              </select>
            </label>
          )}
          <div className="chips">
            <button className="principal" disabled={enviando || leido === null}>Confirmar pago{leido !== null ? ` de ${pesos(leido)}` : ''}</button>
            <button type="button" className="secundario" onClick={() => { setPagando(false); setMensaje('') }}>Cancelar</button>
          </div>
        </form>
      )}
      <details className="mas">
        <summary>Más</summary>
        <div className="chips">
          <button type="button" className="chip" aria-expanded={editando} onClick={() => { setEditando(!editando); setMensaje('') }}>Editar</button>
          {estado !== 'pagado' && estado !== 'omitida' && <button type="button" className="chip" onClick={alOmitir}>No se paga este mes</button>}
          {estado !== 'pagado' && <button type="button" className="chip" onClick={alPausar}>Pausar</button>}
          <button type="button" className="chip" onClick={alQuitar}>Quitar factura</button>
        </div>
      </details>
      {editando && <EditarRecibo recibo={recibo} ubicaciones={ubicaciones} aprendido={recibo.dia_pago ? null : dia} alGuardar={alEditar} alCerrar={() => setEditando(false)} />}
      {mensaje && <p role="alert" className="error">{mensaje}</p>}
    </li>
  )
}

function FilaPausada({ recibo, ubicaciones, alEditar, alActivar }: {
  recibo: ReciboVisible
  alEditar: AlEditar
  ubicaciones: string[]
  alActivar: () => void
}) {
  const [editando, setEditando] = useState(false)
  return (
    <li className="recibo">
      <span>{nombreRecibo(recibo)}</span>
      <button className="secundario" aria-expanded={editando} onClick={() => setEditando(!editando)}>{editando ? 'Cancelar' : 'Editar'}</button>
      <button className="principal" onClick={alActivar}>Activar</button>
      {editando && <EditarRecibo recibo={recibo} ubicaciones={ubicaciones} aprendido={null} alGuardar={alEditar} alCerrar={() => setEditando(false)} />}
    </li>
  )
}

// Todo lo de la factura en un solo formulario; el número completo nunca llega a la pantalla: vacío conserva el que tiene.
function EditarRecibo({ recibo, ubicaciones, aprendido, alGuardar, alCerrar }: {
  recibo: ReciboVisible
  ubicaciones: string[]
  aprendido: number | null
  alGuardar: AlEditar
  alCerrar: () => void
}) {
  const [servicio, setServicio] = useState(recibo.nombre_servicio)
  const [tipo, setTipo] = useState(recibo.tipo_recibo)
  const [ubicacion, setUbicacion] = useState(recibo.nombre_ubicacion ?? '')
  const [requiere, setRequiere] = useState(!!recibo.requiere_numero_pago)
  const [numero, setNumero] = useState('')
  const [descuenta, setDescuenta] = useState(recibo.descuenta_saldo !== false)
  const [dia, setDia] = useState(recibo.dia_pago ? String(recibo.dia_pago) : '')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [duda, setDuda] = useState<string | null>(null)
  // gastos que esta factura ya creó: si deja de descontar, se ofrece quitarlos
  const [gastos, setGastos] = useState<{ id_registro: string; valor: number }[]>([])
  const [quitar, setQuitar] = useState(false)
  useEffect(() => { gastosDeRecibo(recibo.id_recibo).then(setGastos).catch(() => {}) }, [recibo.id_recibo])

  // lugar: la ubicación ya confirmada en "¿Quisiste decir…?"; sin él se revisa si se parece a una usada
  async function guardar(lugar?: string) {
    const limpio = (t: string) => t.replace(/\s+/g, ' ').trim()
    if (!limpio(servicio)) return setError('Escribe el servicio, por ejemplo "Luz".')
    if (tipo === 'hogar' && !limpio(ubicacion)) return setError('Escribe la ubicación del hogar.')
    const sugerida = tipo === 'hogar' && lugar === undefined ? ubicacionParecida(limpio(ubicacion), ubicaciones) : null
    if (sugerida) return setDuda(sugerida)
    setEnviando(true)
    try {
      await alGuardar({
        nombre_servicio: limpio(servicio), tipo_recibo: tipo, nombre_ubicacion: tipo === 'hogar' ? lugar ?? limpio(ubicacion) : null,
        dia_pago: dia ? Number(dia) : null, requiere_numero_pago: requiere, descuenta_saldo: descuenta,
        ...(requiere && numero.trim() ? { numero_cuenta: numero.trim() } : {}),
      }, !descuenta && quitar ? gastos.map(g => g.id_registro) : [])
      alCerrar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="formulario editar-factura" onSubmit={ev => { ev.preventDefault(); guardar() }}>
      <h3>Editar factura</h3>
      <div className="chips" role="radiogroup" aria-label="Tipo de factura">
        {(['hogar', 'personal'] as const).map(t => (
          <button key={t} type="button" role="radio" aria-checked={tipo === t} className="chip" onClick={() => setTipo(t)}>
            {t === 'hogar' ? 'Hogar' : 'Personal'}
          </button>
        ))}
      </div>
      <label>Servicio<input required maxLength={60} value={servicio} onChange={ev => setServicio(ev.target.value)} autoComplete="off" /></label>
      {tipo === 'hogar' && (
        <CampoUbicacion valor={ubicacion} ubicaciones={ubicaciones} alCambiar={u => { setUbicacion(u); setDuda(null) }} />
      )}
      <label>¿Qué día vence?
        <select value={dia} onChange={ev => setDia(ev.target.value)}>
          <option value="">{aprendido ? `Aprendido de tus pagos: ${aprendido}` : 'No sé'}</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Día {d}</option>)}
        </select>
      </label>
      <div className="chips" role="radiogroup" aria-label="¿Requiere número de pago?">
        <span className="tenue">¿Requiere número de pago?</span>
        <button type="button" role="radio" aria-checked={requiere} className="chip" onClick={() => setRequiere(true)}>Sí</button>
        <button type="button" role="radio" aria-checked={!requiere} className="chip" onClick={() => setRequiere(false)}>No</button>
      </div>
      {requiere && (
        <label>Número de pago
          <input maxLength={40} value={numero} onChange={ev => setNumero(ev.target.value)} autoComplete="off"
            placeholder={recibo.numero_cuenta_enmascarado ? `Guardado: ${recibo.numero_cuenta_enmascarado}` : 'El de la factura'} />
          <small className="ayuda">{recibo.numero_cuenta_enmascarado ? 'Déjalo vacío para conservar el que tiene.' : 'Se muestra oculto (****1234).'}</small>
        </label>
      )}
      <div className="chips" role="radiogroup" aria-label="¿Descuenta de mi saldo?">
        <span className="tenue">¿Descuenta de mi saldo?</span>
        <button type="button" role="radio" aria-checked={descuenta} className="chip" onClick={() => setDescuenta(true)}>Sí</button>
        <button type="button" role="radio" aria-checked={!descuenta} className="chip" onClick={() => setDescuenta(false)}>No</button>
      </div>
      {!descuenta && <small className="ayuda">Al pagarla queda pagada, pero sin gasto: no toca tu saldo ni tu presupuesto.</small>}
      {!descuenta && gastos.length > 0 && (
        <div className="chips" role="radiogroup" aria-label="¿Quitar los gastos que ya creó?">
          <span>Esta factura ya creó {gastos.length === 1 ? '1 gasto' : `${gastos.length} gastos`} ({pesos(gastos.reduce((t, g) => t + Number(g.valor), 0))}) que {gastos.length === 1 ? 'descontó' : 'descontaron'} de tu saldo. ¿{gastos.length === 1 ? 'Lo quito' : 'Los quito'}?</span>
          <button type="button" role="radio" aria-checked={quitar} className="chip" onClick={() => setQuitar(true)}>Sí, {gastos.length === 1 ? 'quitarlo' : 'quitarlos'}</button>
          <button type="button" role="radio" aria-checked={!quitar} className="chip" onClick={() => setQuitar(false)}>No, {gastos.length === 1 ? 'dejarlo' : 'dejarlos'}</button>
          {quitar && <small className="ayuda">Al guardar salen de tus gastos y de tu saldo; la factura sigue como pagada en esos meses.</small>}
        </div>
      )}
      {duda ? <DudaUbicacion sugerida={duda} enviando={enviando} alElegir={guardar} escrita={ubicacion.replace(/\s+/g, ' ').trim()} /> : (
        <div className="chips">
          <button className="principal" disabled={enviando}>Guardar</button>
          <button type="button" className="secundario" onClick={alCerrar}>Cancelar</button>
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

// La ubicación con las ya usadas como sugerencia mientras se escribe.
function CampoUbicacion({ valor, ubicaciones, alCambiar }: { valor: string; ubicaciones: string[]; alCambiar: (u: string) => void }) {
  const id = useId()
  return (
    <label>Ubicación
      <input required maxLength={60} value={valor} list={id} onChange={ev => alCambiar(ev.target.value)} placeholder="Dónde llega la factura" autoComplete="off" />
      <datalist id={id}>{ubicaciones.map(u => <option key={u} value={u} />)}</datalist>
      <small className="ayuda">{ubicaciones.length ? 'Elige una de las que ya tienes o escribe una nueva.' : 'Ej.: Casa, La Mesa'}</small>
    </label>
  )
}

// Lo escrito se parece a una ubicación que ya existe: se elige cuál queda antes de guardar.
function DudaUbicacion({ sugerida, escrita, enviando, alElegir }: { sugerida: string; escrita: string; enviando: boolean; alElegir: (lugar: string) => void }) {
  return (
    <div className="chips" role="group" aria-label="¿Quisiste decir…?">
      <span>Ya tienes la ubicación <strong>{sugerida}</strong>. ¿Quisiste decir esa?</span>
      <button type="button" className="chip" disabled={enviando} onClick={() => alElegir(sugerida)}>Sí, usar {sugerida}</button>
      <button type="button" className="chip" disabled={enviando} onClick={() => alElegir(escrita)}>No, es otra</button>
    </div>
  )
}

function NuevoRecibo({ inicial, categorias, ubicaciones, alGuardar }: {
  inicial?: boolean
  categorias: Categoria[]
  ubicaciones: string[]
  // pago: el valor si se paga ahora; 'pendiente' = queda por pagar este mes; 'pausa' = no cuenta hasta activarla
  alGuardar: (nuevo: Omit<Parameters<typeof crearRecibo>[0], 'estado'>, pago: number | 'pendiente' | 'pausa', categoria: Categoria | null) => Promise<unknown>
}) {
  const [abierto, setAbierto] = useState(!!inicial)
  const [servicio, setServicio] = useState('')
  const [tipo, setTipo] = useState<'hogar' | 'personal'>('hogar')
  const [ubicacion, setUbicacion] = useState('')
  const [requiere, setRequiere] = useState(false)
  const [numero, setNumero] = useState('')
  const [monto, setMonto] = useState('')
  const [elegida, setElegida] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cuando, setCuando] = useState<'ahora' | 'pendiente' | 'pausa'>('pendiente')
  const [descuenta, setDescuenta] = useState(true)
  const [duda, setDuda] = useState<string | null>(null)
  const pagarAhora = cuando === 'ahora'
  const limpio = (t: string) => t.replace(/\s+/g, ' ').trim()

  // lugar: la ubicación ya confirmada en "¿Quisiste decir…?"; sin él se revisa si se parece a una usada
  async function guardar(lugar?: string) {
    const valor = pagarAhora ? leerMonto(monto) : null
    if (!servicio.trim()) return setError('Escribe el servicio, por ejemplo "Luz".')
    if (tipo === 'hogar' && !ubicacion.trim()) return setError('Escribe la ubicación del hogar.')
    if (pagarAhora && valor === null) return setError(MONTO_INVALIDO)
    if (pagarAhora && descuenta && tipo === 'personal' && !elegida) return setError('Elige en qué categoría va.')
    const sugerida = tipo === 'hogar' && lugar === undefined ? ubicacionParecida(limpio(ubicacion), ubicaciones) : null
    if (sugerida) return setDuda(sugerida)
    setEnviando(true)
    try {
      if (await alGuardar({
        nombre_servicio: servicio.trim(), tipo_recibo: tipo, descuenta_saldo: descuenta,
        nombre_ubicacion: tipo === 'hogar' ? lugar ?? limpio(ubicacion) : null, numero_cuenta: requiere ? numero.trim() || null : null, requiere_numero_pago: requiere,
      }, valor ?? (cuando === 'pausa' ? 'pausa' : 'pendiente'), categorias.find(c => c.id_etiqueta === elegida) ?? null) === false) return
      setServicio(''); setUbicacion(''); setRequiere(false); setNumero(''); setMonto(''); setElegida(''); setDescuenta(true); setCuando('pendiente'); setDuda(null); setError(''); setAbierto(false)
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
            <CampoUbicacion valor={ubicacion} ubicaciones={ubicaciones} alCambiar={u => { setUbicacion(u); setDuda(null) }} />
          )}
          {tipo === 'personal' && pagarAhora && descuenta && (
            <label>Categoría
              <select value={elegida} onChange={ev => setElegida(ev.target.value)}>
                <option value="">Elige…</option>
                {categorias.map(c => <option key={c.id_etiqueta} value={c.id_etiqueta}>{c.nombre}</option>)}
              </select>
            </label>
          )}
          <div className="chips" role="radiogroup" aria-label="¿Requiere número de pago?">
            <span className="tenue">¿Requiere número de pago?</span>
            <button type="button" role="radio" aria-checked={requiere} className="chip" onClick={() => setRequiere(true)}>Sí</button>
            <button type="button" role="radio" aria-checked={!requiere} className="chip" onClick={() => setRequiere(false)}>No</button>
          </div>
          {requiere && (
            <label>Número de pago
              <input maxLength={40} value={numero} onChange={ev => setNumero(ev.target.value)} autoComplete="off" />
              <small className="ayuda">El de la factura; se muestra oculto (****1234). Puedes agregarlo después.</small>
            </label>
          )}
          <div className="chips" role="radiogroup" aria-label="¿Descuenta de mi saldo?">
            <span className="tenue">¿Descuenta de mi saldo?</span>
            <button type="button" role="radio" aria-checked={descuenta} className="chip" onClick={() => setDescuenta(true)}>Sí</button>
            <button type="button" role="radio" aria-checked={!descuenta} className="chip" onClick={() => setDescuenta(false)}>No</button>
          </div>
          {!descuenta && <small className="ayuda">Al pagarla queda pagada, pero sin gasto: no toca tu saldo ni tu presupuesto.</small>}
          <div className="chips" role="radiogroup" aria-label="¿La pagas ahora?">
            <span className="tenue">¿La pagas ahora?</span>
            <button type="button" role="radio" aria-checked={cuando === 'pendiente'} className="chip" onClick={() => setCuando('pendiente')}>No, queda por pagar este mes</button>
            <button type="button" role="radio" aria-checked={pagarAhora} className="chip" onClick={() => setCuando('ahora')}>Sí, la pago ahora</button>
            <button type="button" role="radio" aria-checked={cuando === 'pausa'} className="chip" onClick={() => setCuando('pausa')}>No, dejarla en pausa</button>
          </div>
          {pagarAhora && <label>Valor pagado<input maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder="Valor que pagaste" /><small className="ayuda" aria-live="polite">{leidoDe(monto) || 'Ej.: 85 mil o 85.000'}</small></label>}
          {cuando === 'pendiente' && <small className="ayuda">Sale en "¿Qué facturas me faltan este mes?" para que la pagues cuando llegue.</small>}
          {cuando === 'pausa' && <small className="ayuda">Queda en "En pausa": no cuenta hasta que la actives.</small>}
          {duda ? <DudaUbicacion sugerida={duda} escrita={limpio(ubicacion)} enviando={enviando} alElegir={guardar} /> : (
            <button className="principal" disabled={enviando}>
              {pagarAhora ? `Guardar y pagar${leerMonto(monto) !== null ? ` ${pesos(leerMonto(monto)!)}` : ''}` : cuando === 'pausa' ? 'Guardar en pausa' : 'Guardar'}
            </button>
          )}
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </section>
  )
}

function SinPagar({ nombre, valor, periodo, hoy, descuenta, propuesta, alPagar, alOmitir }: {
  nombre: string; valor: number; periodo: string; hoy: string; descuenta: boolean; propuesta: Categoria | null
  alPagar: (valor: number, fecha: string) => Promise<unknown>; alOmitir: () => void
}) {
  const [monto, setMonto] = useState(Math.round(valor).toLocaleString('es-CO'))
  const [pagando, setPagando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fin = finDeMes(periodo)
  const [fecha, setFecha] = useState(fin)
  const leido = leerMonto(monto)
  const diaCorto = (f: string) => new Date(`${f}T12:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
  const mes = nombreMes(periodo)

  async function pagar(evento: FormEvent) {
    evento.preventDefault()
    if (leido === null) return setMensaje(MONTO_INVALIDO)
    setEnviando(true)
    try {
      await alPagar(leido, fecha)
      setMensaje('')
    } catch (e) {
      setMensaje((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <li className="recibo">
      <span>{nombre}<span className="tenue">{mes} de {periodo.slice(0, 4)}{propuesta ? ` · ${propuesta.nombre}` : ''}</span></span>
      <strong>{pesos(valor)}</strong>
      <span className="estado fuera">✕ Sin pagar</span>
      {!pagando && <button className="principal" aria-expanded={pagando} onClick={() => { setPagando(true); setMensaje('') }}>Pagar</button>}
      {pagando ? (
        <form className="formulario corregir" onSubmit={pagar}>
          <label>Valor pagado
            <input maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} autoFocus />
          </label>
          {descuenta && (
            <div className="chips mes-gasto" role="radiogroup" aria-label="¿En qué mes va el gasto?">
              <span className="tenue">¿En qué mes va el gasto?</span>
              <button type="button" role="radio" aria-checked={fecha === fin} className="chip" onClick={() => setFecha(fin)}>{mes} ({diaCorto(fin)})</button>
              <button type="button" role="radio" aria-checked={fecha === hoy} className="chip" onClick={() => setFecha(hoy)}>Hoy ({diaCorto(hoy)})</button>
            </div>
          )}
          <div className="chips">
            <button className="principal" disabled={enviando || leido === null}>Confirmar pago{leido !== null ? ` de ${pesos(leido)}` : ''}</button>
            <button type="button" className="secundario" onClick={() => { setPagando(false); setMensaje('') }}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="acciones"><button type="button" className="enlace" onClick={alOmitir}>No se pagó ese mes</button></div>
      )}
      {mensaje && <p role="alert" className="error">{mensaje}</p>}
    </li>
  )
}
