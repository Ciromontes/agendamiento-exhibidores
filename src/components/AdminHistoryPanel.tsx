/**
 * components/AdminHistoryPanel.tsx — Historial Global de Semanas (Admin)
 * ─────────────────────────────────────────────────────────────
 * Dos sub-pestañas:
 *
 *   "Global"   → Selector de semana + grilla completa por exhibidor.
 *                Muestra todos los turnos asignados, vacíos e indicadores
 *                de relevo para la semana seleccionada.
 *
 *   "Por usuario" → Selector de usuario + tabla de sus turnos en las
 *                   últimas 12 semanas: día, exhibidor, horario, compañero/a
 *                   de turno, si pidió relevo o lo aceptó.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import { DAYS_OF_WEEK, formatTimeLabel } from '@/types'
import type { Exhibitor, TimeSlot, Reservation, User } from '@/types'

// ─── Tipos locales ────────────────────────────────────────────

type ResWithUser = Reservation & {
  user: Pick<User, 'id' | 'name' | 'gender'> | null
}

type ReliefRow = {
  reservation_id: string
  status: 'pending' | 'accepted' | 'cancelled'
  from_user_id: string
  acceptor_id: string | null
  from_user: { name: string } | null
  acceptor:  { name: string } | null
}

type UserTurn = {
  week_start: string
  weekLabel:  string
  exhibitorName: string
  day: number
  start_time: string
  end_time: string
  companion: string | null   // nombre del otro ocupante del slot
  relievedBy: string | null  // quien aceptó el relevo de este usuario
  acceptedRelief: string | null // a quien relevó este usuario
}

// ─── Helpers de fecha ─────────────────────────────────────────

function getMondayOfDate(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.toISOString().split('T')[0]
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T12:00:00')
  const end   = new Date(weekStart + 'T12:00:00')
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

const HISTORY_WEEKS = 12

/** Genera la lista de semanas pasadas relativa a active_week_start. */
function buildPastWeeks(activeWeekStart: string): { value: string; label: string }[] {
  const active = new Date(activeWeekStart + 'T12:00:00')
  return Array.from({ length: HISTORY_WEEKS }, (_, i) => {
    const d = new Date(active)
    d.setDate(d.getDate() - (i + 1) * 7)
    const val = d.toISOString().split('T')[0]
    return { value: val, label: formatWeekLabel(val) }
  })
}

// ─── Componente principal ─────────────────────────────────────

type SubTab = 'global' | 'usuario'

