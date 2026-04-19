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
 *   semana | exhibidor | dia | hora | usuario | acompanante | bloqueado | motivo_bloqueo
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

type SlotLookupRow = {
  id: string
  exhibitor_id: string
  day_of_week: number
  start_time: string
  is_active: boolean
  block_reason: string | null
}

type UserLookupRow = {
  id: string
  name: string
}

type ExhibitorLookupRow = {
  id: string
  name: string
}

type ImportAssignment = {
  time_slot_id: string
  user_id: string
  week_start: string
  status: 'confirmed'
  slot_position: number
  congregation_id: string
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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function parseWeekDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0]
  }

  // Excel serial date (days since 1899-12-30)
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    const d = new Date(excelEpoch.getTime() + Math.round(value) * 86400000)
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }

  const raw = String(value ?? '').trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().split('T')[0]
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function normalizeColumn(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .trim()
}

function parseDayOfWeek(value: unknown): number | null {
  const day = normalizeText(value).replace('.', '')
  if (!day) return null

  if (/^[0-6]$/.test(day)) return parseInt(day, 10)

  const map: Record<string, number> = {
    domingo: 0,
    dom: 0,
    lunes: 1,
    lun: 1,
    martes: 2,
    mar: 2,
    miercoles: 3,
    mier: 3,
    mierc: 3,
    jueves: 4,
    jue: 4,
    viernes: 5,
    vie: 5,
    sabado: 6,
    sab: 6,
  }

  return map[day] ?? null
}

function parseStartTime(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const firstPart = raw.split(/-|–|—/)[0].trim()

  const ampm = firstPart.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i)
  if (ampm) {
    let hours = parseInt(ampm[1], 10)
    const mins = ampm[2]
    const suffix = ampm[3].toLowerCase()
    if (suffix === 'pm' && hours < 12) hours += 12
    if (suffix === 'am' && hours === 12) hours = 0
    if (hours < 0 || hours > 23) return null
    return `${String(hours).padStart(2, '0')}:${mins}:00`
  }

  const hhmm = firstPart.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!hhmm) return null

  const hours = parseInt(hhmm[1], 10)
  const mins = hhmm[2]
  if (hours < 0 || hours > 23) return null

  return `${String(hours).padStart(2, '0')}:${mins}:00`
}

function parseAssigneeCell(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const normalized = normalizeText(raw)
  if (['no disponible', 'no-disponible', 'n/a', 'na', 'nd', 'bloqueado'].includes(normalized)) {
    return ''
  }

  return raw
}

