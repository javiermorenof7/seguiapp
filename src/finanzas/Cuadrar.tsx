import { useEffect, useMemo, useRef, useState } from 'react'
import ComoFunciona from '../ComoFunciona'
import {
  aprenderCategoria, aprenderDeExtracto, aprendidoDeExtracto, corregirRegistro, crearCuenta, crearTraslados, eliminarRegistro, guardarCarga,
  obtenerRegistros, ponerCuenta, quitarCarga, type Banco, type ExtractoGuardado, type FilaCarga, type obtenerFinanzas, type RegistroGuardado,
} from '../datos'
import { formatoValor } from '../indicadores'
import { facturaParecida } from './aprende'
import { queDescuentan } from './estadoRecibos'
import { categoriaDeBanco, comercio, conciliar, diferencia, enPesos, leerExtracto, limpiarOcr, saldoEstimado, type Anotado, type ExtractoLeido, type Formato, type MovimientoBanco } from './extracto'
import { leerMonto, normalizar } from './parseo'

type Datos = Awaited<ReturnType<typeof obtenerFinanzas>>
type Traslados = Awaited<ReturnType<typeof crearTraslados>>
interface Ids { gasto: string; ingreso?: string; ahorro?: string; traslados?: string }
// a dónde va un movimiento que falta: g:<categoría>, i:<fuente>, a (ahorro) o t (entre mis cuentas)
interface Decision { incluir: boolean; destino: string; id_recibo?: string; valor: number }

