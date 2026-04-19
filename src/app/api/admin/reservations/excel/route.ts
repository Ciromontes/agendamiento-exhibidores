/**
 * app/api/admin/reservations/excel/route.ts
 * ─────────────────────────────────────────────────────────────
 * GET /api/admin/reservations/excel
 *
 * Descarga un Excel con la configuración ACTUAL de reservas de la
 * semana activa de la congregación del admin.
 *
 * Requiere header: x-access-key: <admin_access_key>
 *
 * Columnas del archivo:
 *   semana | exhibidor | dia | hora | usuario | acompanante | estado | motivo_bloqueo
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { verifyAdmin } from '@/lib/supabase/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

type TimeSlotRow = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
  block_reason: string | null
  exhibitor:
    | { id: string; name: string }
    | Array<{ id: string; name: string }>
    | null
}

type ReservationRow = {
  time_slot_id: string
  slot_position: number
  status: string
  user: { name: string } | Array<{ name: string }> | null
}

const DAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miercoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sabado',
}

const DAY_SORT_ORDER: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  0: 7,
}

function getName(value: { name: string } | Array<{ name: string }> | null): string {
  if (!value) return ''
  return Array.isArray(value) ? (value[0]?.name ?? '') : value.name
}

function getExhibitorName(
  value: { id: string; name: string } | Array<{ id: string; name: string }> | null,
): string {
  if (!value) return 'Sin exhibidor'
  return Array.isArray(value) ? (value[0]?.name ?? 'Sin exhibidor') : value.name
}

function shortTime(time: string): string {
  return (time ?? '').slice(0, 5)
}

export async function GET(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const { data: cfg, error: cfgError } = await supabase
    .from('app_config')
    .select('active_week_start')
    .eq('congregation_id', admin.congregation_id)
    .limit(1)
    .single()

  if (cfgError || !cfg?.active_week_start) {
    return NextResponse.json(
      { error: 'No se pudo obtener la semana activa de la congregacion.' },
      { status: 500 },
    )
  }

  const activeWeek = cfg.active_week_start as string

  // Usar SOLO exhibidores vigentes para evitar mezclar históricos/soft-deleted.
  const { data: currentExhibitors, error: exhibError } = await supabase
    .from('exhibitors')
    .select('id')
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (exhibError) {
    return NextResponse.json({ error: exhibError.message }, { status: 500 })
  }

  const exhibitorIds = (currentExhibitors ?? []).map((e) => e.id)

  if (exhibitorIds.length === 0) {
    const ws = XLSX.utils.json_to_sheet([])
    ws['!cols'] = [
      { wch: 12 }, // semana
      { wch: 28 }, // exhibidor
      { wch: 12 }, // dia
      { wch: 16 }, // hora
      { wch: 28 }, // usuario
      { wch: 28 }, // acompanante
      { wch: 12 }, // estado
      { wch: 26 }, // motivo_bloqueo
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Reservas actuales')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="reservas-actuales-${activeWeek}.xlsx"`,
      },
    })
  }

  const { data: slots, error: slotError } = await supabase
    .from('time_slots')
    .select(`
      id,
      day_of_week,
      start_time,
      end_time,
      is_active,
      block_reason,
      exhibitor:exhibitors!time_slots_exhibitor_id_fkey(id, name)
    `)
    .eq('congregation_id', admin.congregation_id)
    .in('exhibitor_id', exhibitorIds)

  if (slotError) {
    return NextResponse.json({ error: slotError.message }, { status: 500 })
  }

  const slotIds = (slots ?? []).map((s) => s.id)

  let reservations: ReservationRow[] = []
  if (slotIds.length > 0) {
    const { data: reservationsData, error: resError } = await supabase
      .from('reservations')
      .select(`
        time_slot_id,
        slot_position,
        status,
        user:users!reservations_user_id_fkey(name)
      `)
      .eq('congregation_id', admin.congregation_id)
      .eq('week_start', activeWeek)
      .in('time_slot_id', slotIds)
      .neq('status', 'cancelled')

    if (resError) {
      return NextResponse.json({ error: resError.message }, { status: 500 })
    }

    reservations = (reservationsData ?? []) as ReservationRow[]
  }

  const reservationMap = new Map<string, { pos1: string; pos2: string }>()

  for (const r of reservations) {
    const current = reservationMap.get(r.time_slot_id) ?? { pos1: '', pos2: '' }
    const userName = getName(r.user)

    if (r.slot_position === 1) current.pos1 = userName
    if (r.slot_position === 2) current.pos2 = userName

    reservationMap.set(r.time_slot_id, current)
  }

  const sortedSlots = ((slots ?? []) as TimeSlotRow[]).sort((a, b) => {
    const exA = getExhibitorName(a.exhibitor)
    const exB = getExhibitorName(b.exhibitor)
    if (exA !== exB) return exA.localeCompare(exB)

    const dayA = DAY_SORT_ORDER[a.day_of_week] ?? 99
    const dayB = DAY_SORT_ORDER[b.day_of_week] ?? 99
    if (dayA !== dayB) return dayA - dayB

    return a.start_time.localeCompare(b.start_time)
  })

  const rows = sortedSlots.map((slot) => {
    const occ = reservationMap.get(slot.id) ?? { pos1: '', pos2: '' }

    let estado = 'Libre'
    if (!slot.is_active) estado = 'Bloqueado'
    else if (occ.pos1 && occ.pos2) estado = 'Completo'
    else if (occ.pos1 || occ.pos2) estado = 'Parcial'

    return {
      semana: activeWeek,
      exhibidor: getExhibitorName(slot.exhibitor),
      dia: DAY_LABELS[slot.day_of_week] ?? String(slot.day_of_week),
      hora: `${shortTime(slot.start_time)} - ${shortTime(slot.end_time)}`,
      usuario: occ.pos1,
      acompanante: occ.pos2,
      estado,
      motivo_bloqueo: slot.block_reason ?? '',
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  ws['!cols'] = [
    { wch: 12 }, // semana
    { wch: 28 }, // exhibidor
    { wch: 12 }, // dia
    { wch: 16 }, // hora
    { wch: 28 }, // usuario
    { wch: 28 }, // acompanante
    { wch: 12 }, // estado
    { wch: 26 }, // motivo_bloqueo
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reservas actuales')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const fileName = `reservas-actuales-${activeWeek}.xlsx`

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
