/**
 * app/api/admin/reservations/[id]/route.ts
 * ─────────────────────────────────────────────────────────────
 * DELETE /api/admin/reservations/[id]  → cancelar una reserva (admin)
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  try {
    const supabase = createServiceClient()

    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      .select('id, user_id, time_slot_id, week_start, status, congregation_id')
      .eq('id', id)
      .single()

    if (resError || !reservation) {
      return NextResponse.json({ error: 'Reserva no encontrada.' }, { status: 404 })
    }

    if (reservation.congregation_id !== admin.congregation_id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { error: updateError } = await supabase
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await supabase
      .from('relief_requests')
      .update({ status: 'cancelled' })
      .eq('reservation_id', id)
      .eq('status', 'pending')

    await supabase
      .from('invitations')
      .update({ status: 'declined' })
      .eq('from_user_id', reservation.user_id)
      .eq('slot_id', reservation.time_slot_id)
      .eq('week_start', reservation.week_start)
      .eq('status', 'pending')

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error interno al cancelar la reserva.' }, { status: 500 })
  }
}
