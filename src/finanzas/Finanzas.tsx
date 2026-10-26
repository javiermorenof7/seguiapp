import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aprenderCategoria, guardarPresupuesto, obtenerFinanzas, registrar, type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor } from '../indicadores'
import { categoriaDe, leerMovimiento, normalizar, type Categoria } from './parseo'
import {
  acumuladoAno, estadoPresupuesto, mesAMes, mesesAntes, porCategoria, promedioSeisMeses, recibosPendientes, resumenMes,
  saldoDespues, type EstadoPresupuesto, type Movimiento, type TipoMovimiento,
} from './calculos'
import Barras from './Barras'
import Ultimos from './Ultimos'
import Asistente from './Asistente'
import { cincuentaTreintaVeinte, gastoInusual } from './aprende'

type Datos = Awaited<ReturnType<typeof obtenerFinanzas>>
type Grupo = 'auto' | 'basico' | 'personal'
interface Cuentas {
  delMes: ReturnType<typeof resumenMes>; despues: number
  filas: ReturnType<typeof porCategoria>; pendientes: ReturnType<typeof recibosPendientes>; presupuestos: Map<string, number>
}

const NOMBRES: Record<TipoMovimiento, string> = { gasto: 'Gastos', ingreso: 'Ingresos', ahorro: 'Ahorro' }
const TEXTO: Record<TipoMovimiento, string> = { gasto: 'Gasto', ingreso: 'Ingreso', ahorro: 'Ahorro' }
const TEXTO_PRESUPUESTO: Record<NonNullable<EstadoPresupuesto>, string> = { cerca: '◐ Llegaste al 80 %', pasado: '✕ Te pasaste' }
const MAX_DESCRIPCION = 120

const pesos = (v: number) => (v < 0 ? '−' : '') + formatoValor('dinero', Math.abs(v))
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const nombreMes = (mes: string) => new Date(`${mes}-15T12:00`).toLocaleDateString('es-CO', { month: 'short' })

