/**
 * app/api/admin/reports/monthly-ranking/route.ts
 * ──────────────────────────────────────────────────────
 * GET /api/admin/reports/monthly-ranking?year=2026&month=5
 *
 * Ranking mensual por grupos: cuántas veces cada publicador
 * salió a cada exhibidor durante el mes indicado.
 *
 * La consulta itera sobre las semanas del mes, busca reservas
 * confirmadas y las agrupa por usuario + exhibidor.
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ──────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export const dynamic = 'force-dynamic'

const MONTH_LABELS: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
}

/**
 * Genera una lista de week_start (lunes) que caen dentro del mes.
 */
function getWeeksInMonth(year: number, month: number): string[] {
  const weeks: string[] = []
  // Primer día del mes
  const firstDay = new Date(year, month - 1, 1)
  // Último día del mes
  const lastDay = new Date(year, month, 0)

  // Encontrar el lunes de la primera semana que toca el mes
  let cursor = new Date(firstDay)
  const dayOfWeek = cursor.getDay()
  cursor.setDate(cursor.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))

  while (cursor <= lastDay) {
    weeks.push(cursor.toISOString().split('T')[0])
    cursor.setDate(cursor.getDate() + 7)
  }

  return weeks
}

export async function GET(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') ?? '', 10)
  const month = parseInt(searchParams.get('month') ?? '', 10)

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json(
      { error: 'Parámetros inválidos. Usa ?year=2026&month=5' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()
  const weeksInMonth = getWeeksInMonth(year, month)

  // ─── Obtener grupos de la congregación ─────────────────
  const { data: groups } = await supabase
    .from('user_groups')
    .select('id, name, captain_id')
    .eq('congregation_id', admin.congregation_id)
    .order('name')

  // ─── Obtener usuarios con su grupo ─────────────────────
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, name, user_type, group_id')
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)
    .order('name')

  // ─── Obtener exhibidores activos ───────────────────────
  const { data: allExhibitors } = await supabase
    .from('exhibitors')
    .select('id, name')
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)

  // ─── Obtener todas las reservas confirmadas en esas semanas ──
  const { data: reservations, error: resError } = await supabase
    .from('reservations')
    .select('user_id, time_slot_id, week_start')
    .eq('congregation_id', admin.congregation_id)
    .eq('status', 'confirmed')
    .in('week_start', weeksInMonth)

  if (resError) {
    return NextResponse.json({ error: resError.message }, { status: 500 })
  }

  // ─── Obtener los time_slots para asociar con exhibidores ─
  const timeSlotIds = [...new Set((reservations ?? []).map((r) => r.time_slot_id))]
  let slotToExhibitor = new Map<string, string>()
  if (timeSlotIds.length > 0) {
    const { data: slots } = await supabase
      .from('time_slots')
      .select('id, exhibitor_id')
      .in('id', timeSlotIds)

    if (slots) {
      for (const s of slots) {
        slotToExhibitor.set(s.id, s.exhibitor_id)
      }
    }
  }

  // ─── Mapas de búsqueda ──────────────────────────────────
  const userNameMap = new Map((allUsers ?? []).map((u) => [u.id, u.name]))
  const userTypeMap = new Map((allUsers ?? []).map((u) => [u.id, u.user_type]))
  const userGroupMap = new Map((allUsers ?? []).map((u) => [u.id, u.group_id]))
  const exhibitorNameMap = new Map((allExhibitors ?? []).map((e) => [e.id, e.name]))

  const groupNameMap = new Map((groups ?? []).map((g) => [g.id, g.name]))
  const groupCaptainMap = new Map((groups ?? []).map((g) => [g.id, g.captain_id]))

  // ─── Acumular conteos: user_id → { exhibitor_id → count } ─
  const userExhibitorCount = new Map<string, Map<string, number>>()
  // Total de asignaciones por usuario
  const userTotal = new Map<string, number>()

  for (const r of reservations ?? []) {
    const exhibitorId = slotToExhibitor.get(r.time_slot_id)
    if (!exhibitorId) continue

    // Actualizar count por usuario+exhibidor
    let exhibMap = userExhibitorCount.get(r.user_id)
    if (!exhibMap) {
      exhibMap = new Map()
      userExhibitorCount.set(r.user_id, exhibMap)
    }
    exhibMap.set(exhibitorId, (exhibMap.get(exhibitorId) ?? 0) + 1)

    // Actualizar total del usuario
    userTotal.set(r.user_id, (userTotal.get(r.user_id) ?? 0) + 1)
  }

  // ─── Obtener nombres de capitanes ────────────────────────
  const captainIds = [...new Set((groups ?? []).map((g) => g.captain_id))]
  const captainNameMap = new Map<string, string>()
  if (captainIds.length > 0) {
    const { data: captains } = await supabase
      .from('users')
      .select('id, name')
      .in('id', captainIds)

    if (captains) {
      for (const c of captains) {
        captainNameMap.set(c.id, c.name)
      }
    }
  }

  // ─── Construir respuesta por grupos ─────────────────────
  const groupResults: Array<{
    id: string
    name: string
    captain_name: string
    totalAssignments: number
    memberCount: number
    members: Array<Record<string, unknown>>
  }> = []

  for (const g of groups ?? []) {
    const membersInGroup = (allUsers ?? []).filter((u) => u.group_id === g.id)
    const memberRows: Array<Record<string, unknown>> = []
    let groupTotal = 0

    for (const m of membersInGroup) {
      const exhibMap = userExhibitorCount.get(m.id)
      // Saltar si el usuario no tiene asignaciones en el mes
      if (!exhibMap) continue

      const exhibitors: Record<string, number> = {}
      let memberTotal = 0

      if (exhibMap) {
        for (const [exId, count] of exhibMap.entries()) {
          const exName = exhibitorNameMap.get(exId) ?? 'Desconocido'
          exhibitors[exName] = count
          memberTotal += count
        }
      }

      if (memberTotal === 0) continue

      groupTotal += memberTotal
      memberRows.push({
        id: m.id,
        name: userNameMap.get(m.id) ?? m.name,
        user_type: userTypeMap.get(m.id) ?? 'publicador',
        totalAssignments: memberTotal,
        exhibitors,
      })
    }

    // Ordenar miembros por total descendente
    memberRows.sort((a, b) =>
      ((b.totalAssignments as number) ?? 0) - ((a.totalAssignments as number) ?? 0))

    groupResults.push({
      id: g.id,
      name: g.name,
      captain_name: captainNameMap.get(g.captain_id) ?? '',
      totalAssignments: groupTotal,
      memberCount: memberRows.length,
      members: memberRows,
    })
  }

  // ─── Usuarios sin grupo ──────────────────────────────────
  const ungroupedMembers: Array<Record<string, unknown>> = []
  const ungroupedUsers = (allUsers ?? []).filter(
    (u) => !u.group_id && userTotal.has(u.id),
  )

  for (const u of ungroupedUsers) {
    const exhibMap = userExhibitorCount.get(u.id)
    if (!exhibMap) continue

    const exhibitors: Record<string, number> = {}
    let memberTotal = 0

    for (const [exId, count] of exhibMap.entries()) {
      const exName = exhibitorNameMap.get(exId) ?? 'Desconocido'
      exhibitors[exName] = count
      memberTotal += count
    }

    ungroupedMembers.push({
      id: u.id,
      name: userNameMap.get(u.id) ?? u.name,
      user_type: userTypeMap.get(u.id) ?? 'publicador',
      totalAssignments: memberTotal,
      exhibitors,
    })
  }

  ungroupedMembers.sort((a, b) =>
    ((b.totalAssignments as number) ?? 0) - ((a.totalAssignments as number) ?? 0))

  // ─── Totales globales ────────────────────────────────────
  let totalAssignments = 0
  for (const [, count] of userTotal) {
    totalAssignments += count
  }

  const allExhibitorNames = (allExhibitors ?? []).map((e) => e.name)

  return NextResponse.json({
    ok: true,
    year,
    month,
    monthLabel: `${MONTH_LABELS[month]} ${year}`,
    groups: groupResults,
    ungrouped: ungroupedMembers,
    totals: {
      totalGroups: groups?.length ?? 0,
      totalMembersInGroups: groupResults.reduce((sum, g) => sum + g.memberCount, 0),
      totalUngrouped: ungroupedMembers.length,
      totalAssignments,
      allExhibitors: allExhibitorNames,
    },
  })
}
