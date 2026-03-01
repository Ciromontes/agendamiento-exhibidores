/**
 * components/AbsenceToggle.tsx — Fase 9B: Marcar ausencia semanal
 * ─────────────────────────────────────────────────────────────
 * Permite al usuario indicar que no estará disponible durante
 * la semana actual.
 *
 * Flujo al MARCAR ausencia:
 *   1. Busca todas las reservas activas del usuario esta semana.
 *   2. Para cada una, crea un relief_request abierto automático
 *      (expira al inicio del turno o en 24h, lo que sea menor).
 *   3. Inserta la fila en `absences`.
 *   4. Llama onAbsenceChange(true) para que el dashboard bloquee
 *      el ExhibitorGrid.
 *
 * Flujo al QUITAR ausencia:
 *   1. Borra la fila de `absences`.
 *   2. Los relief_requests ya enviados permanecen activos
 *      (el usuario puede cancelarlos manualmente desde la grilla).
 *   3. Llama onAbsenceChange(false).
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import { DAYS_OF_WEEK, formatTimeLabel } from '@/types'

interface Props {
  onAbsenceChange: (isAbsent: boolean) => void
}

/** Calcula el lunes de la semana actual en formato YYYY-MM-DD */
function getCurrentWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.getFullYear(), now.getMonth(), diff)
  return monday.toISOString().split('T')[0]
}

