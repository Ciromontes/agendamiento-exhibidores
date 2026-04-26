/**
 * components/NotificationBell.tsx — Fase 9A: Campana de Notificaciones
 * ─────────────────────────────────────────────────────────────
 * Muestra en el header un ícono de campana con badge numérico.
 * El número suma:
 *   • Invitaciones pendientes recibidas (no expiradas)
 *   • Solicitudes de relevo recibidas/abiertas (no expiradas)
 *
 * Realtime: se suscribe a cambios en ambas tablas para actualizar
 * el badge instantáneamente sin polling.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'

interface Props {
  /** Callback para hacer scroll al panel de notificaciones */
  onBellClick?: () => void
}

export default function NotificationBell({ onBellClick }: Props) {
  const { user } = useUser()
  const supabase  = createClient()

  const [invitationCount, setInvitationCount] = useState(0)
  const [reliefCount,     setReliefCount]     = useState(0)

  const total = invitationCount + reliefCount

  // ─── Cargar conteos ──────────────────────────────────────
  const fetchCounts = useCallback(async () => {
    if (!user) return
    const nowIso = new Date().toISOString()

    // Invitaciones pendientes para mí
    const { count: invCount } = await supabase
      .from('invitations')
      .select('id', { count: 'exact', head: true })
      .eq('to_user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
    setInvitationCount(invCount ?? 0)

    // Relevos pendientes: dirigidos a mí o abiertos (no enviados por mí)
    const { data: reliefData } = await supabase
      .from('relief_requests')
      .select('id, slot_id, week_start, to_user_id, from_user_id')
      .neq('from_user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)

    type ReliefLite = {
      id: string
      slot_id: string
      week_start: string
      to_user_id: string | null
      from_user_id: string
    }
    const allReliefs = (reliefData ?? []) as ReliefLite[]
    const personalReliefs = allReliefs.filter(r => r.to_user_id === user.id)
    const openReliefs = allReliefs.filter(r => r.to_user_id === null)

    // Para relevos abiertos, validar compatibilidad por ocupantes actuales del slot
    // (igual que ReliefBadge), no por género del solicitante.
    let visibleOpen = openReliefs
    if (openReliefs.length > 0) {
      const slotIds = [...new Set(openReliefs.map(r => r.slot_id))]
      const weekStarts = [...new Set(openReliefs.map(r => r.week_start))]
      const { data: slotRes } = await supabase
        .from('reservations')
        .select('time_slot_id, week_start, user_id, user:users!reservations_user_id_fkey(id, gender)')
        .in('time_slot_id', slotIds)
        .in('week_start', weekStarts)
        .neq('status', 'cancelled')

      type OccupantInfo = { userId: string; gender: string | null }
      const occupantsBySlotWeek: Record<string, OccupantInfo[]> = {}
      for (const row of (slotRes ?? []) as unknown as {
        time_slot_id: string
        week_start: string
        user_id: string
        user: { id: string; gender: string | null } | null
      }[]) {
        const key = `${row.time_slot_id}|${row.week_start}`
        if (!occupantsBySlotWeek[key]) occupantsBySlotWeek[key] = []
        occupantsBySlotWeek[key].push({ userId: row.user_id, gender: row.user?.gender ?? null })
      }

      visibleOpen = openReliefs.filter(r => {
        const key = `${r.slot_id}|${r.week_start}`
        const occupants = occupantsBySlotWeek[key] ?? []
        const remaining = occupants.filter(o => o.userId !== r.from_user_id)

        if (remaining.length === 0) return true
        if (!user.gender) return true

        return remaining.every(o => !o.gender || o.gender === user.gender)
      })
    }

    setReliefCount(personalReliefs.length + visibleOpen.length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.gender])

  useEffect(() => { fetchCounts() }, [fetchCounts])

  // ─── Realtime — invitations ───────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`bell:invitations:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'invitations',
          filter: `to_user_id=eq.${user.id}` },
        () => fetchCounts()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // ─── Realtime — relief_requests ──────────────────────────
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`bell:reliefs:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'relief_requests' },
        () => fetchCounts()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!user) return null

  return (
    <button
      onClick={onBellClick}
      aria-label={`${total} notificaciones pendientes`}
      className="relative p-2 rounded-lg hover:bg-indigo-800 transition"
      title={total > 0
        ? `${invitationCount > 0 ? `${invitationCount} invitación${invitationCount > 1 ? 'es' : ''}` : ''}${invitationCount > 0 && reliefCount > 0 ? ' · ' : ''}${reliefCount > 0 ? `${reliefCount} relevo${reliefCount > 1 ? 's' : ''}` : ''}`
        : 'Sin notificaciones'}
    >
      <span className="text-xl">🔔</span>
      {total > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
          {total > 9 ? '9+' : total}
        </span>
      )}
    </button>
  )
}
