import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  aprenderCategoria, crearEtiqueta, guardarPresupuesto, obtenerFinanzas, obtenerMetasAhorro, obtenerPrestamos, obtenerRecibos, obtenerRegistros, registrar, type RegistroGuardado, type Seguimiento,
} from '../datos'
import { formatoValor } from '../indicadores'
import { categoriaDe, leerMonto, leidoDe, MONTO_INVALIDO, normalizar, type Categoria } from './parseo'
import {
  acumuladoAno, estadoPresupuesto, mesAMes, mesesAntes, porCategoria, promedioSeisMeses, recibosPendientes, resumenMes,
  saldoDespues, type EstadoPresupuesto, type Movimiento, type TipoMovimiento,
} from './calculos'
import Barras from './Barras'
import Dona from './Dona'
import SinDatos from '../SinDatos'
import { Apilada, Avance } from './Medidas'
import { recibosDelMes, totalesDelMes } from './estadoRecibos'
import { avanceMeta } from './metas'
import { amortizacion, estadoPrestamo, nombrePrestamo } from './prestamos'
import Ultimos, { FilaMovimiento } from './Ultimos'
import Historial from '../historial/Historial'
import Asistente from './Asistente'
import Recibos from './Recibos'
import Deudas from './Deudas'
import Ahorro from './Ahorro'
import type { MetaAhorro } from './metas'
import { cincuentaTreintaVeinte, facturaParecida, gastoInusual, posibleRepetido, sugeridos } from './aprende'
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
const nombreMesLargo = (mes: string) => new Date(`${mes}-15T12:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
const finDeMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10)
const pesosEje = (v: number) => Math.abs(v) >= 10_000 ? `$${new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}` : pesos(v)
const ver = (alVer: () => void) => <button className="enlace" onClick={alVer}>Ver →</button>
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const hoyIso = () => new Date().toLocaleDateString('en-CA')
const nombreMes = (mes: string) => new Date(`${mes}-15T12:00`).toLocaleDateString('es-CO', { month: 'short' })
const ESTADO_FIJO: Record<EstadoFijo, { texto: string; clase: string }> = {
  recibido: { texto: '✓ Recibido', clase: 'en-meta' }, pendiente: { texto: '◐ Pendiente', clase: 'cerca' }, atrasado: { texto: '✕ Atrasado', clase: 'fuera' },
}
const PESTANAS = { resumen: 'Resumen', gastos: 'Gastos', ingresos: 'Ingresos', ahorro: 'Ahorro', recibos: 'Facturas', deudas: 'Deudas', historial: 'Historial' }

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
  const [pestana, setPestana] = useState<keyof typeof PESTANAS>(abrir === 'factura' ? 'recibos' : abrir === 'gasto' || abrir === 'presupuesto' ? 'gastos'
    : abrir === 'ingreso' ? 'ingresos' : abrir === 'ahorro' ? 'ahorro' : 'resumen')
  const [registrando, setRegistrando] = useState<TipoMovimiento | null>(abrir === 'gasto' || abrir === 'ingreso' || abrir === 'ahorro' ? abrir : null)
  const [registrado, setRegistrado] = useState('')
  // préstamos y facturas para el Resumen y el aviso "¿es la cuota de…?"; si fallan, esos bloques no salen
  const [deudas, setDeudas] = useState<Awaited<ReturnType<typeof obtenerPrestamos>> | null>(null)
  const [recibosVer, setRecibosVer] = useState<Awaited<ReturnType<typeof obtenerRecibos>> | null>(null)
  const prestamos = deudas?.prestamos ?? []
  useEffect(() => {
    obtenerPrestamos().then(setDeudas, () => {})
    obtenerRecibos('2000-01-01').then(setRecibosVer, () => {})
  }, [mes, registros])
  // el filtro con que "Ver todos" abre el Historial
  const [tipoHistorial, setTipoHistorial] = useState(idGastos ?? '')
  // el Historial muestra primero lo registrado a mano; "Ver" de los automáticos lo abre con todo
  const [origenHistorial, setOrigenHistorial] = useState('manual')

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

  // la app carga el último año; para el Resumen se trae una vez lo anterior y se junta (lo reciente sigue viniendo de "registros")
  const [antiguos, setAntiguos] = useState<Movimiento[]>([])
  useEffect(() => {
    const limite = new Date(); limite.setFullYear(limite.getFullYear() - 1)
    const hasta = limite.toLocaleDateString('en-CA')
    const tipoDe = new Map((['gasto', 'ingreso', 'ahorro'] as const).map(t => [id(t), t]))
    obtenerRegistros('2000-01-01').then(lista => setAntiguos(lista.flatMap(r => {
      const tipo = tipoDe.get(r.id_seguimiento)
      return tipo && r.fecha < hasta ? [{ fecha: r.fecha, valor: r.valor, tipo, id_etiqueta: r.id_etiqueta, grupo: r.grupo, nota: r.nota }] : []
    })), () => {})
  }, [seguimientos])
  const todos = useMemo(() => {
    const desde = movimientos.reduce((m, x) => x.fecha < m ? x.fecha : m, '9999')
    return [...movimientos, ...antiguos.filter(a => a.fecha < desde)]
  }, [movimientos, antiguos])

  // periodo "AAAA-MM" (un mes) o "AAAA" (el año: se junta en un solo mes para reutilizar las cuentas del mes)
  const cuentasDe = useCallback((periodo: string): Cuentas | null => {
    if (!datos) return null
    const esAno = periodo.length === 4
    const mes = esAno ? `${periodo}-01` : periodo
    const movs = esAno ? todos.filter(m => m.fecha.startsWith(periodo)).map(m => ({ ...m, fecha: `${periodo}-01-01` })) : todos
    const meses = esAno ? (periodo === hoyIso().slice(0, 4) ? Number(hoyIso().slice(5, 7)) : 12) : 1
    const presupuestos = new Map(datos.presupuestos.map(p => [p.id_etiqueta, Number(p.valor) * meses]))
    const pendientes = esAno ? [] : recibosPendientes(datos.recibos, datos.pagos, mes)
    const idHogar = datos.categorias.find(c => normalizar(c.nombre).startsWith('hogar'))?.id_etiqueta ?? null
    const filas = porCategoria(movs, mes, datos.categorias, presupuestos, pendientes, idHogar)
    const delMes = resumenMes(movs, mes)
    return { presupuestos, pendientes, filas, delMes, despues: saldoDespues(delMes.saldo, filas, pendientes) }
  }, [datos, todos])
  const cuentas = useMemo(() => cuentasDe(mes), [cuentasDe, mes])
  // el Resumen abre siempre en el mes actual; se puede ir hasta 11 meses atrás (lo que ya está cargado)
  const [mesVer, setMesVer] = useState(mes)
  // meses con movimientos, del más reciente al más antiguo, agrupados por año
  const periodosDisponibles = useMemo(() => {
    const meses = [...new Set(todos.map(m => m.fecha.slice(0, 7)))].sort().reverse()
    const porAno = new Map<string, string[]>()
    for (const m of meses) porAno.set(m.slice(0, 4), [...(porAno.get(m.slice(0, 4)) ?? []), m])
    return [...porAno.entries()]
  }, [todos])
  const primerMes = periodosDisponibles.at(-1)?.[1].at(-1) ?? mes
  const cuentasVer = useMemo(() => mesVer === mes ? cuentas : cuentasDe(mesVer), [cuentasDe, cuentas, mes, mesVer])
  const facturasVer = useMemo(() => recibosVer && totalesDelMes(recibosDelMes(recibosVer.recibos.filter(r => r.estado !== 'no_se_paga'), recibosVer.pagos,
    mesVer === mes ? hoyIso() : finDeMes(mesVer.length === 4 ? `${mesVer}-12` : mesVer))), [recibosVer, mes, mesVer])

  // "+ Registrar …" de cada pestaña; al tocarlo se abre el formulario de ese tipo
  const registrar = (tipo: TipoMovimiento) => datos && cuentas && (registrando === tipo ? (
    <NuevoMovimiento
      datos={datos}
      metas={metasAhorro?.metas ?? []}
      anteriores={movimientos}
      tipoInicial={tipo}
      ids={{ gasto: idGastos, ingreso: id('ingreso'), ahorro: id('ahorro') }}
      gastadoDe={idEtiqueta => cuentas.filas.find(f => f.id_etiqueta === idEtiqueta)?.gastado ?? 0}
      presupuestos={cuentas.presupuestos}
      inusual={nuevo => gastoInusual(movimientos, nuevo, mes)}
      alCerrar={() => setRegistrando(null)}
      alIrAFacturas={() => setPestana('recibos')}
      alIrADeudas={() => setPestana('deudas')}
      prestamos={prestamos}
      alGuardar={async (aprendio, mensaje) => {
        setRegistrado(mensaje); setRegistrando(null)
        await Promise.all([alCambiar(), aprendio ? cargar() : null])
      }}
    />
  ) : (
    <section>
      <button className={`principal registrar-uno ${tipo}`} onClick={() => { setRegistrado(''); setRegistrando(tipo) }}>+ Registrar {TEXTO[tipo].toLowerCase()}</button>
      {registrado && <p role="status" className="aviso">{registrado}</p>}
    </section>
  ))

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
          key={`${tipoHistorial}-${origenHistorial}`}
          ids={(['gasto', 'ingreso', 'ahorro'] as const).flatMap(t => id(t) ?? [])}
          registros={registros}
          filtros={[
            { nombre: 'Tipo', inicial: tipoHistorial, opciones: (['gasto', 'ingreso', 'ahorro'] as const).flatMap(t => id(t) ? [[id(t)!, NOMBRES[t]] as [string, string]] : []), de: r => r.id_seguimiento },
            { nombre: 'Categoría o fuente', opciones: [...datos.categorias, ...datos.fuentes].map(c => [c.id_etiqueta, c.nombre] as [string, string]), de: r => r.id_etiqueta ?? '' },
            { nombre: 'Origen', inicial: origenHistorial, opciones: [['factura', 'Facturas'], ['prestamo', 'Préstamos'], ['manual', 'A mano']], de: r => datos.origenes.get(r.id_registro) ?? 'manual' },
          ]}
          buscar={r => r.nota ?? ''}
          suma
          formato={pesos}
          total={lista => (['gasto', 'ingreso', 'ahorro'] as const)
            .map(t => [NOMBRES[t], lista.filter(r => r.id_seguimiento === id(t)).reduce((s, r) => s + r.valor, 0)] as const)
            .filter(([, v]) => v > 0).map(([n, v]) => `${n} ${pesos(v)}`).join(' · ') || 'Sin movimientos'}
          fila={r => (
            <FilaMovimiento key={r.id_registro} registro={r} idGastos={idGastos} categorias={datos.categorias} origen={datos.origenes.get(r.id_registro)}
              tipo={r.id_seguimiento === idGastos ? undefined : TEXTO[r.id_seguimiento === id('ingreso') ? 'ingreso' : 'ahorro']}
              alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
          )}
        />
      )}
      {datos && pestana === 'recibos' && (
        <Recibos idGastos={idGastos} categorias={datos.categorias} aprendido={datos.aprendido} abrirNueva={abrir === 'factura'}
          alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
      )}
      {idAhorro && metasAhorro && pestana === 'ahorro' && (<>
        {registrar('ahorro')}
        <Ahorro idAhorro={idAhorro} metas={metasAhorro.metas} ahorros={metasAhorro.ahorros} alCambiar={alCambiar} />
      </>)}
      {datos && pestana === 'deudas' && (
        <Deudas idGastos={idGastos} categorias={datos.categorias} alCambiar={alCambiar} />
      )}
      {datos && idIngresos && pestana === 'ingresos' && (<>
        {registrar('ingreso')}
        <Ingresos movimientos={movimientos} mes={mes} fuentes={datos.fuentes} idIngresos={idIngresos} idGastos={idGastos}
          registros={registros.filter(r => r.id_seguimiento === idIngresos && r.fecha.startsWith(mes))}
          alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }} />
      </>)}
      {datos && cuentasVer && pestana === 'resumen' && (() => {
        const esAno = mesVer.length === 4
        const ano = mesVer.slice(0, 4)
        const anoActual = mes.slice(0, 4)
        const finAno = ano === anoActual ? mes : `${ano}-12`
        const nombre = esAno ? `todo ${ano}` : nombreMesLargo(mesVer)
        const reparto = esAno ? todos.filter(m => m.fecha.startsWith(ano)).map(m => ({ ...m, fecha: `${ano}-01-01` })) : todos
        const sinNada = !cuentasVer.delMes.ingresos && !cuentasVer.delMes.gastos && !cuentasVer.delMes.ahorro
        const atajos: [string, string][] = [[mes, 'Este mes'], [mesesAntes(mes, 1), 'Mes pasado'], [anoActual, 'Este año'], [String(Number(anoActual) - 1), 'Año pasado']]
        return (
          <>
            <div className="panel-periodo">
            <span className="etiqueta">Período</span>
            <div className="fila-filtros">
            <div className="chips segmentado" role="radiogroup" aria-label="Período del resumen">
              {atajos.map(([p, texto]) => (
                <button key={texto} type="button" role="radio" aria-checked={mesVer === p} className="chip" onClick={() => setMesVer(p)}>{texto}</button>
              ))}
            </div>
              <select aria-label="Elegir mes o año" value={atajos.some(([p]) => p === mesVer) ? '' : mesVer} onChange={ev => ev.target.value && setMesVer(ev.target.value)}>
                <option value="">Elegir…</option>
                {periodosDisponibles.map(([a, meses]) => (
                  <optgroup key={a} label={a}>
                    <option value={a}>Todo {a}</option>
                    {meses.map(m => <option key={m} value={m}>{nombreMesLargo(m)}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            {!esAno && (
              <div className="periodo">
                <button className="secundario" aria-label="Mes anterior" disabled={mesVer <= primerMes} onClick={() => setMesVer(mesesAntes(mesVer, 1))}>◀</button>
                <strong>{nombreMesLargo(mesVer)}</strong>
                <button className="secundario" aria-label="Mes siguiente" disabled={mesVer >= mes} onClick={() => setMesVer(mesesAntes(mesVer, -1))}>▶</button>
              </div>
            )}
            {mesVer !== mes && (
              <p role="status" className="aviso">Estás viendo {nombre}. <button className="enlace" onClick={() => setMesVer(mes)}>Volver a este mes</button></p>
            )}
            </div>
            {sinNada ? (
              <SinDatos titulo={`No hay movimientos en ${nombre}`} detalle="No registraste gastos, ingresos ni ahorro en ese período."
                acciones={[{ texto: 'Volver a este mes', hacer: () => setMesVer(mes) }, { texto: '+ Registrar gasto', hacer: () => { setPestana('gastos'); setRegistrando('gasto') } }]} />
            ) : (
              <>
                <Resumen cuentas={cuentasVer} acumulado={acumuladoAno(todos, esAno ? finAno : mesVer)} alVerRecibos={() => setPestana('recibos')} />
                {!esAno && facturasVer && <FacturasDelMes totales={facturasVer} alVer={() => setPestana('recibos')} />}
                <EnQueSeVa filas={cuentasVer.filas} alVer={() => setPestana('gastos')} />
                <PorCategoria filas={cuentasVer.filas} alVer={() => setPestana('gastos')} />
                {!esAno && idIngresos && <IngresosDelMes movimientos={todos} mes={mesVer} alVer={() => setPestana('ingresos')} />}
                {metasAhorro && <MetasDelMes metas={metasAhorro.metas}
                  ahorros={metasAhorro.ahorros.map(r => ({ fecha: r.fecha, valor: r.valor, tipo: 'ahorro' as const, id_etiqueta: r.id_etiqueta }))} alVer={() => setPestana('ahorro')} />}
                {deudas && <DeudasHoy deudas={deudas} alVer={() => setPestana('deudas')} />}
                <Reparto movimientos={reparto} mes={esAno ? `${ano}-01` : mesVer} categorias={datos.categorias} />
                <MesAMes meses={mesAMes(todos, esAno ? finAno : mesVer)} />
              </>
            )}
          </>
        )
      })()}
      {datos && cuentas && pestana === 'gastos' && (
        <>
          {registrar('gasto')}
          <Ultimos
            registros={registros.filter(r => r.id_seguimiento === idGastos)}
            tipos={[]}
            idGastos={idGastos}
            categorias={datos.categorias}
            origenes={datos.origenes}
            mes={mes}
            alVerTodos={(idTipo, origen) => { setTipoHistorial(idTipo || idGastos); setOrigenHistorial(origen); setPestana('historial') }}
            alCambiar={async () => { await Promise.all([alCambiar(), cargar()]) }}
          />
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

function NuevoMovimiento({ datos, metas, anteriores, tipoInicial, ids, gastadoDe, presupuestos, inusual, alCerrar, alIrAFacturas, alIrADeudas, prestamos, alGuardar }: {
  datos: Datos
  metas: MetaAhorro[]
  anteriores: Movimiento[]
  tipoInicial: TipoMovimiento
  ids: Record<TipoMovimiento, string | undefined>
  gastadoDe: (idEtiqueta: string) => number
  presupuestos: Map<string, number>
  inusual: (nuevo: { valor: number; descripcion: string; id_etiqueta: string | null }) => ReturnType<typeof gastoInusual>
  alCerrar: () => void
  alIrAFacturas: () => void
  alIrADeudas: () => void
  prestamos: { nombre_entidad: string; nombre_prestamo: string | null }[]
  alGuardar: (aprendio: boolean, mensaje: string) => Promise<void>
}) {
  const tipo = tipoInicial
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [elegida, setElegida] = useState<string | null>(null)
  const [idMeta, setIdMeta] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<Grupo>('auto')
  const [otraFecha, setOtraFecha] = useState(false)
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
  const frecuentes = useMemo(() => sugeridos(anteriores, tipo, hoyIso()), [anteriores, tipo])
  const factura = tipo === 'gasto' ? facturaParecida(datos.recibos, descripcion) : null
  const categoria: Categoria | null = lista.find(c => c.id_etiqueta === elegida) ?? propuesta
  // un préstamo por su entidad en lo escrito, o el primero si eligió la categoría Deudas
  const prestamo = tipo !== 'gasto' || factura ? null : (() => {
    const p = facturaParecida(prestamos.map(x => ({ ...x, nombre_servicio: x.nombre_entidad })), descripcion)
      ?? (categoria && normalizar(categoria.nombre).startsWith('deuda') ? prestamos[0] : undefined)
    return p ? [p.nombre_entidad, p.nombre_prestamo].filter(Boolean).join(' · ') : null
  })()
  const fuenteNueva = tipo === 'ingreso' && !categoria ? descripcion.replace(/\s+/g, ' ').trim().slice(0, 60) : ''

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    const idSeguimiento = ids[tipo]
    if (!leido) return setError('Escribe solo el monto, como quieras: "35 mil", "35.000" o "1,5 millones".')
    if (leido.descripcion.length > MAX_DESCRIPCION) return setError(`La descripción admite hasta ${MAX_DESCRIPCION} letras.`)
    if (!fecha || fecha > hoyIso()) return setError('Elige una fecha de hoy o anterior.')
    if (!idSeguimiento) return setError(`No encuentro tu seguimiento de ${NOMBRES[tipo]}.`)
    if (tipo === 'gasto' && !categoria) return setError('Elige en qué categoría va.')
    const repetido = posibleRepetido(anteriores, { tipo, fecha, valor: leido.valor, descripcion: leido.descripcion })
    if (repetido && !confirm(`Ya registraste "${repetido.nota}" por ${pesos(repetido.valor)} el ${repetido.fecha.split('-').reverse().join('/')}. ¿Guardarlo igual?`)) return
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
      await alGuardar(aprende || !!idFuenteNueva, meta ? `${mensaje} Va a la meta ${meta.nombre}.` : mensaje)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="formulario" onSubmit={guardar}>
      <div className="encabezado-seccion">
        <h2>Registrar {tipo === 'ahorro' ? 'un ahorro' : `un ${TEXTO[tipo].toLowerCase()}`}</h2>
        <button type="button" className="enlace" onClick={alCerrar}>Cancelar</button>
      </div>
      <label>¿Cuánto?
        <input required inputMode="text" maxLength={30} value={monto} onChange={ev => setMonto(ev.target.value)}
          placeholder="¿Cuánto fue?" autoComplete="off" autoFocus aria-describedby="monto-leido" />
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
      {frecuentes.length > 0 && !descripcion.trim() && (
        <div className="sugeridos">
          <span className="tenue">Usar otra vez</span>
          <div className="chips">
            {frecuentes.map(f => (
              <button key={f.nota} type="button" className="chip" onClick={() => {
                setDescripcion(f.nota); setMonto(Math.round(f.valor).toLocaleString('es-CO'))
                if (tipo === 'ahorro') setIdMeta(f.id_etiqueta); else setElegida(f.id_etiqueta)
              }}>{f.nota} {pesos(f.valor)}</button>
            ))}
          </div>
        </div>
      )}
      {prestamo && (
        <p role="status" className="aviso">
          ¿Es la cuota de {prestamo}?{' '}
          <button type="button" className="enlace" onClick={alIrADeudas}>Págala en Deudas</button> para que baje el saldo del préstamo.
        </p>
      )}
      {factura && (
        <p role="status" className="aviso">
          {datos.recibos.filter(r => r.nombre_servicio === factura.nombre_servicio).length > 1 || !factura.nombre_ubicacion
            ? `¿Es una factura de ${factura.nombre_servicio}?` : `¿Es la factura ${factura.nombre_servicio} · ${factura.nombre_ubicacion}?`}{' '}
          <button type="button" className="enlace" onClick={alIrAFacturas}>Págala en Facturas</button> para que quede marcada como pagada.
        </p>
      )}
      {tipo === 'gasto' && (
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
          <span className="tenue">¿Es básico o personal? Cuenta para el 50-30-20</span>
          <div className="chips" role="radiogroup" aria-label="Básico o personal">
            {(['auto', 'basico', 'personal'] as const).map(g => (
              <button key={g} type="button" role="radio" aria-checked={grupo === g} className="chip" onClick={() => setGrupo(g)}>
                {g === 'auto' ? `Automático${categoria?.grupo ? ` (${categoria.grupo === 'basico' ? 'básico' : 'personal'})` : ''}` : g === 'basico' ? 'Básico' : 'Personal'}
              </button>
            ))}
          </div>
        </>
      )}
      {tipo === 'ingreso' && (
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
      {otraFecha || fecha !== hoyIso() ? (
        <label>Fecha
          <input type="date" required value={fecha} max={hoyIso()} onChange={ev => setFecha(ev.target.value)} />
        </label>
      ) : (
        <p className="tenue">Fecha: hoy · <button type="button" className="enlace" onClick={() => setOtraFecha(true)}>Otra fecha</button></p>
      )}
      <button className="principal" disabled={enviando}>Guardar {TEXTO[tipo].toLowerCase()}{leido ? ` de ${pesos(leido.valor)}` : ''}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}

// 50-30-20: una fila por parte, cada una con su barra contra su meta (los básicos y personales "hasta", el ahorro "desde").
function Reparto({ movimientos, mes, categorias }: { movimientos: Movimiento[]; mes: string; categorias: Categoria[] }) {
  const r = useMemo(() => cincuentaTreintaVeinte(movimientos, mes, new Map(categorias.map(c => [c.id_etiqueta, c.grupo]))),
    [movimientos, mes, categorias])
  if (!r) return null
  const partes = [
    { nombre: 'Básicos', valor: r.basicos, meta: 50, bien: r.basicos <= 50, texto: 'hasta 50 %' },
    { nombre: 'Personales', valor: r.personales, meta: 30, bien: r.personales <= 30, texto: 'hasta 30 %' },
    { nombre: 'Ahorro', valor: r.ahorro, meta: 20, bien: r.ahorro >= 20, texto: 'desde 20 %' },
  ]
  const salioMas = r.basicos + r.personales + r.ahorro > 100
  return (
    <section>
      <h2>¿Cómo reparto mis ingresos? (50-30-20)</h2>
      <p className="tenue">{salioMas ? 'Este mes salió más de lo que entró: por eso los porcentajes suman más de 100 %.' : 'Cada parte como % de lo que entró este mes.'}</p>
      <ul className="lista">
        {partes.map(p => (
          <li key={p.nombre} className="meta-avance">
            <span>{p.nombre} <span className="tenue">· meta {p.texto}</span></span>
            <span><strong>{Math.round(p.valor)} %</strong> <span className={`estado ${p.bien ? 'en-meta' : 'fuera'}`}>{p.bien ? '✓ Bien' : '✕ Pasado'}</span></span>
            <Avance valor={p.valor} tope={p.meta} color={cssVar(p.bien ? '--en-meta' : '--fuera')}
              descripcion={`${p.nombre}: ${Math.round(p.valor)} % de los ingresos, meta ${p.texto}`} />
          </li>
        ))}
      </ul>
    </section>
  )
}


function Resumen({ cuentas, acumulado, alVerRecibos }: { cuentas: Cuentas; acumulado: number; alVerRecibos: () => void }) {
  const { delMes, despues, pendientes } = cuentas
  return (
    <section className="resumen-finanzas" aria-label="Saldo">
      <div>
        <p className="tenue">Saldo del mes</p>
        <span className={delMes.saldo < 0 ? 'cifra negativo' : 'cifra'}>{pesos(delMes.saldo)}</span>
        {delMes.saldo < 0 && <span className="estado fuera">✕ Este mes sale más de lo que entra</span>}
        <p className="tenue">Ingresos {pesos(delMes.ingresos)} · Gastos {pesos(delMes.gastos)} · Ahorro {pesos(delMes.ahorro)}</p>
        {pendientes.length > 0 && (
          <p className="tenue">
            Tienes {pendientes.length} {pendientes.length === 1 ? 'factura' : 'facturas'} por pagar
            ({pesos(pendientes.reduce((t, p) => t + p.valor, 0))}) · <button className="enlace" onClick={alVerRecibos}>Ir a Facturas</button>
          </p>
        )}
        {delMes.ingresos > 0 && (
          <>
            <Avance valor={delMes.gastos + delMes.ahorro} tope={delMes.ingresos} color={cssVar(delMes.saldo < 0 ? '--fuera' : '--gastos')}
              descripcion={`Salió ${pesos(delMes.gastos + delMes.ahorro)} de ${pesos(delMes.ingresos)} que entraron`} />
            <p className="tenue">Ya salió el {Math.round(((delMes.gastos + delMes.ahorro) / delMes.ingresos) * 100)} % de lo que entró</p>
          </>
        )}
      </div>
      <div className="cifras">
        <p><span className="tenue">Después de <button className="enlace" onClick={alVerRecibos}>facturas pendientes</button> y presupuestos</span><strong>{pesos(despues)}</strong></p>
        <p><span className="tenue">Acumulado del año</span><strong>{pesos(acumulado)}</strong></p>
      </div>
    </section>
  )
}

const COLORES_DONA = ['--c1', '--c2', '--c3', '--c4', '--c5', '--tenue']

// Las 5 categorías con más gasto del mes y el resto en "Otras".
function EnQueSeVa({ filas, alVer }: { filas: ReturnType<typeof porCategoria>; alVer: () => void }) {
  const porciones = useMemo(() => {
    const conGasto = filas.filter(f => f.gastado > 0).sort((a, b) => b.gastado - a.gastado)
    const otras = conGasto.slice(5).reduce((t, f) => t + f.gastado, 0)
    return [...conGasto.slice(0, 5).map(f => ({ nombre: f.nombre, valor: f.gastado })), ...(otras ? [{ nombre: 'Otras', valor: otras }] : [])]
      .map((p, i) => ({ ...p, color: cssVar(COLORES_DONA[i]) }))
  }, [filas])
  const total = porciones.reduce((t, p) => t + p.valor, 0)
  if (!total) return null
  return (
    <section>
      <div className="bloque-pie"><h2>¿En qué se me va la plata?</h2>{ver(alVer)}</div>
      <Dona porciones={porciones} total={total} formato={pesos} colorFondo={cssVar('--fondo')}
        descripcion={`Gasto del mes por categoría: ${porciones.map(p => `${p.nombre} ${pesos(p.valor)}`).join(', ')}`} />
    </section>
  )
}

// Barra con tope: lo gastado encima de la pista gris del presupuesto, de mayor a menor.
function PorCategoria({ filas, alVer }: { filas: ReturnType<typeof porCategoria>; alVer: () => void }) {
  const color = (e: EstadoPresupuesto, conPresupuesto: boolean) =>
    cssVar(e === 'pasado' ? '--fuera' : e === 'cerca' ? '--cerca' : conPresupuesto ? '--en-meta' : '--tenue')
  const conGasto = useMemo(() => filas.filter(f => f.gastado || f.presupuesto).sort((a, b) => b.gastado - a.gastado), [filas])
  const series = useMemo(() => [
    { nombre: 'Presupuesto', datos: conGasto.map(f => f.presupuesto || null), color: cssVar('--pista') },
    { nombre: 'Gastado', datos: conGasto.map(f => f.gastado), color: conGasto.map(f => color(estadoPresupuesto(f.gastado, f.presupuesto), !!f.presupuesto)),
      leyenda: cssVar('--en-meta') },
  ], [conGasto])
  const etiquetas = useMemo(() => conGasto.map(f => f.nombre), [conGasto])
  if (!conGasto.length) return null
  return (
    <section>
      <div className="bloque-pie"><h2>¿Voy dentro del presupuesto?</h2>{ver(alVer)}</div>
      <Barras horizontal superpuesto etiquetas={etiquetas} series={series} formato={pesos} formatoEje={pesosEje}
        colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')} descripcion="Gasto del mes por categoría sobre su presupuesto" />
      <ul className="lista">
        {conGasto.map(f => {
          const e = estadoPresupuesto(f.gastado, f.presupuesto)
          return (
            <li key={f.id_etiqueta ?? 'sin'} className="tres">
              <span>{f.nombre}</span>
              <strong>{pesos(f.gastado)}{f.presupuesto ? <span className="tenue"> de {pesos(f.presupuesto)}</span> : null}</strong>
              {e ? <span className={`estado ${e === 'pasado' ? 'fuera' : 'cerca'}`}>{TEXTO_PRESUPUESTO[e]}</span>
                : f.presupuesto ? <span className="estado en-meta">✓ Dentro</span> : <span className="tenue">Sin presupuesto</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function FacturasDelMes({ totales: t, alVer }: { totales: ReturnType<typeof totalesDelMes>; alVer: () => void }) {
  const total = t.pagado + t.porPagar + t.vencido
  if (!total) return null
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cómo voy con las facturas?</h2>{ver(alVer)}</div>
      <p className="tenue">Total del mes {pesos(total)}</p>
      <Apilada total={total} formato={pesos} descripcion={`Facturas del mes: pagado ${pesos(t.pagado)}, por pagar ${pesos(t.porPagar)}, vencido ${pesos(t.vencido)}`}
        partes={[
          { nombre: '✓ Pagado', valor: t.pagado, color: cssVar('--en-meta') },
          { nombre: '◐ Por pagar', valor: t.porPagar, color: cssVar('--cerca') },
          { nombre: '✕ Vencido', valor: t.vencido, color: cssVar('--fuera') },
        ]} />
    </section>
  )
}

function IngresosDelMes({ movimientos, mes, alVer }: { movimientos: Movimiento[]; mes: string; alVer: () => void }) {
  const actual = useMemo(() => esperadoVsRecibido(movimientos, mes).find(m => m.mes === mes), [movimientos, mes])
  const recibido = resumenMes(movimientos, mes).ingresos
  if (!actual?.esperado && !recibido) return null
  return (
    <section>
      <div className="bloque-pie"><h2>¿Llegó lo que esperaba?</h2>{ver(alVer)}</div>
      <p className="tenue">Recibido {pesos(recibido)}{actual?.esperado ? ` de ${pesos(actual.esperado)} esperados (ingresos fijos)` : ''}</p>
      {!!actual?.esperado && <Avance valor={actual.recibido} tope={actual.esperado} color={cssVar('--ingresos')}
        descripcion={`Ingresos fijos: recibido ${pesos(actual.recibido)} de ${pesos(actual.esperado)}`} />}
    </section>
  )
}

function MetasDelMes({ metas, ahorros, alVer }: { metas: MetaAhorro[]; ahorros: Movimiento[]; alVer: () => void }) {
  const hoy = hoyIso()
  if (!metas.length) return null
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cómo van mis metas de ahorro hoy?</h2>{ver(alVer)}</div>
      <ul className="lista">
        {metas.map(m => {
          const a = avanceMeta(m, ahorros, hoy)
          return (
            <li key={m.id_meta} className="meta-avance">
              <span>{m.nombre}</span>
              <strong>{a.porcentaje} %<span className="tenue"> · {pesos(a.ahorrado)} de {pesos(m.valor)}</span></strong>
              <Avance valor={a.ahorrado} tope={m.valor} color={cssVar('--ahorro')} descripcion={`${m.nombre}: ${a.porcentaje} % ahorrado`} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DeudasHoy({ deudas, alVer }: { deudas: Awaited<ReturnType<typeof obtenerPrestamos>>; alVer: () => void }) {
  const hoy = hoyIso()
  const filas = useMemo(() => deudas.prestamos.map(p => ({ p, e: estadoPrestamo(amortizacion(p, deudas.movimientos.filter(m => m.id_prestamo === p.id_prestamo)).filas, hoy) })),
    [deudas, hoy])
  if (!filas.length) return null
  const saldo = filas.reduce((t, f) => t + f.e.saldo, 0)
  const original = filas.reduce((t, f) => t + Number(f.p.valor_saldo_inicial), 0)
  const proxima = filas.filter(f => f.e.proxima).sort((a, b) => a.e.proxima!.fecha.localeCompare(b.e.proxima!.fecha))[0]
  return (
    <section>
      <div className="bloque-pie"><h2>¿Cuánto debo hoy?</h2>{ver(alVer)}</div>
      <p><strong className="cifra-media">{pesos(saldo)}</strong> <span className="tenue">de {pesos(original)} · pagado {pesos(original - saldo)}</span></p>
      <Avance valor={original - saldo} tope={original} color={cssVar('--en-meta')} descripcion={`Pagado ${pesos(original - saldo)} de ${pesos(original)}`} />
      {proxima && (
        <p className="tenue">
          Próxima cuota: {nombrePrestamo(proxima.p)} · {pesos(proxima.e.proxima!.total)} el {proxima.e.proxima!.fecha.split('-').reverse().join('/')}
          {proxima.e.estado === 'atrasada' && <span className="estado fuera"> ✕ Atrasada</span>}
        </p>
      )}
    </section>
  )
}

function MesAMes({ meses: todos }: { meses: ReturnType<typeof mesAMes> }) {
  // en celular, 3 barras por mes solo se leen con los últimos 6 meses
  const meses = useMemo(() => matchMedia('(max-width: 560px)').matches ? todos.slice(-6) : todos, [todos])
  const etiquetas = useMemo(() => meses.map(m => nombreMes(m.mes)), [meses])
  const series = useMemo(() => [
    { nombre: 'Ingresos', datos: meses.map(m => m.ingresos), color: cssVar('--ingresos') },
    { nombre: 'Gastos', datos: meses.map(m => m.gastos), color: cssVar('--gastos') },
    { nombre: 'Ahorro', datos: meses.map(m => m.ahorro), color: cssVar('--ahorro') },
  ], [meses])
  const saldo = useMemo(() => ({ nombre: 'Saldo', datos: meses.map(m => m.ingresos - m.gastos - m.ahorro), color: cssVar('--tinta') }), [meses])
  return (
    <section>
      <h2>¿Cómo voy mes a mes?</h2>
      <Barras etiquetas={etiquetas} series={series} linea={saldo} formato={pesos} formatoEje={pesosEje} colorTexto={cssVar('--tinta')} colorLinea={cssVar('--linea')}
        descripcion="Ingresos, gastos, ahorro y saldo de cada mes del año" />
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

function Ingresos({ movimientos, registros, mes, fuentes, idIngresos, idGastos, alCambiar }: {
  movimientos: Movimiento[]; registros: RegistroGuardado[]; mes: string; fuentes: Categoria[]; idIngresos: string; idGastos: string
  alCambiar: () => Promise<void>
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
        <h2>Ingresos del mes</h2>
        {registros.length ? (
          <ul className="lista">
            {registros.map(r => (
              <FilaMovimiento key={r.id_registro} registro={r} idGastos={idGastos} categorias={fuentes}
                tipo={nombre(r.id_etiqueta)} alCambiar={alCambiar} />
            ))}
          </ul>
        ) : <p className="tenue">Aún no registras ingresos este mes.</p>}
      </section>
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
