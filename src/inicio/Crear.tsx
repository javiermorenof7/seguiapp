import { useState, type FormEvent } from 'react'
import { activarPlantillas, crearSeguimiento, type Seguimiento } from '../datos'
import type { AccionFinanzas } from '../finanzas/Finanzas'
import { INICIALES } from '../salud/Salud'
import { PLANTILLAS, TIPO_FINANZAS, type Modulo } from './resumenes'

// A dónde lleva cada opción: el formulario que ya existe en el módulo.
export type Destino =
  | { tipo: 'finanzas'; abrir?: AccionFinanzas }
  | { tipo: 'salud'; abrir?: 'ejercicio' | 'medida' }
  | { tipo: 'habitos'; enfocar?: boolean }

export const NOMBRE: Record<Modulo, string> = { finanzas: 'Finanzas', salud: 'Salud', habitos: 'Hábitos' }
export const COLOR: Record<Modulo, string> = { finanzas: 't1', salud: 't2', habitos: 't5' }
export const QUE_MIDE: Record<Modulo, string> = {
  finanzas: 'Gastos, ingresos, ahorro, presupuestos y facturas.',
  salud: 'Gym, peso y medidas.',
  habitos: 'Lo que haces cada día, con rachas.',
}
const OPCIONES: Record<Modulo, { texto: string; ejemplo: string; destino: Destino }[]> = {
  finanzas: [
    { texto: 'Gasto', ejemplo: '35 mil almuerzo', destino: { tipo: 'finanzas', abrir: 'gasto' } },
    { texto: 'Ingreso', ejemplo: 'sueldo, ventas', destino: { tipo: 'finanzas', abrir: 'ingreso' } },
    { texto: 'Ahorro', ejemplo: 'lo que guardas este mes', destino: { tipo: 'finanzas', abrir: 'ahorro' } },
    { texto: 'Presupuesto', ejemplo: 'tope por categoría', destino: { tipo: 'finanzas', abrir: 'presupuesto' } },
    { texto: 'Factura', ejemplo: 'luz, agua, internet', destino: { tipo: 'finanzas', abrir: 'factura' } },
  ],
  salud: [
    { texto: 'Ejercicio', ejemplo: 'press banca 4x10 60', destino: { tipo: 'salud', abrir: 'ejercicio' } },
    { texto: 'Medida', ejemplo: 'peso, cintura o la que quieras', destino: { tipo: 'salud', abrir: 'medida' } },
  ],
  habitos: [{ texto: 'Hábito', ejemplo: 'agua 2 litros', destino: { tipo: 'habitos', enfocar: true } }],
}

// Activa los módulos y crea sus seguimientos base si faltan (Hábitos no tiene: cada hábito lo crea la persona).
export async function activarModulos(modulos: Modulo[], seguimientos: Seguimiento[]) {
  await activarPlantillas(modulos.flatMap(m => PLANTILLAS[m]))
  const base = [
    ...(modulos.includes('finanzas') ? Object.keys(TIPO_FINANZAS).map(nombre => ({ nombre, unidad: null, codigo_plantilla: 'finanzas', tipo_medida: 'dinero' as const })) : []),
    ...(modulos.includes('salud') ? INICIALES.map(i => ({ ...i, tipo_medida: 'numero' as const })) : []),
  ]
  const faltan = base.filter(b => !seguimientos.some(s => s.codigo_plantilla === b.codigo_plantilla && s.nombre === b.nombre))
  await Promise.all(faltan.map(f => crearSeguimiento({ ...f, frecuencia: 'registro' }, null)))
}

export function Crear({ activos, modulo, alElegir, alVolver }: {
  activos: Modulo[]
  modulo?: Modulo
  alElegir: (destino: Destino) => void
  alVolver: () => void
}) {
  const [elegido, setElegido] = useState(modulo ?? (activos.length === 1 ? activos[0] : undefined))
  return (
    <>
      <button className="volver" onClick={elegido && !modulo && activos.length > 1 ? () => setElegido(undefined) : alVolver}>
        ← {elegido && !modulo && activos.length > 1 ? 'Otro módulo' : 'Mi seguimiento'}
      </button>
      <header className="encabezado"><div><h1>{elegido ? NOMBRE[elegido] : '¿Qué quieres registrar?'}</h1></div></header>
      <div className="opciones">
        {!elegido && activos.map(m => (
          <button key={m} className={`opcion ${COLOR[m]}`} onClick={() => setElegido(m)}>
            <strong>{NOMBRE[m]}</strong><span>{QUE_MIDE[m]}</span>
          </button>
        ))}
        {elegido && OPCIONES[elegido].map(o => (
          <button key={o.texto} className={`opcion ${COLOR[elegido]}`} onClick={() => alElegir(o.destino)}>
            <strong>{o.texto}</strong><span>{o.ejemplo}</span>
          </button>
        ))}
      </div>
    </>
  )
}

export function Bienvenida({ nombre, alEmpezar }: { nombre: string | null; alEmpezar: (modulos: Modulo[]) => Promise<void> }) {
  const [marcados, setMarcados] = useState<Modulo[]>([])
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function empezar(evento: FormEvent) {
    evento.preventDefault()
    setEnviando(true)
    try {
      await alEmpezar(marcados)
    } catch (e) {
      setError((e as Error).message)
      setEnviando(false)
    }
  }

  return (
    <form className="formulario" onSubmit={empezar}>
      <h1>Hola{nombre ? `, ${nombre.split(' ')[0]}` : ''}</h1>
      <p className="tenue">Lo que no se mide no se controla. Elige qué quieres seguir; luego puedes activar más.</p>
      <fieldset>
        <legend>¿Qué quieres seguir?</legend>
        {(Object.keys(NOMBRE) as Modulo[]).map(m => (
          <label key={m} className="casilla">
            <input type="checkbox" checked={marcados.includes(m)}
              onChange={ev => setMarcados(ev.target.checked ? [...marcados, m] : marcados.filter(x => x !== m))} />
            <span><strong>{NOMBRE[m]}</strong> · {QUE_MIDE[m]}</span>
          </label>
        ))}
      </fieldset>
      <button className="principal" disabled={!marcados.length || enviando}>Empezar</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}
