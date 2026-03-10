/**
 * components/WeekHistoryPanel.tsx — Fase 8: Historial de Semanas
 * ─────────────────────────────────────────────────────────────
 * Muestra el historial de semanas pasadas de forma read-only.
 *
 * Funcionalidades:
 *   1. Selector de semana (últimas 12 semanas)
 *   2. Grid por exhibidor → por día → personas asignadas
 *      Los turnos propios del usuario se resaltan en índigo.
 *   3. Estadísticas personales: total de turnos en las últimas 12 semanas.
 *
 * No hay acciones de reserva: solo lectura.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import { DAYS_OF_WEEK, formatTimeLabel } from '@/types'
import type { Exhibitor, TimeSlot, Reservation } from '@/types'

// ─── Tipos locales ───────────────────────────────────────────

type ReliefRow = {
  id: string
  reservation_id: string
  from_user_id: string
  acceptor_id: string | null
  status: string
  acceptor:  { name: string } | { name: string }[] | null
  from_user: { name: string } | { name: string }[] | null
}

function getRelName(field: { name: string } | { name: string }[] | null): string | null {
  if (!field) return null
  return Array.isArray(field) ? (field[0]?.name ?? null) : field.name
}

// ─── Helpers de fecha ────────────────────────────────────────

/** Devuelve el lunes de hace `offsetWeeks` semanas (formato 'YYYY-MM-DD'). */
function getWeekStartOffset(offsetWeeks: number): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now)
  monday.setDate(diff - offsetWeeks * 7)
  return monday.toISOString().split('T')[0]
}

/** Formatea un rango de semana para mostrarlo al usuario. */
function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T12:00:00')
  const end   = new Date(weekStart + 'T12:00:00')
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

/** Genera las últimas N semanas anteriores a `activeWeekStart`. */
const HISTORY_WEEKS = 12
function buildPastWeeks(activeWeekStart: string): { label: string; value: string }[] {
  const active = new Date(activeWeekStart + 'T12:00:00')
  return Array.from({ length: HISTORY_WEEKS }, (_, i) => {
    const d = new Date(active)
    d.setDate(d.getDate() - (i + 1) * 7)
    const val = d.toISOString().split('T')[0]
    return { value: val, label: formatWeekLabel(val) }
  })
}

// ─── Componente ──────────────────────────────────────────────

