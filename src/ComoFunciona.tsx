import { useState } from 'react'

// Solo guarda que la persona ya vio la guía; si el navegador no deja, sale abierta otra vez.
const visto = (clave: string) => { try { return localStorage.getItem(clave) === '1' } catch { return false } }
const recordar = (clave: string) => { try { localStorage.setItem(clave, '1') } catch { /* sin almacenamiento */ } }

export default function ComoFunciona({ modulo, pasos }: { modulo: string; pasos: string[] }) {
  const clave = `guia-${modulo}`
  const [abierto, setAbierto] = useState(() => !visto(clave))
  const cerrar = () => { recordar(clave); setAbierto(false) }
  return (
    <div className="como-funciona">
      <button type="button" className="enlace" aria-expanded={abierto} onClick={() => (abierto ? cerrar() : setAbierto(true))}>¿Cómo funciona?</button>
      {abierto && (
        <div className="guia">
          <ol>{pasos.map(p => <li key={p}>{p}</li>)}</ol>
          <button type="button" className="secundario" onClick={cerrar}>Entendido</button>
        </div>
      )}
    </div>
  )
}
