import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { crearPrestamo, deshacerMovimientoPrestamo, obtenerPrestamos, quitarPrestamo, registrarMovimientoPrestamo } from '../datos'
import { formatoValor } from '../indicadores'
import Grafico from '../Grafico'
import { leerMonto, leidoDe, MONTO_INVALIDO, normalizar, type Categoria } from './parseo'
import {
  amortizacion, estadoPrestamo, leerTasa, nombrePrestamo, type EstadoCuota, type MovimientoPrestamo, type Prestamo, type TipoAbono,
} from './prestamos'

type Datos = Awaited<ReturnType<typeof obtenerPrestamos>>

const pesos = (v: number) => (v < 0 ? '−' : '') + formatoValor('dinero', Math.abs(v))
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const fechaCorta = (f: string) => new Date(`${f}T12:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
const TASA_INVALIDA = 'Escribe la tasa efectiva anual, por ejemplo 12,5.'
const ESTADO: Record<EstadoCuota, { texto: string; clase: string }> = {
  atrasada: { texto: '✕ Cuota atrasada', clase: 'fuera' },
  pendiente: { texto: '◐ Cuota del mes', clase: 'cerca' },
  al_dia: { texto: '✓ Al día', clase: 'en-meta' },
}
const TEXTO_MOVIMIENTO: Record<Exclude<MovimientoPrestamo['tipo_movimiento'], 'cuota'>, string> = {
  abono: 'Abono', cambio_tasa: 'Cambio de tasa', cuadre: 'Cuadre con el extracto',
}

export default function Deudas({ idGastos, categorias, alCambiar }: {
  idGastos: string
  categorias: Categoria[]
  alCambiar: () => Promise<void>
}) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const idDeudas = categorias.find(c => normalizar(c.nombre) === 'deudas')?.id_etiqueta ?? null

  const cargar = useCallback(async () => {
    try {
      setDatos(await obtenerPrestamos())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function accion(hacer: () => Promise<unknown>, mensaje: string) {
    await hacer()
    setAviso(mensaje)
    setError('')
    await Promise.all([cargar(), alCambiar()])
  }

  if (!datos) return error ? <p role="alert" className="error">{error}</p> : <p className="tenue">Cargando…</p>
  return (
    <>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <section>
        <h2>Préstamos</h2>
        {!datos.prestamos.length && <p className="tenue">Aún no tienes préstamos. Agrega uno abajo para ver su tabla de cuotas.</p>}
      </section>
      {datos.prestamos.map(p => (
        <TarjetaPrestamo key={p.id_prestamo} prestamo={p} movimientos={datos.movimientos.filter(m => m.id_prestamo === p.id_prestamo)}
          gasto={nota => ({ id_seguimiento: idGastos, id_etiqueta: idDeudas, nota })} accion={accion} />
      ))}
      <NuevoPrestamo alGuardar={nuevo => accion(() => crearPrestamo(nuevo), `${nombrePrestamo(nuevo)} agregado.`)} />
    </>
  )
}

function TarjetaPrestamo({ prestamo, movimientos, gasto, accion }: {
  prestamo: Prestamo
  movimientos: MovimientoPrestamo[]
  gasto: (nota: string) => { id_seguimiento: string; id_etiqueta: string | null; nota: string }
  accion: (hacer: () => Promise<unknown>, mensaje: string) => Promise<void>
}) {
  const hoy = hoyIso()
  const nombre = nombrePrestamo(prestamo)
  const { filas, cuadres } = useMemo(() => amortizacion(prestamo, movimientos), [prestamo, movimientos])
  const estado = estadoPrestamo(filas, hoy)
  const proxima = estado.proxima
  const [monto, setMonto] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [verTabla, setVerTabla] = useState(false)
  const ultimaPagada = [...filas].reverse().find(f => f.pago)?.pago ?? null
  const otros = movimientos.filter(m => m.tipo_movimiento !== 'cuota').sort((a, b) => b.fecha_movimiento.localeCompare(a.fecha_movimiento))
  const puntos = useMemo(() => filas.map(f => ({ fecha: f.fecha, valor: f.saldo })), [filas])

  async function intentar(hacer: () => Promise<void>) {
    setEnviando(true)
    try {
      await hacer()
      setMensaje('')
      return true
    } catch (e) {
      setMensaje((e as Error).message)
      return false
    } finally {
      setEnviando(false)
    }
  }

  function pagar(evento: FormEvent) {
    evento.preventDefault()
    if (!proxima) return
    const valor = monto ? leerMonto(monto) : proxima.total
    if (valor === null || valor <= 0) return setMensaje(MONTO_INVALIDO)
    intentar(() => accion(() => registrarMovimientoPrestamo(
      { id_prestamo: prestamo.id_prestamo, tipo_movimiento: 'cuota', fecha_movimiento: hoy, numero_cuota: proxima.numero, valor },
      gasto(`Cuota ${proxima.numero} ${nombre}`),
    ), `Pagada la cuota ${proxima.numero} de ${nombre}: ${pesos(valor)}.`).then(() => setMonto('')))
  }

  return (
    <section className="tarjeta-prestamo">
      <header className="encabezado">
        <div>
          <h3>{nombre}</h3>
          <p className="tenue">
            {estado.faltan ? `${estado.faltan} ${estado.faltan === 1 ? 'cuota' : 'cuotas'} por pagar · termina ${fechaCorta(estado.fin!)}` : 'Pagado'}
            {' · '}{prestamo.tasa_efectiva_anual.toLocaleString('es-CO')} % E.A.
          </p>
        </div>
        {estado.estado && <span className={`estado ${ESTADO[estado.estado].clase}`}>{ESTADO[estado.estado].texto}</span>}
      </header>
      <p className="cifra">{pesos(estado.saldo)} <span className="tenue">de saldo</span></p>
      {proxima && (
        <form className="fila-presupuesto" onSubmit={pagar}>
          <label htmlFor={`c-${prestamo.id_prestamo}`}>
            Cuota {proxima.numero} · {fechaCorta(proxima.fecha)}
            <span className="tenue">{pesos(proxima.total)}{proxima.seguro ? ` (seguro ${pesos(proxima.seguro)})` : ''}</span>
          </label>
          <input id={`c-${prestamo.id_prestamo}`} maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)}
            placeholder={`Ej. ${Math.round(proxima.total).toLocaleString('es-CO')}`} />
          <button className="secundario" disabled={enviando}>Pagar</button>
          <small className="ayuda" aria-live="polite">{monto ? leidoDe(monto) : 'Vacío = el valor de la cuota. Crea el gasto en Deudas.'}</small>
        </form>
      )}
      {ultimaPagada && (
        <div className="acciones">
          <button className="secundario" disabled={enviando} onClick={() => intentar(() => accion(() => deshacerMovimientoPrestamo(ultimaPagada),
            `Deshecha la cuota ${ultimaPagada.numero_cuota} de ${nombre}.`))}>Deshacer cuota {ultimaPagada.numero_cuota}</button>
        </div>
      )}
      {mensaje && <p role="alert" className="error">{mensaje}</p>}
      {filas.length > 1 && (
        <Grafico puntos={puntos} color={cssVar('--c1')} colorMeta={cssVar('--tenue')} formato={pesos} compacto
          descripcion={`Saldo de ${nombre} cuota a cuota hasta ${fechaCorta(estado.fin ?? hoy)}`} />
      )}
      {cuadres.length > 0 && (
        <p className="tenue">
          Último cuadre ({fechaCorta(cuadres.at(-1)!.fecha)}): el extracto decía {pesos(cuadres.at(-1)!.extracto)} y la app {pesos(cuadres.at(-1)!.calculado)}
          {cuadres.at(-1)!.diferencia ? ` (diferencia ${pesos(cuadres.at(-1)!.diferencia)})` : ', sin diferencia'}. Desde ahí manda el extracto.
        </p>
      )}
      <OtroMovimiento prestamo={prestamo} hoy={hoy} alGuardar={(m, texto) => intentar(() => accion(
        () => registrarMovimientoPrestamo(m, m.tipo_movimiento === 'abono' ? gasto(`Abono ${nombre}`) : undefined), texto))} />
      {otros.length > 0 && (
        <ul className="lista">
          {otros.map(m => (
            <li key={m.id_movimiento_prestamo} className="tres">
              <span>{TEXTO_MOVIMIENTO[m.tipo_movimiento as keyof typeof TEXTO_MOVIMIENTO]}
                <span className="tenue"> · {fechaCorta(m.fecha_movimiento)}{m.tipo_abono ? ` · ${m.tipo_abono === 'reduce_plazo' ? 'reduce el plazo' : 'reduce la cuota'}` : ''}</span>
              </span>
              <strong>{m.tasa_efectiva_anual !== null ? `${m.tasa_efectiva_anual.toLocaleString('es-CO')} % E.A.` : pesos(m.valor ?? 0)}</strong>
              <button className="enlace" disabled={enviando} onClick={() => intentar(() => accion(() => deshacerMovimientoPrestamo(m), 'Movimiento deshecho.'))}>Deshacer</button>
            </li>
          ))}
        </ul>
      )}
      <div className="acciones">
        <button className="enlace" aria-expanded={verTabla} onClick={() => setVerTabla(!verTabla)}>{verTabla ? 'Ocultar tabla de cuotas' : 'Ver tabla de cuotas'}</button>
        <button className="enlace" onClick={() => confirm(`¿Quitar ${nombre}? Sus pagos se conservan en Gastos.`) &&
          intentar(() => accion(() => quitarPrestamo(prestamo.id_prestamo), `${nombre} quitado.`))}>Quitar préstamo</button>
      </div>
      {verTabla && (
        <div className="tabla-desliza">
          <table className="amortizacion">
            <caption className="tenue">Tabla de cuotas de {nombre}</caption>
            <thead><tr><th>#</th><th>Fecha</th><th>Cuota</th><th>Interés</th><th>Capital</th><th>Seguro</th><th>Saldo</th><th>Pagada</th></tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.numero}>
                  <td>{f.numero}</td><td>{fechaCorta(f.fecha)}</td><td>{pesos(f.total)}</td><td>{pesos(f.interes)}</td>
                  <td>{pesos(f.capital)}</td><td>{pesos(f.seguro)}</td><td>{pesos(f.saldo)}</td><td>{f.pago ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type Otro = 'abono' | 'cambio_tasa' | 'cuadre'

function OtroMovimiento({ prestamo, hoy, alGuardar }: {
  prestamo: Prestamo
  hoy: string
  alGuardar: (m: Parameters<typeof registrarMovimientoPrestamo>[0], texto: string) => Promise<boolean>
}) {
  const [tipo, setTipo] = useState<Otro | null>(null)
  const [valor, setValor] = useState('')
  const [fecha, setFecha] = useState(hoy)
  const [tipoAbono, setTipoAbono] = useState<TipoAbono>('reduce_plazo')
  const [error, setError] = useState('')

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    if (!tipo) return
    const base = { id_prestamo: prestamo.id_prestamo, tipo_movimiento: tipo, fecha_movimiento: fecha }
    let guardado: boolean
    if (tipo === 'cambio_tasa') {
      const tasa = leerTasa(valor)
      if (tasa === null) return setError(TASA_INVALIDA)
      guardado = await alGuardar({ ...base, tasa_efectiva_anual: tasa }, `Nueva tasa de ${tasa.toLocaleString('es-CO')} % E.A. desde ${fechaCorta(fecha)}.`)
    } else {
      const n = leerMonto(valor)
      if (n === null || (tipo === 'abono' && n <= 0)) return setError(MONTO_INVALIDO)
      guardado = await alGuardar(tipo === 'abono' ? { ...base, valor: n, tipo_abono: tipoAbono } : { ...base, valor: n },
        tipo === 'abono' ? `Abono de ${pesos(n)} guardado.` : `Saldo del extracto (${pesos(n)}) guardado.`)
    }
    if (guardado) { setTipo(null); setValor(''); setFecha(hoy); setError('') }
  }

  return (
    <>
      <div className="chips" role="radiogroup" aria-label="Registrar en el préstamo">
        {(Object.keys(TEXTO_MOVIMIENTO) as Otro[]).map(t => (
          <button key={t} type="button" role="radio" aria-checked={tipo === t} className="chip"
            onClick={() => { setTipo(tipo === t ? null : t); setValor(''); setError('') }}>{TEXTO_MOVIMIENTO[t]}</button>
        ))}
      </div>
      {tipo && (
        <form className="formulario" onSubmit={guardar}>
          {tipo === 'abono' && (
            <div className="chips" role="radiogroup" aria-label="Qué reduce el abono">
              {(['reduce_plazo', 'reduce_cuota'] as const).map(t => (
                <button key={t} type="button" role="radio" aria-checked={tipoAbono === t} className="chip" onClick={() => setTipoAbono(t)}>
                  {t === 'reduce_plazo' ? 'Reduce el plazo' : 'Reduce la cuota'}
                </button>
              ))}
            </div>
          )}
          <label>
            {tipo === 'abono' ? 'Valor del abono' : tipo === 'cuadre' ? 'Saldo que dice el extracto' : 'Nueva tasa efectiva anual (%)'}
            <input required maxLength={16} value={valor} onChange={ev => setValor(ev.target.value)} autoFocus
              placeholder={tipo === 'cambio_tasa' ? 'Tasa E.A.' : 'Valor'} />
            <small className="ayuda" aria-live="polite">
              {tipo === 'cambio_tasa' ? 'Ej.: 12,5. Se mantiene el plazo y cambia la cuota.' : leidoDe(valor) || 'Ej.: 2 millones o 2.000.000'}
            </small>
          </label>
          <label>{tipo === 'cuadre' ? 'Fecha del extracto' : 'Desde qué fecha'}
            <input type="date" required value={fecha} onChange={ev => setFecha(ev.target.value)} />
            <small className="ayuda">Cuenta desde la cuota siguiente a esta fecha{tipo === 'abono' ? '. Crea el gasto en Deudas.' : '.'}</small>
          </label>
          <button className="principal">Guardar</button>
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </>
  )
}

function NuevoPrestamo({ alGuardar }: { alGuardar: (nuevo: Omit<Prestamo, 'id_prestamo'>) => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  const [enCurso, setEnCurso] = useState(true)
  const [entidad, setEntidad] = useState('')
  const [nombre, setNombre] = useState('')
  const [monto, setMonto] = useState('')
  const [cuotas, setCuotas] = useState('')
  const [tasa, setTasa] = useState('')
  const [seguro, setSeguro] = useState('')
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const saldo = leerMonto(monto)
    const n = Number(cuotas)
    const ea = leerTasa(tasa)
    const valorSeguro = seguro.trim() ? leerMonto(seguro) : 0
    if (!entidad.trim()) return setError('Escribe la entidad, por ejemplo "Bancolombia".')
    if (saldo === null || saldo <= 0 || valorSeguro === null) return setError(MONTO_INVALIDO)
    if (!Number.isInteger(n) || n < 1 || n > 600) return setError('Escribe el número de cuotas, de 1 a 600.')
    if (ea === null) return setError(TASA_INVALIDA)
    if (!fecha) return setError('Elige la fecha de la cuota.')
    setEnviando(true)
    try {
      // shortcut: el día de pago sale de la fecha elegida; si esa cae en un mes corto, las siguientes quedan en ese día.
      await alGuardar({
        nombre_entidad: entidad.trim(), nombre_prestamo: nombre.trim() || null, valor_saldo_inicial: saldo, fecha_primera_cuota: fecha,
        cantidad_cuotas: n, tasa_efectiva_anual: ea, valor_seguro_mensual: valorSeguro, dia_pago: +fecha.slice(8, 10),
      })
      setEntidad(''); setNombre(''); setMonto(''); setCuotas(''); setTasa(''); setSeguro(''); setFecha(''); setError(''); setAbierto(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? 'Cerrar' : 'Agregar un préstamo'}</button>
      {abierto && (
        <form className="formulario" onSubmit={guardar}>
          <div className="chips" role="radiogroup" aria-label="Desde cuándo lo registras">
            {[true, false].map(v => (
              <button key={String(v)} type="button" role="radio" aria-checked={enCurso === v} className="chip" onClick={() => setEnCurso(v)}>
                {v ? 'Ya lo vengo pagando' : 'Recién desembolsado'}
              </button>
            ))}
          </div>
          <label>Entidad<input required maxLength={60} value={entidad} onChange={ev => setEntidad(ev.target.value)} placeholder="Quién te prestó" autoComplete="off" autoFocus /><small className="ayuda">Ej.: Bancolombia, Davivienda</small></label>
          <label>Nombre (opcional)<input maxLength={60} value={nombre} onChange={ev => setNombre(ev.target.value)} placeholder="Para qué es" autoComplete="off" /><small className="ayuda">Ej.: Carro, Libre inversión</small></label>
          <label>{enCurso ? 'Saldo de hoy' : 'Monto del préstamo'}
            <input required maxLength={16} value={monto} onChange={ev => setMonto(ev.target.value)} placeholder={enCurso ? 'Lo que debes hoy' : 'Lo que te prestaron'} />
            <small className="ayuda" aria-live="polite">{leidoDe(monto) || (enCurso ? 'Está en el extracto. Ej.: 18 millones' : 'Ej.: 20 millones o 20.000.000')}</small>
          </label>
          <label>{enCurso ? 'Cuotas que faltan' : 'Plazo en meses'}
            <input required inputMode="numeric" maxLength={3} value={cuotas} onChange={ev => setCuotas(ev.target.value.replace(/\D/g, ''))} placeholder="Número de cuotas" />
            <small className="ayuda">{enCurso ? 'Contando la próxima. Ej.: 36' : 'Ej.: 60'}</small>
          </label>
          <label>Tasa efectiva anual (%)
            <input required maxLength={12} value={tasa} onChange={ev => setTasa(ev.target.value)} placeholder="Tasa E.A." />
            <small className="ayuda">La E.A. del contrato o el extracto. Ej.: 12,5</small>
          </label>
          <label>Seguro mensual (opcional)
            <input maxLength={16} value={seguro} onChange={ev => setSeguro(ev.target.value)} placeholder="Valor fijo del seguro" />
            <small className="ayuda" aria-live="polite">{leidoDe(seguro) || 'Se suma a cada cuota. Ej.: 25 mil'}</small>
          </label>
          <label>{enCurso ? 'Fecha de la próxima cuota' : 'Fecha de la primera cuota'}
            <input type="date" required value={fecha} onChange={ev => setFecha(ev.target.value)} />
            <small className="ayuda">Las demás caen el mismo día de cada mes</small>
          </label>
          <button className="principal" disabled={enviando}>Guardar préstamo</button>
          {error && <p role="alert" className="error">{error}</p>}
        </form>
      )}
    </section>
  )
}
