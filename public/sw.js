// Red primero para la página y caché primero para los archivos con huella (assets/).
// Nunca guarda respuestas de otros orígenes: los datos de Supabase no pasan por aquí.
const CACHE = 'seguiapp-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', evento => evento.waitUntil(self.clients.claim()))

self.addEventListener('fetch', evento => {
  const { request } = evento
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return

  if (url.pathname.includes('/assets/')) {
    // shortcut: la caché de assets no se limpia entre versiones; limpiar las huellas viejas si crece.
    evento.respondWith(caches.open(CACHE).then(async cache => {
      const guardada = await cache.match(request)
      if (guardada) return guardada
      const respuesta = await fetch(request)
      if (respuesta.ok) cache.put(request, respuesta.clone())
      return respuesta
    }))
  } else if (request.mode === 'navigate') {
    evento.respondWith(fetch(request)
      .then(respuesta => {
        const copia = respuesta.clone()
        caches.open(CACHE).then(cache => cache.put(request, copia))
        return respuesta
      })
      .catch(() => caches.match(request)))
  }
})
