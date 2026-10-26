import { useEffect, useRef } from 'react'
import { CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js'
import type { Registro } from './indicadores'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip)

interface Props {
  puntos: Registro[]
  meta?: number | null
  color: string
  colorMeta: string
  descripcion: string
  compacto?: boolean
  formato?: (valor: number) => string
}

const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

// Línea de lo medido con la meta punteada; el último punto (el registro nuevo) va resaltado.
export default function Grafico({ puntos, meta, color, colorMeta, descripcion, compacto, formato }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!lienzo.current) return
    const etiquetas = puntos.map(p => diaMes(p.fecha))
    const ultimo = puntos.length - 1
    const grafico = new Chart(lienzo.current, {
      type: 'line',
      data: {
        labels: etiquetas,
        datasets: [
          {
            data: puntos.map(p => p.valor),
            borderColor: color,
            backgroundColor: color,
            borderWidth: compacto ? 2 : 3,
            tension: 0.3,
            pointRadius: puntos.map((_, i) => (i === ultimo ? (compacto ? 3 : 6) : compacto ? 0 : 3)),
          },
          ...(meta != null
            ? [{ data: puntos.map(() => meta), borderColor: colorMeta, borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0 }]
            : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !compacto,
            callbacks: { label: c => (formato ? formato(Number(c.parsed.y)) : String(c.parsed.y)) },
          },
        },
        scales: {
          x: { display: !compacto, ticks: { color, maxTicksLimit: 6 }, grid: { display: false } },
          y: { display: !compacto, ticks: { color, maxTicksLimit: 5 }, grid: { color: `${colorMeta}33` } },
        },
      },
    })
    return () => grafico.destroy()
  }, [puntos, meta, color, colorMeta, compacto, formato])

  return (
    <div className={compacto ? 'grafico compacto' : 'grafico'}>
      <canvas ref={lienzo} role="img" aria-label={descripcion} />
    </div>
  )
}
