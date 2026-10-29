import type { ReactNode } from 'react'

const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

// nivel: null futuro, 0 nada, 1 sin llegar a la meta, 2 cumplido (como lo da calendarioSemanas)
export interface Dia { fecha: string; nivel: number | null }

// Una columna por semana, de lunes a domingo; arriba el mes donde cambia y hoy con borde.
export default function MapaSemanas({ dias, hoy, descripcion, textos, resumen }: {
  dias: Dia[]; hoy: string; descripcion: string; textos: { hecho: string; parcial?: string; nada: string }; resumen?: ReactNode
}) {
  const semanas = Array.from({ length: dias.length / 7 }, (_, i) => dias.slice(i * 7, i * 7 + 7))
  const mes = (i: number) => semanas[i][0].fecha.slice(5, 7)
  const texto = (d: Dia) => d.nivel === 2 ? textos.hecho : d.nivel ? textos.parcial : textos.nada
  return (
    <>
      {resumen}
      {/* el ancho crece con las semanas para que los cuadros midan lo mismo en todo el sitio */}
      <div className="mapa-semanas" role="img" aria-label={descripcion} style={{ maxWidth: (semanas.length + 1) * 33 }}>
        <i />
        {LETRAS.map(l => <b key={l}>{l}</b>)}
        {semanas.map((s, i) => [
          <i key={`mes-${s[0].fecha}`} className="mes">{i === 0 || mes(i) !== mes(i - 1) ? MESES[Number(mes(i)) - 1] : ''}</i>,
          ...s.map(d => (
            <span key={d.fecha} title={d.nivel === null ? undefined : `${diaMes(d.fecha)} · ${texto(d)}`}
              className={[d.nivel === null ? 'futuro' : d.nivel === 2 ? 'hecho' : d.nivel ? 'parcial' : '', d.fecha === hoy ? 'hoy' : ''].join(' ').trim() || undefined} />
          )),
        ])}
      </div>
      <p className="leyenda-estado">
        <span><i className="hecho" />{textos.hecho}</span>
        {textos.parcial && <span><i className="parcial" />{textos.parcial}</span>}
        <span><i />{textos.nada}</span>
        <span><i className="hoy" />Hoy</span>
      </p>
    </>
  )
}
