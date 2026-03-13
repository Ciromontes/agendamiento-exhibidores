/**
 * app/api/orphan-slots/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST /api/orphan-slots
 *
 * Retorna los turnos huérfanos del usuario para una semana dada.
 * Un turno huérfano es aquel en el que el usuario es la única
 * persona con reserva activa (sin compañero).
 *
 * Seguridad:
 *   - Usa service client (servidor) → sin restricciones de RLS
 *   - Verifica que user_id pertenece a congregation_id antes de retornar
 *   - Solo retorna datos del propio usuario, no de otros
 *
 * Body:  { user_id, congregation_id, week_start }
 * OK:    200 [{ reservation_id, exhibitor_name, day_of_week, start_time, end_time }]
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, congregation_id, week_start } = body as {
      user_id?: string
      congregation_id?: string
      week_start?: string
    }

    if (!user_id || !congregation_id || !week_start) {
      return NextResponse.json({ error: 'Parámetros requeridos' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Verificar que el usuario pertenece a la congregación
    const { data: caller } = await supabase
      .from('users')
      .select('id')
      .eq('id', user_id)
      .eq('congregation_id', congregation_id)
      .eq('is_active', true)
      .single()

    if (!caller) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    // Obtener reservas activas del usuario en esa semana
    const { data: userReservations } = await supabase
      .from('reservations')
      .select(`
        id,
        time_slot_id,
        slot:time_slots!inner(
          id, day_of_week, start_time, end_time,
          exhibitor:exhibitors!inner(name)
        )
      `)
      .eq('user_id', user_id)
      .eq('week_start', week_start)
      .neq('status', 'cancelled')

    if (!userReservations || userReservations.length === 0) {
      return NextResponse.json([])
    }

    // Filtrar solo los huérfanos (slots donde el usuario es el único)
    const orphans: {
      reservation_id: string
      exhibitor_name: string
      day_of_week: number
      start_time: string
      end_time: string
    }[] = []

    for (const r of userReservations) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('time_slot_id', r.time_slot_id)
        .eq('week_start', week_start)
        .neq('status', 'cancelled')

      if (count === 1) {
        const slot = r.slot as unknown as {
          day_of_week: number
          start_time: string
          end_time: string
          exhibitor: { name: string }
        }
        orphans.push({
          reservation_id: r.id,
          exhibitor_name:  slot.exhibitor.name,
          day_of_week:     slot.day_of_week,
          start_time:      slot.start_time,
          end_time:        slot.end_time,
        })
      }
    }

    return NextResponse.json(orphans)
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
