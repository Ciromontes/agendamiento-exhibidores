/**
 * components/ServiceWorkerRegistration.tsx — Fase 9B: PWA
 * ─────────────────────────────────────────────────────────────
 * Componente cliente mínimo que registra el service worker
 * al cargar la app. Se monta en el RootLayout para que esté
 * presente en todas las páginas.
 *
 * Solo ejecuta código en el navegador (useEffect):
 * no afecta el SSR/SSG ni el bundle del servidor.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect } from 'react'

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // Registrar el service worker desde /sw.js (directorio public/)
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(reg => {
        // Detectar actualizaciones disponibles
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Hay una nueva versión disponible; el SW se activará en la próxima visita.
              console.info('[SW] Nueva versión disponible, se activará al recargar.')
            }
          })
        })
      })
      .catch(err => {
        // En desarrollo con HTTPS falso puede fallar; no es crítico.
        console.debug('[SW] No se pudo registrar el service worker:', err)
      })
  }, [])

  // No renderiza ningún elemento visual
  return null
}
