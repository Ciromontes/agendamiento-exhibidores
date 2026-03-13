/**
 * components/InvitationBadge.tsx — Fase 7b: Panel de Invitaciones Recibidas
 * ─────────────────────────────────────────────────────────────
 * Muestra las invitaciones pendientes (no expiradas) que recibió el usuario.
 * Permite aceptar o rechazar cada una directamente desde el dashboard.
 *
 * Fase 7b: agrega countdown de tiempo restante y filtra expiradas.
 * Fase 7c: suscripción Realtime — el usuario ve nuevas invitaciones
 *   al instante (websocket), sin necesidad de refrescar la página.
 *
 * Flujo:
 *   1. Carga invitations donde to_user_id = usuario actual, status = 'pending'
 *   2. Filtra las ya expiradas (expires_at < ahora)
 *   3. Muestra cada invitación con: quién invita, qué turno, tiempo restante
 *   4. Suscripción Realtime detecta INSERT/UPDATE → recarga automática
 *   5. Aceptar → RPC accept_invitation (verifica límite, expiración, espacio)
 *   6. Rechazar → UPDATE status = 'declined'
 *   7. Intervalo 30s: actualiza countdowns en pantalla
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import { Invitation, DAYS_OF_WEEK, formatTimeLabel, timeUntilExpiry } from '@/types'

export default function InvitationBadge() {
  const { user } = useUser()
  const supabase = createClient()

  // ─── Estado ───────────────────────────────────────────────
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  // Tick periódico para re-renderizar y actualizar los countdowns
  const [, setTick] = useState(0)
  // Modal de confirmación cuando aceptar una invitación liberaría un turno huérfano
  const [conflictModal, setConflictModal] = useState<{
    invitationId: string
    orphanLabel: string
    orphanReservationId: string  // ID de la reserva huérfana a cancelar antes de aceptar
  } | null>(null)

  // ─── Cargar invitaciones pendientes no expiradas ──────────
  const fetchInvitations = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('invitations')
      .select(`
        *,
        from_user:users!invitations_from_user_id_fkey(id, name),
        slot:time_slots!invitations_slot_id_fkey(id, day_of_week, start_time, end_time, exhibitor:exhibitors(name))
      `)
      .eq('to_user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())       // Solo no expiradas
      .order('expires_at', { ascending: true })         // Las que vencen antes, primero
    if (data) setInvitations(data as Invitation[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    fetchInvitations()
  }, [fetchInvitations])

  // ─── Realtime: detectar nuevas invitaciones al instante ───
  // Se suscribe a INSERT y UPDATE en la tabla invitations filtrado
  // por to_user_id del usuario actual. Cuando alguien envía una
  // invitación, el canal notifica y se recarga sin refrescar página.
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`invitations:to_user_id=eq.${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'invitations',
          filter: `to_user_id=eq.${user.id}`,
        },
        () => { fetchInvitations() }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'invitations',
          filter: `to_user_id=eq.${user.id}`,
        },
        () => { fetchInvitations() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Intervalo 30s: solo para actualizar los countdowns en pantalla
  // (los datos en sí llegan por Realtime)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  // ─── Ejecutar aceptación (sin verificación de conflicto) ─────
  const doAccept = async (invitationId: string) => {
    const { data, error } = await supabase
      .rpc('accept_invitation', { p_invitation_id: invitationId })
    if (error || !data?.success) {
      alert('No se pudo aceptar: ' + (data?.error ?? error?.message ?? 'Error desconocido'))
    }
    await fetchInvitations()
  }

  // ─── Aceptar invitación ───────────────────────────────────
  // Primero verifica si aceptar liberaría un turno huérfano del usuario.
  // Si hay conflicto, muestra un modal de confirmación antes de proceder.
  const handleAccept = async (invitationId: string) => {
    setActionLoading(invitationId)

    // Verificar conflicto con turno huérfano (Fase 4)
    const { data: conflictData } = await supabase
      .rpc('check_invitation_accept_conflict', { p_invitation_id: invitationId })

    if (conflictData?.has_conflict) {
      // Construir etiqueta del turno que quedaría libre
      const dayName = DAYS_OF_WEEK[conflictData.day_of_week as number] ?? ''
      const timeLabel = formatTimeLabel(
        conflictData.start_time as string,
        conflictData.end_time as string,
      )
      const label = `${conflictData.exhibitor_name as string} – ${dayName} ${timeLabel}`
      setConflictModal({
        invitationId,
        orphanLabel: label,
        orphanReservationId: conflictData.reservation_id as string,
      })
      setActionLoading(null)
      return
    }

    await doAccept(invitationId)
    setActionLoading(null)
  }

  // ─── Rechazar invitación ──────────────────────────────────
  const handleDecline = async (invitationId: string) => {
    setActionLoading(invitationId)
    await supabase
      .from('invitations')
      .update({ status: 'declined' })
      .eq('id', invitationId)
    await fetchInvitations()
    setActionLoading(null)
  }

  if (!user || (loading && invitations.length === 0)) return null
  if (!loading && invitations.length === 0) return null

  return (
    <>
    <div className="bg-white rounded-xl shadow-md border border-indigo-100 mb-4">
      {/* Cabecera */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">✉️</span>
          <span className="font-semibold text-gray-800 text-sm">Invitaciones pendientes</span>
          <span className="bg-indigo-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
            {invitations.length}
          </span>
        </div>
        <span className="text-gray-400 text-xs">
          {expanded ? '▲ Ocultar' : '▼ Ver'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
            </div>
          ) : (
            invitations.map(inv => {
              const dayName   = inv.slot ? DAYS_OF_WEEK[inv.slot.day_of_week] : '—'
              const timeLabel = inv.slot
                ? formatTimeLabel(inv.slot.start_time, inv.slot.end_time)
                : '—'
              const remaining = timeUntilExpiry(inv.expires_at)
              const isLoading = actionLoading === inv.id
              const isUrgent  = remaining !== null &&
                (new Date(inv.expires_at).getTime() - Date.now()) < 30 * 60_000

              return (
                <div key={inv.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1">
                    <p className="text-sm text-gray-800">
                      <span className="font-semibold">{inv.from_user?.name ?? 'Alguien'}</span>
                      {' '}te invita{' '}
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(inv.slot as any)?.exhibitor?.name && (
                        <>
                          en{' '}
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          <span className="font-semibold text-indigo-700">{(inv.slot as any).exhibitor.name}</span>
                          {' '}
                        </>
                      )}
                      el{' '}
                      <span className="font-semibold text-indigo-700">{dayName}</span>
                      {' · '}
                      <span className="text-gray-600">{timeLabel}</span>
                    </p>
                    {/* Countdown: cuánto tiempo queda para responder */}
                    {remaining && (
                      <p className={`text-[11px] mt-0.5 font-medium ${
                        isUrgent ? 'text-red-500' : 'text-amber-600'
                      }`}>
                        {isUrgent ? '⚠️ Urgente · expira en' : '⏱ Expira en'} {remaining}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleAccept(inv.id)}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
                    >
                      {isLoading ? '...' : '✅ Aceptar'}
                    </button>
                    <button
                      onClick={() => handleDecline(inv.id)}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition"
                    >
                      {isLoading ? '...' : '❌ Rechazar'}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>

    {/* ─── Modal de confirmación de conflicto (Fase 4) ─────────── */}
    {/* Aparece cuando aceptar la invitación liberaría un turno huérfano */}
    {conflictModal && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
          <h3 className="text-base font-bold text-gray-800 mb-2">⚠️ Turno en conflicto</h3>
          <p className="text-sm text-gray-600 mb-4">
            Si aceptas esta invitación, tu turno sin compañero en{' '}
            <span className="font-semibold text-indigo-700">{conflictModal.orphanLabel}</span>{' '}
            quedará libre para que otros puedan tomarlo.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setConflictModal(null)}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                const { invitationId, orphanReservationId } = conflictModal
                setConflictModal(null)
                setActionLoading(invitationId)
                // Cancelar el turno huérfano primero para liberar el cupo
                await supabase
                  .from('reservations')
                  .update({ status: 'cancelled' })
                  .eq('id', orphanReservationId)
                // Ahora el usuario tiene cupo → accept_invitation funcionará
                await doAccept(invitationId)
                setActionLoading(null)
              }}
              className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 transition"
            >
              Aceptar de todas formas
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  )
}
