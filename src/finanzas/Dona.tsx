import { useEffect, useRef } from 'react'
import { ArcElement, Chart, DoughnutController, Tooltip } from 'chart.js'

Chart.register(DoughnutController, ArcElement, Tooltip)

export interface Porcion { nombre: string; valor: number; color: string }

// Dona de "¿en qué se va?": la lista al lado repite cada porción con su monto y %, así no depende solo del color.
export default function Dona({ porciones, total, formato, descripcion, colorFondo }: {
  porciones: Porcion[]; total: number; formato: (valor: number) => string; descripcion: string; colorFondo: string
}) {
  const lienzo = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!lienzo.current) return
    const grafico = new Chart(lienzo.current, {
      type: 'doughnut',
      data: {
        labels: porciones.map(p => p.nombre),
        datasets: [{ data: porciones.map(p => p.valor), backgroundColor: porciones.map(p => p.color), borderColor: colorFondo, borderWidth: 2 }],
      },
      options: {
        cutout: '68%',
        responsive: true,
        maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${formato(Number(c.parsed))}` } } },
      },
    })
    return () => grafico.destroy()
  }, [porciones, formato, colorFondo])

  return (
    <div className="dona">
      <div className="dona-lienzo">
        <canvas ref={lienzo} role="img" aria-label={descripcion} />
        <p className="dona-centro"><span className="tenue">Gastado</span><strong>{formato(total)}</strong></p>
      </div>
      <ul className="dona-leyenda">
        {porciones.map(p => (
          <li key={p.nombre}>
            <span className="muestra" style={{ background: p.color }} aria-hidden="true" />
            <span>{p.nombre}</span>
            <strong>{formato(p.valor)}</strong>
            <span className="tenue">{Math.round((p.valor / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
