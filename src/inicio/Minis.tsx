// Minigráficos de las tarjetas del inicio: formas simples en blanco sobre el color del módulo.

export function EntroSalio({ entro, salio, formato }: { entro: number; salio: number; formato: (v: number) => string }) {
  const tope = Math.max(entro, salio, 1)
  return (
    <span className="mini mini-barras" role="img" aria-label={`Entró ${formato(entro)} y salió ${formato(salio)} este mes`}>
      {([['Entró', entro], ['Salió', salio]] as const).map(([nombre, valor]) => (
        <span key={nombre}><span className="sub">{nombre}</span><span className="pista"><span style={{ width: `${valor / tope * 100}%` }} /></span></span>
      ))}
    </span>
  )
}

// semana: de lunes a domingo, null si el día no ha llegado
export function SemanaGym({ semana, meta }: { semana: (boolean | null)[]; meta: number | null }) {
  const hechos = semana.filter(Boolean).length
  return (
    <span className="mini mini-semana" role="img" aria-label={`Esta semana: ${hechos} ${meta ? `de ${meta} ` : ''}días de gym`}>
      {semana.map((d, i) => <span key={i} className={d ? 'lleno' : d === null ? 'futuro' : undefined}>{'LMXJVSD'[i]}</span>)}
    </span>
  )
}

export function HabitosHoy({ lista }: { lista: { nombre: string; hecho: boolean }[] }) {
  return (
    <span className="mini mini-habitos" role="img" aria-label={lista.map(h => `${h.nombre}: ${h.hecho ? 'hecho' : 'pendiente'}`).join(', ')}>
      {lista.map(h => <span key={h.nombre} className={h.hecho ? 'lleno' : undefined}><i />{h.nombre}</span>)}
    </span>
  )
}

export function TareasHoy({ hechas, total }: { hechas: number; total: number }) {
  return (
    <span className="mini mini-barra" role="img" aria-label={`${hechas} de ${total} tareas de hoy hechas`}>
      <span className="pista"><span style={{ width: `${hechas / total * 100}%` }} /></span>
      <span className="sub">{hechas} de {total} hechas hoy</span>
    </span>
  )
}
