/**
 * public/sw.js — Service Worker (Fase 9B: PWA)
 * ─────────────────────────────────────────────────────────────
 * Estrategias de caché:
 *
 *   Cache-First  → Assets estáticos Next.js, iconos, fuentes.
 *                  Se sirven desde caché; se actualizan en segundo plano.
 *
 *   Network-First → Supabase API, páginas HTML de navegación.
 *                   Intenta red; cae a caché si no hay conexión.
 *
 *   Offline fallback → Si el usuario navega sin conexión y no hay
 *                      caché, sirve la última versión cacheada de /dashboard.
 * ─────────────────────────────────────────────────────────────
 */

const CACHE_NAME   = 'exhibidores-v1'
const SHELL_URLS   = ['/', '/dashboard']        // cachear al instalar

// ── Instalación ──────────────────────────────────────────────
// Pre-cachear el app shell (rutas principales).
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

// ── Activación ───────────────────────────────────────────────
// Eliminar cachés de versiones anteriores y tomar control.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE_NAME)
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

// ── Interceptar peticiones (fetch) ───────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Solo manejar GET; dejar pasar el resto
  if (request.method !== 'GET') return

  // Ignorar el WebSocket HMR de Next.js en desarrollo
  if (url.pathname.startsWith('/_next/webpack-hmr')) return

  // Nunca cachear API internas: deben reflejar datos en tiempo real.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request))
    return
  }

  // ─── 1. Cache-First: assets estáticos, iconos, fuentes ───
  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/')        ||
    url.pathname.match(/\.(png|svg|ico|woff2?|ttf|eot)$/)

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone()
            caches.open(CACHE_NAME).then(c => c.put(request, clone))
          }
          return resp
        })
      })
    )
    return
  }

  // ─── 2. Network-First: API Supabase + páginas de navegación ──
  // Garantiza datos frescos cuando hay red.
  // Cuando no hay red, sirve la copia cacheada si existe.
  const isSupa = url.hostname.includes('supabase.co')
  const isNav  = request.mode === 'navigate'

  if (isSupa || isNav) {
    event.respondWith(
      fetch(request)
        .then(resp => {
          // Cachear páginas de navegación exitosas
          if (isNav && resp.ok) {
            const clone = resp.clone()
            caches.open(CACHE_NAME).then(c => c.put(request, clone))
          }
          return resp
        })
        .catch(async () => {
          // Sin red: buscar en caché
          const cached = await caches.match(request)
          if (cached) return cached
          // Fallback final: servir /dashboard cacheado
          if (isNav) {
            return caches.match('/dashboard') || caches.match('/')
          }
        })
    )
    return
  }

  // ─── 3. Stale-While-Revalidate: resto de peticiones ──────
  // Sirve desde caché (respuesta inmediata) y actualiza en segundo plano.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const networkFetch = fetch(request).then(resp => {
          if (resp.ok) cache.put(request, resp.clone())
          return resp
        })
        return cached || networkFetch
      })
    )
  )
})
