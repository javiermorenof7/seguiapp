// Aviso cuando un período o filtro no trae datos: dice qué falta y qué se puede hacer.
export default function SinDatos({ titulo, detalle, acciones = [] }: {
  titulo: string; detalle?: string; acciones?: { texto: string; hacer: () => void }[]
}) {
  return (
    <div className="sin-datos" role="status">
      <strong>{titulo}</strong>
      {detalle && <p className="tenue">{detalle}</p>}
      {acciones.length > 0 && (
        <div className="chips">
          {acciones.map(a => <button key={a.texto} type="button" className="secundario" onClick={a.hacer}>{a.texto}</button>)}
        </div>
      )}
    </div>
  )
}
