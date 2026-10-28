import { useEffect, useState } from 'react'
import { equipoDe, estaInstalada, instalar, puedeInstalar, type Equipo } from './equipo'

const PASOS: Record<Equipo, { titulo: string; pasos: string[] }> = {
  iphone: {
    titulo: 'iPhone o iPad',
    pasos: [
      'Abre seguiapp en Safari.',
      'Toca el botón Compartir (el cuadro con la flecha hacia arriba).',
      'Elige «Agregar a inicio» y luego «Agregar».',
    ],
  },
  android: {
    titulo: 'Android',
    pasos: [
      'Abre seguiapp en Chrome.',
      'Toca el menú ⋮ arriba a la derecha.',
      'Elige «Instalar app» (o «Agregar a la pantalla principal») y confirma.',
    ],
  },
  computador: {
    titulo: 'Computador',
    pasos: [
      'Abre seguiapp en Chrome o Edge.',
      'Haz clic en el ícono de instalar al final de la barra de direcciones, o en el menú elige «Instalar seguiapp».',
      'En Mac con Safari: menú Archivo › «Añadir al Dock».',
    ],
  },
}

export default function Instalar({ alVolver }: { alVolver: () => void }) {
  const equipo = equipoDe(navigator.userAgent, navigator.maxTouchPoints)
  const [conBoton, setConBoton] = useState(puedeInstalar())
  const [listo, setListo] = useState(estaInstalada())

  useEffect(() => {
    const alPoder = () => setConBoton(true)
    const alInstalar = () => { setConBoton(false); setListo(true) }
    addEventListener('beforeinstallprompt', alPoder)
    addEventListener('appinstalled', alInstalar)
    return () => { removeEventListener('beforeinstallprompt', alPoder); removeEventListener('appinstalled', alInstalar) }
  }, [])

  const orden: Equipo[] = [equipo, ...(['iphone', 'android', 'computador'] as const).filter(e => e !== equipo)]

  return (
    <article className="contenedor politica">
      <button className="volver" onClick={alVolver}>← Volver</button>
      <h1>Instalar la app</h1>
      <p>Instalada, seguiapp abre desde el inicio de tu equipo como cualquier app, a pantalla completa.</p>
      {listo
        ? <p role="status">✓ Ya está instalada en este equipo.</p>
        : conBoton && <button className="principal" onClick={() => instalar().then(setListo)}>Instalar</button>}

      {orden.map((e, i) => (
        <section key={e}>
          <h2>{PASOS[e].titulo}{i === 0 && <span className="tenue"> · tu equipo</span>}</h2>
          <ol>{PASOS[e].pasos.map(p => <li key={p}>{p}</li>)}</ol>
        </section>
      ))}

      <h2>Bueno saber</h2>
      <ul>
        <li>Se actualiza sola: cada vez que la abres con conexión trae lo último.</li>
        <li>En iPhone, los avisos solo llegan si la app está instalada.</li>
      </ul>
    </article>
  )
}
