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

// Avisos: el texto llega cifrado desde la función de Supabase; al tocarlo abre (o enfoca) la app en la pantalla del aviso.
self.addEventListener('push', evento => {
  const aviso = evento.data ? evento.data.json() : { titulo: 'seguiapp', cuerpo: 'Tienes un aviso.', abrir: '/' }
  evento.waitUntil(self.registration.showNotification(aviso.titulo, {
    body: aviso.cuerpo, icon: 'icono.svg', badge: 'icono.svg', data: { abrir: aviso.abrir },
  }))
})

self.addEventListener('notificationclick', evento => {
  evento.notification.close()
  // solo rutas propias: nunca abre otro sitio aunque el aviso lo pida
  const destino = new URL(evento.notification.data?.abrir ?? '/', self.registration.scope)
  const url = destino.origin === location.origin ? new URL(destino.pathname.replace(/^\//, '') + destino.search, self.registration.scope).href : self.registration.scope
  evento.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ventanas => {
    const abierta = ventanas.find(v => v.url.startsWith(self.registration.scope))
    return abierta ? abierta.navigate(url).then(v => v && v.focus()) : self.clients.openWindow(url)
  }))
})
