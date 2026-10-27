import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import {
  asegurarPerfil, cerrarSesion, eliminarRegistro, enviarCola, obtenerPlantillasActivas, obtenerRecibos, obtenerRegistros,
  obtenerSeguimientos, registrar, type RegistroGuardado, type Seguimiento,
} from './datos'
import {
  agregado, estado, formatoValor, inicioPeriodo, ordenEstado, periodoDe, seSuma, serie,
  type Estado, type Periodo, type Registro, type TipoMedida,
} from './indicadores'
import Grafico from './Grafico'
import Privacidad from './Privacidad'
import Finanzas from './finanzas/Finanzas'
import Salud from './salud/Salud'
import Habitos from './habitos/Habitos'
import { dias } from './habitos/calculos'
import { mesesAntes } from './finanzas/calculos'
import { recibosDelMes } from './finanzas/estadoRecibos'
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
  const [verPrivacidad, setVerPrivacidad] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, nueva) => setSesion(nueva))
    return () => data.subscription.unsubscribe()
  }, [])

  if (sesion === undefined) return <div className="contenedor"><p className="tenue">Cargando…</p></div>
  if (verPrivacidad) return <Privacidad alVolver={() => setVerPrivacidad(false)} />
  if (!sesion) return <Entrar alPrivacidad={() => setVerPrivacidad(true)} />
  return <Panel sesion={sesion} alPrivacidad={() => setVerPrivacidad(true)} />
}

function Entrar({ alPrivacidad }: { alPrivacidad: () => void }) {
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
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  )
}

type Vista = { tipo: 'inicio' } | { tipo: 'crear'; modulo?: Modulo } | Destino | { tipo: 'detalle'; id: string }

function Panel({ sesion, alPrivacidad }: { sesion: Session; alPrivacidad: () => void }) {
  const [vista, setVista] = useState<Vista>({ tipo: 'inicio' })
  const [seguimientos, setSeguimientos] = useState<Seguimiento[] | null>(null)
  const [registros, setRegistros] = useState<RegistroGuardado[]>([])
  const [plantillas, setPlantillas] = useState<string[]>([])
  const [error, setError] = useState('')
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
          alAbrir={id => setVista({ tipo: 'detalle', id })}
        />
      )}
      <footer className="pie"><button className="enlace" onClick={alPrivacidad}>Privacidad</button></footer>
    </div>
  )
}

const ICONO: Record<Estado, string> = { en_meta: '✓', cerca: '◐', fuera: '✕' }
const pesos = (v: number) => (v < 0 ? '-' : '') + formatoValor('dinero', Math.abs(v))
interface Dato { texto: string; estado?: Estado | null }

function Inicio({ seguimientos, registros, activos, alCrear, alActivar, alIr, alAbrir }: {
  seguimientos: Seguimiento[] | null
  registros: RegistroGuardado[]
  activos: Modulo[]
  alCrear: (modulo?: Modulo) => void
  alActivar: (modulo: Modulo) => void
  alIr: (destino: Destino) => void
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
  const conFinanzas = !!finanzas

  // las facturas viven en sus tablas, no en los registros; se vuelven a pedir cuando cambia algo
  useEffect(() => {
    if (!conFinanzas) return
    obtenerRecibos(`${mesesAntes(hoy.slice(0, 7), 12)}-01`).then(d => {
      const filas = recibosDelMes(d.recibos, d.pagos, hoy)
      setFacturas({ porPagar: filas.filter(f => f.estado === 'por_pagar').length, vencidas: filas.filter(f => f.estado === 'vencido').length, total: filas.length })
    }).catch(() => setFacturas(null))
  }, [conFinanzas, registros, hoy])

  // el estado que más pide atención va en la chapa; lo demás, como dato
  const saldo: Dato | null = finanzas && (finanzas.saldo >= 0
    ? { texto: 'Saldo a favor este mes', estado: 'en_meta' } : { texto: 'Gastas más de lo que entra', estado: 'fuera' })
  const factura: Dato | null = !facturas?.total ? null
    : facturas.vencidas ? { texto: `${facturas.vencidas} ${facturas.vencidas === 1 ? 'factura vencida' : 'facturas vencidas'}`, estado: 'fuera' }
      : facturas.porPagar ? { texto: `${facturas.porPagar} ${facturas.porPagar === 1 ? 'factura' : 'facturas'} por pagar`, estado: 'cerca' }
        : { texto: 'Facturas al día', estado: 'en_meta' }
  const chapaFinanzas = factura && factura.estado !== 'en_meta' ? factura : saldo
  const datosFinanzas = [saldo, factura].filter((d): d is Dato => !!d && d !== chapaFinanzas)
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
