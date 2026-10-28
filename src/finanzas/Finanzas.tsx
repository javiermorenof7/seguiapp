import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aprenderCategoria, crearEtiqueta, guardarPresupuesto, obtenerFinanzas, obtenerMetasAhorro, registrar, type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor } from '../indicadores'
import { categoriaDe, leerMonto, leidoDe, MONTO_INVALIDO, normalizar, type Categoria } from './parseo'
import {
  acumuladoAno, estadoPresupuesto, mesAMes, mesesAntes, porCategoria, promedioSeisMeses, recibosPendientes, resumenMes,
  saldoDespues, type EstadoPresupuesto, type Movimiento, type TipoMovimiento,
} from './calculos'
import Barras from './Barras'
import Ultimos, { FilaMovimiento } from './Ultimos'
import Historial from '../historial/Historial'
import Asistente from './Asistente'
import Recibos from './Recibos'
import Deudas from './Deudas'
import Ahorro from './Ahorro'
import type { MetaAhorro } from './metas'
import { cincuentaTreintaVeinte, gastoInusual } from './aprende'
import { esperadoVsRecibido, estadoFijo, fijos, porFuente, type EstadoFijo } from './ingresos'

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

// Lo que se abre al llegar desde "+ Crear".
export type AccionFinanzas = TipoMovimiento | 'presupuesto' | 'factura'

const pesos = (v: number) => (v < 0 ? '−' : '') + formatoValor('dinero', Math.abs(v))
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const nombreMes = (mes: string) => new Date(`${mes}-15T12:00`).toLocaleDateString('es-CO', { month: 'short' })
const ESTADO_FIJO: Record<EstadoFijo, { texto: string; clase: string }> = {
  recibido: { texto: '✓ Recibido', clase: 'en-meta' }, pendiente: { texto: '◐ Pendiente', clase: 'cerca' }, atrasado: { texto: '✕ Atrasado', clase: 'fuera' },
}
const PESTANAS = { resumen: 'Resumen', recibos: 'Facturas', ingresos: 'Ingresos', ahorro: 'Ahorro', deudas: 'Deudas', historial: 'Historial' }

