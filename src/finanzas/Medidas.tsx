// Barras hechas con CSS para "parte de un total" y "avance hacia un tope"; la lista o el texto repiten los valores.

export interface Parte { nombre: string; valor: number; color: string }

// Una barra apilada; marcas opcionales en % del total (p. ej. 50 y 80 del 50-30-20).
export function Apilada({ partes, total, formato, descripcion, marcas = [] }: {
  partes: Parte[]; total: number; formato: (v: number) => string; descripcion: string; marcas?: { en: number; texto: string }[]
}) {
  return (
    <>
      <div className="apilada" role="img" aria-label={descripcion}>
        {total > 0 && partes.map(p => <span key={p.nombre} style={{ width: `${(p.valor / total) * 100}%`, background: p.color }} />)}
        {marcas.map(m => <i key={m.texto} style={{ left: `${m.en}%` }}><b>{m.texto}</b></i>)}
      </div>
      <ul className="leyenda">
        {partes.map(p => (
          <li key={p.nombre}>
            <span className="muestra" style={{ background: p.color }} aria-hidden="true" /> {p.nombre} <strong>{formato(p.valor)}</strong>
          </li>
        ))}
      </ul>
    </>
  )
}

// Lo logrado sobre una pista gris del tope; si pasa del 100 %, la pista se encoge y la marca muestra dónde estaba el tope.
export function Avance({ valor, tope, color, descripcion }: { valor: number; tope: number; color: string; descripcion: string }) {
  const escala = Math.max(valor, tope) || 1
  return (
    <div className="avance" role="img" aria-label={descripcion}>
      <span style={{ width: `${(valor / escala) * 100}%`, background: color }} />
      {valor > tope && <i style={{ left: `${(tope / escala) * 100}%` }} />}
    </div>
  )
}
