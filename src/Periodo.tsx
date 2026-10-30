import { useEffect, useState } from 'react'
import { obtenerRegistros, type RegistroGuardado } from './datos'
import { restarDias } from './salud/calculos'
import { mover, rango as rangoDe, type Escala } from './historial/periodo'

// Días hacia atrás que se ven; 0 = todo el historial.
export type Rango = 30 | 90 | 180 | 365 | 0
const RANGOS: [Rango, string][] = [[30, '1 mes'], [90, '3 meses'], [180, '6 meses'], [365, 'Año'], [0, 'Todo']]

export const desdeRango = (rango: Rango, hoy: string) => rango ? restarDias(hoy, rango) : '0000-00-00'

// Semana, mes o año con ◀ ▶ (como el Historial): el gráfico cubre solo ese período y no se aprieta.
export interface Ventana { escala: Escala; ancla: string }
const hoyIso = () => new Date().toLocaleDateString('en-CA')
export const ventanaInicial = (): Ventana => ({ escala: 'mes', ancla: hoyIso() })
// La app ya tiene el último año; más atrás pide el historial completo de ese seguimiento.
export const rangoCarga = (v: Ventana): Rango => rangoDe(v.escala, v.ancla).desde < restarDias(hoyIso(), 365) ? 0 : 365
const ESCALAS: [Escala, string][] = [['semana', 'Semana'], ['mes', 'Mes'], ['ano', 'Año']]

export function PeriodoNavegable({ valor, alCambiar }: { valor: Ventana; alCambiar: (v: Ventana) => void }) {
  const r = rangoDe(valor.escala, valor.ancla)
  return (
    <div className="panel-periodo">
      <span className="etiqueta">Período</span>
      <div className="chips segmentado" role="radiogroup" aria-label="Período del gráfico">
        {ESCALAS.map(([e, texto]) => (
          <button key={e} type="button" role="radio" aria-checked={valor.escala === e} className="chip" onClick={() => alCambiar({ ...valor, escala: e })}>{texto}</button>
        ))}
      </div>
      <div className="periodo">
        <button className="secundario" aria-label="Período anterior" onClick={() => alCambiar({ ...valor, ancla: mover(valor.escala, valor.ancla, -1) })}>←</button>
        <strong>{r.titulo}</strong>
        <button className="secundario" aria-label="Período siguiente" disabled={r.hasta >= hoyIso()}
          onClick={() => alCambiar({ ...valor, ancla: mover(valor.escala, valor.ancla, 1) })}>→</button>
      </div>
    </div>
  )
}

export default function Periodo({ valor, alCambiar }: { valor: Rango; alCambiar: (r: Rango) => void }) {
  return (
    <div className="chips segmentado" role="radiogroup" aria-label="Período del gráfico">
      {RANGOS.map(([r, texto]) => (
        <button key={r} type="button" role="radio" aria-checked={valor === r} className="chip" onClick={() => alCambiar(r)}>{texto}</button>
      ))}
    </div>
  )
}

// La app carga el último año; con "Todo" trae el historial completo de ese seguimiento una sola vez.
export function useRegistrosDe<T>(idSeguimiento: string, rango: Rango, delAno: T[]): (T | RegistroGuardado)[] {
  const [todos, setTodos] = useState<{ id: string; lista: RegistroGuardado[] } | null>(null)
  useEffect(() => {
    if (rango !== 0 || todos?.id === idSeguimiento) return
    // sin conexión se queda con el último año, que ya está en pantalla
    obtenerRegistros('2000-01-01', idSeguimiento).then(lista => setTodos({ id: idSeguimiento, lista }), () => {})
  }, [rango, idSeguimiento, todos])
  return rango === 0 && todos?.id === idSeguimiento ? todos.lista : delAno
}
