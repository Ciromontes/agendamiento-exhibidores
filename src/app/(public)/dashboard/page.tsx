/**
 * app/(public)/dashboard/page.tsx — Fase 8: Dashboard + Historial
 * ─────────────────────────────────────────────────────────────
 * Página principal para usuarios normales (no admin).
 * Ahora tiene dos vistas:
 *   - 'main'    : ExhibitorGrid (agendamiento de la semana actual)
 *   - 'history' : WeekHistoryPanel (semanas pasadas + mis estadísticas)
 * El usuario siempre arranca en 'main'.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

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
import { USER_TYPE_LABELS } from '@/types'

export default function DashboardPage() {
  const { user, isLoading, logout } = useUser()
  const router = useRouter()

  // Estado para el nombre del cónyuge (Fase 3)
  const [spouseName, setSpouseName] = useState<string | null>(null)
  // Vista activa: panel principal o historial (Fase 8)
  const [view, setView] = useState<'main' | 'history'>('main')
  // Referencia al panel de notificaciones (Fase 9A) — permite hacer scroll directo
  const notifRef = useRef<HTMLDivElement>(null)

  // Protección de ruta: redirigir al login si no hay usuario
  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/')
    }
  }, [user, isLoading, router])

  // Cargar nombre del cónyuge si está vinculado (Fase 3)
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
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header con info del usuario, tipo y botón de salir */}
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
              {/* Badge con tipo de usuario */}
              <span className="text-[10px] bg-indigo-500 text-indigo-100 px-2 py-0.5 rounded-full font-medium">
                {USER_TYPE_LABELS[user.user_type] || user.user_type}
              </span>
              {/* Badge de cónyuge vinculado (Fase 3) */}
              {spouseName && (
                <span className="text-[10px] bg-pink-500/30 text-pink-100 px-2 py-0.5 rounded-full font-medium">
                  💑 {spouseName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Campana de notificaciones: invitaciones + relevos (Fase 9A) */}
            <NotificationBell
              onBellClick={() => {
                setView('main')
                setTimeout(() => notifRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
              }}
            />
            {/* Toggle historial / panel principal (Fase 8) */}
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
              onClick={() => { logout(); router.push('/') }}
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
            {/* Panel de notificaciones: invitaciones + relevos (Fases 7 + 9A) */}
            {/* El ref permite que la campana del header haga scroll hasta aquí */}
            <div ref={notifRef}>
              <InvitationBadge />
              <ReliefBadge />
            </div>
            {/* Fase 10: Botón global de relevo — reemplaza AbsenceToggle */}
            <GlobalReliefButton />
            {/* Anuncio de próxima apertura de reservas con cuenta regresiva */}
            <OpeningCountdown />
            <ExhibitorGrid />
          </>
        ) : (
          /* Historial de semanas pasadas + mis estadísticas (Fase 8) */
          <WeekHistoryPanel />
        )}
      </main>
    </div>
  )
}