function parseBlockedInstruction(
  blockedRaw: unknown,
  estadoRaw: unknown,
): { value: boolean | null; error?: string } {
  const blocked = normalizeText(blockedRaw)
  if (blocked) {
    if (
      ['si', 'yes', 'true', '1', 'bloqueado', 'no disponible', 'no-disponible', 'inactivo'].includes(
        blocked,
      )
    ) {
      return { value: true }
    }
    if (['no', 'false', '0', 'libre', 'parcial', 'completo', 'disponible', 'activo'].includes(blocked)) {
      return { value: false }
    }
    return {
      value: null,
      error: 'valor inválido. Usa No Disponible/Bloqueado o Disponible/No.',
    }
  }

  // Compatibilidad con plantillas antiguas que traían columna "estado".
  const estado = normalizeText(estadoRaw)
  if (estado === 'bloqueado') return { value: true }
  if (['libre', 'parcial', 'completo'].includes(estado)) return { value: false }

  return { value: null }
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
      { wch: 12 }, // bloqueado
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
    const blockedLabel = slot.is_active ? '' : 'No Disponible'
    const rawReason = String(slot.block_reason ?? '').trim()
    const normalizedReason = normalizeText(rawReason)
    const reasonLabel = !slot.is_active && (!rawReason || normalizedReason === 'bloqueado desde excel')
      ? 'No Disponible'
      : rawReason

    return {
      semana: activeWeek,
      exhibidor: getExhibitorName(slot.exhibitor),
      dia: DAY_LABELS[slot.day_of_week] ?? String(slot.day_of_week),
      hora: `${shortTime(slot.start_time)} - ${shortTime(slot.end_time)}`,
      usuario: slot.is_active ? occ.pos1 : 'No Disponible',
      acompanante: slot.is_active ? occ.pos2 : 'No Disponible',
      bloqueado: blockedLabel,
      motivo_bloqueo: reasonLabel,
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
    { wch: 12 }, // bloqueado
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

export async function POST(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Se esperaba FormData con archivo.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No se encontró el archivo en el campo "file".' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]

  if (!ws) {
    return NextResponse.json({ error: 'El archivo no contiene hojas.' }, { status: 400 })
  }

  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]
  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'El Excel está vacío.' }, { status: 400 })
  }

  const rows = rawRows.map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeColumn(key)] = value
    }
    return normalized
  })

  const supabase = createServiceClient()

  const { data: cfg, error: cfgError } = await supabase
    .from('app_config')
    .select('active_week_start')
    .eq('congregation_id', admin.congregation_id)
    .limit(1)
    .single()

  if (cfgError || !cfg?.active_week_start) {
    return NextResponse.json(
      { error: 'No se pudo obtener la semana activa de la congregación.' },
      { status: 500 },
    )
  }

  const sourceWeek = cfg.active_week_start as string
  const defaultTargetWeek = addDays(sourceWeek, 7)

  const detectedWeeks = new Set<string>()
  for (const row of rows) {
    const weekValue = row.semana ?? row.week_start ?? row.week
    const parsedWeek = parseWeekDate(weekValue)
    if (parsedWeek) detectedWeeks.add(parsedWeek)
  }

  if (detectedWeeks.size > 1) {
    return NextResponse.json(
      {
        error:
          'El archivo mezcla varias semanas en la columna "semana". Usa una sola semana por archivo.',
      },
      { status: 422 },
    )
  }

  const targetWeek = detectedWeeks.size === 1 ? Array.from(detectedWeeks)[0] : defaultTargetWeek

  const { data: exhibitors, error: exhibError } = await supabase
    .from('exhibitors')
    .select('id, name')
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (exhibError) {
    return NextResponse.json({ error: exhibError.message }, { status: 500 })
  }

  if (!exhibitors || exhibitors.length === 0) {
    return NextResponse.json({ error: 'No hay exhibidores activos en esta congregación.' }, { status: 400 })
  }

  const exhibitorIds = exhibitors.map((e) => e.id)

  const { data: slots, error: slotError } = await supabase
    .from('time_slots')
    .select('id, exhibitor_id, day_of_week, start_time, is_active, block_reason')
    .eq('congregation_id', admin.congregation_id)
    .in('exhibitor_id', exhibitorIds)

  if (slotError) {
    return NextResponse.json({ error: slotError.message }, { status: 500 })
  }

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, name')
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 })
  }

  const exhibitorsByName = new Map<string, ExhibitorLookupRow[]>()
  for (const ex of (exhibitors ?? []) as ExhibitorLookupRow[]) {
    const key = normalizeText(ex.name)
    const current = exhibitorsByName.get(key) ?? []
    current.push(ex)
    exhibitorsByName.set(key, current)
  }

  const usersByName = new Map<string, UserLookupRow[]>()
  for (const u of (users ?? []) as UserLookupRow[]) {
    const key = normalizeText(u.name)
    const current = usersByName.get(key) ?? []
    current.push(u)
    usersByName.set(key, current)
  }

  const slotMap = new Map<string, SlotLookupRow>()
  for (const s of (slots ?? []) as SlotLookupRow[]) {
    const key = `${s.exhibitor_id}|${s.day_of_week}|${s.start_time}`
    slotMap.set(key, s)
  }

  const errors: string[] = []
  const assignments: ImportAssignment[] = []
  let skipped = 0
  const seenSlotRows = new Set<string>()
  const slotUpdates = new Map<string, { is_active: boolean; block_reason: string | null }>()

  const addCellError = (rowNum: number, column: string, detail: string) => {
    errors.push(`Fila ${rowNum}, columna "${column}": ${detail}`)
  }

  const resolveExhibitor = (name: string, rowNum: number): ExhibitorLookupRow | null => {
    const normalized = normalizeText(name)
    const found = exhibitorsByName.get(normalized) ?? []
    if (found.length === 0) {
      addCellError(rowNum, 'exhibidor', `"${name}" no existe en esta congregación.`)
      return null
    }
    if (found.length > 1) {
      addCellError(rowNum, 'exhibidor', `valor ambiguo "${name}". Usa un nombre único.`)
      return null
    }
    return found[0]
  }

  const resolveUser = (name: string, rowNum: number, label: 'usuario' | 'acompanante'): UserLookupRow | null => {
    const normalized = normalizeText(name)
    const found = usersByName.get(normalized) ?? []
    if (found.length === 0) {
      addCellError(rowNum, label, `"${name}" no existe o está inactivo.`)
      return null
    }
    if (found.length > 1) {
      addCellError(rowNum, label, `valor ambiguo "${name}". Se requieren nombres únicos.`)
      return null
    }
    return found[0]
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    const exhibitorRaw = String(row.exhibidor ?? row.exhibitor ?? '').trim()
    const dayRaw = row.dia ?? row.day ?? ''
    const hourRaw = row.hora ?? row.hour ?? ''
    let userRaw = parseAssigneeCell(row.usuario ?? row.user ?? '')
    let companionRaw = parseAssigneeCell(row.acompanante ?? '')
    const blockedRaw = row.bloqueado ?? ''
    const estadoRaw = row.estado ?? ''
    const blockReasonRaw = String(row.motivo_bloqueo ?? '').trim()

    // Si el principal quedó vacío pero hay acompañante, promovemos el acompañante
    // para evitar que el archivo sea rechazado por una edición parcial.
    if (!userRaw && companionRaw) {
      userRaw = companionRaw
      companionRaw = ''
    }

    const hasAnyValue = [
      exhibitorRaw,
      dayRaw,
      hourRaw,
      userRaw,
      companionRaw,
      blockedRaw,
      blockReasonRaw,
    ].some(
      (v) => String(v ?? '').trim() !== '',
    )
    if (!hasAnyValue) {
      skipped++
      continue
    }

    if (!exhibitorRaw) {
      addCellError(rowNum, 'exhibidor', 'falta valor obligatorio.')
      continue
    }

    const dayOfWeek = parseDayOfWeek(dayRaw)
    if (dayOfWeek === null) {
      addCellError(rowNum, 'dia', `valor inválido "${String(dayRaw)}".`)
      continue
    }

    const startTime = parseStartTime(hourRaw)
    if (!startTime) {
      addCellError(
        rowNum,
        'hora',
        `valor inválido "${String(hourRaw)}". Usa formato HH:mm o HH:mm - HH:mm.`,
      )
      continue
    }

    const exhibitor = resolveExhibitor(exhibitorRaw, rowNum)
    if (!exhibitor) continue

    const slotKey = `${exhibitor.id}|${dayOfWeek}|${startTime}`
    const slot = slotMap.get(slotKey)

    if (!slot) {
      addCellError(
        rowNum,
        'hora',
        `no existe slot para ${exhibitorRaw} (${String(dayRaw)} ${shortTime(startTime)}).`,
      )
      continue
    }

    if (seenSlotRows.has(slot.id)) {
      addCellError(rowNum, 'hora', 'slot duplicado en el archivo. Usa una sola fila por horario.')
      continue
    }
    seenSlotRows.add(slot.id)

    const blockedInstruction = parseBlockedInstruction(blockedRaw, estadoRaw)
    if (blockedInstruction.error) {
      addCellError(rowNum, 'bloqueado', blockedInstruction.error)
      continue
    }

    const currentBlocked = !slot.is_active
    const effectiveBlocked = blockedInstruction.value === null ? currentBlocked : blockedInstruction.value

    if (blockedInstruction.value !== null) {
      if (blockedInstruction.value) {
        const reasonToSave = blockReasonRaw || slot.block_reason || 'No Disponible'
        slotUpdates.set(slot.id, { is_active: false, block_reason: reasonToSave })
      } else {
        slotUpdates.set(slot.id, { is_active: true, block_reason: null })
      }
    }

    if (!userRaw && !companionRaw) {
      skipped++
      continue
    }

    if (!userRaw && companionRaw) {
      addCellError(rowNum, 'usuario', 'no puedes definir acompañante sin usuario principal.')
      continue
    }

    if (effectiveBlocked) {
      addCellError(
        rowNum,
        'bloqueado',
        'el slot está marcado como bloqueado. Desbloquéalo para asignar usuario/acompañante.',
      )
      continue
    }

    const mainUser = resolveUser(userRaw, rowNum, 'usuario')
    if (!mainUser) continue

    let companionUser: UserLookupRow | null = null
    if (companionRaw) {
      companionUser = resolveUser(companionRaw, rowNum, 'acompanante')
      if (!companionUser) continue
      if (companionUser.id === mainUser.id) {
        addCellError(rowNum, 'acompanante', 'usuario y acompañante no pueden ser la misma persona.')
        continue
      }
    }

    assignments.push({
      time_slot_id: slot.id,
      user_id: mainUser.id,
      week_start: targetWeek,
      status: 'confirmed',
      slot_position: 1,
      congregation_id: admin.congregation_id,
    })

    if (companionUser) {
      assignments.push({
        time_slot_id: slot.id,
        user_id: companionUser.id,
        week_start: targetWeek,
        status: 'confirmed',
        slot_position: 2,
        congregation_id: admin.congregation_id,
      })
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        totalRows: rows.length,
        created: 0,
        updated: 0,
        skipped,
        errors,
        rejected: true,
        message: 'El archivo tiene errores. No se guardó ningún cambio.',
      },
      { status: 422 },
    )
  }

  let updated = 0
  for (const [slotId, patch] of slotUpdates.entries()) {
    const { error: slotUpdateError } = await supabase
      .from('time_slots')
      .update(patch)
      .eq('id', slotId)
      .eq('congregation_id', admin.congregation_id)

    if (slotUpdateError) {
      return NextResponse.json(
        { error: 'No se pudo actualizar bloqueos de slots: ' + slotUpdateError.message },
        { status: 500 },
      )
    }
    updated++
  }

  const [{ error: clearResError }, { error: clearInvError }, { error: clearReliefError }, { error: clearAbsError }] =
    await Promise.all([
      supabase
        .from('reservations')
        .delete()
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', targetWeek),
      supabase
        .from('invitations')
        .update({ status: 'declined' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', targetWeek)
        .eq('status', 'pending'),
      supabase
        .from('relief_requests')
        .update({ status: 'cancelled' })
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', targetWeek)
        .eq('status', 'pending'),
      supabase
        .from('absences')
        .delete()
        .eq('congregation_id', admin.congregation_id)
        .eq('week_start', targetWeek),
    ])

  if (clearResError || clearInvError || clearReliefError || clearAbsError) {
    return NextResponse.json(
      {
        error:
          clearResError?.message ||
          clearInvError?.message ||
          clearReliefError?.message ||
          clearAbsError?.message ||
          'No se pudo limpiar la semana destino.',
      },
      { status: 500 },
    )
  }

  let created = 0
  if (assignments.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from('reservations')
      .insert(assignments)
      .select('id')

    if (insertError) {
      return NextResponse.json(
        { error: 'No se pudo aplicar la carga de reservas: ' + insertError.message },
        { status: 500 },
      )
    }

    created = inserted?.length ?? assignments.length
  }

  return NextResponse.json({
    ok: true,
    totalRows: rows.length,
    created,
    updated,
    skipped,
    errors: [],
    message: `Reservas aplicadas correctamente para la semana ${targetWeek}.`,
    targetWeek,
  })
}
