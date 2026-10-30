import type { ReactNode } from 'react'

// Filtro desplegable de toda la app: una línea aunque haya muchas opciones (la lista la abre el celular).
// Con alLimpiar, al elegir algo el borde se marca y aparece la ✕ para volver a "todos".
export default function Selector({ id, titulo, icono, valor, alCambiar, alLimpiar, children }: {
  id: string
  titulo: string
  icono?: string
  valor: string
  alCambiar: (valor: string) => void
  alLimpiar?: () => void
  children: ReactNode
}) {
  const elegido = !!valor && !!alLimpiar
  return (
    <div className="filtro">
      <label htmlFor={id} className="etiqueta">{titulo}</label>
      <div className={elegido ? 'selector elegido' : 'selector'}>
        {icono && <span aria-hidden="true">{icono}</span>}
        <select id={id} value={valor} onChange={ev => alCambiar(ev.target.value)}>{children}</select>
        {elegido && <button type="button" className="quitar" aria-label={`Quitar el filtro de ${titulo.toLowerCase()}`} onClick={alLimpiar}>✕</button>}
      </div>
    </div>
  )
}
