import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { obtenerRegistros, type RegistroGuardado } from '../datos'
import Barras from '../finanzas/Barras'
import SinDatos from '../SinDatos'
import { normalizar } from '../finanzas/parseo'
import { agrupar, mover, rango, type Escala } from './periodo'

export interface Filtro { nombre: string; opciones: [string, string][]; de: (r: RegistroGuardado) => string; inicial?: string }

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

// Todos los registros del módulo por semana, mes o año, con sus filtros, totales y un gráfico del período.
export default function Historial({ ids, registros, filtros, buscar, suma, formato = v => Number.isInteger(v) ? String(v) : '', total, fila }: {
  ids: string[]
  registros: RegistroGuardado[]
  filtros: Filtro[]
  buscar?: (r: RegistroGuardado) => string
  suma: boolean
  formato?: (valor: number) => string
  total: (lista: RegistroGuardado[]) => string
  fila: (r: RegistroGuardado) => ReactNode
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

  const puntos = agrupar(escala, r, delPeriodo, suma)

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
          <label key={f.nombre}>{f.nombre}
            <select value={elegidos[f.nombre]} onChange={ev => setElegidos({ ...elegidos, [f.nombre]: ev.target.value })}>
              <option value="">Todos</option>
              {f.opciones.map(([valor, t]) => <option key={valor} value={valor}>{t}</option>)}
            </select>
          </label>
        ))}
        {buscar && (
          <label>Buscar
            <input value={texto} maxLength={60} onChange={ev => setTexto(ev.target.value)} placeholder="Palabra a buscar" autoComplete="off" />
            <small className="ayuda">Ej.: almuerzo, taxi</small>
          </label>
        )}
      </div>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <p className="aviso" aria-live="polite">{total(delPeriodo)} · {delPeriodo.length} {delPeriodo.length === 1 ? 'registro' : 'registros'}</p>
      {delPeriodo.length > 0 && (
        <Barras etiquetas={puntos.map(p => etiqueta(escala, p.fecha))} series={[{ nombre: r.titulo, color: cssVar('--acento'), datos: puntos.map(p => p.valor) }]}
          formato={formato} colorTexto={cssVar('--tenue')} colorLinea={cssVar('--linea')} descripcion={`${suma ? 'Total' : 'Registros'} por ${escala === 'ano' ? 'mes' : 'día'} de ${r.titulo}`} />
      )}
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
export function FilaSimple({ fecha, titulo, detalle, alBorrar }: { fecha: string; titulo: string; detalle: string; alBorrar: () => Promise<void> }) {
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
      ) : <button className="secundario" onClick={() => setConfirmar(true)}>Borrar</button>}
      {error && <span role="alert" className="error">{error}</span>}
    </li>
  )
}
