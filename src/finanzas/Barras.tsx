import { useEffect, useRef } from 'react'
import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip, type Plugin } from 'chart.js'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip, LineController, LineElement, PointElement)

// leyenda: el color de la muestra cuando las barras van coloreadas por estado
export interface Serie { nombre: string; datos: (number | null)[]; color: string | string[]; borde?: string; leyenda?: string }

interface Props {
  etiquetas: string[]
  series: Serie[]
  formato: (valor: number) => string
  descripcion: string
  colorTexto: string
  colorLinea: string
  horizontal?: boolean
  // las series una encima de otra: la primera es la pista (p. ej. el presupuesto) y la segunda lo logrado
  superpuesto?: boolean
  // las series apiladas en una sola barra (p. ej. a tiempo sobre tarde)
  apilado?: boolean
  // formato corto para los ejes ("12 M"); el tooltip sigue con el monto completo
  formatoEje?: (valor: number) => string
  // una línea encima de las barras verticales (p. ej. el saldo de cada mes)
  linea?: { nombre: string; datos: number[]; color: string; punteada?: boolean }
  // tope fijo del eje de valores (p. ej. los 7 días de la semana)
  maximo?: number
  // false cuando la pantalla pone su propia leyenda (p. ej. colores por estado)
  leyenda?: boolean
  // muchos días en el eje: pocas marcas derechas, la fecha completa al tocar y el día atípico marcado sin aplastar los demás
  dias?: { titulos: string[] }
}

// Barras agrupadas: horizontales para "¿en qué se va?", verticales para el mes a mes.
export default function Barras({ etiquetas, series, formato, descripcion, colorTexto, colorLinea, horizontal, superpuesto, apilado, formatoEje = formato, linea, maximo, leyenda = true, dias }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!lienzo.current) return
    // un día más de 3 veces el segundo mayor se corta al tope con su valor escrito: la escala sigue partiendo de 0 y se leen los demás
    const valores = series.flatMap(s => s.datos.filter((v): v is number => v !== null && v > 0)).sort((a, b) => b - a)
    const tope = dias && !maximo && valores.length > 1 && valores[0] > 3 * valores[1] ? valores[1] * 1.3 : undefined
    const atipico: Plugin<'bar'> = {
      id: 'atipico',
      afterDatasetsDraw(c) {
        if (!tope) return
        const ctx = c.ctx
        ctx.save()
        ctx.fillStyle = colorTexto
        ctx.font = '600 12px system-ui, sans-serif'
        ctx.textAlign = 'center'
        c.data.datasets.forEach((d, i) => c.getDatasetMeta(i).data.forEach((el, j) => {
          const v = d.data[j] as number | null
          if (v !== null && v > tope) ctx.fillText(`▲ ${formatoEje(v)}`, el.x, c.chartArea.top - 6)
        }))
        ctx.restore()
      },
    }
    // precision 0: todos los valores son pesos o conteos, sin marcas decimales que se repitan al redondear
    const eje = { stacked: apilado, max: maximo ?? tope, ticks: { color: colorTexto, // con escalas cortas (0 a 7 días) solo se rotulan el inicio, la mitad y el tope: a 390 px los rótulos se montan
      callback: (v: string | number) => maximo && maximo <= 10 && ![0, Math.round(maximo / 2), maximo].includes(Number(v)) ? '' : formatoEje(Number(v)),
      maxTicksLimit: maximo && maximo <= 10 ? maximo + 1 : dias ? 4 : 5, precision: 0 },
      // la línea del 0 con el color del texto: se nota cuando hay valores negativos (p. ej. el saldo)
      grid: { color: (c: { tick: { value: number } }) => c.tick.value === 0 ? colorTexto : colorLinea } }
    const corto = (i: number) => etiquetas[i].length > 16 ? `${etiquetas[i].slice(0, 15)}…` : etiquetas[i]
    const categorias = { stacked: apilado, ticks: { color: colorTexto, ...(dias ? { autoSkip: true, maxTicksLimit: 7, maxRotation: 0, minRotation: 0 } : { autoSkip: false }),
      ...(horizontal ? { callback: (_: unknown, i: number) => corto(i) } : {}) }, grid: { display: false } }
    const grafico = new Chart(lienzo.current, {
      type: 'bar',
      plugins: [atipico],
      data: {
        labels: etiquetas,
        datasets: [
          ...(linea ? [{ type: 'line' as const, label: linea.nombre, data: linea.datos, borderColor: linea.color, backgroundColor: linea.color,
            borderWidth: 2, pointRadius: linea.punteada ? 0 : 3, tension: 0, ...(linea.punteada ? { borderDash: [6, 5] } : {}) }] : []),
          ...series.map((s, i) => ({
            type: 'bar' as const, label: s.nombre, data: s.datos, backgroundColor: s.color, borderColor: s.borde ?? s.color,
            borderWidth: s.borde ? 1.5 : 0, borderRadius: 6, maxBarThickness: superpuesto && i ? 12 : 22,
            ...(superpuesto ? { grouped: false, order: -i } : {}),
          })),
        ],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        layout: { padding: { top: tope ? 18 : 0 } },
        // un toque en cualquier parte del día muestra todas sus series, sin tener que atinarle a una barra delgada
        ...(dias ? { interaction: { mode: 'index' as const, intersect: false } } : {}),
        responsive: true,
        maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
        plugins: {
          legend: { display: leyenda && series.length + (linea ? 1 : 0) > 1, align: 'start', labels: { color: colorTexto, boxWidth: 12,
            generateLabels: c => Chart.defaults.plugins.legend.labels.generateLabels(c).map(l => {
              const s = series.find(x => x.nombre === l.text)
              return s?.leyenda ? { ...l, fillStyle: s.leyenda, strokeStyle: s.leyenda } : l
            }) } },
          tooltip: { callbacks: { ...(dias ? { title: items => dias.titulos[items[0].dataIndex] ?? '' } : {}),
            label: c => `${c.dataset.label}: ${formato(Number(horizontal ? c.parsed.x : c.parsed.y))}` } },
        },
        scales: horizontal ? { x: eje, y: categorias } : { x: categorias, y: eje },
      },
    })
    return () => grafico.destroy()
  }, [etiquetas, series, formato, formatoEje, colorTexto, colorLinea, horizontal, superpuesto, apilado, linea, maximo, leyenda, dias])

  const alto = horizontal ? Math.max(160, etiquetas.length * (superpuesto ? 1 : series.length) * 30 + 60) : 260
  return (
    <div className="grafico" style={{ height: alto }}>
      <canvas ref={lienzo} role="img" aria-label={descripcion} />
    </div>
  )
}
