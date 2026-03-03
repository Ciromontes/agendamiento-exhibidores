/**
 * components/AdminAbsencePanel.tsx — Fase 9B: Reporte de Ausencias
 * ─────────────────────────────────────────────────────────────
 * Panel de administración que muestra los usuarios ausentes
 * para la semana seleccionada.
 *
 * Funcionalidades:
 *   - Selector de semana (misma navegación que AdminWeekReport)
 *   - Lista de ausentes con nombre, motivo y cantidad de relevos
 *     activos para esa semana
 *   - El admin puede quitar la ausencia de cualquier usuario
 *     (por si fue marcada por error)
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { USER_TYPE_LABELS } from '@/types'
import { useUser } from '@/context/UserContext'

/** Calcula el lunes de la semana actual en formato YYYY-MM-DD */
function getCurrentWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.getFullYear(), now.getMonth(), diff)
  return monday.toISOString().split('T')[0]
}

/** Desplaza una fecha de lunes N semanas */
function shiftWeek(weekStart: string, delta: number): string {
  const d = new Date(weekStart + 'T00:00:00')
  d.setDate(d.getDate() + delta * 7)
  return d.toISOString().split('T')[0]
}

/** Formatea  YYYY-MM-DD → "Semana del DD/MM/YYYY" */
function formatWeekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-')
  return `Semana del ${d}/${m}/${y}`
}

type AbsenceRow = {
  id: string
  user_id: string
  week_start: string
  reason: string | null
  created_at: string
  user?: { id: string; name: string; user_type: string }
  reliefCount?: number
}

export default function AdminAbsencePanel() {
  const supabase = createClient()
  const { user } = useUser()
  const congregationId = user?.congregation_id ?? ''
  const [weekStart, setWeekStart] = useState(getCurrentWeekStart())
  const [absences, setAbsences] = useState<AbsenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)

  const loadAbsences = useCallback(async () => {
    if (!congregationId) return
    setLoading(true)

    // Cargar ausencias de la semana con datos del usuario
    const { data } = await supabase
      .from('absences')
      .select('id, user_id, week_start, reason, created_at, user:users(id, name, user_type)')
      .eq('week_start', weekStart)
      .eq('congregation_id', congregationId)
      .order('created_at', { ascending: false })

    if (!data) { setLoading(false); return }

    // Cargar conteo de relief_requests activos de cada usuario
    const rows = data as unknown as AbsenceRow[]
    const userIds = rows.map(r => r.user_id)

    let reliefCounts = new Map<string, number>()
    if (userIds.length > 0) {
      const { data: relData } = await supabase
        .from('relief_requests')
        .select('from_user_id')
        .in('from_user_id', userIds)
        .eq('week_start', weekStart)
        .eq('congregation_id', congregationId)
        .eq('status', 'pending')
      relData?.forEach(r => {
        reliefCounts.set(r.from_user_id, (reliefCounts.get(r.from_user_id) ?? 0) + 1)
      })
    }

    setAbsences(rows.map(r => ({ ...r, reliefCount: reliefCounts.get(r.user_id) ?? 0 })))
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, congregationId])

  useEffect(() => { loadAbsences() }, [loadAbsences])

  const handleRemove = async (id: string, userName: string) => {
    if (!confirm(`¿Quitar la ausencia de ${userName}?`)) return
    setRemoving(id)
    await supabase.from('absences').delete().eq('id', id).eq('congregation_id', congregationId)
    setAbsences(prev => prev.filter(a => a.id !== id))
    setRemoving(null)
  }

  const currentWeek  = getCurrentWeekStart()
  const isThisWeek   = weekStart === currentWeek

  return (
    <div className="space-y-4">
      {/* Navegador de semana */}
      <div className="flex items-center justify-between bg-white rounded-xl shadow-sm border p-4">
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, -1))}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
        >
          ‹ Anterior
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-800">{formatWeekLabel(weekStart)}</p>
          {isThisWeek && (
            <span className="text-[11px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">
              Semana actual
            </span>
          )}
        </div>
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, +1))}
          disabled={isThisWeek}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition"
        >
          Siguiente ›
        </button>
      </div>

      {/* Lista de ausentes */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-5 py-3 border-b bg-red-50 flex items-center gap-2">
          <span className="text-lg">🚫</span>
          <h2 className="text-sm font-semibold text-red-800">
            Ausentes esta semana
          </h2>
          {!loading && (
            <span className="ml-auto text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
              {absences.length}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-500" />
          </div>
        ) : absences.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            No hay ausencias registradas esta semana. ✅
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {absences.map(abs => {
              const userData = abs.user as { id: string; name: string; user_type: string } | undefined
              return (
                <li key={abs.id} className="px-5 py-4 flex items-start gap-4">
                  {/* Avatar iniciales */}
                  <div className="w-9 h-9 rounded-full bg-red-100 text-red-700 font-bold text-sm flex items-center justify-center shrink-0">
                    {userData?.name?.charAt(0) ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {userData?.name ?? 'Usuario desconocido'}
                      </p>
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full shrink-0">
                        {USER_TYPE_LABELS[userData?.user_type ?? ''] ?? userData?.user_type}
                      </span>
                    </div>
                    {abs.reason && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Motivo: {abs.reason}
                      </p>
                    )}
                    {(abs.reliefCount ?? 0) > 0 ? (
                      <p className="text-xs text-amber-600 mt-0.5">
                        🔄 {abs.reliefCount} relevo(s) activo(s)
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Sin turnos activos / sin relevos pendientes
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemove(abs.id, userData?.name ?? '')}
                    disabled={removing === abs.id}
                    className="shrink-0 px-3 py-1 text-xs rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition"
                  >
                    {removing === abs.id ? '...' : '✕ Quitar'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
