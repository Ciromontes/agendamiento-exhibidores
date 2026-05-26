/**
 * app/api/admin/reservations/excel/preview/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST /api/admin/reservations/excel/preview
 *
 * Iteración 3 — UI Preview de importación de reservas.
 *
 * Analiza el archivo Excel y devuelve qué pasaría SIN aplicar
 * cambios. El admin puede revisar slotActions (CREADO,
 * ACTUALIZADO, ERROR) antes de confirmar la importación real
 * contra POST /api/admin/reservations/excel.
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '@/lib/supabase/admin-auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  readExcelFile,
  normalizeText,
  parseDayOfWeek,
  parseStartTime,
  parseAssigneeCell,
  parseBlockedInstruction,
  parseWeekDate,
  addDays,
  resolveExhibitor,
  resolveUser,
  DAY_LABELS,
  type SlotLookupRow,
  type ExhibitorLookupRow,
  type UserLookupRow,
  type ImportAssignment,
  type SlotAction,
  type SlotUpdatePatch,
  type SlotToCreate,
} from '@/lib/slots/excel-import'
import { hasTimeConflict, calculateEndTime, shortTime } from '@/lib/slots/conflict-detection'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
  let rows: Record<string, unknown>[]
  try {
    const parsed = readExcelFile(arrayBuffer)
    rows = parsed.rows
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  // ─── Obtener semana activa ────────────────────────────────
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
      { error: 'El archivo mezcla varias semanas. Usa una sola semana por archivo.' },
      { status: 422 },
    )
  }

  const targetWeek = detectedWeeks.size === 1 ? Array.from(detectedWeeks)[0] : defaultTargetWeek

  // ─── Cargar datos de referencia ───────────────────────────
  const [{ data: exhibitors }, { data: users }, { data: slots }] = await Promise.all([
    supabase
      .from('exhibitors')
      .select('id, name')
      .eq('congregation_id', admin.congregation_id)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('users')
      .select('id, name')
      .eq('congregation_id', admin.congregation_id)
      .eq('is_active', true),
    supabase
      .from('time_slots')
      .select('id, exhibitor_id, day_of_week, start_time, end_time, is_active, block_reason')
      .eq('congregation_id', admin.congregation_id),
  ])

  if (!exhibitors || exhibitors.length === 0) {
    return NextResponse.json(
      { error: 'No hay exhibidores activos en esta congregación.' },
      { status: 400 },
    )
  }

  const exhibitorsByName = new Map<string, ExhibitorLookupRow[]>()
  for (const ex of exhibitors as ExhibitorLookupRow[]) {
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
  const slotsByExhibitorAndDay = new Map<string, SlotLookupRow[]>()
  for (const s of (slots ?? []) as SlotLookupRow[]) {
    const key = `${s.exhibitor_id}|${s.day_of_week}|${s.start_time}`
    slotMap.set(key, s)
    const groupKey = `${s.exhibitor_id}|${s.day_of_week}`
    const current = slotsByExhibitorAndDay.get(groupKey) ?? []
    current.push(s)
    slotsByExhibitorAndDay.set(groupKey, current)
  }

  // ─── Validar filas ────────────────────────────────────────
  const errors: string[] = []
  const assignments: ImportAssignment[] = []
  let skipped = 0
  const seenSlotRows = new Set<string>()
  const slotUpdates = new Map<string, SlotUpdatePatch>()
  const slotActions: SlotAction[] = []
  const slotsToCreate: SlotToCreate[] = []
  // Mapa de slots pendientes del Excel (para detectar conflictos DENTRO del mismo archivo)
  const pendingSlotsByGroup = new Map<string, Array<{ start_time: string; end_time: string }>>()

  const addCellError = (rowNum: number, column: string, detail: string) => {
    errors.push(`Fila ${rowNum}, columna "${column}": ${detail}`)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    const exhibitorRaw = String(row.exhibidor ?? row.exhibitor ?? '').trim()
    const dayRaw = row.dia ?? row.day ?? ''
    const hourRaw = row.hora ?? row.hour ?? ''
    let userRaw = parseAssigneeCell(row.publicador_a ?? row.usuario ?? row.user ?? '')
    let companionRaw = parseAssigneeCell(row.publicador_b ?? row.acompanante ?? '')
    const blockedRaw = row.bloqueado ?? ''
    const estadoRaw = row.estado ?? ''
    const blockReasonRaw = String(row.motivo_bloqueo ?? '').trim()

    if (!userRaw && companionRaw) {
      userRaw = companionRaw
      companionRaw = ''
    }

    const hasAnyValue = [exhibitorRaw, dayRaw, hourRaw, userRaw, companionRaw, blockedRaw, blockReasonRaw]
      .some((v) => String(v ?? '').trim() !== '')
    if (!hasAnyValue) { skipped++; continue }

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
      addCellError(rowNum, 'hora', `valor inválido "${String(hourRaw)}". Usa formato HH:mm o HH:mm - HH:mm.`)
      continue
    }

    const exhibitor = resolveExhibitor(exhibitorRaw, exhibitorsByName, addCellError, rowNum)
    if (!exhibitor) continue

    const slotKey = `${exhibitor.id}|${dayOfWeek}|${startTime}`
    let slot = slotMap.get(slotKey)

    // Si no existe, validar conflictos y marcar como CREADO
    if (!slot) {
      const endTime = calculateEndTime(startTime)
      const groupKey = `${exhibitor.id}|${dayOfWeek}`

      // Detectar conflictos SOLO contra slots del mismo Excel (no contra la BD)
      // El Excel es la fuente de verdad
      const pendingForGroup = pendingSlotsByGroup.get(groupKey) ?? []
      const conflictingPending = pendingForGroup.find((s) =>
        hasTimeConflict(startTime, endTime, s.start_time, s.end_time),
      )

      if (conflictingPending) {
        // Error real: DOS filas del Excel se cruzan en el mismo exhibidor/día
        addCellError(
          rowNum,
          'hora',
          `conflicto DENTRO del Excel: ${shortTime(startTime)}-${shortTime(endTime)} se cruza con ${shortTime(conflictingPending.start_time)}-${shortTime(conflictingPending.end_time)}`,
        )
        continue
      }

      // Registrar este slot en pendientes para futuras comparaciones
      if (!pendingSlotsByGroup.has(groupKey)) {
        pendingSlotsByGroup.set(groupKey, [])
      }
      pendingSlotsByGroup.get(groupKey)!.push({ start_time: startTime, end_time: endTime })

      slotActions.push({
        rowNum,
        exhibitor_name: exhibitorRaw,
        day: String(dayRaw),
        hour: shortTime(startTime),
        action: 'CREADO',
      })

      slotsToCreate.push({
        exhibitor_id: exhibitor.id,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        congregation_id: admin.congregation_id,
      })

      continue
    }

    // ─── Slot existente: actualizar bloqueo/asignaciones ──────
    {
      const currentBlocked = !slot.is_active
      const blockedInstruction = parseBlockedInstruction(blockedRaw, estadoRaw)
      const effectiveBlocked = blockedInstruction.value === null ? currentBlocked : blockedInstruction.value

      let action: SlotAction['action'] = 'EXISTENTE'
      let actionMessage: string | undefined

      if (userRaw || companionRaw) {
        // Si hay asignaciones, forzar desbloqueo
        if (currentBlocked || blockedInstruction.value) {
          action = 'ACTUALIZADO'
          actionMessage = `Slot desbloqueado para asignar ${userRaw}${companionRaw ? ` y ${companionRaw}` : ''}`
        }
      } else if (blockedInstruction.value !== null && blockedInstruction.value !== currentBlocked) {
        action = 'ACTUALIZADO'
        actionMessage = blockedInstruction.value
          ? 'Slot marcado como No Disponible'
          : 'Slot desbloqueado'
      }

      slotActions.push({
        rowNum,
        exhibitor_name: exhibitorRaw,
        day: String(dayRaw),
        hour: shortTime(startTime),
        action,
        message: actionMessage,
        slot_id: slot.id,
      })

      // Actualizar slotUpdates para preview
      if (userRaw || companionRaw) {
        slotUpdates.set(slot.id, { is_active: true, block_reason: null })
      } else if (blockedInstruction.value !== null) {
        if (blockedInstruction.value) {
          slotUpdates.set(slot.id, { is_active: false, block_reason: blockReasonRaw || 'No Disponible' })
        } else {
          slotUpdates.set(slot.id, { is_active: true, block_reason: null })
        }
      }
    }

    if (seenSlotRows.has(slot.id)) {
      addCellError(rowNum, 'hora', 'slot duplicado en el archivo.')
      continue
    }
    seenSlotRows.add(slot.id)

    const blockedInstruction = parseBlockedInstruction(blockedRaw, estadoRaw)
    if (blockedInstruction.error) {
      addCellError(rowNum, 'bloqueado', blockedInstruction.error)
      continue
    }

    const currentBlocked = !slot.is_active
    let effectiveBlocked = blockedInstruction.value === null ? currentBlocked : blockedInstruction.value

    if (userRaw || companionRaw) {
      effectiveBlocked = false
    }

    if (!userRaw && !companionRaw) {
      if (!slotUpdates.has(slot.id)) {
        skipped++
      }
      continue
    }

    if (effectiveBlocked) {
      addCellError(rowNum, 'bloqueado', 'el slot está marcado como bloqueado. Desbloquéalo para asignar publicadores.')
      continue
    }

    const mainUser = resolveUser(userRaw, usersByName, addCellError, rowNum, 'publicador_a')
    if (!mainUser) continue

    let companionUser: UserLookupRow | null = null
    if (companionRaw) {
      companionUser = resolveUser(companionRaw, usersByName, addCellError, rowNum, 'publicador_b')
      if (!companionUser) continue
      if (companionUser.id === mainUser.id) {
        addCellError(rowNum, 'publicador_b', 'Publicador A y Publicador B no pueden ser la misma persona.')
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

  // ─── Respuesta preview (sin aplicar cambios) ──────────────
  const createdCount = slotActions.filter((a) => a.action === 'CREADO').length
  const updatedCount = slotActions.filter((a) => a.action === 'ACTUALIZADO').length
  const errorCount = slotActions.filter((a) => a.action === 'ERROR').length
  const warningCount = slotActions.filter((a) => a.action === 'WARNING').length
  const existingCount = slotActions.filter((a) => a.action === 'EXISTENTE').length
  const userAssignments = assignments.length

  return NextResponse.json({
    ok: errors.length === 0,
    preview: true,
    totalRows: rows.length,
    targetWeek,
    slotActions,
    createdSlots: createdCount,
    updatedSlots: updatedCount,
    errorSlots: errorCount,
    warningSlots: warningCount,
    existingSlots: existingCount,
    userAssignments,
    skipped,
    errors,
    message:
      errors.length > 0
        ? `Vista previa con ${errors.length} error(es). Revisa los detalles antes de confirmar.`
        : `Vista previa: ${createdCount} slot(es) por crear, ${updatedCount} por actualizar, ${userAssignments} asignaciones. Sin errores.`,
  })
}
