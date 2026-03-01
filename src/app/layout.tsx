/**
 * app/layout.tsx
 * ─────────────────────────────────────────────────────────────
 * Layout raíz de la aplicación Next.js.
 *
 * Este archivo envuelve TODAS las páginas de la app.
 * Responsabilidades:
 *   - Cargar fuentes de Google (Geist Sans y Mono)
 *   - Importar estilos globales (globals.css + Tailwind)
 *   - Envolver toda la app en <UserProvider> para que
 *     cualquier componente pueda acceder al usuario con useUser()
 *   - Configurar metadata (título, descripción) para SEO
 *   - Establecer el idioma como español (lang="es")
 * ─────────────────────────────────────────────────────────────
 */
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { UserProvider } from '@/context/UserContext'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'

// Cargar fuente Geist Sans (texto general)
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

// Cargar fuente Geist Mono (código, números)
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Metadata para SEO, pestaña del navegador y PWA (Fase 9B)
export const metadata: Metadata = {
  title: 'Exhibidores — Agendamiento',
  description: 'Sistema de agendamiento de turnos para predicación en exhibidores.',
  // Habilitar instalación PWA desde el navegador
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Exhibidores',
    statusBarStyle: 'default',
  },
}

// Viewport separado de metadata (requerido por Next.js 14+)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#4f46e5',
}

/**
 * RootLayout - Layout raíz que envuelve toda la aplicación.
 * Todas las páginas (/, /dashboard, /admin) se renderizan
 * dentro de este layout como {children}.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <head>
        {/* Icono para iOS ("Añadir a pantalla de inicio") */}
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* UserProvider: contexto global de autenticación */}
        <UserProvider>
          {children}
        </UserProvider>
        {/* Registrar service worker para PWA (solo en el navegador) */}
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}