/** Combina weekStart + day_of_week + start_time en un Date */
function buildSlotDatetime(weekStart: string, dayOfWeek: number, startTime: string): Date {
  const monday = new Date(weekStart + 'T00:00:00')
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const d = new Date(monday)
  d.setDate(d.getDate() + offset)
  const [h, m] = startTime.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

export default function AbsenceToggle({ onAbsenceChange }: Props) {
  const { user }   = useUser()
  const supabase   = createClient()
  const weekStart  = getCurrentWeekStart()

  const [isAbsent,    setIsAbsent]    = useState(false)
  const [absenceId,   setAbsenceId]   = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [reason,      setReason]      = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [activeReservations, setActiveReservations] = useState<{
    id: string
    time_slot_id: string
    slot?: { day_of_week: number; start_time: string; end_time: string }
  }[]>([])

  // ─── Cargar estado de ausencia actual ─────────────────────
  const fetchStatus = useCallback(async () => {
    if (!user) return
    setLoading(true)

    const { data: absData } = await supabase
      .from('absences')
      .select('id')
      .eq('user_id', user.id)
      .eq('week_start', weekStart)
      .maybeSingle()

    const absent = !!absData
    setIsAbsent(absent)
    setAbsenceId(absData?.id ?? null)
    onAbsenceChange(absent)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, weekStart])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ─── Cargar reservas activas del usuario esta semana ──────
  const fetchReservations = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('reservations')
      .select(`
        id, time_slot_id,
        slot:time_slots!reservations_time_slot_id_fkey(day_of_week, start_time, end_time)
      `)
      .eq('user_id', user.id)
      .eq('week_start', weekStart)
      .neq('status', 'cancelled')
    setActiveReservations(
      (data ?? []) as unknown as { id: string; time_slot_id: string;
        slot?: { day_of_week: number; start_time: string; end_time: string } }[]
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, weekStart])

  // ─── Iniciar flujo de marcar ausencia ─────────────────────
  const handleMarkAbsent = async () => {
    await fetchReservations()
    setShowConfirm(true)
  }

  // ─── Confirmar ausencia: insertar BD + relief_requests ────
  const handleConfirm = async () => {
    if (!user) return
    setActionLoading(true)

    // 1. Registrar ausencia
    const { data: absData, error: absError } = await supabase
      .from('absences')
      .insert({ user_id: user.id, week_start: weekStart, reason: reason.trim() || null })
      .select('id')
      .single()

    if (absError) {
      alert('Error al registrar ausencia: ' + absError.message)
      setActionLoading(false)
      return
    }
    setAbsenceId(absData.id)

    // 2. Crear un relief_request abierto para cada reserva activa
    const reliefInserts = activeReservations.map(res => {
      const slotDatetime = res.slot
        ? buildSlotDatetime(weekStart, res.slot.day_of_week, res.slot.start_time)
        : null
      const expiresAt = slotDatetime
        ? new Date(Math.min(slotDatetime.getTime(), Date.now() + 24 * 3_600_000)).toISOString()
        : new Date(Date.now() + 24 * 3_600_000).toISOString()
      return {
        reservation_id: res.id,
        slot_id:        res.time_slot_id,
        week_start:     weekStart,
        from_user_id:   user.id,
        to_user_id:     null,           // abierto a todos
        status:         'pending',
        expires_at:     expiresAt,
      }
    })

    if (reliefInserts.length > 0) {
      const { error: relError } = await supabase
        .from('relief_requests')
        .insert(reliefInserts)
      if (relError) {
        console.warn('No se pudieron crear todos los relevos:', relError.message)
      }
    }

    setIsAbsent(true)
    onAbsenceChange(true)
    setShowConfirm(false)
    setReason('')
    setActionLoading(false)
  }

  // ─── Quitar ausencia ──────────────────────────────────────
  const handleRemoveAbsence = async () => {
    if (!user || !absenceId) return
    if (!confirm('¿Quitar tu ausencia esta semana? Las solicitudes de relevo ya enviadas seguirán activas.')) return

    setActionLoading(true)
    const { error } = await supabase
      .from('absences')
      .delete()
      .eq('id', absenceId)

    if (error) {
      alert('Error al quitar ausencia: ' + error.message)
    } else {
      setIsAbsent(false)
      setAbsenceId(null)
      onAbsenceChange(false)
    }
    setActionLoading(false)
  }

  if (!user || loading) return null

  return (
    <>
      {/* ── Tarjeta de estado de ausencia ── */}
      <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap ${
        isAbsent
          ? 'bg-red-50 border-red-200'
          : 'bg-white border-gray-200 shadow-sm'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{isAbsent ? '🚫' : '📅'}</span>
          <div>
            <p className="text-sm font-semibold text-gray-800">
              {isAbsent ? 'Marcado como ausente esta semana' : 'Disponible esta semana'}
            </p>
            <p className="text-xs text-gray-500">
              {isAbsent
                ? 'No puedes reservar turnos. Se enviaron solicitudes de relevo para tus turnos activos.'
                : 'Si no podrás asistir esta semana, marcar ausencia enviará relevos automáticos.'}
            </p>
          </div>
        </div>

        {isAbsent ? (
          <button
            onClick={handleRemoveAbsence}
            disabled={actionLoading}
            className="px-4 py-1.5 text-xs font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50 transition shrink-0"
          >
            {actionLoading ? '...' : '✅ Quitar ausencia'}
          </button>
        ) : (
          <button
            onClick={handleMarkAbsent}
            disabled={actionLoading}
            className="px-4 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition shrink-0"
          >
            {actionLoading ? '...' : '🚫 Marcar ausencia'}
          </button>
        )}
      </div>

      {/* ── Modal de confirmación de ausencia ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex justify-between items-center px-5 py-4 border-b">
              <h2 className="text-base font-semibold text-gray-800">🚫 Confirmar ausencia</h2>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {/* Resumen de turnos afectados */}
              {activeReservations.length > 0 ? (
                <div className="mb-4">
                  <p className="text-sm text-gray-700 mb-2">
                    Se enviarán <strong>{activeReservations.length}</strong> solicitude(s) de relevo abierto:
                  </p>
                  <ul className="space-y-1 text-xs text-gray-600 bg-amber-50 rounded-lg p-3">
                    {activeReservations.map(res => (
                      <li key={res.id} className="flex items-center gap-1.5">
                        <span>🔄</span>
                        {res.slot
                          ? `${DAYS_OF_WEEK[res.slot.day_of_week]} · ${formatTimeLabel(res.slot.start_time, res.slot.end_time)}`
                          : 'Turno sin detalle'}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-gray-600 mb-4">
                  No tienes turnos activos esta semana. Solo quedarás marcado como ausente.
                </p>
              )}

              {/* Campo de motivo opcional */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Motivo (opcional)
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Ej: Viaje, Enfermedad..."
                  maxLength={80}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2 text-sm rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading}
                  className="flex-1 py-2 text-sm rounded-xl bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition font-medium"
                >
                  {actionLoading ? '...' : '✅ Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
