import { useEffect, useState } from 'react'
import { obtenerRegistros, type RegistroGuardado } from './datos'
import { restarDias } from './salud/calculos'

// Días hacia atrás que se ven; 0 = todo el historial.
export type Rango = 30 | 90 | 180 | 365 | 0
const RANGOS: [Rango, string][] = [[30, '1 mes'], [90, '3 meses'], [180, '6 meses'], [365, 'Año'], [0, 'Todo']]

export const desdeRango = (rango: Rango, hoy: string) => rango ? restarDias(hoy, rango) : '0000-00-00'

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
