/**
 * app/manifest.ts — PWA Web App Manifest (Fase 9B)
 * ─────────────────────────────────────────────────────────────
 * Next.js 13+ sirve este archivo como /manifest.webmanifest
 * y agrega automáticamente el <link rel="manifest"> al HTML.
 *
 * Habilita "Agregar a pantalla de inicio" en móviles.
 * display: 'standalone' oculta la barra del navegador (fullscreen app).
 * ─────────────────────────────────────────────────────────────
 */
import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Exhibidores — Agendamiento',
    short_name: 'Exhibidores',
    description: 'Sistema de agendamiento de turnos para predicación en exhibidores.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9fafb',
    theme_color: '#4f46e5',
    lang: 'es',
    categories: ['productivity', 'utilities'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        // SVG escala a cualquier tamaño — funciona en Android Chrome
        // y en iOS como fallback.
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
