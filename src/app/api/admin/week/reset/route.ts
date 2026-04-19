/**
 * app/api/admin/week/reset/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST /api/admin/week/reset
 *
 * Acciones rápidas de semana para administración/pruebas:
 *   - reset_current: reinicia la semana activa (cancela reservas activas)
 *   - advance_blank: abre nueva semana en blanco (cancela reservas desde semana activa)
 *   - advance_keep:  abre nueva semana copiando cupos actuales
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '@/lib/supabase/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

type WeekActionMode = 'reset_current' | 'advance_blank' | 'advance_keep'

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function isWeekActionMode(value: unknown): value is WeekActionMode {
  return value === 'reset_current' || value === 'advance_blank' || value === 'advance_keep'
}

export async function POST(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let body: { mode?: WeekActionMode }
  try {
    body = (await req.json()) as { mode?: WeekActionMode }
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 })
  }

  if (!isWeekActionMode(body.mode)) {
    return NextResponse.json(
      { error: 'Modo inválido. Usa: reset_current, advance_blank o advance_keep.' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  const { data: cfg, error: cfgError } = await supabase
    .from('app_config')
    .select('id, active_week_start')
    .eq('congregation_id', admin.congregation_id)
    .limit(1)
    .single()

  if (cfgError || !cfg?.id || !cfg?.active_week_start) {
    return NextResponse.json(
      { error: 'No se encontró configuración activa para esta congregación.' },
      { status: 500 },
    )
  }

  const currentWeek = cfg.active_week_start as string
  const nextWeek = addDays(currentWeek, 7)

  if (body.mode === 'reset_current') {
    const [{ error: reservationsError }, { error: invitationsError }, { error: reliefError }] = await Promise.all([
      supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', currentWeek)
        .neq('status', 'cancelled'),
      supabase
        .from('invitations')
        .update({ status: 'declined' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', currentWeek)
        .eq('status', 'pending'),
      supabase
        .from('relief_requests')
        .update({ status: 'cancelled' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', currentWeek)
        .eq('status', 'pending'),
    ])

    if (reservationsError || invitationsError || reliefError) {
      return NextResponse.json(
        {
          error:
            reservationsError?.message ||
            invitationsError?.message ||
            reliefError?.message ||
            'No se pudo reiniciar la semana en curso.',
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      mode: body.mode,
      active_week_start: currentWeek,
      message: 'Semana en curso reiniciada: todos los turnos quedaron en cero.',
    })
  }

  if (body.mode === 'advance_blank') {
    const [
      { error: reservationsError },
      { error: invitationsError },
      { error: reliefError },
      { error: absencesError },
      { error: cfgUpdateError },
    ] = await Promise.all([
      supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('congregation_id', admin.congregation_id)
        .gte('week_start', currentWeek)
        .neq('status', 'cancelled'),
      supabase
        .from('invitations')
        .update({ status: 'declined' })
        .eq('congregation_id', admin.congregation_id)
        .gte('week_start', currentWeek)
        .eq('status', 'pending'),
      supabase
        .from('relief_requests')
        .update({ status: 'cancelled' })
        .eq('congregation_id', admin.congregation_id)
        .gte('week_start', currentWeek)
        .eq('status', 'pending'),
      supabase
        .from('absences')
        .delete()
        .eq('congregation_id', admin.congregation_id)
        .gte('week_start', currentWeek),
      supabase
        .from('app_config')
        .update({ active_week_start: nextWeek })
        .eq('id', cfg.id)
        .eq('congregation_id', admin.congregation_id),
    ])

    if (reservationsError || invitationsError || reliefError || absencesError || cfgUpdateError) {
      return NextResponse.json(
        {
          error:
            reservationsError?.message ||
            invitationsError?.message ||
            reliefError?.message ||
            absencesError?.message ||
            cfgUpdateError?.message ||
            'No se pudo abrir la nueva semana en blanco.',
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      mode: body.mode,
      active_week_start: nextWeek,
      message: 'Nueva semana abierta en blanco. Reservas reiniciadas desde la semana activa.',
    })
  }

  const { data: sourceReservations, error: sourceError } = await supabase
    .from('reservations')
    .select('time_slot_id, user_id, slot_position')
    .eq('congregation_id', admin.congregation_id)
    .eq('week_start', currentWeek)
    .neq('status', 'cancelled')

  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 500 })
  }

  const [{ error: clearReservationsError }, { error: clearInvitationsError }, { error: clearReliefError }, { error: clearAbsencesError }] =
    await Promise.all([
      supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', nextWeek)
        .neq('status', 'cancelled'),
      supabase
        .from('invitations')
        .update({ status: 'declined' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', nextWeek)
        .eq('status', 'pending'),
      supabase
        .from('relief_requests')
        .update({ status: 'cancelled' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', nextWeek)
        .eq('status', 'pending'),
      supabase
        .from('absences')
        .delete()
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', nextWeek),
    ])

  if (clearReservationsError || clearInvitationsError || clearReliefError || clearAbsencesError) {
    return NextResponse.json(
      {
        error:
          clearReservationsError?.message ||
          clearInvitationsError?.message ||
          clearReliefError?.message ||
          clearAbsencesError?.message ||
          'No se pudo limpiar la semana destino.',
      },
      { status: 500 },
    )
  }

  const copyRows = (sourceReservations ?? []).map((r) => ({
    time_slot_id: r.time_slot_id,
    user_id: r.user_id,
    week_start: nextWeek,
    status: 'confirmed',
    slot_position: r.slot_position,
    congregation_id: admin.congregation_id,
  }))

  if (copyRows.length > 0) {
    const { error: insertError } = await supabase.from('reservations').insert(copyRows)
    if (insertError) {
      return NextResponse.json(
        { error: 'No se pudieron copiar reservas a la nueva semana: ' + insertError.message },
        { status: 500 },
      )
    }
  }

  const { error: configError } = await supabase
    .from('app_config')
    .update({ active_week_start: nextWeek })
    .eq('id', cfg.id)
    .eq('congregation_id', admin.congregation_id)

  if (configError) {
    return NextResponse.json(
      { error: 'Se copiaron reservas, pero no se pudo avanzar la semana: ' + configError.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    mode: body.mode,
    active_week_start: nextWeek,
    copied: copyRows.length,
    message: `Nueva semana abierta conservando cupos. Reservas copiadas: ${copyRows.length}.`,
  })
}