export default function Finanzas({ seguimientos, registros, alVolver, alCambiar }: {
  seguimientos: Seguimiento[]
  registros: RegistroGuardado[]
  alVolver: () => void
  alCambiar: () => Promise<void>
}) {
  const mes = hoyIso().slice(0, 7)
  const id = (tipo: TipoMovimiento) =>
    seguimientos.find(s => s.codigo_plantilla === 'finanzas' && s.nombre === NOMBRES[tipo])?.id_seguimiento
  const idGastos = id('gasto')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    if (!idGastos) return
    try {
      setDatos(await obtenerFinanzas(idGastos, `${mesesAntes(mes, 4)}-01`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [idGastos, mes])
  useEffect(() => { cargar() }, [cargar])

  const movimientos = useMemo<Movimiento[]>(() => {
    const tipoDe = new Map((['gasto', 'ingreso', 'ahorro'] as const).map(t => [id(t), t]))
    return registros.flatMap(r => {
      const tipo = tipoDe.get(r.id_seguimiento)
      return tipo ? [{ fecha: r.fecha, valor: r.valor, tipo, id_etiqueta: r.id_etiqueta, grupo: r.grupo, nota: r.nota }] : []
    })
  }, [registros, seguimientos])

  const cuentas = useMemo<Cuentas | null>(() => {
    if (!datos) return null
    const presupuestos = new Map(datos.presupuestos.map(p => [p.id_etiqueta, Number(p.valor)]))
    const pendientes = recibosPendientes(datos.recibos, datos.pagos, mes)
    const idHogar = datos.categorias.find(c => normalizar(c.nombre).startsWith('hogar'))?.id_etiqueta ?? null
    const filas = porCategoria(movimientos, mes, datos.categorias, presupuestos, pendientes, idHogar)
    const delMes = resumenMes(movimientos, mes)
    return { presupuestos, pendientes, filas, delMes, despues: saldoDespues(delMes.saldo, filas, pendientes) }
  }, [datos, movimientos, mes])

  if (!idGastos) return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <p className="tenue">Activa la plantilla Finanzas para ver esta pantalla.</p>
    </>
  )

  return (
    <>
      <button className="volver" onClick={alVolver}>← Mi seguimiento</button>
      <header className="encabezado">
        <div>
          <h1>Finanzas</h1>
          <p className="tenue">{new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}</p>
        </div>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {datos && cuentas && (
        <>
          <NuevoMovimiento
            datos={datos}
            ids={{ gasto: idGastos, ingreso: id('ingreso'), ahorro: id('ahorro') }}
            gastadoDe={idEtiqueta => cuentas.filas.find(f => f.id_etiqueta === idEtiqueta)?.gastado ?? 0}
            presupuestos={cuentas.presupuestos}
            inusual={nuevo => gastoInusual(movimientos, nuevo, mes)}
            alGuardar={async aprendio => { await Promise.all([alCambiar(), aprendio ? cargar() : null]) }}
          />
          <Ultimos
            registros={registros.filter(r => [idGastos, id('ingreso'), id('ahorro')].includes(r.id_seguimiento)).slice(0, 6)}
            idGastos={idGastos}
            categorias={datos.categorias}
            alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }}
          />
          <Resumen cuentas={cuentas} acumulado={acumuladoAno(movimientos, mes)} />
          <Reparto movimientos={movimientos} mes={mes} categorias={datos.categorias} />
          <PorCategoria filas={cuentas.filas} />
          <MesAMes meses={mesAMes(movimientos, mes)} />
          {cuentas.pendientes.length > 0 && (
            <section>
              <h2>Recibos pendientes del mes</h2>
              <ul className="lista">
                {cuentas.pendientes.map(p => (
                  <li key={p.id_recibo} className="dos"><span>{p.nombre}</span><strong>{pesos(p.valor)}</strong></li>
                ))}
              </ul>
            </section>
          )}
          <Presupuestos
            categorias={datos.categorias}
            presupuestos={datos.presupuestos}
            sugerido={idEtiqueta => promedioSeisMeses(movimientos, idEtiqueta, mes)}
            alGuardar={(idEtiqueta, valor) => guardarPresupuesto(idGastos, idEtiqueta,
              datos.presupuestos.find(p => p.id_etiqueta === idEtiqueta), valor).then(cargar)}
          />
          <Asistente idGastos={idGastos} categorias={datos.categorias} alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
        </>
      )}
      {!datos && !error && <p className="tenue">Cargando…</p>}
    </>
  )
}