export default function WeekHistoryPanel() {
  const { user } = useUser()
  const supabase  = createClient()
  const congregationId = user?.congregation_id ?? ''

  const [pastWeeks,         setPastWeeks]          = useState<{ label: string; value: string }[]>([])
  const [selectedWeek,      setSelectedWeek]      = useState('')
  const [exhibitors,        setExhibitors]         = useState<Exhibitor[]>([])
  const [selectedExhibitor, setSelectedExhibitor]  = useState<string | null>(null)
  const [timeSlots,         setTimeSlots]          = useState<TimeSlot[]>([])
  const [reservations,      setReservations]       = useState<Reservation[]>([])
  const [myStats,           setMyStats]            = useState<{ week: string; label: string; count: number }[]>([])
  const [myReliefs,         setMyReliefs]          = useState<ReliefRow[]>([])
  const [loading,           setLoading]            = useState(true)

  // ─── Cargar semana activa → construir lista de historial ─
  useEffect(() => {
    if (!congregationId) return
    supabase
      .from('app_config')
      .select('active_week_start')
      .eq('congregation_id', congregationId)
      .limit(1)
      .single()
      .then(({ data }) => {
        const activeWeek = data?.active_week_start ?? getWeekStartOffset(0)
        const weeks = buildPastWeeks(activeWeek)
        setPastWeeks(weeks)
        setSelectedWeek(weeks[0]?.value ?? '')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congregationId])

  // ─── Carga datos de la semana seleccionada ───────────────
  const loadData = useCallback(async () => {
    if (!selectedWeek || !user || !congregationId) return
    setLoading(true)

    const [exhibRes, slotRes, resRes, reliefRes] = await Promise.all([
      supabase.from('exhibitors').select('*').eq('congregation_id', congregationId).order('name'),
      supabase.from('time_slots').select('*').eq('congregation_id', congregationId),
      supabase
        .from('reservations')
        .select('*, user:users(id, name)')
        .eq('week_start', selectedWeek)
        .eq('congregation_id', congregationId)
        .neq('status', 'cancelled'),
      supabase
        .from('relief_requests')
        .select('id, reservation_id, from_user_id, acceptor_id, status, acceptor:users!acceptor_id(name), from_user:users!from_user_id(name)')
        .eq('week_start', selectedWeek)
        .eq('congregation_id', congregationId)
        .or(`from_user_id.eq.${user.id},acceptor_id.eq.${user.id}`),
    ])

    if (exhibRes.data) {
      setExhibitors(exhibRes.data)
      setSelectedExhibitor(prev =>
        prev && exhibRes.data.some(e => e.id === prev) ? prev : (exhibRes.data[0]?.id ?? null)
      )
    }
    if (slotRes.data) setTimeSlots(slotRes.data)
    if (resRes.data)  setReservations(resRes.data as Reservation[])
    if (reliefRes.data) setMyReliefs(reliefRes.data as unknown as ReliefRow[])

    // Estadísticas: cuántos turnos tuve en cada semana del historial
    const weekValues = pastWeeks.map(w => w.value)
    const { data: statsData } = await supabase
      .from('reservations')
      .select('week_start')
      .eq('user_id', user.id)
      .in('week_start', weekValues)
      .eq('congregation_id', congregationId)
      .neq('status', 'cancelled')

    if (statsData) {
      const counts = new Map<string, number>()
      statsData.forEach(r => counts.set(r.week_start, (counts.get(r.week_start) ?? 0) + 1))
      setMyStats(pastWeeks.map(w => ({
        week:  w.value,
        label: w.label,
        count: counts.get(w.value) ?? 0,
      })))
    }

    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek, user?.id, congregationId, pastWeeks])

  useEffect(() => { loadData() }, [loadData])

  // ─── Derivados ───────────────────────────────────────────

  /** Exhibidores visibles: activos siempre + eliminados solo si tienen datos esta semana. */
  const exhibitorsToShow = exhibitors.filter(ex => {
    if (!ex.deleted_at) return true
    return reservations.some(r => {
      const slot = timeSlots.find(s => s.id === r.time_slot_id)
      return slot?.exhibitor_id === ex.id
    })
  })

  /** Mis turnos en la semana seleccionada con compañero/a y relevo. */
  const myWeekTurns = !user ? [] : reservations
    .filter(r => r.user_id === user.id)
    .map(r => {
      const slot = timeSlots.find(s => s.id === r.time_slot_id)
      const ex   = exhibitors.find(e => e.id === slot?.exhibitor_id)
      const comp = reservations.find(c => c.time_slot_id === r.time_slot_id && c.user_id !== user.id)
      const rel  = myReliefs.find(rel => rel.reservation_id === r.id && rel.status === 'accepted')
      return {
        id:            r.id,
        exhibitorName: ex?.name ?? '—',
        day:           slot?.day_of_week ?? 0,
        timeLabel:     slot ? formatTimeLabel(slot.start_time, slot.end_time) : '',
        companion:     (comp?.user as { name: string } | undefined)?.name ?? null,
        relievedBy:    rel ? getRelName(rel.acceptor) : null,
      }
    })
    .sort((a, b) => a.day - b.day || a.timeLabel.localeCompare(b.timeLabel))

  /** Relevos que acepté esta semana (cubrí el turno de otro). */
  const acceptedByMe = myReliefs.filter(r => r.acceptor_id === user?.id && r.status === 'accepted')

  /** Slots del exhibidor seleccionado, agrupados por día. */
  const slotsByDay: Map<number, TimeSlot[]> = new Map()
  timeSlots
    .filter(s => s.exhibitor_id === selectedExhibitor && s.is_active)
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
    .forEach(s => {
      if (!slotsByDay.has(s.day_of_week)) slotsByDay.set(s.day_of_week, [])
      slotsByDay.get(s.day_of_week)!.push(s)
    })

  const days = [...slotsByDay.keys()].sort()

  const getSlotRes = (slotId: string) =>
    reservations
      .filter(r => r.time_slot_id === slotId)
      .sort((a, b) => a.slot_position - b.slot_position)

  const totalMyTurns = myStats.reduce((s, w) => s + w.count, 0)
  const weeksWithTurns = myStats.filter(w => w.count > 0)

  if (!pastWeeks.length) {
    return (
      <p className="text-center py-12 text-gray-400">No hay semanas anteriores disponibles.</p>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Selector de semana ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-gray-700">📅 Semana:</span>
        <select
          value={selectedWeek}
          onChange={e => setSelectedWeek(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
        >
          {pastWeeks.map(w => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
      </div>

      {/* ── Tabs de exhibidores ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-100 bg-gray-50">
          {exhibitorsToShow.map(ex => (
            <button
              key={ex.id}
              onClick={() => setSelectedExhibitor(ex.id)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                selectedExhibitor === ex.id
                  ? 'border-indigo-600 text-indigo-700 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {ex.name}
              {ex.deleted_at && (
                <span className="ml-1.5 text-[9px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full font-medium align-middle">
                  eliminado
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Grid de días/turnos ── */}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-500" />
          </div>
        ) : days.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">Sin turnos configurados para este exhibidor.</p>
        ) : (
          <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {days.map(dow => (
              <div key={dow} className="border border-gray-100 rounded-lg overflow-hidden">
                {/* Cabecera del día */}
                <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    {DAYS_OF_WEEK[dow]}
                  </span>
                </div>
                {/* Slots del día */}
                <div className="divide-y divide-gray-50">
                  {slotsByDay.get(dow)!.map(slot => {
                    const slotRes = getSlotRes(slot.id)
                    const hasMyRes = slotRes.some(r => r.user_id === user?.id)
                    return (
                      <div
                        key={slot.id}
                        className={`px-3 py-2 ${hasMyRes ? 'bg-indigo-50/70' : ''}`}
                      >
                        {/* Horario */}
                        <p className="text-[10px] text-gray-400 mb-1">
                          {formatTimeLabel(slot.start_time, slot.end_time)}
                          {hasMyRes && (
                            <span className="ml-1.5 text-indigo-500 font-semibold">● yo</span>
                          )}
                        </p>
                        {/* Personas */}
                        {slotRes.length === 0 ? (
                          <p className="text-xs text-gray-300 italic">— vacío —</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {slotRes.map(r => {
                              const isMe  = r.user_id === user?.id
                              const relief = isMe
                                ? myReliefs.find(rel => rel.reservation_id === r.id && rel.status === 'accepted')
                                : null
                              const slotCompanion = slotRes.find(c => c.user_id !== r.user_id)
                              const companionName = isMe && slotCompanion
                                ? (slotCompanion.user as { name: string } | undefined)?.name ?? null
                                : null
                              return (
                                <div key={r.id} className="flex flex-col gap-0.5">
                                  <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${
                                    isMe
                                      ? 'bg-indigo-100 text-indigo-700 font-semibold'
                                      : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {(r.user as { name: string } | undefined)?.name ?? 'Desconocido'}
                                    {isMe && companionName && (
                                      <span className="ml-1 font-normal text-indigo-400">· con {companionName}</span>
                                    )}
                                  </span>
                                  {relief && (
                                    <span className="text-[9px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full w-fit">
                                      🔄 relevado por {getRelName(relief.acceptor) ?? '?'}
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Mis estadísticas ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="font-semibold text-gray-700 text-sm mb-3">
          📊 Mis turnos — últimas {HISTORY_WEEKS} semanas
        </h3>
        <p className="text-3xl font-bold text-indigo-600 mb-3">
          {totalMyTurns}
          <span className="text-sm font-normal text-gray-400 ml-1">turnos totales</span>
        </p>
        {weeksWithTurns.length === 0 ? (
          <p className="text-sm text-gray-400">No tienes turnos registrados en este período.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {weeksWithTurns.map(w => (
              <button
                key={w.week}
                onClick={() => setSelectedWeek(w.week)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  w.week === selectedWeek
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                }`}
              >
                {w.label}: <strong>{w.count}</strong>
              </button>
            ))}
          </div>
        )}

        {/* ── Detalle de mis turnos en la semana visualizada ── */}
        {myWeekTurns.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">Semana seleccionada — tus turnos:</p>
            <div className="space-y-2">
              {myWeekTurns.map(t => (
                <div key={t.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-gray-700">{t.exhibitorName}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-600">{DAYS_OF_WEEK[t.day]}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-500">{t.timeLabel}</span>
                  {t.companion && (
                    <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
                      con {t.companion}
                    </span>
                  )}
                  {t.relievedBy && (
                    <span className="bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded-full">
                      🔄 relevado por {t.relievedBy}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Relevos aceptados esta semana ── */}
        {acceptedByMe.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">Relevos que cubriste esta semana:</p>
            <div className="flex flex-wrap gap-2">
              {acceptedByMe.map(r => (
                <span key={r.id} className="text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full border border-teal-100">
                  ✔️ Relevaste a {getRelName(r.from_user) ?? '?'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
