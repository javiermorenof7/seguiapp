import { useEffect, useRef } from 'react'
import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip)

export interface Serie { nombre: string; datos: number[]; color: string | string[]; borde?: string }

interface Props {
  etiquetas: string[]
  series: Serie[]
  formato: (valor: number) => string
  descripcion: string
  colorTexto: string
  colorLinea: string
  horizontal?: boolean
}

// Barras agrupadas: horizontales para "¿en qué se va?", verticales para el mes a mes.
export default function Barras({ etiquetas, series, formato, descripcion, colorTexto, colorLinea, horizontal }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!lienzo.current) return
    const eje = { ticks: { color: colorTexto, callback: (v: string | number) => formato(Number(v)), maxTicksLimit: 5 }, grid: { color: `${colorLinea}` } }
    const categorias = { ticks: { color: colorTexto, autoSkip: false }, grid: { display: false } }
    const grafico = new Chart(lienzo.current, {
      type: 'bar',
      data: {
        labels: etiquetas,
        datasets: series.map(s => ({
          label: s.nombre, data: s.datos, backgroundColor: s.color, borderColor: s.borde ?? s.color,
          borderWidth: s.borde ? 1.5 : 0, borderRadius: 6, maxBarThickness: 22,
        })),
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
        plugins: {
          legend: { display: series.length > 1, labels: { color: colorTexto, boxWidth: 12 } },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formato(Number(horizontal ? c.parsed.x : c.parsed.y))}` } },
        },
        scales: horizontal ? { x: eje, y: categorias } : { x: categorias, y: eje },
      },
    })
    return () => grafico.destroy()
  }, [etiquetas, series, formato, colorTexto, colorLinea, horizontal])

  const alto = horizontal ? Math.max(160, etiquetas.length * series.length * 26 + 60) : 260
  return (
    <div className="grafico" style={{ height: alto }}>
      <canvas ref={lienzo} role="img" aria-label={descripcion} />
    </div>
  )
}
