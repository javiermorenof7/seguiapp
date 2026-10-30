import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { obtenerRegistros, type RegistroGuardado } from '../datos'
import Barras from '../finanzas/Barras'
import Grafico from '../Grafico'
import SinDatos from '../SinDatos'
import { normalizar } from '../finanzas/parseo'
import { agrupar, mover, porSemanas, rango, type Escala, type Modo } from './periodo'
import Selector from '../Selector'

export interface Filtro { nombre: string; opciones: [string, string][]; de: (r: RegistroGuardado) => string; inicial?: string }
// Qué dibuja el gráfico con los filtros elegidos: la pregunta que responde, cómo junta cada día y, si van separadas, sus series.
export interface Vista {
  modo: Modo
  pregunta: string
  formato?: (valor: number) => string
  formatoEje?: (valor: number) => string
  cuanto?: (r: RegistroGuardado) => number
  series?: { nombre: string; color: string; de: (r: RegistroGuardado) => boolean }[]
  // tope de cada día (p. ej. cuántos hábitos hay); en el año se muestra como % del mes
  maximoDia?: number
}

const ESCALAS: [Escala, string][] = [['semana', 'Semana'], ['mes', 'Mes'], ['ano', 'Año']]
const hoyIso = () => new Date().toLocaleDateString('en-CA')
// el panel ya trae el último año de registros (ver cargar en App)
const cargadoDesde = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toLocaleDateString('en-CA') })()
// en el mes solo algunos días llevan número para que no se amontonen
const etiqueta = (escala: Escala, fecha: string) => {
  if (escala === 'ano') return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CO', { month: 'short', timeZone: 'UTC' })
  const dia = Number(fecha.slice(8, 10))
  return escala === 'semana' ? ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'][(new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7] : dia === 1 || dia % 5 === 0 ? String(dia) : ''
}
const cssVar = (nombre: string) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()
const fechaLarga = (escala: Escala, fecha: string) => new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CO',
  escala === 'ano' ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const diasDelMes = (fecha: string) => new Date(Date.UTC(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)), 0)).getUTCDate()

// Todos los registros del módulo por semana, mes o año, con sus filtros, totales y un gráfico del período.
// Un ícono por lo que filtra; los demás llevan la etiqueta.
const ICONOS: Record<string, string> = { Tipo: '🗂️', 'Categoría o fuente': '🏷️', Origen: '✍️', Ejercicio: '🏋️', Hábito: '🎯' }