export default function Finanzas({ seguimientos, registros, abrir, alVolver, alCambiar }: {
  seguimientos: Seguimiento[]
  abrir?: AccionFinanzas
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
  const idIngresos = id('ingreso')
  const [pestana, setPestana] = useState<keyof typeof PESTANAS>(abrir === 'factura' ? 'recibos' : 'resumen')

  const cargar = useCallback(async () => {
    if (!idGastos) return
    try {
      setDatos(await obtenerFinanzas(idGastos, `${mesesAntes(mes, 4)}-01`, idIngresos))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [idGastos, idIngresos, mes])
  useEffect(() => { cargar() }, [cargar])

  // metas y todos los ahorros; los registros cambian tras cada guardado, así que se vuelven a pedir con ellos
  const idAhorro = id('ahorro')
  const [metasAhorro, setMetasAhorro] = useState<Awaited<ReturnType<typeof obtenerMetasAhorro>> | null>(null)
  useEffect(() => {
    if (idAhorro) obtenerMetasAhorro(idAhorro).then(setMetasAhorro, e => setError((e as Error).message))
  }, [idAhorro, registros])

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
      <div className="chips pestanas" role="radiogroup" aria-label="Sección de Finanzas">
        {(Object.keys(PESTANAS) as (keyof typeof PESTANAS)[]).filter(p => (p !== 'ingresos' || idIngresos) && (p !== 'ahorro' || idAhorro)).map(p => (
          <button key={p} type="button" role="radio" aria-checked={pestana === p} className="chip" onClick={() => setPestana(p)}>{PESTANAS[p]}</button>
        ))}
      </div>
      {datos && pestana === 'historial' && (
        <Historial
          ids={(['gasto', 'ingreso', 'ahorro'] as const).flatMap(t => id(t) ?? [])}
          registros={registros}
          filtros={[
            { nombre: 'Tipo', inicial: idGastos, opciones: (['gasto', 'ingreso', 'ahorro'] as const).flatMap(t => id(t) ? [[id(t)!, NOMBRES[t]] as [string, string]] : []), de: r => r.id_seguimiento },
            { nombre: 'Categoría o fuente', opciones: [...datos.categorias, ...datos.fuentes].map(c => [c.id_etiqueta, c.nombre] as [string, string]), de: r => r.id_etiqueta ?? '' },
          ]}
          buscar={r => r.nota ?? ''}
          suma
          formato={pesos}
          total={lista => (['gasto', 'ingreso', 'ahorro'] as const)
            .map(t => [NOMBRES[t], lista.filter(r => r.id_seguimiento === id(t)).reduce((s, r) => s + r.valor, 0)] as const)
            .filter(([, v]) => v > 0).map(([n, v]) => `${n} ${pesos(v)}`).join(' · ') || 'Sin movimientos'}
          fila={r => (
            <FilaMovimiento key={r.id_registro} registro={r} idGastos={idGastos} categorias={datos.categorias}
              tipo={r.id_seguimiento === idGastos ? undefined : TEXTO[r.id_seguimiento === id('ingreso') ? 'ingreso' : 'ahorro']}
              alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
          )}
        />
      )}
      {datos && pestana === 'recibos' && (
        <Recibos idGastos={idGastos} categorias={datos.categorias} aprendido={datos.aprendido} abrirNueva={abrir === 'factura'}
          alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
      )}
      {idAhorro && metasAhorro && pestana === 'ahorro' && (
        <Ahorro idAhorro={idAhorro} metas={metasAhorro.metas} ahorros={metasAhorro.ahorros} alCambiar={alCambiar} />
      )}
      {datos && pestana === 'deudas' && (
        <Deudas idGastos={idGastos} categorias={datos.categorias} alCambiar={alCambiar} />
      )}
      {datos && idIngresos && pestana === 'ingresos' && (
        <Ingresos movimientos={movimientos} mes={mes} fuentes={datos.fuentes} idIngresos={idIngresos}
          alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
      )}
      {datos && cuentas && pestana === 'resumen' && (
        <>
          <NuevoMovimiento
            datos={datos}
            metas={metasAhorro?.metas ?? []}
            anteriores={movimientos}
            tipoInicial={abrir === 'gasto' || abrir === 'ingreso' || abrir === 'ahorro' ? abrir : undefined}
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
          <Resumen cuentas={cuentas} acumulado={acumuladoAno(movimientos, mes)} alVerRecibos={() => setPestana('recibos')} />
          <Reparto movimientos={movimientos} mes={mes} categorias={datos.categorias} />
          <PorCategoria filas={cuentas.filas} />
          <MesAMes meses={mesAMes(movimientos, mes)} />
          {cuentas.pendientes.length > 0 && (
            <section>
              <h2>Facturas pendientes del mes</h2>
              <ul className="lista">
                {cuentas.pendientes.map(p => (
                  <li key={p.id_recibo} className="dos"><span>{p.nombre}</span><strong>{pesos(p.valor)}</strong></li>
                ))}
              </ul>
              <button className="secundario" onClick={() => setPestana('recibos')}>Pagar en Facturas</button>
            </section>
          )}
          <Presupuestos
            inicial={abrir === 'presupuesto'}
            categorias={datos.categorias}
            presupuestos={datos.presupuestos}
            sugerido={idEtiqueta => promedioSeisMeses(movimientos, idEtiqueta, mes)}
            alGuardar={(idEtiqueta, valor) => guardarPresupuesto(idGastos, idEtiqueta,
              datos.presupuestos.find(p => p.id_etiqueta === idEtiqueta), valor).then(cargar)}
          />
          <Asistente idSeguimiento={idGastos} categorias={datos.categorias} alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
        </>
      )}
      {!datos && !error && <p className="tenue">Cargando…</p>}
    </>
  )
}

function NuevoMovimiento({ datos, metas, anteriores, tipoInicial, ids, gastadoDe, presupuestos, inusual, alGuardar }: {
  datos: Datos
  metas: MetaAhorro[]
  anteriores: Movimiento[]
  tipoInicial?: TipoMovimiento
  ids: Record<TipoMovimiento, string | undefined>
  gastadoDe: (idEtiqueta: string) => number
  presupuestos: Map<string, number>
  inusual: (nuevo: { valor: number; descripcion: string; id_etiqueta: string | null }) => ReturnType<typeof gastoInusual>
  alGuardar: (aprendio: boolean) => Promise<void>
}) {
  const [tipo, setTipo] = useState<TipoMovimiento>(tipoInicial ?? 'gasto')
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [elegida, setElegida] = useState<string | null>(null)
  const [idMeta, setIdMeta] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<Grupo>('auto')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const valor = leerMonto(monto)
  const leido = valor === null ? null : { valor, descripcion: descripcion.replace(/\s+/g, ' ').trim() }
  // en Gastos es la categoría; en Ingresos, la fuente
  const lista = tipo === 'ingreso' ? datos.fuentes : datos.categorias
  const propuesta = tipo === 'ahorro' ? null : categoriaDe(descripcion, datos.aprendido, lista)
  // lo que ya escribió antes en este tipo, del más reciente al más antiguo
  const sugerencias = useMemo(() => [...new Set(anteriores.filter(m => m.tipo === tipo && m.nota)
    .sort((a, b) => b.fecha.localeCompare(a.fecha)).map(m => m.nota!))].slice(0, 30), [anteriores, tipo])
  const categoria: Categoria | null = lista.find(c => c.id_etiqueta === elegida) ?? propuesta
  const fuenteNueva = tipo === 'ingreso' && !categoria ? descripcion.replace(/\s+/g, ' ').trim().slice(0, 60) : ''

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const idSeguimiento = ids[tipo]
    if (!leido) return setError('Escribe solo el monto, como quieras: "35 mil", "35.000" o "1,5 millones".')
    if (leido.descripcion.length > MAX_DESCRIPCION) return setError(`La descripción admite hasta ${MAX_DESCRIPCION} letras.`)
    if (!fecha || fecha > hoyIso()) return setError('Elige una fecha de hoy o anterior.')
    if (!idSeguimiento) return setError(`No encuentro tu seguimiento de ${NOMBRES[tipo]}.`)
    if (tipo === 'gasto' && !categoria) return setError('Elige en qué categoría va.')
    setEnviando(true)
    try {
      // sin conexión no se puede crear la fuente: el ingreso queda sin fuente y se le pone después
      const idFuenteNueva = fuenteNueva ? await crearEtiqueta(idSeguimiento, fuenteNueva).catch(() => null) : null
      const fuente = categoria ?? (idFuenteNueva ? { nombre: fuenteNueva } : null)
      const resultado = await registrar({
        id_seguimiento: idSeguimiento, fecha_registro: fecha, valor: leido.valor, nota: leido.descripcion || null,
        id_etiqueta: tipo === 'ahorro' ? idMeta : categoria?.id_etiqueta ?? idFuenteNueva,
        grupo: tipo === 'gasto' && grupo !== 'auto' ? grupo : null,
      })
      // aprende solo cuando la persona eligió algo distinto de lo propuesto
      const aprende = !!categoria && !!leido.descripcion && categoria.id_etiqueta !== propuesta?.id_etiqueta
      if (aprende) await aprenderCategoria(normalizar(leido.descripcion), categoria.nombre).catch(() => {})
      let mensaje = resultado === 'guardado'
        ? `${TEXTO[tipo]} registrado: ${pesos(leido.valor)}${fuente ? ` ${tipo === 'gasto' ? 'en' : 'de'} ${fuente.nombre}` : ''}.`
        : 'Sin conexión: quedó guardado en este equipo y se enviará al volver la conexión.'
      if (tipo === 'gasto') {
        const presupuesto = presupuestos.get(categoria!.id_etiqueta) ?? null
        const total = gastadoDe(categoria!.id_etiqueta) + leido.valor
        const e = estadoPresupuesto(total, presupuesto)
        const raro = inusual({ valor: leido.valor, descripcion: leido.descripcion, id_etiqueta: categoria!.id_etiqueta })
        if (raro) mensaje += ` Ojo: es más del doble de lo normal (${pesos(raro.promedio)} en promedio ${raro.base === 'descripcion' ? `en "${leido.descripcion}"` : `en ${categoria!.nombre}`}).`
        if (e) mensaje += ` ${TEXTO_PRESUPUESTO[e]} del presupuesto de ${categoria!.nombre}: ${pesos(total)} de ${pesos(presupuesto!)}.`
      }
      const meta = tipo === 'ahorro' ? metas.find(m => m.id_etiqueta === idMeta) : undefined
      setAviso(meta ? `${mensaje} Va a la meta ${meta.nombre}.` : mensaje)
      setMonto('')
      setDescripcion('')
      setElegida(null)
      setIdMeta(null)
      setGrupo('auto')
      setError('')
      await alGuardar(aprende || !!idFuenteNueva)
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
      <label>Monto
        <input required inputMode="text" maxLength={30} value={monto} onChange={ev => setMonto(ev.target.value)}
          placeholder="¿Cuánto fue?" autoComplete="off" autoFocus={!!tipoInicial} aria-describedby="monto-leido" />
        <small className="ayuda">Ej.: 35 mil, 35.000 o 1,5 millones</small>
        <span id="monto-leido" className="tenue" aria-live="polite">{monto.trim() && (valor === null ? 'Escribe solo el monto' : pesos(valor))}</span>
      </label>
      <label>{tipo === 'ingreso' ? '¿De dónde vino?' : tipo === 'ahorro' ? '¿Para qué?' : '¿En qué fue?'}
        <input maxLength={MAX_DESCRIPCION} value={descripcion} list="descripciones" autoComplete="off"
          onChange={ev => { setDescripcion(ev.target.value); setElegida(null) }}
          placeholder={tipo === 'ingreso' ? 'Quién te pagó o por qué' : tipo === 'ahorro' ? 'Para qué estás ahorrando' : 'Qué compraste o pagaste'} />
        <small className="ayuda">Ej.: {tipo === 'ingreso' ? 'sueldo, venta, arriendo' : tipo === 'ahorro' ? 'viaje, emergencias' : 'almuerzo, taxi, mercado'}</small>
        <datalist id="descripciones">{sugerencias.map(s => <option key={s} value={s} />)}</datalist>
      </label>
      {tipo === 'gasto' && (descripcion.trim() || leido) && (
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
      {tipo === 'ingreso' && descripcion.trim() && (
        <fieldset>
          <legend>Fuente</legend>
          <div className="chips">
            {datos.fuentes.map(c => (
              <button key={c.id_etiqueta} type="button" role="radio" aria-checked={categoria?.id_etiqueta === c.id_etiqueta}
                className="chip" onClick={() => setElegida(c.id_etiqueta)}>{c.nombre}</button>
            ))}
          </div>
          {fuenteNueva && <small className="ayuda">Fuente nueva: «{fuenteNueva}». Se crea al guardar, o elige una de arriba.</small>}
        </fieldset>
      )}
      {tipo === 'ahorro' && metas.length > 0 && (
        <fieldset>
          <legend>Meta (opcional)</legend>
          <div className="chips">
            {[{ id_etiqueta: null, nombre: 'Ninguna' }, ...metas].map(m => (
              <button key={m.id_etiqueta ?? ''} type="button" role="radio" aria-checked={idMeta === m.id_etiqueta}
                className="chip" onClick={() => setIdMeta(m.id_etiqueta)}>{m.nombre}</button>
            ))}
          </div>
        </fieldset>
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

function Resumen({ cuentas, acumulado, alVerRecibos }: { cuentas: Cuentas; acumulado: number; alVerRecibos: () => void }) {
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
        <p><span className="tenue">Después de <button className="enlace" onClick={alVerRecibos}>facturas pendientes</button> y presupuestos</span><strong>{pesos(despues)}</strong></p>
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

function Presupuestos({ inicial, categorias, presupuestos, sugerido, alGuardar }: {
  inicial?: boolean
  categorias: Categoria[]
  presupuestos: Datos['presupuestos']
  sugerido: (idEtiqueta: string) => number
  alGuardar: (idEtiqueta: string, valor: number | null) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(!!inicial)
  return (
    <section>
      <h2>Presupuestos del mes</h2>
      <button className="secundario" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? 'Cerrar' : 'Poner o cambiar presupuestos'}
      </button>
      {abierto && (
        <ul className="lista">
          {categorias.map((c, i) => (
            <FilaPresupuesto key={c.id_etiqueta} nombre={c.nombre} sugerido={sugerido(c.id_etiqueta)} enfocar={inicial && i === 0}
              actual={presupuestos.find(p => p.id_etiqueta === c.id_etiqueta)?.valor}
              alGuardar={valor => alGuardar(c.id_etiqueta, valor)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function FilaPresupuesto({ nombre, actual, sugerido, enfocar, alGuardar }: {
  nombre: string; actual?: number; enfocar?: boolean; sugerido: number; alGuardar: (valor: number | null) => Promise<void>
}) {
  const [valor, setValor] = useState(actual ? Math.round(actual).toLocaleString('es-CO') : '')
  const [mensaje, setMensaje] = useState('')

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const numero = valor.trim() ? leerMonto(valor) : null
    if (valor.trim() && numero === null) return setMensaje(MONTO_INVALIDO)
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
        <input id={`p-${nombre}`} maxLength={16} value={valor} onChange={ev => setValor(ev.target.value)}
          placeholder="Tope del mes (ej. 500 mil)" autoFocus={enfocar} />
        <button className="secundario" disabled={!valor && !actual}>{!valor && actual ? 'Quitar' : 'Guardar'}</button>
        {valor && <small className="ayuda" aria-live="polite">{leidoDe(valor)}</small>}
        {mensaje && <span role="status" className="tenue">{mensaje}</span>}
      </form>
    </li>
  )
}

function Ingresos({ movimientos, mes, fuentes, idIngresos, alCambiar }: {
  movimientos: Movimiento[]; mes: string; fuentes: Categoria[]; idIngresos: string; alCambiar: () => Promise<void>
}) {
  const nombre = (id: string | null) => fuentes.find(f => f.id_etiqueta === id)?.nombre ?? 'Sin fuente'
  const hoy = hoyIso()
  const delMes = useMemo(() => fijos(movimientos, mes).map(f => ({ ...f, estado: estadoFijo(f, movimientos, hoy) })), [movimientos, mes, hoy])
  const recibido = useMemo(() => esperadoVsRecibido(movimientos, mes), [movimientos, mes])
  const fuente = useMemo(() => {
    const r = porFuente(movimientos, mes)
    const colores = ['--t4', '--t1', '--t7', '--t5', '--t3', '--t6', '--t2']
    return { etiquetas: r.meses.map(nombreMes), series: r.series.map((x, i) => ({ nombre: nombre(x.id_etiqueta), datos: x.datos, color: cssVar(colores[i % colores.length]) })) }
  }, [movimientos, mes, fuentes])

  return (
    <>
      <section>
        <h2>Ingresos fijos del mes</h2>
        {delMes.length ? (
          <ul className="lista">
            {delMes.map(f => (
              <li key={f.id_etiqueta} className="recibo">
                <span>{nombre(f.id_etiqueta)}<span className="tenue"> · día {f.dia}</span></span>
                <strong>{pesos(f.monto)}</strong>
                <span className={`estado ${ESTADO_FIJO[f.estado].clase}`}>{ESTADO_FIJO[f.estado].texto}</span>
              </li>
            ))}
          </ul>
        ) : <p className="tenue">Un ingreso es fijo cuando llega de la misma fuente los últimos 3 meses con un monto parecido. Ponle fuente a tus ingresos para verlos aquí.</p>}
      </section>
      {fuente.series.length > 0 && (
        <section>
          <h2>¿De dónde vienen mis ingresos?</h2>
          <Barras etiquetas={fuente.etiquetas} series={fuente.series} formato={pesos} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
            descripcion="Ingresos de cada fuente en los últimos 6 meses" />
        </section>
      )}
      {recibido.some(m => m.esperado > 0) && (
        <section>
          <h2>¿Llegó lo esperado?</h2>
          <Barras etiquetas={recibido.map(m => nombreMes(m.mes))} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')} formato={pesos}
            series={[
              { nombre: 'Esperado', datos: recibido.map(m => m.esperado), color: cssVar('--linea'), borde: cssVar('--tenue') },
              { nombre: 'Recibido', datos: recibido.map(m => m.recibido), color: cssVar('--t4') },
            ]}
            descripcion="Ingresos fijos esperados frente a lo recibido de esas fuentes en los últimos 6 meses" />
        </section>
      )}
      <Asistente idSeguimiento={idIngresos} tipo="ingreso" categorias={fuentes}
        alCrear={async nombre => ({ id_etiqueta: await crearEtiqueta(idIngresos, nombre), nombre, grupo: null, palabras_clave: [] })}
        alCambiar={alCambiar} />
    </>
  )
}