function NuevoMovimiento({ datos, ids, gastadoDe, presupuestos, inusual, alGuardar }: {
  datos: Datos
  ids: Record<TipoMovimiento, string | undefined>
  gastadoDe: (idEtiqueta: string) => number
  presupuestos: Map<string, number>
  inusual: (nuevo: { valor: number; descripcion: string; id_etiqueta: string | null }) => ReturnType<typeof gastoInusual>
  alGuardar: (aprendio: boolean) => Promise<void>
}) {
  const [tipo, setTipo] = useState<TipoMovimiento>('gasto')
  const [texto, setTexto] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [elegida, setElegida] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<Grupo>('auto')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const leido = leerMovimiento(texto)
  const propuesta = tipo === 'gasto' && leido ? categoriaDe(leido.descripcion, datos.aprendido, datos.categorias) : null
  const categoria: Categoria | null = datos.categorias.find(c => c.id_etiqueta === elegida) ?? propuesta

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const idSeguimiento = ids[tipo]
    if (!leido) return setError('Escribe el monto y en qué fue, por ejemplo "35 mil almuerzo".')
    if (leido.valor >= 1e12) return setError('El monto es demasiado grande.')
    if (leido.descripcion.length > MAX_DESCRIPCION) return setError(`La descripción admite hasta ${MAX_DESCRIPCION} letras.`)
    if (!fecha || fecha > hoyIso()) return setError('Elige una fecha de hoy o anterior.')
    if (!idSeguimiento) return setError(`No encuentro tu seguimiento de ${NOMBRES[tipo]}.`)
    if (tipo === 'gasto' && !categoria) return setError('Elige en qué categoría va.')
    setEnviando(true)
    try {
      const resultado = await registrar({
        id_seguimiento: idSeguimiento, fecha_registro: fecha, valor: leido.valor, nota: leido.descripcion || null,
        id_etiqueta: tipo === 'gasto' ? categoria!.id_etiqueta : null,
        grupo: tipo === 'gasto' && grupo !== 'auto' ? grupo : null,
      })
      // aprende solo cuando la persona eligió algo distinto de lo propuesto
      const aprende = tipo === 'gasto' && !!leido.descripcion && categoria!.id_etiqueta !== propuesta?.id_etiqueta
      if (aprende) await aprenderCategoria(normalizar(leido.descripcion), categoria!.nombre).catch(() => {})
      let mensaje = resultado === 'guardado'
        ? `${TEXTO[tipo]} registrado: ${pesos(leido.valor)}${categoria && tipo === 'gasto' ? ` en ${categoria.nombre}` : ''}.`
        : 'Sin conexión: quedó guardado en este equipo y se enviará al volver la conexión.'
      if (tipo === 'gasto') {
        const presupuesto = presupuestos.get(categoria!.id_etiqueta) ?? null
        const total = gastadoDe(categoria!.id_etiqueta) + leido.valor
        const e = estadoPresupuesto(total, presupuesto)
        const raro = inusual({ valor: leido.valor, descripcion: leido.descripcion, id_etiqueta: categoria!.id_etiqueta })
        if (raro) mensaje += ` Ojo: es más del doble de lo normal (${pesos(raro.promedio)} en promedio ${raro.base === 'descripcion' ? `en "${leido.descripcion}"` : `en ${categoria!.nombre}`}).`
        if (e) mensaje += ` ${TEXTO_PRESUPUESTO[e]} del presupuesto de ${categoria!.nombre}: ${pesos(total)} de ${pesos(presupuesto!)}.`
      }
      setAviso(mensaje)
      setTexto('')
      setElegida(null)
      setGrupo('auto')
      setError('')
      await alGuardar(aprende)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <h2>Nuevo movimiento</h2>
      <div className="chips" role="radiogroup" aria-label="Tipo de movimiento">
        {(['gasto', 'ingreso', 'ahorro'] as const).map(t => (
          <button key={t} type="button" role="radio" aria-checked={tipo === t} className="chip" onClick={() => setTipo(t)}>{TEXTO[t]}</button>
        ))}
      </div>
      <label>Monto y en qué fue
        <input required maxLength={140} value={texto} onChange={ev => { setTexto(ev.target.value); setElegida(null) }}
          placeholder="35 mil almuerzo" autoComplete="off" />
      </label>
      {leido && (
        <p className="tenue" aria-live="polite">
          {TEXTO[tipo]} · <strong>{pesos(leido.valor)}</strong>{leido.descripcion && ` · ${leido.descripcion}`}
          {tipo === 'gasto' && (categoria ? ` · ${categoria.nombre}` : ' · ¿En qué categoría va?')}
        </p>
      )}
      {tipo === 'gasto' && leido && (
        <>
          <fieldset>
            <legend>Categoría{propuesta ? '' : ' (la aprendo para la próxima vez)'}</legend>
            <div className="chips">
              {datos.categorias.map(c => (
                <button key={c.id_etiqueta} type="button" role="radio" aria-checked={categoria?.id_etiqueta === c.id_etiqueta}
                  className="chip" onClick={() => setElegida(c.id_etiqueta)}>{c.nombre}</button>
              ))}
            </div>
          </fieldset>
          <div className="chips" role="radiogroup" aria-label="Básico o personal">
            {(['auto', 'basico', 'personal'] as const).map(g => (
              <button key={g} type="button" role="radio" aria-checked={grupo === g} className="chip" onClick={() => setGrupo(g)}>
                {g === 'auto' ? `Automático${categoria?.grupo ? ` (${categoria.grupo === 'basico' ? 'básico' : 'personal'})` : ''}` : g === 'basico' ? 'Básico' : 'Personal'}
              </button>
            ))}
          </div>
        </>
      )}
      <label>Fecha
        <input type="date" required value={fecha} max={hoyIso()} onChange={ev => setFecha(ev.target.value)} />
      </label>
      <button className="principal" disabled={enviando}>Guardar</button>
      {aviso && <p role="status" className="aviso">{aviso}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

function Reparto({ movimientos, mes, categorias }: { movimientos: Movimiento[]; mes: string; categorias: Categoria[] }) {
  const r = useMemo(() => cincuentaTreintaVeinte(movimientos, mes, new Map(categorias.map(c => [c.id_etiqueta, c.grupo]))),
    [movimientos, mes, categorias])
  const series = useMemo(() => r && [
    { nombre: 'Este mes', datos: [r.basicos, r.personales, r.ahorro], color: [
      cssVar(r.basicos > 50 ? '--fuera' : '--en-meta'), cssVar(r.personales > 30 ? '--fuera' : '--en-meta'),
      cssVar(r.ahorro >= 20 ? '--en-meta' : '--cerca')] },
    { nombre: 'Lo sano', datos: [50, 30, 20], color: cssVar('--linea'), borde: cssVar('--tenue') },
  ], [r])
  if (!r || !series) return null
  return (
    <section>
      <h2>¿Cómo reparto mis ingresos? (50-30-20)</h2>
      <Barras horizontal etiquetas={ETIQUETAS_REPARTO} series={series} formato={v => `${Math.round(v)} %`}
        colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion={`Básicos ${r.basicos} %, personales ${r.personales} %, ahorro ${r.ahorro} % de los ingresos del mes, frente a 50, 30 y 20`} />
      {r.avisos.map(a => <p key={a} className="estado fuera aviso-reparto">✕ {a}</p>)}
      {!r.avisos.length && <p className="tenue">✓ Vas dentro del 50-30-20 en gastos.</p>}
    </section>
  )
}

const ETIQUETAS_REPARTO = ['Básicos (≤ 50 %)', 'Personales (≤ 30 %)', 'Ahorro (≥ 20 %)']

function Resumen({ cuentas, acumulado }: { cuentas: Cuentas; acumulado: number }) {
  const { delMes, despues } = cuentas
  return (
    <section className="resumen-finanzas" aria-label="Saldo">
      <div>
        <p className="tenue">Saldo del mes</p>
        <span className={delMes.saldo < 0 ? 'cifra negativo' : 'cifra'}>{pesos(delMes.saldo)}</span>
        {delMes.saldo < 0 && <span className="estado fuera">✕ Este mes sale más de lo que entra</span>}
        <p className="tenue">Ingresos {pesos(delMes.ingresos)} · Gastos {pesos(delMes.gastos)} · Ahorro {pesos(delMes.ahorro)}</p>
      </div>
      <div className="cifras">
        <p><span className="tenue">Después de recibos pendientes y presupuestos</span><strong>{pesos(despues)}</strong></p>
        <p><span className="tenue">Acumulado del año</span><strong>{pesos(acumulado)}</strong></p>
      </div>
    </section>
  )
}

function PorCategoria({ filas }: { filas: ReturnType<typeof porCategoria> }) {
  const color = (e: EstadoPresupuesto, conPresupuesto: boolean) =>
    cssVar(e === 'pasado' ? '--fuera' : e === 'cerca' ? '--cerca' : conPresupuesto ? '--en-meta' : '--tenue')
  const conGasto = filas.filter(f => f.gastado || f.presupuesto)
  const series = useMemo(() => [
    { nombre: 'Gastado', datos: conGasto.map(f => f.gastado), color: conGasto.map(f => color(estadoPresupuesto(f.gastado, f.presupuesto), !!f.presupuesto)) },
    { nombre: 'Presupuesto', datos: conGasto.map(f => f.presupuesto ?? 0), color: cssVar('--linea'), borde: cssVar('--tenue') },
  ], [filas])
  const etiquetas = useMemo(() => conGasto.map(f => f.nombre), [filas])
  if (!conGasto.length) return null
  return (
    <section>
      <h2>¿Voy dentro del presupuesto?</h2>
      <Barras horizontal etiquetas={etiquetas} series={series} formato={pesos} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion="Gasto del mes por categoría frente a su presupuesto" />
      <ul className="lista">
        {conGasto.map(f => {
          const e = estadoPresupuesto(f.gastado, f.presupuesto)
          return (
            <li key={f.id_etiqueta ?? 'sin'} className="tres">
              <span>{f.nombre}</span>
              <strong>{pesos(f.gastado)}{f.presupuesto ? <span className="tenue"> de {pesos(f.presupuesto)}</span> : null}</strong>
              {e ? <span className={`estado ${e === 'pasado' ? 'fuera' : 'cerca'}`}>{TEXTO_PRESUPUESTO[e]}</span> : <span />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function MesAMes({ meses }: { meses: ReturnType<typeof mesAMes> }) {
  const etiquetas = useMemo(() => meses.map(m => nombreMes(m.mes)), [meses])
  const series = useMemo(() => [
    { nombre: 'Ingresos', datos: meses.map(m => m.ingresos), color: cssVar('--t4') },
    { nombre: 'Gastos', datos: meses.map(m => m.gastos), color: cssVar('--t2') },
    { nombre: 'Ahorro', datos: meses.map(m => m.ahorro), color: cssVar('--t6') },
  ], [meses])
  return (
    <section>
      <h2>¿Cómo voy mes a mes?</h2>
      <Barras etiquetas={etiquetas} series={series} formato={pesos} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion="Ingresos, gastos y ahorro de cada mes del año" />
    </section>
  )
}

function Presupuestos({ categorias, presupuestos, sugerido, alGuardar }: {
  categorias: Categoria[]
  presupuestos: Datos['presupuestos']
  sugerido: (idEtiqueta: string) => number
  alGuardar: (idEtiqueta: string, valor: number | null) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <section>
      <h2>Presupuestos del mes</h2>
      <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? 'Cerrar' : 'Poner o cambiar presupuestos'}
      </button>
      {abierto && (
        <ul className="lista">
          {categorias.map(c => (
            <FilaPresupuesto key={c.id_etiqueta} nombre={c.nombre} sugerido={sugerido(c.id_etiqueta)}
              actual={presupuestos.find(p => p.id_etiqueta === c.id_etiqueta)?.valor}
              alGuardar={valor => alGuardar(c.id_etiqueta, valor)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function FilaPresupuesto({ nombre, actual, sugerido, alGuardar }: {
  nombre: string; actual?: number; sugerido: number; alGuardar: (valor: number | null) => Promise<void>
}) {
  const [valor, setValor] = useState(actual ? Math.round(actual).toLocaleString('es-CO') : '')
  const [mensaje, setMensaje] = useState('')

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const limpio = valor.replace(/[.\s$]/g, '')
    const numero = limpio ? Number(limpio) : null
    if (numero !== null && (!Number.isInteger(numero) || numero <= 0 || numero >= 1e12)) return setMensaje('Escribe pesos sin decimales.')
    try {
      await alGuardar(numero)
      setMensaje(numero === null ? 'Quitado.' : 'Guardado.')
    } catch (err) {
      setMensaje((err as Error).message)
    }
  }

  return (
    <li>
      <form className="fila-presupuesto" onSubmit={guardar}>
        <label htmlFor={`p-${nombre}`}>{nombre}{sugerido > 0 && <span className="tenue"> Sugerido {pesos(sugerido)}</span>}</label>
        <input id={`p-${nombre}`} inputMode="numeric" maxLength={16} value={valor} onChange={ev => setValor(ev.target.value)}
          placeholder="Sin presupuesto" />
        <button className="secundario" disabled={!valor && !actual}>{!valor && actual ? 'Quitar' : 'Guardar'}</button>
        {mensaje && <span role="status" className="tenue">{mensaje}</span>}
      </form>
    </li>
  )
}