export default function Historial({ ids, registros, filtros, buscar, suma, formato = v => Number.isInteger(v) ? String(v) : '', total, fila, vista }: {
  ids: string[]
  registros: RegistroGuardado[]
  filtros: Filtro[]
  buscar?: (r: RegistroGuardado) => string
  suma: boolean
  formato?: (valor: number) => string
  total: (lista: RegistroGuardado[]) => string
  fila: (r: RegistroGuardado) => ReactNode
  vista?: (elegidos: Record<string, string>) => Vista
}) {
  const hoy = hoyIso()
  const [escala, setEscala] = useState<Escala>('mes')
  const [ancla, setAncla] = useState(hoy)
  const [elegidos, setElegidos] = useState<Record<string, string>>(() => Object.fromEntries(filtros.map(f => [f.nombre, f.inicial ?? ''])))
  const [texto, setTexto] = useState('')
  const [antiguos, setAntiguos] = useState<{ desde: string; registros: RegistroGuardado[] } | null>(null)
  const [error, setError] = useState('')
  const r = rango(escala, ancla)

  // lo anterior a lo ya cargado se pide a la base al llegar a ese período
  // shortcut: vuelve a traer todo desde esa fecha; pedir solo el período si los años viejos pesan
  useEffect(() => {
    if (r.desde >= cargadoDesde || (antiguos && antiguos.desde <= r.desde)) return
    obtenerRegistros(r.desde).then(lista => setAntiguos({ desde: r.desde, registros: lista }), e => setError((e as Error).message))
  }, [r.desde, antiguos])

  const delPeriodo = useMemo(() => {
    const todos = antiguos ? [...antiguos.registros.filter(x => x.fecha < cargadoDesde), ...registros] : registros
    const buscado = normalizar(texto)
    return todos
      .filter(x => ids.includes(x.id_seguimiento) && x.fecha >= r.desde && x.fecha <= r.hasta)
      .filter(x => filtros.every(f => !elegidos[f.nombre] || f.de(x) === elegidos[f.nombre]))
      .filter(x => !buscado || !buscar || normalizar(buscar(x)).includes(buscado))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [antiguos, registros, ids, r.desde, r.hasta, filtros, elegidos, texto, buscar])

  const v = vista?.(elegidos) ?? { modo: suma ? 'suma' : 'conteo', pregunta: suma ? 'Total de cada día' : 'Registros de cada día' }
  const fmt = v.formato ?? formato
  const series = (v.series ?? [{ nombre: v.pregunta, color: cssVar('--c1'), de: () => true }]).filter(s => delPeriodo.some(s.de))
  // en el celular, varias series en un mes no caben por día: van por semana
  const porSemana = escala === 'mes' && series.length > 1 && matchMedia('(max-width: 560px)').matches
  const enPorcentaje = escala === 'ano' && !!v.maximoDia
  const datos = series.map(s => {
    const p = agrupar(escala, r, delPeriodo.filter(s.de), v.modo, v.cuanto)
    if (porSemana) return porSemanas(p, v.modo)
    return enPorcentaje ? p.map(x => ({ ...x, valor: x.valor === null ? null : Math.round(x.valor / (v.maximoDia! * diasDelMes(x.fecha)) * 100) })) : p
  })
  const base = datos[0] ?? []
  const etiquetas = base.map(p => 'etiqueta' in p ? String(p.etiqueta) : escala === 'mes' ? String(Number(p.fecha.slice(8))) : etiqueta(escala, p.fecha))
  const titulos = base.map(p => 'etiqueta' in p ? `Días ${p.etiqueta}` : fechaLarga(escala, p.fecha))
  const pregunta = `${v.pregunta}${porSemana ? ' (por semana)' : escala === 'ano' ? ' (por mes)' : ''} · ${r.titulo}`
  const mayor = (i: number) => datos[i].reduce<{ valor: number; titulo: string } | null>((m, p, j) => p.valor !== null && p.valor > (m?.valor ?? -Infinity) ? { valor: p.valor, titulo: titulos[j] } : m, null)
  const descripcion = series.map((s, i) => { const m = mayor(i); return `${s.nombre}${m ? `: el mayor, ${m.titulo} con ${enPorcentaje ? `${m.valor} %` : fmt(m.valor)}` : ''}` }).join('; ')

  return (
    <section>
      <div className="panel-periodo">
      <span className="etiqueta">Período y filtros</span>
      <div className="chips segmentado" role="radiogroup" aria-label="Ver por">
        {ESCALAS.map(([e, t]) => (
          <button key={e} type="button" role="radio" aria-checked={escala === e} className="chip" onClick={() => setEscala(e)}>{t}</button>
        ))}
      </div>
      <div className="periodo">
        <button className="secundario" aria-label="Período anterior" onClick={() => setAncla(mover(escala, ancla, -1))}>←</button>
        <h2>{r.titulo}</h2>
        <button className="secundario" aria-label="Período siguiente" disabled={r.hasta >= hoy} onClick={() => setAncla(mover(escala, ancla, 1))}>→</button>
      </div>
      <div className="filtros">
        {filtros.map(f => (
          <Selector key={f.nombre} id={`filtro-${f.nombre}`} titulo={f.nombre} icono={ICONOS[f.nombre] ?? '🏷️'} valor={elegidos[f.nombre]}
            alCambiar={v => setElegidos({ ...elegidos, [f.nombre]: v })} alLimpiar={() => setElegidos({ ...elegidos, [f.nombre]: '' })}>
            <option value="">Todos</option>
            {f.opciones.map(([valor, t]) => <option key={valor} value={valor}>{t}</option>)}
          </Selector>
        ))}
        {buscar && (
          <div className="filtro">
            <label htmlFor="filtro-buscar" className="etiqueta">Buscar</label>
            <div className={texto ? 'selector elegido' : 'selector'}>
              <span aria-hidden="true">🔎</span>
              <input id="filtro-buscar" value={texto} maxLength={60} onChange={ev => setTexto(ev.target.value)} placeholder="Ej.: almuerzo, taxi" autoComplete="off" />
              {texto && <button type="button" className="quitar" aria-label="Borrar la búsqueda" onClick={() => setTexto('')}>✕</button>}
            </div>
          </div>
        )}
      </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <p className="aviso" aria-live="polite">{total(delPeriodo)} · {delPeriodo.length} {delPeriodo.length === 1 ? 'registro' : 'registros'}</p>
      {delPeriodo.length > 0 && series.length > 0 && <h3 className="pregunta-grafico">{pregunta}</h3>}
      {delPeriodo.length > 0 && series.length > 0 && (v.modo === 'maximo' && series.length === 1 && !porSemana ? (
        // valores como el peso o la cintura: una línea, sin los días vacíos (en barras 74 y 75 kg se verían iguales)
        <Grafico puntos={base.flatMap(p => p.valor === null ? [] : [{ fecha: p.fecha, valor: p.valor }])} color={series[0].color}
          colorMeta={cssVar('--tenue')} formato={fmt} descripcion={descripcion} desde={r.desde} hasta={r.hasta} />
      ) : (
        <Barras etiquetas={etiquetas} series={series.map((s, i) => ({ nombre: s.nombre, color: s.color, datos: datos[i].map(p => p.valor) }))}
          formato={enPorcentaje ? x => `${x} %` : fmt} formatoEje={enPorcentaje ? x => `${x} %` : v.formatoEje ?? fmt}
          maximo={enPorcentaje ? 100 : v.maximoDia && !porSemana ? v.maximoDia : undefined}
          colorTexto={cssVar('--tenue')} colorLinea={cssVar('--linea')} descripcion={descripcion} dias={{ titulos }} />
      ))}
      {delPeriodo.length === 0 ? (() => {
        const conFiltros = !!texto.trim() || Object.values(elegidos).some(Boolean)
        return <SinDatos titulo={conFiltros ? 'No encontramos registros con estos filtros' : `No hay registros en ${r.titulo.toLowerCase()}`}
          detalle={conFiltros ? 'Prueba quitando algún filtro o mira otro período.' : 'Mira otro período o registra algo nuevo.'}
          acciones={[
            ...(conFiltros ? [{ texto: 'Quitar filtros', hacer: () => { setTexto(''); setElegidos(Object.fromEntries(filtros.map(f => [f.nombre, '']))) } }] : []),
            ...(r.hasta < hoy ? [{ texto: 'Ir al período actual', hacer: () => setAncla(hoy) }] : []),
          ]} />
      })() : <ul className="lista">{delPeriodo.map(fila)}</ul>}
    </section>
  )
}

// Fila de Salud y Hábitos: fecha, qué, cuánto y borrar con confirmación (el borrado es lógico).
// children: lo que se abre debajo de la fila (p. ej. el formulario de Editar)
export function FilaSimple({ fecha, titulo, detalle, alBorrar, alEditar, children }: {
  fecha: string; titulo: string; detalle: string; alBorrar: () => Promise<void>; alEditar?: () => void; children?: ReactNode
}) {
  const [confirmar, setConfirmar] = useState(false)
  const [error, setError] = useState('')
  return (
    <li className="ultimo">
      <span>{fecha.split('-').reverse().join('/')}</span>
      <strong>{titulo}</strong>
      <span className="tenue">{detalle}</span>
      {confirmar ? (
        <span className="chips">
          <button className="secundario" onClick={() => alBorrar().catch(e => setError((e as Error).message))}>Sí, borrar</button>
          <button className="secundario" onClick={() => setConfirmar(false)}>No</button>
        </span>
      ) : alEditar ? (
        <span className="chips">
          <button className="secundario" onClick={alEditar}>Editar</button>
          <button className="secundario" onClick={() => setConfirmar(true)}>Borrar</button>
        </span>
      ) : <button className="secundario" onClick={() => setConfirmar(true)}>Borrar</button>}
      {error && <span role="alert" className="error">{error}</span>}
      {children}
    </li>
  )
}