const pesos = (v: number) => (v < 0 ? '−' : '') + formatoValor('dinero', Math.abs(v))
const dePesos = (centavos: number) => pesos(Math.round(centavos / 100))
const dia = (fecha: string) => fecha.split('-').reverse().join('/')
const periodo = (desde: string, hasta: string) => desde.slice(0, 7) === hasta.slice(0, 7)
  ? new Date(`${hasta.slice(0, 7)}-15T12:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
  : `${dia(desde)} a ${dia(hasta)}`
const diasAntes = (fecha: string, n: number) => { const d = new Date(`${fecha}T12:00`); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA') }
const MAX_NOTA = 120

type Paso =
  | { paso: 'inicio' }
  | { paso: 'leyendo'; texto: string }
  | { paso: 'clave'; archivo: File; equivocada: boolean }
  | { paso: 'columnas'; lineas: string[]; ejemplo: { descripcion: string; montos: number[] } }
  | { paso: 'cuadre'; extracto: ExtractoLeido; lineas: string[] }

export default function Extracto({ ids, datos, banco, registros, desdeRegistros, alCambiar, alVerHistorial }: {
  ids: Ids
  datos: Datos
  banco: Banco
  /** lo cargado en la app (último año), para el estado de los meses ya subidos */
  registros: RegistroGuardado[]
  desdeRegistros: string
  alCambiar: () => Promise<void>
  alVerHistorial: () => void
}) {
  const [estado, setEstado] = useState<Paso>({ paso: 'inicio' })
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [traslados, setTraslados] = useState<Traslados | null>(null)
  const [sabidos, setSabidos] = useState<{ traslados: Map<string, string>; formatos: Map<string, string> }>({ traslados: new Map(), formatos: new Map() })
  const archivoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([aprendidoDeExtracto('traslado'), aprendidoDeExtracto('formato_extracto')]).then(([t, f]) => setSabidos({ traslados: t, formatos: f }), () => {})
  }, [])
  useEffect(() => { if (ids.traslados) crearTraslados().then(setTraslados, () => {}) }, [ids.traslados])

  // dónde anotó antes cada comercio, para sugerir la categoría de lo que trae el banco
  const historia = useMemo(() => registros.flatMap(r => {
    const texto = r.nota && r.id_etiqueta ? comercio(r.nota) : ''
    return texto ? [{ texto, id_etiqueta: r.id_etiqueta! }] : []
  }), [registros])

  // el signo con que cada registro mueve la cuenta
  const signo = (r: RegistroGuardado) => r.id_seguimiento === ids.ingreso || (traslados && r.id_etiqueta === traslados.entrada) ? 1 : -1
  const deFinanzas = (r: RegistroGuardado) => [ids.gasto, ids.ingreso, ids.ahorro, ids.traslados].includes(r.id_seguimiento)

  async function leer(archivo: File, clave?: string) {
    setError(''); setAviso('')
    setEstado({ paso: 'leyendo', texto: 'Abriendo el extracto…' })
    try {
      const { lineasDePdf, lineasPorOcr, PdfConClave } = await import('./leerPdf')
      try {
        const lineas = await lineasDePdf(archivo, clave, (n, total) => setEstado({ paso: 'leyendo', texto: `Leyendo página ${n} de ${total}` }))
        if (interpretar(lineas)) return
        // sin movimientos en el texto: vienen como imagen
        setEstado({ paso: 'leyendo', texto: 'Los movimientos vienen como imagen: preparando el lector, tarda unos segundos…' })
        const leidas = await lineasPorOcr(archivo, clave, (n, total) => setEstado({ paso: 'leyendo', texto: `Leyendo la imagen de la página ${n} de ${total}` }))
        if (interpretar(limpiarOcr(leidas))) return
        setEstado({ paso: 'inicio' })
        setError('No encontré movimientos en este PDF. Revisa que sea el extracto de una cuenta de ahorros o corriente.')
      } catch (e) {
        if (e instanceof PdfConClave) return setEstado({ paso: 'clave', archivo, equivocada: e.equivocada })
        throw e
      }
    } catch {
      setEstado({ paso: 'inicio' })
      setError('No pude leer ese archivo. Revisa que sea el PDF del extracto tal como lo entrega el banco.')
    }
  }

  // la firma de un formato: sus primeras líneas sin números, para recordar qué es cada columna
  const firma = (lineas: string[]) => normalizar(lineas.filter(l => !/\d/.test(l)).slice(0, 4).join('|')).slice(0, 100)

  // true si con esas líneas ya hay algo que mostrar (el cuadre o la pregunta de las columnas)
  function interpretar(lineas: string[], formato?: Formato): boolean {
    const guardado = sabidos.formatos.get(firma(lineas))
    const lectura = leerExtracto(lineas, formato ?? (guardado ? JSON.parse(guardado) as Formato : undefined))
    if (lectura.ok) {
      if (formato) aprenderDeExtracto('formato_extracto', firma(lineas), JSON.stringify(formato)).catch(() => {})
      setEstado({ paso: 'cuadre', extracto: lectura.extracto, lineas })
      return true
    }
    if (lectura.motivo === 'columnas' && lectura.ejemplo.montos.length >= 2) {
      setEstado({ paso: 'columnas', lineas, ejemplo: lectura.ejemplo })
      return true
    }
    return false
  }

  return (
    <section className="extracto">
      {error && <p role="alert" className="error">{error}</p>}
      {aviso && <p role="status" className="aviso">{aviso} <button type="button" className="enlace" onClick={alVerHistorial}>Ver en el Historial</button></p>}
      {estado.paso === 'inicio' && (
        <>
          <h2>¿La app dice lo mismo que el banco?</h2>
          <ComoFunciona modulo="extracto" pasos={['Descarga el extracto del mes en PDF desde tu banco y súbelo aquí.', 'Te muestro lo que falta anotar, con su categoría sugerida, y lo agregas con un toque.', 'Lo que ya habías anotado se empareja solo; lo que va entre tus cuentas no cuenta como gasto.', 'Al final el saldo de la app queda igual al del banco.']} />
          <p className="tenue">Sube el extracto del mes y te muestro qué falta anotar y si el saldo cuadra. Se lee en tu equipo, no se sube a ningún lado.</p>
          <input ref={archivoRef} type="file" accept="application/pdf,.pdf" hidden
            onChange={ev => { const a = ev.target.files?.[0]; ev.target.value = ''; if (a) leer(a) }} />
          <button type="button" className="principal" onClick={() => archivoRef.current?.click()}>Subir extracto (PDF)</button>
          <Subidos banco={banco} registros={registros} desdeRegistros={desdeRegistros} signo={signo}
            alQuitar={async id => { await quitarCarga(id); await alCambiar(); setAviso('') }} />
        </>
      )}
      {estado.paso === 'leyendo' && <p role="status" className="tenue">{estado.texto}</p>}
      {estado.paso === 'clave' && (
        <Clave equivocada={estado.equivocada} alCancelar={() => setEstado({ paso: 'inicio' })} alEnviar={clave => leer(estado.archivo, clave)} />
      )}
      {estado.paso === 'columnas' && (
        <Columnas ejemplo={estado.ejemplo} alCancelar={() => setEstado({ paso: 'inicio' })} alElegir={formato => { if (!interpretar(estado.lineas, formato)) { setEstado({ paso: 'inicio' }); setError('Con esas columnas el saldo no cuadra. Sube el extracto otra vez y elige otras.') } }} />
      )}
      {estado.paso === 'cuadre' && (
        <Cuadre key={estado.extracto.desde + estado.extracto.hasta + estado.extracto.saldoFinal} extracto={estado.extracto} ids={ids} datos={datos} banco={banco}
          sabidos={sabidos.traslados} historia={historia} signo={signo} deFinanzas={deFinanzas} alCambiar={alCambiar}
          alCancelar={() => setEstado({ paso: 'inicio' })}
          alTerminar={mensaje => { setEstado({ paso: 'inicio' }); setAviso(mensaje) }} />
      )}
    </section>
  )
}

function Clave({ equivocada, alEnviar, alCancelar }: { equivocada: boolean; alEnviar: (clave: string) => void; alCancelar: () => void }) {
  const [clave, setClave] = useState('')
  return (
    <form className="formulario" onSubmit={ev => { ev.preventDefault(); alEnviar(clave) }}>
      <h2>Este extracto tiene clave</h2>
      {equivocada && <p role="alert" className="error">Esa clave no abre el archivo. Prueba otra vez.</p>}
      <label>Clave del PDF
        <input type="password" required autoFocus autoComplete="off" value={clave} onChange={ev => setClave(ev.target.value)} />
        <small className="ayuda">Suele ser tu número de documento. Solo se usa para abrirlo aquí; no se guarda.</small>
      </label>
      <div className="chips">
        <button className="principal">Abrir</button>
        <button type="button" className="secundario" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  )
}

// Cuando los saldos no dicen solos qué es cada número, se pregunta una vez con la primera fila.
function Columnas({ ejemplo, alElegir, alCancelar }: { ejemplo: { descripcion: string; montos: number[] }; alElegir: (f: Formato) => void; alCancelar: () => void }) {
  const [saldo, setSaldo] = useState(ejemplo.montos.length - 1)
  const [valor, setValor] = useState(0)
  return (
    <form className="formulario" onSubmit={ev => { ev.preventDefault(); if (saldo !== valor) alElegir({ saldo, valor }) }}>
      <h2>Ayúdame con este extracto</h2>
      <p className="tenue">No reconocí las columnas. En el primer movimiento{ejemplo.descripcion && ` (${ejemplo.descripcion})`} aparecen estos números:</p>
      {([['¿Cuál es el valor del movimiento?', valor, setValor], ['¿Cuál es el saldo después del movimiento?', saldo, setSaldo]] as const).map(([pregunta, elegido, elegir]) => (
        <fieldset key={pregunta}>
          <legend>{pregunta}</legend>
          <div className="chips">
            {ejemplo.montos.map((m, i) => (
              <button key={i} type="button" role="radio" aria-checked={elegido === i} className="chip" onClick={() => elegir(i)}>{formatoValor('dinero', Math.abs(m) / 100)}</button>
            ))}
          </div>
        </fieldset>
      ))}
      {saldo === valor && <p role="alert" className="error">El valor y el saldo no pueden ser el mismo número.</p>}
      <div className="chips">
        <button className="principal">Leer con estas columnas</button>
        <button type="button" className="secundario" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  )
}

function Cuadre({ extracto: e, ids, datos, banco, sabidos, historia, signo, deFinanzas, alCambiar, alCancelar, alTerminar }: {
  extracto: ExtractoLeido; ids: Ids; datos: Datos; banco: Banco; sabidos: Map<string, string>; historia: { texto: string; id_etiqueta: string }[]
  signo: (r: RegistroGuardado) => number; deFinanzas: (r: RegistroGuardado) => boolean
  alCambiar: () => Promise<void>; alCancelar: () => void; alTerminar: (mensaje: string) => void
}) {
  const cuenta = banco.cuentas.find(c => c.ultimos_digitos && c.ultimos_digitos === e.ultimos4)
  const [idElegida, setIdElegida] = useState('')
  const [nombreCuenta, setNombreCuenta] = useState(e.ultimos4 ? `Cuenta ·${e.ultimos4}` : 'Mi cuenta')
  const idCuenta = cuenta?.id_cuenta ?? (idElegida || null)
  const efectivo = banco.cuentas.find(c => c.nombre === 'Efectivo')
  const [anotados, setAnotados] = useState<(Anotado & { registro: RegistroGuardado })[] | null>(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [decisiones, setDecisiones] = useState(new Map<string, Decision>())
  // lo que la persona decidió para un monto que no coincide: usar el del banco o dejar el suyo
  const [montos, setMontos] = useState(new Map<string, 'banco' | 'mio'>())
  const [confirmar, setConfirmar] = useState('')

  useEffect(() => {
    obtenerRegistros(diasAntes(e.desde, 3)).then(filas => setAnotados(filas.filter(deFinanzas).map(r => ({
      id_registro: r.id_registro, fecha: r.fecha, valor: signo(r) * Math.round(r.valor * 100), id_cuenta: banco.deRegistro.get(r.id_registro) ?? null, nota: r.nota, registro: r,
    }))), err => setError((err as Error).message))
    // se vuelve a pedir cuando cambian las cuentas o lo cargado
  }, [e, banco])

  // huellas ya guardadas de esta cuenta, con su registro (vacío en los de centavos)
  const cargados = useMemo(() => {
    const suyos = new Set(banco.extractos.filter(x => x.id_cuenta === idCuenta).map(x => x.id_extracto))
    return new Map(banco.vinculos.filter(v => suyos.has(v.id_extracto)).map(v => [v.huella, v.id_registro]))
  }, [banco, idCuenta])

  const { cuadre, centavos } = useMemo(() => {
    // lo que no llega a un peso no crea registro: solo cuenta en el saldo
    const normales = e.movimientos.filter(m => enPesos(m.valor) !== 0)
    const sueltos = e.movimientos.filter(m => enPesos(m.valor) === 0 && !cargados.has(m.huella))
    const conRegistro = new Map([...cargados].flatMap(([h, id]) => id ? [[h, id] as [string, string]] : []))
    return { cuadre: conciliar({ ...e, movimientos: normales }, anotados ?? [], idCuenta, conRegistro), centavos: sueltos }
  }, [e, anotados, idCuenta, cargados])

  const propuesta = (m: MovimientoBanco): Decision => {
    if (sabidos.has(normalizar(m.descripcion).slice(0, 100))) return { incluir: true, destino: 't', valor: m.valor }
    if (m.valor > 0) return { incluir: true, destino: `i:${categoriaDeBanco(m.descripcion, datos.aprendido, datos.fuentes, historia)?.id_etiqueta ?? ''}`, valor: m.valor }
    // el banco pega las palabras con puntos ("NAL.CLARO"): se separan antes de buscar la factura
    const factura = facturaParecida(queDescuentan(datos.recibos), normalizar(m.descripcion).replace(/[^a-z0-9ñ]+/g, ' '))
    const categoria = factura ? datos.categorias.find(c => normalizar(c.nombre) === 'hogar') : categoriaDeBanco(m.descripcion, datos.aprendido, datos.categorias, historia)
    return { incluir: true, destino: `g:${categoria?.id_etiqueta ?? ''}`, id_recibo: factura?.id_recibo, valor: m.valor }
  }
  // las propuestas se calculan una vez por extracto: comparan cada fila con todo lo anotado
  const propuestas = useMemo(() => new Map(cuadre.faltan.map(m => [m.huella, propuesta(m)])), [cuadre.faltan, sabidos, historia, datos])
  const decision = (m: MovimientoBanco) => decisiones.get(m.huella) ?? propuestas.get(m.huella) ?? propuesta(m)
  // movimientos iguales: misma descripción y mismo sentido
  const igual = (m: MovimientoBanco) => `${Math.sign(m.valor)}|${normalizar(m.descripcion)}`
  // elegir a dónde va uno lo pone en todos sus iguales; marcar o corregir el monto es de cada fila
  const decidir = (m: MovimientoBanco, cambio: Partial<Decision>) => {
    const nuevas = new Map(decisiones)
    for (const o of cambio.destino === undefined ? [m] : cuadre.faltan.filter(x => igual(x) === igual(m))) nuevas.set(o.huella, { ...decision(o), ...cambio })
    setDecisiones(nuevas)
  }
  const grupos = useMemo(() => {
    const porClave = new Map<string, MovimientoBanco[]>()
    for (const m of cuadre.faltan) porClave.set(igual(m), [...(porClave.get(igual(m)) ?? []), m])
    return [...porClave.values()]
  }, [cuadre.faltan])
  // con un extracto más reciente de esta cuenta ya subido, este solo carga movimientos: el saldo se cuadra con el último
  const esReciente = !banco.extractos.some(x => x.id_cuenta === idCuenta && x.fecha_hasta > e.hasta)

  const porGuardar = cuadre.faltan.filter(m => decision(m).incluir)
  const falta = diferencia(cuadre) + centavos.reduce((t, m) => t + m.valor, 0)
  const sinVincular = cuadre.cuadran.filter(p => !cargados.has(p.banco.huella))
  const pendientes = cuadre.faltan.length + cuadre.montoDistinto.length + cuadre.soloApp.length
  const todos = e.movimientos.length - centavos.length + cuadre.soloApp.length
  const hayCambios = porGuardar.length + sinVincular.length + centavos.length + montos.size > 0
  const dudosos = cuadre.faltan.filter(m => m.dudoso).length

  async function accion(hacer: () => Promise<unknown>) {
    setEnviando(true); setError('')
    try { await hacer(); await alCambiar() } catch (err) { setError((err as Error).message) } finally { setEnviando(false); setConfirmar('') }
  }

  async function guardar() {
    setEnviando(true); setError('')
    try {
      const id = idCuenta ?? await crearCuenta(nombreCuenta.trim().slice(0, 40) || 'Mi cuenta', e.ultimos4)
      const tr = porGuardar.some(m => decision(m).destino === 't') ? await crearTraslados() : null
      const nuevo = (m: MovimientoBanco, d: Decision): NonNullable<FilaCarga['nuevo']> => {
        const base = { valor: Math.abs(enPesos(d.valor)) / 100, nota: m.descripcion.slice(0, MAX_NOTA) }
        if (d.destino === 't') return { ...base, id_seguimiento: tr!.id_seguimiento, id_etiqueta: d.valor > 0 ? tr!.entrada : tr!.salida }
        if (d.destino === 'a' && ids.ahorro) return { ...base, id_seguimiento: ids.ahorro, id_etiqueta: null }
        const etiqueta = d.destino.slice(2) || null
        return d.valor > 0 && ids.ingreso
          ? { ...base, id_seguimiento: ids.ingreso, id_etiqueta: etiqueta }
          : { ...base, id_seguimiento: ids.gasto, id_etiqueta: d.valor > 0 ? null : etiqueta, id_recibo: d.id_recibo }
      }
      const resueltos = cuadre.montoDistinto.filter(p => montos.has(p.banco.huella))
      for (const p of resueltos.filter(p => montos.get(p.banco.huella) === 'banco'))
        await corregirRegistro(p.app.id_registro, { valor: Math.abs(enPesos(p.banco.valor)) / 100, nota: p.app.nota })
      const filas: FilaCarga[] = [
        ...[...sinVincular, ...resueltos].map(p => ({ huella: p.banco.huella, fecha: p.banco.fecha, valor_banco: p.banco.valor / 100, id_registro: p.app.id_registro })),
        ...porGuardar.map(m => ({ huella: m.huella, fecha: m.fecha, valor_banco: decision(m).valor / 100, nuevo: nuevo(m, decision(m)) })),
        ...centavos.map(m => ({ huella: m.huella, fecha: m.fecha, valor_banco: m.valor / 100 })),
      ]
      await guardarCarga(id, { desde: e.desde, hasta: e.hasta, saldoInicial: e.saldoInicial / 100, saldoFinal: e.saldoFinal / 100 }, filas)
      // aprende de lo que la persona cambió frente a lo propuesto, una vez por grupo de iguales
      const aprendidas = new Set<string>()
      for (const m of porGuardar) {
        const d = decision(m)
        if (d.destino === propuestas.get(m.huella)?.destino || aprendidas.has(igual(m))) continue
        aprendidas.add(igual(m))
        const completa = normalizar(m.descripcion).slice(0, 100)
        const elegida = [...datos.categorias, ...datos.fuentes].find(c => c.id_etiqueta === d.destino.slice(2))
        // un traslado se recuerda con el texto entero (lleva la cuenta); una categoría, con el comercio
        if (d.destino === 't') await aprenderDeExtracto('traslado', completa, 'si').catch(() => {})
        else if (elegida && completa) await aprenderCategoria((comercio(m.descripcion) || completa).slice(0, 100), elegida.nombre).catch(() => {})
      }
      await alCambiar()
      const quedan = cuadre.faltan.length - porGuardar.length + cuadre.montoDistinto.length - resueltos.length + cuadre.soloApp.length
      alTerminar(quedan
        ? `Guardado. Quedan ${quedan} por resolver en ${periodo(e.desde, e.hasta)}: vuelve a subir el extracto cuando quieras.`
        : esReciente ? `✓ ${periodo(e.desde, e.hasta)} cuadra con el banco · Saldo ${dePesos(e.saldoFinal)} al ${dia(e.hasta)}.`
          : `✓ Movimientos de ${periodo(e.desde, e.hasta)} cargados.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  if (!anotados) return <p className="tenue">{error || 'Comparando con lo que tienes anotado…'}</p>
  const opciones = (m: MovimientoBanco) => m.valor > 0
    ? <><optgroup label="Ingreso">{[{ id_etiqueta: '', nombre: 'Sin fuente' }, ...datos.fuentes].map(f => <option key={f.id_etiqueta} value={`i:${f.id_etiqueta}`}>{f.nombre}</option>)}</optgroup>
      <option value="t">Entre mis cuentas (traslado)</option></>
    : <><optgroup label="Gasto">{[{ id_etiqueta: '', nombre: 'Sin categoría' }, ...datos.categorias].map(c => <option key={c.id_etiqueta} value={`g:${c.id_etiqueta}`}>{c.nombre}</option>)}</optgroup>
      {ids.ahorro && <option value="a">Ahorro</option>}
      <option value="t">Entre mis cuentas (traslado)</option></>

  return (
    <>
      <div className="cuadre-titular" role="status">
        <p className="tenue">{periodo(e.desde, e.hasta)} · {cuenta?.nombre ?? (e.ultimos4 ? `cuenta terminada en ${e.ultimos4}` : 'cuenta nueva')}</p>
        {esReciente ? (
          <>
            <p className="cuadre-numero">{falta === 0 && pendientes === 0 ? '✓ Cuadra con el banco' : `Te faltan ${dePesos(Math.abs(falta))} para cuadrar`}</p>
            <p className="con-estado">
              <span className={`estado ${falta === 0 ? 'en-meta' : 'fuera'}`}>{falta === 0 ? '✓' : '✕'} Saldo al {dia(e.hasta)}</span>
              {dePesos(e.saldoFinal)} en el banco
            </p>
          </>
        ) : (
          <>
            <p className="cuadre-numero">{pendientes === 0 ? '✓ Movimientos cargados' : `Faltan ${cuadre.faltan.length} por agregar`}</p>
            <p>Ya subiste un extracto más reciente de esta cuenta: este solo carga movimientos. El saldo se cuadra con el último.</p>
          </>
        )}
        <p className="tenue">{todos - pendientes} de {todos} movimientos resueltos</p>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!cuenta && (
        <fieldset className="formulario">
          <legend>¿De qué cuenta es este extracto?</legend>
          <div className="chips">
            {banco.cuentas.filter(c => c !== efectivo).map(c => (
              <button key={c.id_cuenta} type="button" role="radio" aria-checked={idElegida === c.id_cuenta} className="chip" onClick={() => setIdElegida(c.id_cuenta)}>{c.nombre}</button>
            ))}
            <button type="button" role="radio" aria-checked={!idElegida} className="chip" onClick={() => setIdElegida('')}>Una nueva</button>
          </div>
          {!idElegida && (
            <label>Nombre de la cuenta
              <input maxLength={40} value={nombreCuenta} onChange={ev => setNombreCuenta(ev.target.value)} />
            </label>
          )}
        </fieldset>
      )}

      {cuadre.faltan.length > 0 && (
        <details className="grupo-cuadre" open>
          <summary>Faltan en la app · {cuadre.faltan.length}</summary>
          {dudosos > 0 && <p className="aviso">{dudosos === 1 ? 'Hay un monto' : `Hay ${dudosos} montos`} que no sigue el saldo: revísalo antes de guardar.</p>}
          <ul className="lista">
            {grupos.map(iguales => {
              const fila = (m: MovimientoBanco, conDestino: boolean) => {
                const d = decision(m)
                const factura = d.id_recibo && datos.recibos.find(r => r.id_recibo === d.id_recibo)
                return (
                  <li key={m.huella} className="ultimo fila-extracto">
                    <label className="marca"><input type="checkbox" checked={d.incluir} onChange={ev => decidir(m, { incluir: ev.target.checked })} aria-label={`Agregar ${m.descripcion}`} /> {dia(m.fecha)}</label>
                    <strong>{dePesos(d.valor)}</strong>
                    <span className="tenue">{factura ? `Pago de ${factura.nombre_servicio} · ` : ''}{m.descripcion || 'Sin descripción'}</span>
                    {(m.dudoso || conDestino) && (
                      <span className="chips">
                        {m.dudoso && (
                          <input className="monto-dudoso" inputMode="decimal" aria-label="Monto correcto, en pesos" defaultValue={Math.abs(d.valor) / 100}
                            onBlur={ev => { const n = Number(ev.target.value.replace(',', '.')); if (n > 0) decidir(m, { valor: Math.sign(m.valor) * Math.round(n * 100) }) }} />
                        )}
                        {conDestino && <select aria-label="A dónde va" value={d.destino} onChange={ev => decidir(m, { destino: ev.target.value, id_recibo: undefined })}>{opciones(m)}</select>}
                      </span>
                    )}
                  </li>
                )
              }
              if (iguales.length === 1) return fila(iguales[0], true)
              const [primero] = iguales
              return (
                <li key={primero.huella} className="ultimo fila-extracto iguales">
                  <span>{iguales.length} iguales</span>
                  <strong>{dePesos(iguales.reduce((s, m) => s + decision(m).valor, 0))}</strong>
                  <span className="tenue">{primero.descripcion || 'Sin descripción'}</span>
                  <span className="chips">
                    <select aria-label={`A dónde van los ${iguales.length}`} value={decision(primero).destino} onChange={ev => decidir(primero, { destino: ev.target.value, id_recibo: undefined })}>{opciones(primero)}</select>
                  </span>
                  <details>
                    <summary>Ver los {iguales.length}</summary>
                    <ul className="lista">{iguales.map(m => fila(m, false))}</ul>
                  </details>
                </li>
              )
            })}
          </ul>
        </details>
      )}

      {cuadre.montoDistinto.length > 0 && (
        <details className="grupo-cuadre" open>
          <summary>El monto no coincide · {cuadre.montoDistinto.length}</summary>
          <ul className="lista">
            {cuadre.montoDistinto.map(p => (
              <li key={p.banco.huella} className="ultimo fila-extracto">
                <span>{dia(p.banco.fecha)}</span>
                <strong>{dePesos(p.banco.valor)}</strong>
                <span className="tenue">El banco dice {dePesos(Math.abs(p.banco.valor))} · anotaste {dePesos(Math.abs(p.app.valor))} · {p.app.nota || p.banco.descripcion}</span>
                <span className="chips" role="radiogroup" aria-label="Qué monto queda">
                  {([['banco', 'Usar el del banco'], ['mio', 'Dejar el mío']] as const).map(([v, texto]) => (
                    <button key={v} type="button" role="radio" aria-checked={montos.get(p.banco.huella) === v} className="chip"
                      onClick={() => setMontos(new Map(montos).set(p.banco.huella, v))}>{texto}</button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {cuadre.soloApp.length > 0 && (
        <details className="grupo-cuadre" open>
          <summary>Solo en la app · {cuadre.soloApp.length}</summary>
          <p className="tenue">Los anotaste en esta cuenta y el banco no los trae.</p>
          <ul className="lista">
            {cuadre.soloApp.map(a => (
              <li key={a.id_registro} className="ultimo fila-extracto">
                <span>{dia(a.fecha)}</span>
                <strong>{dePesos(a.valor)}</strong>
                <span className="tenue">{a.nota || 'Sin descripción'}</span>
                {confirmar === a.id_registro ? (
                  <span className="chips">
                    <span className="tenue">¿Seguro?</span>
                    <button type="button" className="secundario" disabled={enviando} onClick={() => accion(() => eliminarRegistro(a.id_registro))}>Sí, borrar</button>
                    <button type="button" className="secundario" onClick={() => setConfirmar('')}>No</button>
                  </span>
                ) : (
                  <span className="chips">
                    {efectivo && <button type="button" className="secundario" disabled={enviando} onClick={() => accion(() => ponerCuenta([a.id_registro], efectivo.id_cuenta))}>Fue en efectivo</button>}
                    {banco.cuentas.filter(c => c !== efectivo && c.id_cuenta !== idCuenta).map(c => (
                      <button key={c.id_cuenta} type="button" className="secundario" disabled={enviando} onClick={() => accion(() => ponerCuenta([a.id_registro], c.id_cuenta))}>Fue con {c.nombre}</button>
                    ))}
                    <button type="button" className="secundario" onClick={() => setConfirmar(a.id_registro)}>Borrar</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {cuadre.sinCuenta.length > 0 && (
        <details className="grupo-cuadre">
          <summary>Anotados sin cuenta en estas fechas · {cuadre.sinCuenta.length}</summary>
          <p className="tenue">El banco no los trae y no dicen con qué se pagaron: no cuentan en el cuadre.</p>
          {efectivo && <button type="button" className="secundario" disabled={enviando} onClick={() => accion(() => ponerCuenta(cuadre.sinCuenta.map(a => a.id_registro), efectivo.id_cuenta))}>Fueron en efectivo</button>}
          <ul className="lista">
            {cuadre.sinCuenta.map(a => <li key={a.id_registro} className="ultimo"><span>{dia(a.fecha)}</span><strong>{dePesos(a.valor)}</strong><span className="tenue">{a.nota || 'Sin descripción'}</span></li>)}
          </ul>
        </details>
      )}

      {cuadre.cuadran.length > 0 && (
        <details className="grupo-cuadre">
          <summary>Cuadran · {cuadre.cuadran.length}</summary>
          <ul className="lista">
            {cuadre.cuadran.map(p => <li key={p.banco.huella} className="ultimo"><span>{dia(p.banco.fecha)}</span><strong>{dePesos(p.banco.valor)}</strong><span className="tenue">{p.app.nota || p.banco.descripcion}</span></li>)}
          </ul>
        </details>
      )}
      {centavos.length > 0 && <p className="tenue">{centavos.length === 1 ? 'Un movimiento' : `${centavos.length} movimientos`} de menos de un peso (intereses) solo {centavos.length === 1 ? 'cuenta' : 'cuentan'} en el saldo.</p>}

      <div className="chips cuadre-acciones">
        <button type="button" className="principal" disabled={enviando || !hayCambios} onClick={guardar}>
          {enviando ? 'Guardando…' : porGuardar.length ? `Agregar ${porGuardar.length === 1 ? 'el movimiento' : `los ${porGuardar.length}`}` : 'Guardar el cuadre'}
        </button>
        <button type="button" className="secundario" disabled={enviando} onClick={alCancelar}>Cancelar</button>
      </div>
    </>
  )
}

// Los extractos ya subidos, por cuenta, con su estado frente a lo que hay hoy en la app.
function Subidos({ banco, registros, desdeRegistros, signo, alQuitar }: {
  banco: Banco; registros: RegistroGuardado[]; desdeRegistros: string; signo: (r: RegistroGuardado) => number; alQuitar: (idExtracto: string) => Promise<void>
}) {
  const [confirmar, setConfirmar] = useState('')
  const [error, setError] = useState('')
  const activos = useMemo(() => new Set(registros.map(r => r.id_registro)), [registros])
  if (!banco.extractos.length) return null

  const falta = (x: ExtractoGuardado): number | null => {
    if (x.fecha_desde < desdeRegistros) return null
    const suyos = new Set(banco.extractos.filter(o => o.id_cuenta === x.id_cuenta).map(o => o.id_extracto))
    const enRango = (f: string) => f >= x.fecha_desde && f <= x.fecha_hasta
    // un movimiento subido en dos extractos que se pisan cuenta una vez
    const vinculos = [...new Map(banco.vinculos.filter(v => suyos.has(v.id_extracto) && enRango(v.fecha_movimiento)).map(v => [v.huella, v])).values()]
    const vinculados = new Set(vinculos.map(v => v.id_registro))
    const delBanco = vinculos.filter(v => !v.id_registro || activos.has(v.id_registro)).reduce((t, v) => t + Math.round(v.valor_banco * 100), 0)
    const sueltos = registros.filter(r => banco.deRegistro.get(r.id_registro) === x.id_cuenta && enRango(r.fecha) && !vinculados.has(r.id_registro))
      .reduce((t, r) => t + signo(r) * Math.round(r.valor * 100), 0)
    return Math.round(x.valor_saldo_final * 100) - Math.round(x.valor_saldo_inicial * 100) - delBanco - sueltos
  }
  // entre dos extractos seguidos de una cuenta, el saldo final de uno es el inicial del otro; si no, falta uno en medio
  const huecos = banco.cuentas.flatMap(c => {
    const suyos = banco.extractos.filter(x => x.id_cuenta === c.id_cuenta).sort((a, b) => a.fecha_desde.localeCompare(b.fecha_desde))
    return suyos.slice(1).flatMap((x, i) => suyos[i].fecha_hasta < x.fecha_desde && Math.round(suyos[i].valor_saldo_final * 100) !== Math.round(x.valor_saldo_inicial * 100)
      ? [`En ${c.nombre} falta un extracto entre el ${dia(suyos[i].fecha_hasta)} y el ${dia(x.fecha_desde)}.`] : [])
  })

  // el saldo de cada cuenta es el de su extracto más reciente: si ya es viejo, se avisa
  const limite = diasAntes(new Date().toLocaleDateString('en-CA'), 45)
  const atrasadas = banco.cuentas.flatMap(c => {
    const ultimo = banco.extractos.filter(x => x.id_cuenta === c.id_cuenta).map(x => x.fecha_hasta).sort().pop()
    return ultimo && ultimo < limite ? [`El saldo de ${c.nombre} está al ${dia(ultimo)}: sube el extracto más reciente para cuadrar.`] : []
  })

  // el extracto llega a mes vencido: el saldo de hoy se estima con el último y lo anotado después
  const saldos = banco.cuentas.flatMap(c => {
    const ultimo = banco.extractos.filter(x => x.id_cuenta === c.id_cuenta).sort((a, b) => a.fecha_hasta.localeCompare(b.fecha_hasta)).pop()
    if (!ultimo) return []
    const suyos = registros.filter(r => banco.deRegistro.get(r.id_registro) === c.id_cuenta).map(r => ({ fecha: r.fecha, valor: signo(r) * r.valor }))
    return [{ cuenta: c, hasta: ultimo.fecha_hasta, banco: Math.round(ultimo.valor_saldo_final), ...saldoEstimado(Math.round(ultimo.valor_saldo_final), ultimo.fecha_hasta, suyos) }]
  })

  return (
    <>
      <h2>¿Cuánto tengo hoy?</h2>
      <p className="tenue">El extracto llega con el mes vencido: el saldo de hoy es el del último extracto más lo que has anotado en esa cuenta desde entonces.</p>
      <ul className="lista">
        {saldos.map(s => <SaldoHoy key={s.cuenta.id_cuenta} {...s} nombre={s.cuenta.nombre} />)}
      </ul>
      <h2>Extractos subidos</h2>
      {error && <p role="alert" className="error">{error}</p>}
      {huecos.map(h => <p key={h} className="aviso">{h}</p>)}
      {atrasadas.map(a => <p key={a} className="aviso">{a}</p>)}
      <ul className="lista con-estado">
        {banco.extractos.map(x => {
          const reciente = !banco.extractos.some(o => o.id_cuenta === x.id_cuenta && o.fecha_hasta > x.fecha_hasta)
          const f = reciente ? falta(x) : null
          return (
            <li key={x.id_extracto} className="ultimo fila-extracto">
              <span>{banco.cuentas.find(c => c.id_cuenta === x.id_cuenta)?.nombre ?? 'Cuenta quitada'}</span>
              <strong>{periodo(x.fecha_desde, x.fecha_hasta)}</strong>
              <span className="tenue">
                {f !== null && <span className={`estado ${f === 0 ? 'en-meta' : 'fuera'}`}>{f === 0 ? '✓ Cuadra' : `✕ Faltan ${dePesos(Math.abs(f))}`}</span>}
                {reciente ? `Saldo ${pesos(Math.round(x.valor_saldo_final))} al ${dia(x.fecha_hasta)}` : 'Movimientos cargados'}
              </span>
              {confirmar === x.id_extracto ? (
                <span className="chips">
                  <span className="tenue">¿Seguro? Se borra lo que agregó este extracto; lo que anotaste a mano se queda.</span>
                  <button type="button" className="secundario" onClick={() => alQuitar(x.id_extracto).catch(err => setError((err as Error).message))}>Sí, quitar</button>
                  <button type="button" className="secundario" onClick={() => setConfirmar('')}>No</button>
                </span>
              ) : (
                <span className="chips"><button type="button" className="secundario" onClick={() => setConfirmar(x.id_extracto)}>Quitar lo que cargó</button></span>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

// El saldo estimado de una cuenta y, si la persona quiere, la comparación con lo que dice su banco hoy. No guarda nada.
function SaldoHoy({ nombre, hasta, banco, saldo, cuantos }: { nombre: string; hasta: string; banco: number; saldo: number; cuantos: number }) {
  const [abierto, setAbierto] = useState(false)
  const [dicho, setDicho] = useState('')
  const real = leerMonto(dicho)
  const diferencia = real === null ? null : Math.round(real - saldo)
  return (
    <li className="ultimo fila-extracto">
      <span>{nombre}</span>
      <strong>{pesos(saldo)}</strong>
      <span className="tenue">
        estimado hoy · {pesos(banco)} al {dia(hasta)} según el banco{cuantos ? ` y ${cuantos === 1 ? 'un movimiento anotado' : `${cuantos} movimientos anotados`} después` : ', sin nada anotado después'}
      </span>
      <span className="chips">
        {abierto ? (
          <label>¿Cuánto dice tu banco hoy?
            <input inputMode="text" autoFocus maxLength={30} value={dicho} onChange={ev => setDicho(ev.target.value)} placeholder="Ej.: 1.250.000" autoComplete="off" />
          </label>
        ) : <button type="button" className="enlace" onClick={() => setAbierto(true)}>¿Cuánto dice tu banco hoy?</button>}
      </span>
      {abierto && diferencia !== null && (
        <span role="status" className="chips aviso">
          {diferencia === 0 ? '✓ Vas al día: es lo mismo que tienes anotado.'
            : `Hay ${pesos(Math.abs(diferencia))} de ${diferencia < 0 ? 'gastos' : 'ingresos'} sin anotar desde el ${dia(hasta)}.`}
        </span>
      )}
    </li>
  )
}
