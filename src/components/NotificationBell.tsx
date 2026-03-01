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
      .select('id, to_user_id, from_user:users!relief_requests_from_user_id_fkey(gender)')
      .neq('from_user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)

    // Filtrar: dirigidos a mí O abiertos con género compatible
    const relevant = (reliefData ?? []).filter(r => {
      if (r.to_user_id === user.id) return true  // Personalizado para mí
      if (r.to_user_id !== null) return false    // Personalizado para otro
      // Abierto: verificar compatibilidad de género
      const fromGender = (r.from_user as unknown as { gender: string } | undefined)?.gender
      return fromGender === user.gender
    })
    setReliefCount(relevant.length)
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
