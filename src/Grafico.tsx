import { useEffect, useRef } from 'react'
import { Chart, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js'
import type { Registro } from './indicadores'
import type { Plugin } from 'chart.js'

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip)

interface Props {
  puntos: Registro[]
  meta?: number | null
  color: string
  colorMeta: string
  descripcion: string
  compacto?: boolean
  formato?: (valor: number) => string
  formatoEje?: (valor: number) => string
  // texto junto a la línea punteada ("Meta 75 kg", "Récord 80 kg")
  etiquetaMeta?: string
  // puntos marcados más grandes, con su texto en el tooltip (p. ej. cada récord)
  destacados?: { indices: number[]; texto: string }
}

// transparencia solo si viene en hex de 6 dígitos
const conAlfa = (color: string, alfa: string) => /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alfa}` : color

const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
// el eje X va en días reales: dos registros separados 40 días no quedan pegados como si fueran seguidos
const aDia = (fecha: string) => Date.parse(fecha) / 864e5
const deDia = (dia: number) => diaMes(new Date(dia * 864e5).toISOString().slice(0, 10))

// Línea recta de lo medido y la meta punteada; el último punto (el registro nuevo) va resaltado.
export default function Grafico({ puntos, meta, color, colorMeta, descripcion, compacto, formato, formatoEje, etiquetaMeta, destacados }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!lienzo.current) return
    // la meta se pinta como el texto para no confundirse con la cuadrícula
    const colorLinea = compacto ? colorMeta : getComputedStyle(document.documentElement).getPropertyValue('--tinta').trim() || colorMeta
    const ultimo = puntos.length - 1
    const marcado = new Set(destacados?.indices)
    const radio = (i: number) => i === ultimo ? (compacto ? 3 : 6) : compacto ? 0 : marcado.has(i) ? 5 : puntos.length > 60 ? 0 : 3
    const rotulo: Plugin<'line'> = {
      id: 'rotulo',
      afterDatasetsDraw(c) {
        if (compacto || meta == null || !etiquetaMeta) return
        const { ctx, chartArea } = c
        ctx.save()
        ctx.fillStyle = colorLinea
        ctx.font = `600 12px ${Chart.defaults.font.family}`
        ctx.textAlign = 'right'
        ctx.fillText(etiquetaMeta, chartArea.right, Math.max(chartArea.top + 12, c.scales.y.getPixelForValue(meta) - 6))
        ctx.restore()
      },
    }
    const grafico = new Chart(lienzo.current, {
      type: 'line',
      data: {
        datasets: [
          {
            data: puntos.map(p => ({ x: aDia(p.fecha), y: p.valor })),
            borderColor: color,
            pointBackgroundColor: color,
            // sin relleno ni curvas: el eje Y no parte de 0 y con pocos puntos la curva inventa subidas
            fill: false,
            borderWidth: compacto ? 2 : 3,
            tension: 0,
            pointRadius: puntos.map((_, i) => radio(i)),
          },
          ...(meta != null
            ? [{ data: [puntos[0], puntos[ultimo]].map(p => ({ x: aDia(p.fecha), y: meta })), borderColor: colorLinea, borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0 }]
            : []),
        ],
      },
      plugins: [rotulo],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !compacto,
            filter: c => c.datasetIndex === 0,
            callbacks: { title: c => diaMes(puntos[c[0].dataIndex].fecha), label: c => `${formato ? formato(Number(c.parsed.y)) : String(c.parsed.y)}${marcado.has(c.dataIndex) ? ` · ${destacados!.texto}` : ''}` },
          },
        },
        scales: {
          x: { type: 'linear', display: !compacto, ticks: { color: colorMeta, maxTicksLimit: 6, precision: 0, callback: v => deDia(Number(v)) }, grid: { display: false } },
          y: { display: !compacto, ticks: { color: colorMeta, maxTicksLimit: 5, ...(formato ? { callback: v => (formatoEje ?? formato)(Number(v)) } : {}) },
            grid: { color: conAlfa(colorMeta, '33') } },
        },
      },
    })
    return () => grafico.destroy()
  }, [puntos, meta, color, colorMeta, compacto, formato, formatoEje, etiquetaMeta, destacados])

  return (
    <div className={compacto ? 'grafico compacto' : 'grafico'}>
      <canvas ref={lienzo} role="img" aria-label={descripcion} />
    </div>
  )
}
