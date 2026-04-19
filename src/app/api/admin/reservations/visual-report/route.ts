import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '@/lib/supabase/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type SlotRow = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
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

type ReportItem = {
  day_of_week: number
  day_label: string
  start_time: string
  end_time: string
  user_name: string
  companion_name: string
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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
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

export async function GET(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const supabase = createServiceClient()

  const [{ data: cfg, error: cfgError }, { data: congregation }] = await Promise.all([
    supabase
      .from('app_config')
      .select('active_week_start')
      .eq('congregation_id', admin.congregation_id)
      .limit(1)
      .single(),
    supabase
      .from('congregations')
      .select('name')
      .eq('id', admin.congregation_id)
      .limit(1)
      .single(),
  ])

  if (cfgError || !cfg?.active_week_start) {
    return NextResponse.json(
      { error: 'No se pudo obtener la semana activa de la congregacion.' },
      { status: 500 },
    )
  }

  const activeWeek = cfg.active_week_start as string

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
    return NextResponse.json(
      {
        ok: true,
        weekStart: activeWeek,
        weekEnd: addDays(activeWeek, 6),
        congregationName: congregation?.name ?? 'Congregacion',
        generatedAt: new Date().toISOString(),
        totalSlots: 0,
        totalAssignments: 0,
        groups: [],
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      },
    )
  }

  const { data: slots, error: slotError } = await supabase
    .from('time_slots')
    .select(`
      id,
      day_of_week,
      start_time,
      end_time,
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
      .eq('status', 'confirmed')
      .in('time_slot_id', slotIds)

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

  const grouped = new Map<string, ReportItem[]>()

  for (const slot of (slots ?? []) as SlotRow[]) {
    const occupancy = reservationMap.get(slot.id)
    if (!occupancy) continue

    const hasAssignment = Boolean(occupancy.pos1 || occupancy.pos2)
    if (!hasAssignment) continue

    const exhibitorName = getExhibitorName(slot.exhibitor)
    const list = grouped.get(exhibitorName) ?? []

    list.push({
      day_of_week: slot.day_of_week,
      day_label: DAY_LABELS[slot.day_of_week] ?? String(slot.day_of_week),
      start_time: slot.start_time,
      end_time: slot.end_time,
      user_name: occupancy.pos1,
      companion_name: occupancy.pos2,
    })

    grouped.set(exhibitorName, list)
  }

  const groups = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([exhibitorName, rows]) => ({
      exhibitorName,
      rows: rows.sort((a, b) => {
        const dayA = DAY_SORT_ORDER[a.day_of_week] ?? 99
        const dayB = DAY_SORT_ORDER[b.day_of_week] ?? 99
        if (dayA !== dayB) return dayA - dayB
        return a.start_time.localeCompare(b.start_time)
      }),
    }))

  const totalSlots = groups.reduce((acc, g) => acc + g.rows.length, 0)
  const totalAssignments = groups.reduce(
    (acc, g) =>
      acc +
      g.rows.reduce((innerAcc, row) => {
        let value = innerAcc
        if (row.user_name) value += 1
        if (row.companion_name) value += 1
        return value
      }, 0),
    0,
  )

  return NextResponse.json(
    {
      ok: true,
      weekStart: activeWeek,
      weekEnd: addDays(activeWeek, 6),
      congregationName: congregation?.name ?? 'Congregacion',
      generatedAt: new Date().toISOString(),
      totalSlots,
      totalAssignments,
      groups,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    },
  )
}
