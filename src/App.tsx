import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import {
  asegurarPerfil, cerrarSesion, eliminarRegistro, enviarCola, obtenerMetasAhorro, obtenerPlantillasActivas, obtenerTareas, obtenerPrestamos, obtenerRecibos, obtenerRegistros,
  obtenerSeguimientos, registrar, soyAdministrador, type RegistroGuardado, type Seguimiento,
} from './datos'
import {
  agregado, estado, formatoValor, inicioPeriodo, ordenEstado, periodoDe, seSuma, serie,
  type Estado, type Periodo, type Registro, type TipoMedida,
} from './indicadores'
import Grafico from './Grafico'
import Privacidad from './Privacidad'
import Instalar from './Instalar'
import { estaInstalada } from './equipo'
import Finanzas from './finanzas/Finanzas'
import Salud from './salud/Salud'
import Habitos from './habitos/Habitos'
import Tareas from './tareas/Tareas'
import Avisos from './avisos/Avisos'
import MisDatos from './misdatos/MisDatos'
import Administrar from './misdatos/Administrar'
import { aTiempoSemana, deHoy, fechaColombia, sumarDias } from './tareas/calculos'
import { dias } from './habitos/calculos'
import { mesesAntes } from './finanzas/calculos'
import { recibosDelMes } from './finanzas/estadoRecibos'
import { amortizacion, estadoPrestamo } from './finanzas/prestamos'
import { metaProxima } from './finanzas/metas'
import { conSigno } from './salud/calculos'
import { activos, moduloDe, MODULOS, resumenFinanzas, resumenHabitos, resumenSalud, type Modulo } from './inicio/resumenes'
import { activarModulos, Bienvenida, COLOR, Crear, NOMBRE, QUE_MIDE, type Destino } from './inicio/Crear'

const TEXTO_ESTADO: Record<Estado, string> = { fuera: '✕ Fuera de la meta', cerca: '◐ Cerca de la meta', en_meta: '✓ Vas bien' }
const TEXTO_PERIODO: Record<Periodo, string> = { dia: 'día', semana: 'semana', mes: 'mes', ano: 'año' }

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
  // #privacidad abre la política directo: es el enlace de la pantalla de permiso de Google
  const [verPrivacidad, setVerPrivacidad] = useState(location.hash === '#privacidad')
  const [verInstalar, setVerInstalar] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, nueva) => setSesion(nueva))
    return () => data.subscription.unsubscribe()
  }, [])

  if (sesion === undefined) return <div className="contenedor"><p className="tenue">Cargando…</p></div>
  if (verPrivacidad) return <Privacidad alVolver={() => setVerPrivacidad(false)} />
  if (verInstalar) return <Instalar alVolver={() => setVerInstalar(false)} />
  if (!sesion) return <Entrar alPrivacidad={() => setVerPrivacidad(true)} alInstalar={() => setVerInstalar(true)} />
  return <Panel sesion={sesion} alPrivacidad={() => setVerPrivacidad(true)} alInstalar={() => setVerInstalar(true)} />
}

function Entrar({ alPrivacidad, alInstalar }: { alPrivacidad: () => void; alInstalar: () => void }) {
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
      {!estaInstalada() && <p className="tenue"><button className="enlace" onClick={alInstalar}>Instalar la app</button> en tu celular o computador.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  )
}

type Vista = { tipo: 'inicio' } | { tipo: 'crear'; modulo?: Modulo } | Destino | { tipo: 'detalle'; id: string } | { tipo: 'avisos' } | { tipo: 'misdatos' } | { tipo: 'administrar' }

// Al tocar un aviso se abre la app con ?ir=; se lee una vez y se limpia la dirección.
function vistaInicial(): Vista {
  const ir = new URLSearchParams(location.search).get('ir')
  if (ir) history.replaceState(null, '', location.pathname)
  return ir === 'tareas' ? { tipo: 'tareas' } : ir === 'finanzas' ? { tipo: 'finanzas' }
    : ir === 'misdatos' ? { tipo: 'misdatos' } : ir === 'administrar' ? { tipo: 'administrar' } : { tipo: 'inicio' }
}

