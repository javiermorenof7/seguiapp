// Qué equipo usa la persona y si la app ya está instalada, para la pantalla "Instalar la app".

export type Equipo = 'iphone' | 'android' | 'computador'

// El iPad con iPadOS se presenta como Mac; se distingue porque es táctil.
export function equipoDe(agente: string, puntosTactiles = 0): Equipo {
  if (/iphone|ipad|ipod/i.test(agente) || (/macintosh/i.test(agente) && puntosTactiles > 1)) return 'iphone'
  return /android/i.test(agente) ? 'android' : 'computador'
}

export const instalada = (modoApp: boolean, standaloneIos?: boolean) => modoApp || standaloneIos === true

export const estaInstalada = () =>
  instalada(matchMedia('(display-mode: standalone)').matches, (navigator as { standalone?: boolean }).standalone)

interface AvisoInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

// Chrome y Edge avisan una sola vez al cargar que se puede instalar; se guarda para el botón.
let aviso: AvisoInstalar | null = null
if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); aviso = e as AvisoInstalar })
  addEventListener('appinstalled', () => { aviso = null })
}

export const puedeInstalar = () => aviso !== null

export async function instalar(): Promise<boolean> {
  if (!aviso) return false
  await aviso.prompt()
  const { outcome } = await aviso.userChoice
  aviso = null
  return outcome === 'accepted'
}
