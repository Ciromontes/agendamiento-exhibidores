/**
 * components/AdminWeekReport.tsx — Fase 8: Reporte Semanal para Admin
 * ─────────────────────────────────────────────────────────────
 * Muestra el horario completo de cualquier semana (actual o pasadas).
 *
 * Funcionalidades:
 *   1. Navegador de semanas: semana actual + historial
 *   2. Tabla por exhibidor: turnos × día — quién está asignado
 *   3. Slots vacíos resaltados en naranja (huecos sin cubrir)
 *   4. Botón de impresión: genera vista limpia para PDF/papel
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DAYS_OF_WEEK, formatTimeLabel } from '@/types'
import type { Exhibitor, TimeSlot, Reservation } from '@/types'
import { useUser } from '@/context/UserContext'

// ─── Helpers de fecha ────────────────────────────────────────

function getWeekStartOffset(offsetWeeks: number): string {
  const now = new Date()
  const day  = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now)
  monday.setDate(diff - offsetWeeks * 7)
  return monday.toISOString().split('T')[0]
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart + 'T12:00:00')
  const end   = new Date(weekStart + 'T12:00:00')
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

// Número máximo de semanas hacia el pasado disponibles
const MAX_PAST_WEEKS = 16

// ─── Componente principal ─────────────────────────────────────

export default function AdminWeekReport() {
  const supabase = createClient()
  const { user } = useUser()
  const congregationId = user?.congregation_id ?? ''

  // offset 0 = semana actual, 1 = semana anterior, etc.
  const [offset,     setOffset]     = useState(0)
  const [exhibitors, setExhibitors] = useState<Exhibitor[]>([])
  const [timeSlots,  setTimeSlots]  = useState<TimeSlot[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading,    setLoading]    = useState(true)

  const weekStart = getWeekStartOffset(offset)
  const weekLabel = formatWeekLabel(weekStart)

  // ─── Carga de datos ──────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    const [exhibRes, slotRes, resRes] = await Promise.all([
      supabase.from('exhibitors').select('*').eq('is_active', true).eq('congregation_id', congregationId).order('name'),
      supabase.from('time_slots').select('*').eq('is_active', true).eq('congregation_id', congregationId),
      supabase
        .from('reservations')
        .select('*, user:users(id, name)')
        .eq('week_start', weekStart)
        .neq('status', 'cancelled'),
    ])

    if (exhibRes.data) setExhibitors(exhibRes.data)
    if (slotRes.data)  setTimeSlots(slotRes.data)
    if (resRes.data)   setReservations(resRes.data as Reservation[])

    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => { loadData() }, [loadData])

  // ─── Derivados ───────────────────────────────────────────

  const getExhibitorSlots = (exhibitorId: string): TimeSlot[] =>
    timeSlots
      .filter(s => s.exhibitor_id === exhibitorId)
      .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))

  const getSlotRes = (slotId: string): Reservation[] =>
    reservations
      .filter(r => r.time_slot_id === slotId)
      .sort((a, b) => a.slot_position - b.slot_position)

  // Total de slots / slots vacíos para el resumen
  const totalSlots = timeSlots.length
  const emptySlots = timeSlots.filter(s => getSlotRes(s.id).length === 0).length
  const isCurrentWeek = offset === 0

  return (
    <div className="space-y-4">

      {/* ── Barra de navegación + acciones ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {/* Navegador de semanas */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset(o => Math.min(o + 1, MAX_PAST_WEEKS))}
            disabled={offset >= MAX_PAST_WEEKS}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition"
            title="Semana anterior"
          >
            ‹
          </button>
          <div className="text-center min-w-[200px]">
            <p className="text-sm font-semibold text-gray-800">{weekLabel}</p>
            {isCurrentWeek && (
              <p className="text-[10px] text-indigo-500 font-medium">Semana en curso</p>
            )}
          </div>
          <button
            onClick={() => setOffset(o => Math.max(o - 1, 0))}
            disabled={offset === 0}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition"
            title="Semana siguiente"
          >
            ›
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Resumen rápido */}
          {!loading && (
            <div className="flex gap-2 text-xs">
              <span className="bg-green-50 text-green-700 px-2.5 py-1 rounded-full border border-green-100">
                ✅ {totalSlots - emptySlots} cubiertos
              </span>
              {emptySlots > 0 && (
                <span className="bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full border border-orange-100">
                  ⚠️ {emptySlots} vacíos
                </span>
              )}
            </div>
          )}
          {/* Botón imprimir */}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition"
          >
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* ── Encabezado solo para impresión ── */}
      <div className="hidden print:block mb-4">
        <h1 className="text-xl font-bold">Horario de Exhibidores</h1>
        <p className="text-gray-600 text-sm">{weekLabel}</p>
      </div>

      {/* ── Contenido ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        </div>
      ) : (
        <div className="space-y-5 print:space-y-4">
          {exhibitors.map(exhibitor => {
            const slots = getExhibitorSlots(exhibitor.id)
            if (slots.length === 0) return null

            // Agrupar por día
            const slotsByDay = new Map<number, TimeSlot[]>()
            slots.forEach(s => {
              if (!slotsByDay.has(s.day_of_week)) slotsByDay.set(s.day_of_week, [])
              slotsByDay.get(s.day_of_week)!.push(s)
            })
            const days = [...slotsByDay.keys()].sort()

            return (
              <div
                key={exhibitor.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:border print:border-gray-300 print:rounded-none print:shadow-none print:break-inside-avoid"
              >
                {/* Cabecera del exhibidor */}
                <div className="bg-indigo-700 px-4 py-2.5 print:bg-gray-800">
                  <h2 className="font-semibold text-white text-sm">{exhibitor.name}</h2>
                </div>

                {/* Tabla de días */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-28">
                          Horario
                        </th>
                        {days.map(dow => (
                          <th
                            key={dow}
                            className="text-center px-3 py-2 text-xs font-medium text-gray-600 min-w-[120px]"
                          >
                            {DAYS_OF_WEEK[dow]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Una fila por bloque de horario (mismo start_time en todos los días) */}
                      {/* Obtenemos los horarios únicos del exhibidor */}
                      {[...new Set(slots.map(s => `${s.start_time}|${s.end_time}`))].sort().map(timeKey => {
                        const [st, et] = timeKey.split('|')
                        return (
                          <tr key={timeKey} className="border-b border-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                              {formatTimeLabel(st, et)}
                            </td>
                            {days.map(dow => {
                              const slot = slotsByDay.get(dow)?.find(
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
                                    isEmpty
                                      ? 'bg-orange-50 print:bg-orange-50'
                                      : 'bg-green-50/40'
                                  }`}
                                >
                                  {isEmpty ? (
                                    <span className="text-[11px] text-orange-500 font-medium">
                                      ⚡ Sin asignar
                                    </span>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {slotRes.map(r => (
                                        <div
                                          key={r.id}
                                          className="text-[11px] text-gray-700 leading-tight"
                                        >
                                          {(r.user as { name: string } | undefined)?.name ?? '—'}
                                        </div>
                                      ))}
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
