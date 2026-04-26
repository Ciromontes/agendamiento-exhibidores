/**
 * components/GlobalReliefButton.tsx — Fase 10: Botón global de Pedir Relevo
 * ─────────────────────────────────────────────────────────────
 * Reemplaza el AbsenceToggle. Permite al usuario solicitar relevo
 * para UNA o VARIAS de sus reservas activas de la semana actual,
 * sin necesidad de entrar celda por celda en la grilla.
 *
 * Flujo:
 *   1. Carga las reservas activas del usuario esta semana.
 *   2. Al pulsar "🔄 Pedir Relevo" abre un modal con la lista.
 *   3. El usuario selecciona una o varias reservas (checkbox).
 *   4. Muestra paso de confirmación antes de enviar.
 *   5. Inserta relief_requests abiertos (to_user_id = null) para
 *      cada reserva seleccionada, respetando la lógica de expiración.
 *
 * No bloquea la grilla (ese comportamiento era del AbsenceToggle).
 * El arte naranja/ámbar se mantiene igual que el toggle anterior.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import { DAYS_OF_WEEK, formatTimeLabel } from '@/types'

/** Lunes de la semana actual — formato YYYY-MM-DD */
function getCurrentWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.getFullYear(), now.getMonth(), diff)
  return monday.toISOString().split('T')[0]
}