function Panel({ sesion, alPrivacidad, alInstalar }: { sesion: Session; alPrivacidad: () => void; alInstalar: () => void }) {
  const [vista, setVista] = useState<Vista>(vistaInicial)
  const [seguimientos, setSeguimientos] = useState<Seguimiento[] | null>(null)
  const [registros, setRegistros] = useState<RegistroGuardado[]>([])
  const [plantillas, setPlantillas] = useState<string[]>([])
  const [error, setError] = useState('')
  const [administrador, setAdministrador] = useState(false)
  useEffect(() => { soyAdministrador().then(setAdministrador, () => setAdministrador(false)) }, [])
  const nombre = (sesion.user.user_metadata?.full_name as string | undefined)?.slice(0, 100) ?? null

  const cargar = useCallback(async () => {
    try {
      const [s, r, p] = await Promise.all([obtenerSeguimientos(), obtenerRegistros(haceUnAno()), obtenerPlantillasActivas()])
      setSeguimientos(s)
      setRegistros(r)
      setPlantillas(p)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    asegurarPerfil(nombre).catch(() => {}).then(() => enviarCola()).then(cargar)
    const alVolverConexion = () => { enviarCola().then(n => { if (n) cargar() }) }
    addEventListener('online', alVolverConexion)
    return () => removeEventListener('online', alVolverConexion)
  }, [nombre, cargar])

  const actual = vista.tipo === 'detalle' ? seguimientos?.find(s => s.id_seguimiento === vista.id) : undefined
  const enModulo = (codigos: string[]) => !!actual && codigos.includes(actual.codigo_plantilla ?? '')
  const activosAhora = useMemo(() => MODULOS.filter(m => activos(seguimientos ?? [], plantillas).has(m)), [seguimientos, plantillas])
  const alInicio = () => setVista({ tipo: 'inicio' })
  const nuevo = seguimientos?.length === 0 && plantillas.length === 0

  return (
    <div className="contenedor">
      {error && <p role="alert" className="error">{error}</p>}
      {vista.tipo === 'crear' && (
        <Crear activos={activosAhora} modulo={vista.modulo} alElegir={setVista} alVolver={alInicio} />
      )}
      {seguimientos && (vista.tipo === 'finanzas' || enModulo(['finanzas'])) && (
        <Finanzas seguimientos={seguimientos} registros={registros} abrir={vista.tipo === 'finanzas' ? vista.abrir : undefined}
          alVolver={alInicio} alCambiar={cargar} />
      )}
      {seguimientos && (vista.tipo === 'salud' || enModulo(['gym', 'cuerpo'])) && (
        <Salud seguimientos={seguimientos} registros={registros} abrir={vista.tipo === 'salud' ? vista.abrir : undefined}
          alVolver={alInicio} alCambiar={cargar} />
      )}
      {seguimientos && (vista.tipo === 'habitos' || enModulo(['habitos'])) && (
        <Habitos seguimientos={seguimientos} registros={registros} enfocar={vista.tipo === 'habitos' && vista.enfocar}
          alVolver={alInicio} alCambiar={cargar} />
      )}
      {vista.tipo === 'tareas' && <Tareas abrir={vista.abrir} alVolver={alInicio} />}
      {vista.tipo === 'avisos' && <Avisos alVolver={alInicio} alInstalar={alInstalar} />}
      {vista.tipo === 'misdatos' && <MisDatos alVolver={alInicio} />}
      {vista.tipo === 'administrar' && administrador && <Administrar alVolver={alInicio} />}
      {vista.tipo === 'detalle' && actual && !moduloDe(actual.codigo_plantilla) && (
        <Detalle
          seguimiento={actual}
          indice={seguimientos!.indexOf(actual)}
          registros={registros.filter(r => r.id_seguimiento === actual.id_seguimiento)}
          alVolver={alInicio}
          alCambiar={cargar}
        />
      )}
      {vista.tipo === 'inicio' && nuevo && (
        <Bienvenida nombre={nombre} alEmpezar={async modulos => {
          await activarModulos(modulos, [])
          await cargar()
          setVista({ tipo: 'crear', modulo: modulos.length === 1 ? modulos[0] : undefined })
        }} />
      )}
      {vista.tipo === 'inicio' && !nuevo && (
        <Inicio
          seguimientos={seguimientos}
          registros={registros}
          activos={activosAhora}
          alCrear={modulo => setVista({ tipo: 'crear', modulo })}
          alActivar={modulo => activarModulos([modulo], seguimientos ?? []).then(cargar).catch(e => setError((e as Error).message))}
          alIr={setVista}
          alAvisos={() => setVista({ tipo: 'avisos' })}
          alAbrir={id => setVista({ tipo: 'detalle', id })}
        />
      )}
      <footer className="pie">
        <button className="enlace" onClick={alPrivacidad}>Privacidad</button>
        {' · '}<button className="enlace" onClick={() => setVista({ tipo: 'misdatos' })}>Mis datos</button>
        {administrador && <> · <button className="enlace" onClick={() => setVista({ tipo: 'administrar' })}>Mensajes</button></>}
        {!estaInstalada() && <> · <button className="enlace" onClick={alInstalar}>Instalar la app</button></>}
      </footer>
    </div>
  )
}

const ICONO: Record<Estado, string> = { en_meta: '✓', cerca: '◐', fuera: '✕' }
const pesos = (v: number) => (v < 0 ? '-' : '') + formatoValor('dinero', Math.abs(v))
interface Dato { texto: string; estado?: Estado | null }

function Inicio({ seguimientos, registros, activos, alCrear, alActivar, alIr, alAvisos, alAbrir }: {
  seguimientos: Seguimiento[] | null
  registros: RegistroGuardado[]
  activos: Modulo[]
  alCrear: (modulo?: Modulo) => void
  alActivar: (modulo: Modulo) => void
  alIr: (destino: Destino) => void
  alAvisos: () => void
  alAbrir: (id: string) => void
}) {
  const hoy = hoyIso()
  const finanzas = useMemo(() => seguimientos && resumenFinanzas(seguimientos, registros, hoy), [seguimientos, registros, hoy])
  const salud = useMemo(() => seguimientos && resumenSalud(seguimientos, registros, hoy), [seguimientos, registros, hoy])
  const habitos = useMemo(() => seguimientos && resumenHabitos(seguimientos, registros, hoy), [seguimientos, registros, hoy])
  const otros = useMemo(() => (seguimientos ?? []).filter(s => !moduloDe(s.codigo_plantilla))
    .map((s, indice) => ({ s, indice, ...resumen(s, registros) }))
    .sort((a, b) => ordenEstado(a.estado) - ordenEstado(b.estado)), [seguimientos, registros])
  const [facturas, setFacturas] = useState<{ porPagar: number; vencidas: number; total: number } | null>(null)
  const [cuotas, setCuotas] = useState<{ pendientes: number; atrasadas: number; total: number } | null>(null)
  const [tareas, setTareas] = useState<{ pendientes: number; vencidas: number; recordatorios: number; aTiempo: number; total: number } | null>(null)
  const conTareas = activos.includes('tareas')
  // las tareas viven en sus tablas, no en los registros
  useEffect(() => {
    if (!conTareas) return
    const hoyCol = fechaColombia(new Date())
    obtenerTareas(sumarDias(hoyCol, -30)).then(d => {
      const h = deHoy(d.tareas, d.recordatorios, hoyCol)
      setTareas({ pendientes: h.deHoy.length + h.sinFecha.length, vencidas: h.vencidas.length, recordatorios: h.recordatorios.length, ...aTiempoSemana(d.tareas, hoyCol) })
    }).catch(() => setTareas(null))
  }, [conTareas])
  const [meta, setMeta] = useState<ReturnType<typeof metaProxima> | null>(null)
  const conFinanzas = !!finanzas
  const idAhorro = seguimientos?.find(s => s.codigo_plantilla === 'finanzas' && s.nombre === 'Ahorro')?.id_seguimiento

  // las facturas viven en sus tablas, no en los registros; se vuelven a pedir cuando cambia algo
  useEffect(() => {
    if (!conFinanzas) return
    obtenerRecibos(`${mesesAntes(hoy.slice(0, 7), 12)}-01`).then(d => {
      const filas = recibosDelMes(d.recibos, d.pagos, hoy)
      setFacturas({ porPagar: filas.filter(f => f.estado === 'por_pagar').length, vencidas: filas.filter(f => f.estado === 'vencido').length, total: filas.length })
    }).catch(() => setFacturas(null))
    obtenerPrestamos().then(d => {
      const estados = d.prestamos.map(p => estadoPrestamo(amortizacion(p, d.movimientos.filter(m => m.id_prestamo === p.id_prestamo)).filas, hoy).estado)
      setCuotas({ pendientes: estados.filter(e => e === 'pendiente').length, atrasadas: estados.filter(e => e === 'atrasada').length, total: estados.length })
    }).catch(() => setCuotas(null))
    if (idAhorro) obtenerMetasAhorro(idAhorro).then(d => setMeta(metaProxima(d.metas, d.ahorros.map(r =>
      ({ fecha: r.fecha, valor: r.valor, tipo: 'ahorro' as const, id_etiqueta: r.id_etiqueta })), hoy))).catch(() => setMeta(null))
  }, [conFinanzas, registros, hoy, idAhorro])

  // el estado que más pide atención va en la chapa; lo demás, como dato
  const saldo: Dato | null = finanzas && (finanzas.saldo >= 0
    ? { texto: 'Saldo a favor este mes', estado: 'en_meta' } : { texto: 'Gastas más de lo que entra', estado: 'fuera' })
  const factura: Dato | null = !facturas?.total ? null
    : facturas.vencidas ? { texto: `${facturas.vencidas} ${facturas.vencidas === 1 ? 'factura vencida' : 'facturas vencidas'}`, estado: 'fuera' }
      : facturas.porPagar ? { texto: `${facturas.porPagar} ${facturas.porPagar === 1 ? 'factura' : 'facturas'} por pagar`, estado: 'cerca' }
        : { texto: 'Facturas al día', estado: 'en_meta' }
  const fijos = finanzas?.ingresosFijos
  const ingreso: Dato | null = !fijos?.total ? null
    : fijos.atrasados ? { texto: `${fijos.atrasados} ${fijos.atrasados === 1 ? 'ingreso fijo atrasado' : 'ingresos fijos atrasados'}`, estado: 'fuera' }
      : fijos.pendientes ? { texto: `${fijos.pendientes} ${fijos.pendientes === 1 ? 'ingreso fijo pendiente' : 'ingresos fijos pendientes'}`, estado: 'cerca' }
        : { texto: 'Ingresos fijos recibidos', estado: 'en_meta' }
  const cuota: Dato | null = !cuotas?.total ? null
    : cuotas.atrasadas ? { texto: `${cuotas.atrasadas} ${cuotas.atrasadas === 1 ? 'cuota atrasada' : 'cuotas atrasadas'}`, estado: 'fuera' }
      : cuotas.pendientes ? { texto: `${cuotas.pendientes} ${cuotas.pendientes === 1 ? 'cuota' : 'cuotas'} por pagar este mes`, estado: 'cerca' }
        : { texto: 'Préstamos al día', estado: 'en_meta' }
  const ahorro: Dato | null = meta && { texto: `Meta ${meta.meta.nombre}: ${meta.porcentaje} %`, estado: meta.estado === 'atrasada' ? 'cerca' : meta.estado === 'va_bien' ? 'en_meta' : null }
  const avisos = [factura, cuota, ingreso]
  const chapaFinanzas = avisos.find(d => d && d.estado === 'fuera') ?? avisos.find(d => d && d.estado === 'cerca') ?? saldo
  const datosFinanzas = [saldo, ...avisos, ahorro].filter((d): d is Dato => !!d && d !== chapaFinanzas)
  const montos = finanzas ? [['Gastos', finanzas.gastos], ['Ingresos', finanzas.ingresos], ['Ahorro', finanzas.ahorro]] as [string, number][] : undefined
  const datosSalud: Dato[] = salud ? [
    { texto: salud.peso
      ? `Peso ${formatoValor('numero', salud.peso.valor, salud.peso.unidad)}${salud.peso.cambio30 === null ? '' : ` · ${conSigno(salud.peso.cambio30, salud.peso.unidad)} en 30 días`}`
      : 'Peso: sin registrar', estado: salud.peso?.estado },
    { texto: salud.cintura ? `Cintura ${formatoValor('numero', salud.cintura.valor, salud.cintura.unidad)}` : 'Cintura: sin registrar', estado: salud.cintura?.estado },
  ] : []
  const chapaHabitos: Dato | null = habitos && (habitos.hechos === habitos.total ? { texto: 'Todo hecho hoy', estado: 'en_meta' }
    : habitos.hechos ? { texto: `Te ${habitos.total - habitos.hechos === 1 ? 'falta 1' : `faltan ${habitos.total - habitos.hechos}`}`, estado: 'cerca' }
      : { texto: 'Ninguno hecho hoy', estado: 'fuera' })
  const inactivos = seguimientos ? MODULOS.filter(m => !activos.includes(m)) : []

  return (
    <>
      <header className="encabezado">
        <div>
          <h1>Mi seguimiento</h1>
          <p className="tenue">{new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="acciones">
          {activos.length > 0 && <button className="principal crear" onClick={() => alCrear()}>+ Crear</button>}
          <button className="secundario" onClick={alAvisos}>Avisos</button>
          <button className="secundario" onClick={cerrarSesion}>Salir</button>
        </div>
      </header>
      <main className="cuadricula" aria-label="Módulos" aria-busy={!seguimientos}>
        {!seguimientos && [1, 2, 3].map(n => <div key={n} className="tarjeta esqueleto" />)}
        {activos.includes('finanzas') && (
          <Bloque modulo="finanzas" vacio={!finanzas?.hayDatos} cifra={finanzas ? pesos(finanzas.saldo) : ''} sub="saldo del mes" chapa={chapaFinanzas} montos={montos} datos={datosFinanzas}
            puntos={finanzas?.puntos ?? []} formato={pesos} alAbrir={() => alIr({ tipo: 'finanzas' })} alCrear={() => alCrear('finanzas')} />
        )}
        {activos.includes('salud') && (
          <Bloque modulo="salud" vacio={!salud?.hayDatos} cifra={dias(salud?.diasGym ?? 0)} sub="de gym esta semana" datos={datosSalud}
            puntos={salud?.puntos ?? []} alAbrir={() => alIr({ tipo: 'salud' })} alCrear={() => alCrear('salud')} />
        )}
        {activos.includes('habitos') && (
          <Bloque modulo="habitos" vacio={!habitos} cifra={habitos ? `${habitos.hechos} de ${habitos.total}` : ''} sub="hechos hoy" chapa={chapaHabitos}
            datos={habitos ? [{ texto: `Mejor racha viva ${dias(habitos.mejorRacha)}` }] : []}
            puntos={habitos?.puntos ?? []} meta={habitos?.total} alAbrir={() => alIr({ tipo: 'habitos' })} alCrear={() => alCrear('habitos')} />
        )}
        {activos.includes('tareas') && (
          <Bloque modulo="tareas" vacio={!tareas || (!tareas.pendientes && !tareas.vencidas && !tareas.recordatorios && !tareas.total)}
            cifra={tareas ? String(tareas.pendientes + tareas.vencidas + tareas.recordatorios) : ''} sub="pendientes hoy"
            chapa={tareas?.vencidas ? { texto: `${tareas.vencidas} ${tareas.vencidas === 1 ? 'vencida' : 'vencidas'}`, estado: 'fuera' }
              : tareas && !tareas.pendientes && !tareas.recordatorios ? { texto: 'Todo al día', estado: 'en_meta' } : null}
            datos={tareas?.total ? [{ texto: `${Math.round(tareas.aTiempo / tareas.total * 100)} % a tiempo esta semana (${tareas.aTiempo} de ${tareas.total})` }] : []}
            puntos={[]} alAbrir={() => alIr({ tipo: 'tareas' })} alCrear={() => alCrear('tareas')} />
        )}
        {otros.length > 0 && (
          <section className="tarjeta t4 otros" aria-label="Otros">
            <h2>Otros</h2>
            <ul className="datos">
              {otros.map(({ s, valor, estado }) => (
                <li key={s.id_seguimiento}>
                  <button className="enlace-claro" onClick={() => alAbrir(s.id_seguimiento)}>
                    <strong>{s.nombre}</strong> {formatoValor(s.tipo_medida, valor, s.unidad)} · {estado ? TEXTO_ESTADO[estado] : textoMeta(s)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      {inactivos.length > 0 && (
        <section className="apagados" aria-label="Módulos sin activar">
          {inactivos.map(m => (
            <div key={m} className="apagado">
              <span><strong>{NOMBRE[m]}</strong> · {QUE_MIDE[m]}</span>
              <button className="secundario" onClick={() => alActivar(m)}>Activar</button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

function Bloque({ modulo, vacio, cifra, sub, chapa, montos, datos, puntos, meta, formato, alAbrir, alCrear }: {
  modulo: Modulo; vacio: boolean; cifra: string; sub: string; chapa?: Dato | null; montos?: [string, number][]; datos: Dato[]
  puntos: Registro[]; meta?: number
  formato?: (valor: number) => string; alAbrir: () => void; alCrear: () => void
}) {
  if (vacio) return (
    <button className={`tarjeta ${COLOR[modulo]}`} onClick={alCrear}>
      <h2>{NOMBRE[modulo]}</h2>
      <span className="sub">Aún no registras nada.</span>
      <span className="estado">+ Registrar lo primero</span>
    </button>
  )
  return (
    <button className={`tarjeta ${COLOR[modulo]}`} onClick={alAbrir}>
      <h2>{NOMBRE[modulo]} <span aria-hidden="true">→</span></h2>
      <span className="cifra">{cifra}</span>
      <span className="sub">{sub}</span>
      {chapa?.estado && <span className="estado">{ICONO[chapa.estado]} {chapa.texto}</span>}
      {montos && (
        <span className="montos">
          {montos.map(([nombre, valor]) => <span key={nombre}><span className="sub">{nombre}</span><strong>{pesos(valor)}</strong></span>)}
        </span>
      )}
      <span className="datos">
        {datos.map(d => <span key={d.texto}>{d.estado && `${ICONO[d.estado]} `}{d.texto}</span>)}
      </span>
      {puntos.length > 1 && (
        <Grafico compacto puntos={puntos} meta={meta} formato={formato} color="#FFFFFF" colorMeta="#FFFFFFBF" descripcion={`Tendencia de ${NOMBRE[modulo]}`} />
      )}
    </button>
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
