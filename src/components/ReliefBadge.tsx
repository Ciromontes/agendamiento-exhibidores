/**
 * components/ReliefBadge.tsx — Fase 9A: Panel de Solicitudes de Relevo
 * ─────────────────────────────────────────────────────────────
 * Muestra las solicitudes de relevo pendientes que recibió el usuario.
 * Incluye las dirigidas específicamente a él Y las abiertas cuyos
 * solicitantes son del mismo género y él no ha alcanzado su límite.
 *
 * Permite:
 *   • Aceptar → RPC accept_relief(relief_id, user.id)
 *     Transfiere la reserva al usuario aceptante.
 *   • Saltar → UPDATE status = 'cancelled' (no muestra más al usuario)
 *
 * Realtime: se suscribe a INSERT/UPDATE en relief_requests
 * para actualizar instantáneamente sin refrescar la página.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import { DAYS_OF_WEEK, formatTimeLabel, timeUntilExpiry, WEEKLY_LIMITS, MONTHLY_LIMITS } from '@/types'
import type { ReliefRequest } from '@/types'

export default function ReliefBadge() {
  const { user } = useUser()
  const supabase  = createClient()

  const [reliefs,       setReliefs]       = useState<ReliefRequest[]>([])
  const [loading,       setLoading]       = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [expanded,      setExpanded]      = useState(true)
  const [, setTick] = useState(0)

  // Para saber si el usuario tiene cupo disponible
  const [myCurrentCount, setMyCurrentCount] = useState(0)
  const [maxTurnos,       setMaxTurnos]      = useState(1)
  const panelRef = useRef<HTMLDivElement>(null)

  // ─── Cargar solicitudes pendientes ───────────────────────
  const fetchReliefs = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const nowIso = new Date().toISOString()

    // Cargar modo de conteo para verificar cupo
    const { data: config } = await supabase
      .from('app_config')
      .select('counting_mode')
      .eq('congregation_id', user.congregation_id)
      .limit(1)
      .single()
    const mode = config?.counting_mode ?? 'weekly'

    // Contar mis reservas actuales para saber si tengo cupo
    const weekStart = (() => {
      const now = new Date(); const day = now.getDay()
      const diff = now.getDate() - day + (day === 0 ? -6 : 1)
      const m = new Date(now.getFullYear(), now.getMonth(), diff)
      return m.toISOString().split('T')[0]
    })()
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString().split('T')[0]

    const { count: myCount } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq(mode === 'monthly' ? 'week_start' : 'week_start', mode === 'monthly' ? monthStart : weekStart)
      .gte('week_start', mode === 'monthly' ? monthStart : weekStart)
      .neq('status', 'cancelled')
    setMyCurrentCount(myCount ?? 0)

    const limits = mode === 'monthly' ? MONTHLY_LIMITS : WEEKLY_LIMITS
    setMaxTurnos(limits[user.user_type] ?? 1)

    // Cargar solicitudes de relevo
    const { data } = await supabase
      .from('relief_requests')
      .select(`
        *,
        from_user:users!relief_requests_from_user_id_fkey(id, name, gender),
        slot:time_slots!relief_requests_slot_id_fkey(id, day_of_week, start_time, end_time)
      `)
      .neq('from_user_id', user.id)   // No mis propias solicitudes
      .eq('status', 'pending')
      .gt('expires_at', nowIso)

    if (data) {
      // Filtrar: dirigidas a mí O abiertas con género compatible
      const visible = (data as ReliefRequest[]).filter(r => {
        if (r.to_user_id === user.id) return true  // Personalizado para mí
        if (r.to_user_id !== null) return false    // Personalizado para otro
        // Abierto: verificar compatibilidad de género
        const fromGender = (r.from_user as { gender: string } | undefined)?.gender
        return fromGender === user.gender
      })
      setReliefs(visible)
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.gender, user?.user_type])

  useEffect(() => { fetchReliefs() }, [fetchReliefs])

  // ─── Realtime ─────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`reliefbadge:${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'relief_requests' },
        () => fetchReliefs()
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'relief_requests' },
        () => fetchReliefs()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Intervalo 30s: actualiza countdowns en pantalla
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  // ─── Aceptar relevo ───────────────────────────────────────
  const handleAccept = async (reliefId: string) => {
    if (!user) return
    if (myCurrentCount >= maxTurnos) {
      alert('Ya alcanzaste tu límite de turnos para este período.')
      return
    }
    setActionLoading(reliefId)
    const { data, error } = await supabase
      .rpc('accept_relief', {
        p_relief_id:   reliefId,
        p_acceptor_id: user.id,
      })
    if (error || !data?.success) {
      alert('No se pudo aceptar: ' + (data?.error ?? error?.message ?? 'Error desconocido'))
    } else {
      alert('✅ Relevo aceptado. El turno ha sido transferido a tu nombre.')
    }
    await fetchReliefs()
    setActionLoading(null)
  }

  // ─── Saltar solicitud ─────────────────────────────────────
  // No cancela la solicitud globalmente, solo la oculta.
  // Si es personalizada, la cancela; si es abierta, solo la remueve de la vista local.
  const handleSkip = async (relief: ReliefRequest) => {
    setActionLoading(relief.id)
    if (relief.to_user_id === user?.id) {
      // Personalizada para mí: declinar formalmente
      await supabase
        .from('relief_requests')
        .update({ status: 'cancelled' })
        .eq('id', relief.id)
    }
    // Para relevos abiertos: simplemente remover de la vista local
    setReliefs(prev => prev.filter(r => r.id !== relief.id))
    setActionLoading(null)
  }

  if (!user || (loading && reliefs.length === 0)) return null
  if (!loading && reliefs.length === 0) return null

  const hasCapacity = myCurrentCount < maxTurnos

  return (
    <div ref={panelRef} className="bg-white rounded-xl shadow-md border border-orange-100 mb-4">
      {/* Cabecera */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🔄</span>
          <span className="font-semibold text-gray-800 text-sm">Solicitudes de relevo</span>
          <span className="bg-orange-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
            {reliefs.length}
          </span>
        </div>
        <span className="text-gray-400 text-xs">{expanded ? '▲ Ocultar' : '▼ Ver'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500" />
            </div>
          ) : (
            reliefs.map(rel => {
              const dayName   = rel.slot ? DAYS_OF_WEEK[rel.slot.day_of_week] : '—'
              const timeLabel = rel.slot
                ? formatTimeLabel(rel.slot.start_time, rel.slot.end_time)
                : '—'
              const remaining = timeUntilExpiry(rel.expires_at)
              const isUrgent  = remaining !== null &&
                (new Date(rel.expires_at).getTime() - Date.now()) < 30 * 60_000
              const isLoading = actionLoading === rel.id
              const isPersonal = rel.to_user_id === user?.id

              return (
                <div key={rel.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1">
                    {/* Tipo de solicitud */}
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-1 text-orange-500">
                      {isPersonal ? '👤 Solicitud personalizada' : '📢 Relevo abierto'}
                    </p>
                    <p className="text-sm text-gray-800">
                      <span className="font-semibold">
                        {(rel.from_user as { name: string } | undefined)?.name ?? 'Alguien'}
                      </span>
                      {' busca relevo para el turno del '}
                      <span className="font-semibold text-orange-700">{dayName}</span>
                      {' · '}
                      <span className="text-gray-600">{timeLabel}</span>
                    </p>
                    {/* Countdown */}
                    {remaining && (
                      <p className={`text-[11px] mt-0.5 font-medium ${
                        isUrgent ? 'text-red-500' : 'text-amber-600'
                      }`}>
                        {isUrgent ? '⚠️ Urgente · expira en' : '⏱ Expira en'} {remaining}
                      </p>
                    )}
                    {/* Aviso si no tiene cupo */}
                    {!hasCapacity && (
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Ya alcanzaste tu límite de turnos este período.
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleAccept(rel.id)}
                      disabled={isLoading || !hasCapacity}
                      className="px-3 py-1.5 text-xs font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-40 transition"
                    >
                      {isLoading ? '...' : '✅ Tomar turno'}
                    </button>
                    <button
                      onClick={() => handleSkip(rel)}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition"
                    >
                      {isLoading ? '...' : (isPersonal ? '❌ Declinar' : 'Saltar')}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