/** Combina weekStart + day_of_week + start_time en un objeto Date */
function buildSlotDatetime(weekStart: string, dayOfWeek: number, startTime: string): Date {
  const monday = new Date(weekStart + 'T00:00:00')
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const d = new Date(monday)
  d.setDate(d.getDate() + offset)
  const [h, m] = startTime.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

// Tipo interno para reservas con su info de slot
type ReservationItem = {
  id: string
  time_slot_id: string
  slot?: {
    day_of_week: number
    start_time: string
    end_time: string
  }
  hasPendingRelief: boolean   // Ya hay una solicitud pendiente para esta reserva
}

export default function GlobalReliefButton() {
  const { user } = useUser()
  const supabase = createClient()
  const congregationId = user?.congregation_id ?? ''

  // ─── Estado principal ────────────────────────────────────
  const [weekStart, setWeekStart] = useState(getCurrentWeekStart())
  const [reservations, setReservations] = useState<ReservationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  // Checkboxes: set de ids de reservas seleccionadas
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Paso del modal: 'select' = elegir reservas, 'confirm' = confirmar
  const [step, setStep] = useState<'select' | 'confirm'>('select')
  const [sending, setSending] = useState(false)
  const [sentCount, setSentCount] = useState(0)   // cuántos se enviaron en el último envío

  // ─── Cargar reservas activas + estado de relevos ─────────
  const fetchData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: config } = await supabase
      .from('app_config')
      .select('active_week_start')
      .eq('congregation_id', congregationId)
      .limit(1)
      .single()
    const effectiveWeekStart = (config?.active_week_start as string | null) ?? getCurrentWeekStart()
    setWeekStart(effectiveWeekStart)

    // Reservas activas de la semana ACTIVA con detalle del slot
    const { data: resData } = await supabase
      .from('reservations')
      .select(`
        id, time_slot_id,
        slot:time_slots!reservations_time_slot_id_fkey(day_of_week, start_time, end_time)
      `)
      .eq('user_id', user.id)
      .eq('congregation_id', congregationId)
      .eq('week_start', effectiveWeekStart)
      .neq('status', 'cancelled')

    if (!resData || resData.length === 0) {
      setReservations([])
      setLoading(false)
      return
    }

    // Relevos pendientes y no expirados para estas reservas
    const reservationIds = resData.map(r => r.id)
    const nowIso = new Date().toISOString()
    const { data: reliefData } = await supabase
      .from('relief_requests')
      .select('reservation_id')
      .in('reservation_id', reservationIds)
      .eq('from_user_id', user.id)
      .eq('congregation_id', congregationId)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)

    const pendingSet = new Set(reliefData?.map(r => r.reservation_id) ?? [])

    const items: ReservationItem[] = (resData as unknown as ReservationItem[]).map(r => ({
      ...r,
      hasPendingRelief: pendingSet.has(r.id),
    }))

    setReservations(items)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, congregationId])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Abrir modal: sin preseleccion — el usuario elige manualmente ──
  const handleOpenModal = () => {
    // Sin preseleccion: el usuario marca las fechas que desea
    const initial = new Set<string>()
    setSelected(initial)
    setStep('select')
    setSentCount(0)
    setShowModal(true)
  }

  // ─── Toggle de selección ──────────────────────────────────
  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── Enviar solicitudes de relevo ─────────────────────────
  const handleConfirm = async () => {
    if (!user || selected.size === 0 || !weekStart) return
    setSending(true)

    const selectedItems = reservations.filter(r => selected.has(r.id))

    const inserts = selectedItems.map(res => {
      // Expiración = el menor entre: inicio del turno y ahora+2h
      const slotDatetime = res.slot
        ? buildSlotDatetime(weekStart, res.slot.day_of_week, res.slot.start_time)
        : null
      const expiresAt = slotDatetime
        ? new Date(Math.min(slotDatetime.getTime(), Date.now() + 2 * 3_600_000)).toISOString()
        : new Date(Date.now() + 2 * 3_600_000).toISOString()

      return {
        reservation_id:  res.id,
        slot_id:         res.time_slot_id,
        week_start:      weekStart,
        from_user_id:    user.id,
        to_user_id:      null,       // relevo abierto (cualquier hermano compatible)
        status:          'pending',
        expires_at:      expiresAt,
        congregation_id: congregationId,
      }
    })

    const { error } = await supabase.from('relief_requests').insert(inserts)

    if (error) {
      alert('Error al enviar solicitudes: ' + error.message)
    } else {
      setSentCount(selected.size)
      setStep('select')       // volver al paso inicial (el modal se cerrará)
      setShowModal(false)
      await fetchData()       // recargar para marcar los nuevos como pendientes
    }
    setSending(false)
  }

  // Si no hay usuario o está cargando no renderizar nada
  if (!user || loading) return null

  // ─── Derivados de UI ─────────────────────────────────────
  const totalReservations = reservations.length
  const pendingCount      = reservations.filter(r => r.hasPendingRelief).length
  const allHavePending    = totalReservations > 0 && pendingCount === totalReservations

  return (
    <>
      {/* ── Tarjeta del botón global — diseño naranja/ámbar ── */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔄</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {allHavePending
                ? 'Relevos solicitados esta semana'
                : totalReservations === 0
                ? 'Sin turnos activos esta semana'
                : 'Pedir relevo para uno o varios turnos'}
            </p>
            <p className="text-xs text-amber-700">
              {allHavePending
                ? `${pendingCount} solicitud${pendingCount !== 1 ? 'es' : ''} de relevo activa${pendingCount !== 1 ? 's' : ''} — visible${pendingCount !== 1 ? 's' : ''} en la campana 🔔`
                : totalReservations === 0
                ? 'Reserva un turno primero para poder pedir relevo desde aquí.'
                : `Tienes ${totalReservations} turno${totalReservations !== 1 ? 's' : ''} esta semana${pendingCount > 0 ? ` · ${pendingCount} ya con relevo pendiente` : ''}`}
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenModal}
          disabled={totalReservations === 0 || allHavePending}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition shrink-0 ${
            totalReservations === 0 || allHavePending
              ? 'bg-amber-100 text-amber-400 cursor-not-allowed'
              : 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
          }`}
        >
          {allHavePending ? '✅ Ya solicitado' : '🔄 Pedir Relevo'}
        </button>
      </div>

      {/* Mensaje de éxito temporal después de enviar */}
      {sentCount > 0 && !showModal && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 mb-4 flex items-center gap-2 text-sm text-green-700">
          <span>✅</span>
          <span>
            Se enviaron <strong>{sentCount}</strong> solicitud{sentCount !== 1 ? 'es' : ''} de relevo abierto.
            Los hermanos compatibles podrán aceptar desde la campana 🔔.
          </span>
        </div>
      )}

      {/* ── Modal de selección + confirmación ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">

            {/* Encabezado */}
            <div className="flex justify-between items-center px-5 py-4 border-b">
              <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                🔄 Pedir Relevo
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-4">

              {step === 'select' && (
                <>
                  <p className="text-sm text-gray-600 mb-3">
                    Selecciona los turnos para los que quieres pedir relevo.
                    Se avisará a todos los hermanos compatibles.
                  </p>

                  {/* Lista de reservas con checkboxes */}
                  <div className="space-y-2 mb-4">
                    {reservations.map(res => {
                      const isChecked  = selected.has(res.id)
                      const isPending  = res.hasPendingRelief
                      const dayLabel   = res.slot ? DAYS_OF_WEEK[res.slot.day_of_week] : '—'
                      const timeLabel  = res.slot
                        ? formatTimeLabel(res.slot.start_time, res.slot.end_time)
                        : '—'

                      return (
                        <label
                          key={res.id}
                          className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                            isPending
                              ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                              : isChecked
                              ? 'bg-amber-50 border-amber-300'
                              : 'bg-white border-gray-200 hover:border-amber-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked && !isPending}
                            disabled={isPending}
                            onChange={() => !isPending && toggleSelected(res.id)}
                            className="mt-0.5 accent-amber-500 w-4 h-4 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">
                              {dayLabel}
                            </p>
                            <p className="text-xs text-gray-500">{timeLabel}</p>
                            {isPending && (
                              <span className="text-[10px] text-amber-600 font-medium">
                                ⏳ Relevo ya solicitado
                              </span>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>

                  {/* Botones del paso de selección */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowModal(false)}
                      className="flex-1 py-2 text-sm rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => setStep('confirm')}
                      disabled={selected.size === 0}
                      className="flex-1 py-2 text-sm rounded-xl bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition font-medium"
                    >
                      Continuar ({selected.size})
                    </button>
                  </div>
                </>
              )}

              {step === 'confirm' && (
                <>
                  <p className="text-sm text-gray-700 mb-3">
                    ¿Confirmas pedir relevo para los siguientes turnos?
                    Todos los hermanos del mismo género con cupo disponible serán notificados.
                  </p>

                  {/* Resumen de los turnos seleccionados */}
                  <ul className="space-y-1 text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                    {reservations
                      .filter(r => selected.has(r.id))
                      .map(res => (
                        <li key={res.id} className="flex items-center gap-1.5">
                          <span className="text-amber-500">🔄</span>
                          <span>
                            <strong>
                              {res.slot ? DAYS_OF_WEEK[res.slot.day_of_week] : '—'}
                            </strong>
                            &nbsp;·&nbsp;
                            {res.slot
                              ? formatTimeLabel(res.slot.start_time, res.slot.end_time)
                              : '—'}
                          </span>
                        </li>
                      ))}
                  </ul>

                  <p className="text-xs text-gray-400 mb-4 text-center">
                    Las solicitudes de relevo expiran al inicio de cada turno o en 24 horas.
                  </p>

                  {/* Botones del paso de confirmación */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStep('select')}
                      disabled={sending}
                      className="flex-1 py-2 text-sm rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                      ← Atrás
                    </button>
                    <button
                      onClick={handleConfirm}
                      disabled={sending}
                      className="flex-1 py-2 text-sm rounded-xl bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition font-medium"
                    >
                      {sending ? '...' : '✅ Confirmar'}
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  )
}
