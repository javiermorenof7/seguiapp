import { guardarSuscripcion } from '../datos'
import { equipoDe } from '../equipo'
import { LLAVE_PUBLICA_VAPID } from './llave'

// Quién pidió avisos en este equipo. "Salir" no lo borra: al volver a entrar la suscripción se renueva sola.
const CLAVE = 'avisos_en_equipo'
type Almacen = Pick<Storage, 'getItem' | 'setItem'>

const leer = (a: Almacen): string[] => {
  try { return JSON.parse(a.getItem(CLAVE) ?? '[]') } catch { return [] }
}
export const quiereAvisos = (idUsuario: string, a: Almacen = localStorage) => leer(a).includes(idUsuario)
export function recordarAvisos(idUsuario: string, quiere: boolean, a: Almacen = localStorage) {
  const otros = leer(a).filter(x => x !== idUsuario)
  try { a.setItem(CLAVE, JSON.stringify(quiere ? [...otros, idUsuario] : otros)) } catch { /* sin almacenamiento no se renueva sola */ }
}

export const soportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export async function suscripcionActual() {
  if (!soportaPush()) return null
  const registro = await navigator.serviceWorker.getRegistration()
  return registro ? registro.pushManager.getSubscription() : null
}

// La llave VAPID viaja en base64 url; pushManager la pide en bytes.
const enBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0))
const enBase64 = (buffer: ArrayBuffer | null) => btoa(String.fromCharCode(...new Uint8Array(buffer ?? new ArrayBuffer(0))))
const nombreEquipo = () => {
  const equipo = equipoDe(navigator.userAgent, navigator.maxTouchPoints)
  return equipo === 'iphone' ? 'iPhone' : equipo === 'android' ? 'Android' : 'Computador'
}

// Toma la suscripción que tenga el equipo (o pide una nueva) y la deja guardada a nombre de quien tiene la sesión.
export async function suscribir() {
  const registro = await navigator.serviceWorker.ready
  const s = await registro.pushManager.getSubscription()
    ?? await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: enBytes(LLAVE_PUBLICA_VAPID) })
  await guardarSuscripcion({ endpoint: s.endpoint, llave_p256dh: enBase64(s.getKey('p256dh')), llave_auth: enBase64(s.getKey('auth')), nombre_equipo: nombreEquipo() })
}

// Al abrir la app: solo para quien pidió avisos aquí y con el permiso vigente; nunca pide permiso por su cuenta.
// Si el equipo ya está suscrito con su sesión abierta (activó antes de existir la marca), se le marca.
export async function renovarAvisos(idUsuario: string) {
  if (!soportaPush() || Notification.permission !== 'granted') return
  if (!quiereAvisos(idUsuario)) {
    if (!await suscripcionActual()) return
    recordarAvisos(idUsuario, true)
  }
  await suscribir()
}