export default function AdminHistoryPanel() {
  const { user } = useUser()
  const supabase  = createClient()
  const congregationId = user?.congregation_id ?? ''

  const [subTab,     setSubTab]     = useState<SubTab>('global')
  const [pastWeeks,  setPastWeeks]  = useState<{ value: string; label: string }[]>([])

  // Cargar active_week_start al montar
  useEffect(() => {
    if (!congregationId) return
    supabase
      .from('app_config')
      .select('active_week_start')
      .eq('congregation_id', congregationId)
      .limit(1)
      .single()
      .then(({ data }) => {
        const aw = data?.active_week_start ?? getMondayOfDate(new Date())
        setPastWeeks(buildPastWeeks(aw))
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congregationId])

  if (!pastWeeks.length) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Sub-pestañas */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setSubTab('global')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            subTab === 'global'
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          🗓️ Global por semana
        </button>
        <button
          onClick={() => setSubTab('usuario')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            subTab === 'usuario'
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          👤 Por usuario
        </button>
      </div>

      {subTab === 'global' ? (
        <GlobalHistoryView
          pastWeeks={pastWeeks}
          congregationId={congregationId}
        />
      ) : (
        <UserHistoryView
          pastWeeks={pastWeeks}
          congregationId={congregationId}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// SUB-VISTA A: Global por semana
// ══════════════════════════════════════════════════════════════

function GlobalHistoryView({
  pastWeeks,
  congregationId,
}: {
  pastWeeks: { value: string; label: string }[]
  congregationId: string
}) {
  const supabase = createClient()

  const [weekIdx,      setWeekIdx]      = useState(0) // 0 = semana más reciente
  const [exhibitors,   setExhibitors]   = useState<Exhibitor[]>([])
  const [timeSlots,    setTimeSlots]    = useState<TimeSlot[]>([])
  const [reservations, setReservations] = useState<ResWithUser[]>([])
  const [reliefs,      setReliefs]      = useState<ReliefRow[]>([])
  const [loading,      setLoading]      = useState(true)

  const selectedWeek = pastWeeks[weekIdx]?.value ?? ''
  const weekLabel    = pastWeeks[weekIdx]?.label ?? ''

  const loadData = useCallback(async () => {
    if (!selectedWeek || !congregationId) return
    setLoading(true)

    const [exhibRes, slotRes, resRes, reliefRes] = await Promise.all([
      supabase
        .from('exhibitors')
        .select('*')
        .eq('congregation_id', congregationId)
        .order('name'),
      supabase
        .from('time_slots')
        .select('*')
        .eq('congregation_id', congregationId)
        .eq('is_active', true),
      supabase
        .from('reservations')
        .select('*, user:users(id, name, gender)')
        .eq('week_start', selectedWeek)
        .eq('congregation_id', congregationId)
        .neq('status', 'cancelled'),
      supabase
        .from('relief_requests')
        .select('reservation_id, status, from_user_id, acceptor_id, from_user:users!from_user_id(name), acceptor:users!acceptor_id(name)')
        .eq('week_start', selectedWeek)
        .eq('congregation_id', congregationId),
    ])

    if (exhibRes.data) setExhibitors(exhibRes.data)
    if (slotRes.data)  setTimeSlots(slotRes.data)
    if (resRes.data)   setReservations(resRes.data as ResWithUser[])
    if (reliefRes.data) setReliefs(reliefRes.data as unknown as ReliefRow[])

    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek, congregationId])

  useEffect(() => { loadData() }, [loadData])

  // Helpers
  const getSlotsForExhibitor = (exhibitorId: string) =>
    timeSlots
      .filter(s => s.exhibitor_id === exhibitorId)
      .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))

  const getSlotRes = (slotId: string) =>
    reservations
      .filter(r => r.time_slot_id === slotId)
      .sort((a, b) => a.slot_position - b.slot_position)

  const getReliefForReservation = (resId: string) =>
    reliefs.find(r => r.reservation_id === resId)

  // Totales para la barra resumen
  const activeSlots   = timeSlots.length
  const coveredSlots  = timeSlots.filter(s => getSlotRes(s.id).length > 0).length
  const emptySlots    = activeSlots - coveredSlots
  const totalPeople   = reservations.length
  const totalReliefs  = reliefs.filter(r => r.status === 'accepted').length

  // Exhibidores que tienen al menos 1 slot con al menos 1 reserva
  const exhibidoresConDatos = exhibitors.filter(ex =>
    getSlotsForExhibitor(ex.id).some(s => getSlotRes(s.id).length > 0)
  )

  return (
    <div className="space-y-4">
      {/* Barra de navegación */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekIdx(i => Math.min(i + 1, pastWeeks.length - 1))}
            disabled={weekIdx >= pastWeeks.length - 1}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition"
            title="Semana anterior"
          >‹</button>
          <div className="text-center min-w-[200px]">
            <p className="text-sm font-semibold text-gray-800">{weekLabel}</p>
            {weekIdx === 0 && (
              <p className="text-[10px] text-indigo-500 font-medium">Semana más reciente</p>
            )}
          </div>
          <button
            onClick={() => setWeekIdx(i => Math.max(i - 1, 0))}
            disabled={weekIdx === 0}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition"
            title="Semana siguiente"
          >›</button>
        </div>

        {/* Selector rápido por dropdown */}
        <select
          value={weekIdx}
          onChange={e => setWeekIdx(Number(e.target.value))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
        >
          {pastWeeks.map((w, i) => (
            <option key={w.value} value={i}>{w.label}</option>
          ))}
        </select>

        {/* Resumen rápido */}
        {!loading && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="bg-green-50 text-green-700 px-2.5 py-1 rounded-full border border-green-100">
              ✅ {coveredSlots} cubiertos
            </span>
            {emptySlots > 0 && (
              <span className="bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full border border-orange-100">
                ⚡ {emptySlots} vacíos
              </span>
            )}
            <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">
              👥 {totalPeople} asignados
            </span>
            {totalReliefs > 0 && (
              <span className="bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full border border-purple-100">
                🔄 {totalReliefs} relevos
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition print:hidden"
        >
          🖨️ Imprimir
        </button>
      </div>

      {/* Contenido */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        </div>
      ) : exhibidoresConDatos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">No hay reservas registradas para esta semana.</p>
        </div>
      ) : (
        <div className="space-y-5 print:space-y-4">
          {exhibitors.map(exhibitor => {
            const slots = getSlotsForExhibitor(exhibitor.id)
            if (slots.length === 0) return null

            // Agrupar por día
            const byDay = new Map<number, TimeSlot[]>()
            slots.forEach(s => {
              if (!byDay.has(s.day_of_week)) byDay.set(s.day_of_week, [])
              byDay.get(s.day_of_week)!.push(s)
            })
            const days = [...byDay.keys()].sort()

            // Verificar si este exhibidor tiene alguna reserva esta semana
            const hasAnyRes = slots.some(s => getSlotRes(s.id).length > 0)
            if (!hasAnyRes) return null

            return (
              <div
                key={exhibitor.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:border print:border-gray-300 print:rounded-none print:shadow-none print:break-inside-avoid"
              >
                <div className="bg-indigo-700 px-4 py-2.5 print:bg-gray-800 flex items-center justify-between">
                  <h2 className="font-semibold text-white text-sm">{exhibitor.name}</h2>
                  {exhibitor.deleted_at && (
                    <span className="text-[10px] bg-red-500/40 text-red-100 px-2 py-0.5 rounded-full">
                      eliminado
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-32">Horario</th>
                        {days.map(dow => (
                          <th key={dow} className="text-center px-3 py-2 text-xs font-medium text-gray-600 min-w-[130px]">
                            {DAYS_OF_WEEK[dow]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...new Set(slots.map(s => `${s.start_time}|${s.end_time}`))].sort().map(timeKey => {
                        const [st, et] = timeKey.split('|')
                        return (
                          <tr key={timeKey} className="border-b border-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                              {formatTimeLabel(st, et)}
                            </td>
                            {days.map(dow => {
                              const slot = byDay.get(dow)?.find(
                                s => s.start_time === st && s.end_time === et
                              )
                              if (!slot) {
                                return <td key={dow} className="px-3 py-2 text-center text-gray-200 text-xs">—</td>
                              }
                              const slotRes = getSlotRes(slot.id)
                              const isEmpty = slotRes.length === 0
                              return (
                                <td
                                  key={dow}
                                  className={`px-3 py-2 text-center ${
                                    isEmpty ? 'bg-orange-50' : 'bg-green-50/40'
                                  }`}
                                >
                                  {isEmpty ? (
                                    <span className="text-[11px] text-orange-400">— vacío —</span>
                                  ) : (
                                    <div className="space-y-1">
                                      {slotRes.map(r => {
                                        const relief = getReliefForReservation(r.id)
                                        const relieved = relief?.status === 'accepted' && relief.acceptor_id
                                        return (
                                          <div key={r.id} className="flex flex-col items-center gap-0.5">
                                            <span className="text-[11px] text-gray-700 leading-tight font-medium">
                                              {r.user?.name ?? '—'}
                                            </span>
                                            {relieved && (
                                              <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                                🔄 relevado por {relief.acceptor?.name ?? '?'}
                                              </span>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// SUB-VISTA B: Por usuario
// ══════════════════════════════════════════════════════════════

function UserHistoryView({
  pastWeeks,
  congregationId,
}: {
  pastWeeks: { value: string; label: string }[]
  congregationId: string
}) {
  const supabase = createClient()

  const [users,         setUsers]         = useState<Pick<User, 'id' | 'name' | 'user_type'>[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [turns,         setTurns]         = useState<UserTurn[]>([])
  const [loading,       setLoading]       = useState(false)
  const [usersLoading,  setUsersLoading]  = useState(true)

  // Cargar lista de usuarios activos
  useEffect(() => {
    if (!congregationId) return
    supabase
      .from('users')
      .select('id, name, user_type')
      .eq('congregation_id', congregationId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) {
          setUsers(data)
          setSelectedUserId(data[0]?.id ?? '')
        }
        setUsersLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congregationId])

  const loadUserHistory = useCallback(async () => {
    if (!selectedUserId || !congregationId || !pastWeeks.length) return
    setLoading(true)

    const weekValues = pastWeeks.map(w => w.value)

    // Reservas del usuario en las semanas del historial
    const { data: resData } = await supabase
      .from('reservations')
      .select('id, week_start, time_slot_id, slot_position, time_slot:time_slots(day_of_week, start_time, end_time, exhibitor_id)')
      .eq('user_id', selectedUserId)
      .eq('congregation_id', congregationId)
      .in('week_start', weekValues)
      .neq('status', 'cancelled')

    if (!resData || resData.length === 0) {
      setTurns([])
      setLoading(false)
      return
    }

    // IDs de todos los slots usados
    const slotIds   = [...new Set(resData.map(r => r.time_slot_id))]
    const resIds    = resData.map(r => r.id)
    const exhibIds  = [...new Set(
      resData.map(r => (r.time_slot as unknown as TimeSlot | null)?.exhibitor_id).filter(Boolean) as string[]
    )]

    // Cargar datos en paralelo: compañeros de slot + exhibidores + relevos
    const [compRes, exhibRes, reliefFromRes, reliefAcceptRes] = await Promise.all([
      // Compañeros: reservas del MISMO slot+semana pero de OTRO usuario
      supabase
        .from('reservations')
        .select('time_slot_id, week_start, user:users(name)')
        .in('time_slot_id', slotIds)
        .in('week_start', weekValues)
        .neq('user_id', selectedUserId)
        .neq('status', 'cancelled'),
      // Exhibidores
      supabase
        .from('exhibitors')
        .select('id, name')
        .in('id', exhibIds),
      // Relevos PEDIDOS por este usuario (from_user)
      supabase
        .from('relief_requests')
        .select('reservation_id, status, acceptor_id, acceptor:users!acceptor_id(name)')
        .in('reservation_id', resIds)
        .eq('status', 'accepted'),
      // Relevos ACEPTADOS POR este usuario (acceptor)
      supabase
        .from('relief_requests')
        .select('reservation_id, week_start, from_user:users!from_user_id(name), acceptor_id')
        .eq('acceptor_id', selectedUserId)
        .in('week_start', weekValues)
        .eq('status', 'accepted'),
    ])

    // Mapas de lookup
    const exhibitorMap = new Map<string, string>(
      (exhibRes.data ?? []).map(e => [e.id, e.name])
    )

    type CompRow = { time_slot_id: string; week_start: string; user: { name: string } | { name: string }[] | null }
    type FromRow = { reservation_id: string; acceptor: { name: string } | { name: string }[] | null }
    type AccRow  = { week_start: string; from_user: { name: string } | { name: string }[] | null }

    const getName = (field: { name: string } | { name: string }[] | null): string | null => {
      if (!field) return null
      return Array.isArray(field) ? (field[0]?.name ?? null) : field.name
    }

    // Compañeros: { `${slotId}|${weekStart}` → nombre }
    const companionMap = new Map<string, string>()
    const compData = (compRes.data ?? []) as unknown as CompRow[]
    compData.forEach(cr => {
      const key  = `${cr.time_slot_id}|${cr.week_start}`
      const name = getName(cr.user)
      if (name) companionMap.set(key, name)
    })

    // Relevos pedidos: reservationId → nombre del aceptante
    const fromData = (reliefFromRes.data ?? []) as unknown as FromRow[]
    const relievedByMap = new Map<string, string>(
      fromData.map(r => [r.reservation_id, getName(r.acceptor) ?? '?'] as [string, string])
    )

    // Relevos aceptados: week_start → nombre del solicitante
    const acceptedReliefMap = new Map<string, string>()
    const acceptData = (reliefAcceptRes.data ?? []) as unknown as AccRow[]
    acceptData.forEach(r => {
      const name = getName(r.from_user)
      if (name) acceptedReliefMap.set(r.week_start, name)
    })

    // Construir lista de turnos
    const weekMap = new Map(pastWeeks.map(w => [w.value, w.label]))

    const built: UserTurn[] = resData.map(r => {
      const ts = r.time_slot as unknown as TimeSlot | null
      return {
        week_start:     r.week_start,
        weekLabel:      weekMap.get(r.week_start) ?? r.week_start,
        exhibitorName:  ts?.exhibitor_id ? (exhibitorMap.get(ts.exhibitor_id) ?? '—') : '—',
        day:            ts?.day_of_week ?? 0,
        start_time:     ts?.start_time ?? '',
        end_time:       ts?.end_time ?? '',
        companion:      companionMap.get(`${r.time_slot_id}|${r.week_start}`) ?? null,
        relievedBy:     relievedByMap.get(r.id) ?? null,
        acceptedRelief: acceptedReliefMap.get(r.week_start) ?? null,
      }
    })

    // Ordenar: semana más reciente primero, luego por día y hora
    built.sort((a, b) => {
      if (a.week_start !== b.week_start) return b.week_start.localeCompare(a.week_start)
      if (a.day !== b.day) return a.day - b.day
      return a.start_time.localeCompare(b.start_time)
    })

    setTurns(built)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, congregationId, pastWeeks])

  useEffect(() => {
    if (selectedUserId) loadUserHistory()
  }, [loadUserHistory, selectedUserId])

  // Estadísticas rápidas
  const totalTurns    = turns.length
  const weeksActives  = new Set(turns.map(t => t.week_start)).size
  const totalReliefs  = turns.filter(t => t.relievedBy).length
  const totalAccepted = turns.filter(t => t.acceptedRelief).length

  const selectedUser = users.find(u => u.id === selectedUserId)

  return (
    <div className="space-y-4">
      {/* Selector de usuario */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-gray-700">👤 Usuario:</span>
        {usersLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-400" />
        ) : (
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white flex-1 max-w-xs"
          >
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        {/* Estadísticas rápidas del usuario */}
        {!loading && selectedUser && (
          <div className="flex flex-wrap gap-2 text-xs ml-auto">
            <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">
              📋 {totalTurns} turnos
            </span>
            <span className="bg-green-50 text-green-700 px-2.5 py-1 rounded-full border border-green-100">
              📅 {weeksActives} semanas activas
            </span>
            {totalReliefs > 0 && (
              <span className="bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full border border-purple-100">
                🔄 {totalReliefs} relevos pedidos
              </span>
            )}
            {totalAccepted > 0 && (
              <span className="bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full border border-teal-100">
                ✔️ {totalAccepted} relevos aceptados
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabla de turnos */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        </div>
      ) : turns.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">Sin turnos registrados en las últimas {pastWeeks.length} semanas.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">Semana</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">Día</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">Exhibidor</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">Horario</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">Compañero/a</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">Relevo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {turns.map((t, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{t.weekLabel}</td>
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-700 whitespace-nowrap">
                      {DAYS_OF_WEEK[t.day]}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-700">{t.exhibitorName}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                      {t.start_time && t.end_time ? formatTimeLabel(t.start_time, t.end_time) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {t.companion ? (
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{t.companion}</span>
                      ) : (
                        <span className="text-gray-300 italic">solo/a</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {t.relievedBy ? (
                        <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                          🔄 relevado por {t.relievedBy}
                        </span>
                      ) : t.acceptedRelief ? (
                        <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                          ✔️ relevó a {t.acceptedRelief}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
