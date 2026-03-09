/**
 * app/[slug]/dashboard/page.tsx — Dashboard V4 Multi-Tenant
 * ─────────────────────────────────────────────────────────────
 * Página principal para usuarios normales (no admin).
 * URL: /{slug}/dashboard
 *
 * Reemplaza: app/(public)/dashboard/page.tsx
 * El slug se usa para construir rutas de regreso al login.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { use } from 'react'
import { useUser } from '@/context/UserContext'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import ExhibitorGrid from '@/components/ExhibitorGrid'
import InvitationBadge from '@/components/InvitationBadge'
import ReliefBadge from '@/components/ReliefBadge'
import NotificationBell from '@/components/NotificationBell'
import WeekHistoryPanel from '@/components/WeekHistoryPanel'
import GlobalReliefButton from '@/components/GlobalReliefButton'
import OpeningCountdown from '@/components/OpeningCountdown'
import ActiveWeekBanner from '@/components/ActiveWeekBanner'
import { USER_TYPE_LABELS } from '@/types'

type Props = {
  params: Promise<{ slug: string }>
}

export default function DashboardPage({ params }: Props) {
  const { slug } = use(params)

  const { user, congregationSlug, isLoading, logout } = useUser()
  const router = useRouter()

  const [spouseName, setSpouseName] = useState<string | null>(null)
  const [view, setView] = useState<'main' | 'history'>('main')
  const notifRef = useRef<HTMLDivElement>(null)

  // Protección de ruta
  useEffect(() => {
    if (isLoading) return

    // Redirigir si no hay usuario o hay mezcla de congregaciones
    if (!user || (slug && congregationSlug && slug !== congregationSlug)) {
      if (slug && congregationSlug && slug !== congregationSlug) {
        logout()
      }
      return router.push(`/${slug}`)
    }
    
    // Si es admin, redirigir al panel de admin
    if (user && user.is_admin) {
      router.push(`/${slug}/admin`)
    }
  }, [user, congregationSlug, isLoading, router, slug, logout])

  // Cargar nombre del cónyuge
  useEffect(() => {
    if (!user?.spouse_id) {
      setSpouseName(null)
      return
    }
    const fetchSpouse = async () => {
      try {
        const res = await fetch(`/api/users/${user.spouse_id}`)
        if (res.ok) {
          const data = await res.json()
          setSpouseName(data.name)
        }
      } catch { /* ignorar */ }
    }
    fetchSpouse()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.spouse_id])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span>📋</span> Exhibidores
            </h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-indigo-200 text-sm">
                Hola, {user.name}
              </p>
              <span className="text-[10px] bg-indigo-500 text-indigo-100 px-2 py-0.5 rounded-full font-medium">
                {USER_TYPE_LABELS[user.user_type] || user.user_type}
              </span>
              {spouseName && (
                <span className="text-[10px] bg-pink-500/30 text-pink-100 px-2 py-0.5 rounded-full font-medium">
                  💑 {spouseName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell
              onBellClick={() => {
                setView('main')
                setTimeout(() => notifRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
              }}
            />
            <button
              onClick={() => setView(v => v === 'main' ? 'history' : 'main')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                view === 'history'
                  ? 'bg-white text-indigo-700'
                  : 'bg-indigo-800 hover:bg-indigo-900 text-white'
              }`}
            >
              {view === 'history' ? '← Panel principal' : '📊 Historial'}
            </button>
            <button
              onClick={() => { logout(); router.push(`/${slug}`) }}
              className="bg-indigo-800 hover:bg-indigo-900 px-4 py-2 rounded-lg text-sm transition text-white"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {view === 'main' ? (
          <>
            <div ref={notifRef}>
              <InvitationBadge />
              <ReliefBadge />
            </div>
            <GlobalReliefButton />
            <OpeningCountdown />
            <ActiveWeekBanner />
            <ExhibitorGrid />
          </>
        ) : (
          <WeekHistoryPanel />
        )}
      </main>
    </div>
  )
}
