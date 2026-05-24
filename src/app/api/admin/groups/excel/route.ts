/**
 * app/api/admin/groups/excel/route.ts
 * ──────────────────────────────────────────────────────
 * GET  /api/admin/groups/excel   → descargar grupos.xlsx
 * POST /api/admin/groups/excel   → importar grupos desde Excel
 *
 * Formato Excel (iteración 5):
 *   grupo       | nombre_usuario    | es_capitan
 *   Grupo A     | Juan Perez        | SI
 *   Grupo A     | Maria Gomez       | NO
 *
 * Reglas:
 *   - 'nombre_usuario' debe existir en la BD
 *   - 'SI' en es_capitan marca al usuario como capitán del grupo
 *   - Un solo capitán por grupo
 *   - Si el grupo no existe, se crea automáticamente
 *   - Si el usuario ya pertenece a otro grupo, se reasigna
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ──────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

// ─── GET — descargar grupos.xlsx ─────────────────────────────
export async function GET(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const supabase = createServiceClient()

  const { data: groups, error: groupError } = await supabase
    .from('user_groups')
    .select('id, name, captain_id')
    .eq('congregation_id', admin.congregation_id)
    .order('name')

  if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 })

  if (!groups || groups.length === 0) {
    // Excel vacío
    const emptyRows = [{ grupo: '', nombre_usuario: '', es_capitan: '' }]
    const ws = XLSX.utils.json_to_sheet(emptyRows)
    ws['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Grupos')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="grupos.xlsx"',
      },
    })
  }

  const groupIds = groups.map((g) => g.id)

  const { data: members, error: memberError } = await supabase
    .from('users')
    .select('id, name, group_id')
    .in('group_id', groupIds)
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)
    .order('name')

  if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 })

  const groupNameMap = new Map(groups.map((g) => [g.id, g.name]))
  const captainIds = new Map<string, string>()
  for (const g of groups) {
    captainIds.set(g.id, g.captain_id)
  }

  const rows = (members ?? []).map((m) => ({
    grupo: groupNameMap.get(m.group_id ?? '') ?? '',
    nombre_usuario: m.name,
    es_capitan: captainIds.get(m.group_id ?? '') === m.id ? 'SI' : 'NO',
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Grupos')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="grupos.xlsx"',
    },
  })
}

// ─── POST — importar grupos desde Excel ──────────────────────
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Se esperaba FormData con archivo.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No se encontró el archivo.' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return NextResponse.json({ error: 'El archivo no contiene hojas.' }, { status: 400 })

  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]
  if (rawRows.length === 0) return NextResponse.json({ error: 'El Excel está vacío.' }, { status: 400 })

  const supabase = createServiceClient()

  // ─── Cargar datos de referencia ─────────────────────────
  const { data: users } = await supabase
    .from('users')
    .select('id, name, captain_id')
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)

  const { data: existingGroups } = await supabase
    .from('user_groups')
    .select('id, name, captain_id')
    .eq('congregation_id', admin.congregation_id)

  const usersByName = new Map((users ?? []).map((u) => [normalizeText(u.name), u.id]))
  const groupsByName = new Map((existingGroups ?? []).map((g) => [normalizeText(g.name), g]))
  const groupCaptainMap = new Map<string, string>()
  for (const g of existingGroups ?? []) {
    groupCaptainMap.set(g.id, g.captain_id)
  }

  const errors: string[] = []
  const groupsToCreate = new Map<string, string[]>()  // groupNameRaw → [userNamesRaw]
  const captainsMap = new Map<string, string>()       // groupNameRaw → userNameRaw

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNum = i + 2

    const groupName = String(row.grupo ?? '').trim()
    const userName = String(row.nombre_usuario ?? '').trim()
    const isCaptain = String(row.es_capitan ?? '').trim().toUpperCase()

    if (!groupName || !userName) continue

    const userId = usersByName.get(normalizeText(userName))
    if (!userId) {
      errors.push(`Fila ${rowNum}: "${userName}" no existe en la BD.`)
      continue
    }

    if (!groupsToCreate.has(groupName)) {
      groupsToCreate.set(groupName, [])
    }
    groupsToCreate.get(groupName)!.push(userName)

    if (isCaptain === 'SI') {
      if (captainsMap.has(groupName)) {
        errors.push(`Fila ${rowNum}: "${groupName}" ya tiene un capitán (${captainsMap.get(groupName)}). Solo uno por grupo.`)
      } else {
        captainsMap.set(groupName, userName)
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({
      ok: false, rejected: true,
      errors,
      message: 'El archivo tiene errores. No se guardó ningún cambio.',
    }, { status: 422 })
  }

  // ─── Procesar grupos ─────────────────────────────────────
  const created: string[] = []
  const updated: string[] = []
  const assignments: Array<{ userId: string; groupId: string; isCaptain: boolean }> = []

  for (const [groupName, memberNames] of groupsToCreate) {
    const normalizedName = normalizeText(groupName)
    let group = groupsByName.get(normalizedName)

    if (group) {
      // Grupo existe
      const captainName = captainsMap.get(groupName)
      if (captainName) {
        const captainId = usersByName.get(normalizeText(captainName))
        if (captainId && captainId !== group.captain_id) {
          const { error: updateError } = await supabase
            .from('user_groups')
            .update({ captain_id: captainId })
            .eq('id', group.id)
          if (!updateError) {
            groupCaptainMap.set(group.id, captainId)
            updated.push(`Capitán de "${groupName}" actualizado a "${captainName}"`)
          }
        }
      }
    } else {
      // Crear grupo nuevo
      const firstCaptain = captainsMap.get(groupName)
      const captainId = firstCaptain ? usersByName.get(normalizeText(firstCaptain)) : null
      const { data: newGroup, error: insertError } = await supabase
        .from('user_groups')
        .insert({
          name: groupName,
          captain_id: captainId || memberNames.length > 0 ? usersByName.get(normalizeText(memberNames[0])) : null,
          congregation_id: admin.congregation_id,
        })
        .select('id, name, captain_id')
        .single()

      if (insertError) {
        errors.push(`No se pudo crear el grupo "${groupName}": ${insertError.message}`)
        continue
      }

      group = newGroup
      groupsByName.set(normalizedName, newGroup)
      created.push(groupName)
      created.push(`Capitán de "${groupName}" asignado: ${firstCaptain || memberNames[0]}`)
      updated.push(`Se asignó un capitán al grupo "${groupName}".`)
    }

    // Asignar miembros al grupo
    for (const memberName of memberNames) {
      const memberId = usersByName.get(normalizeText(memberName))
      if (!memberId || !group) continue
      assignments.push({
        userId: memberId,
        groupId: group.id,
        isCaptain: captainsMap.get(groupName) === memberName,
      })
    }
  }

  // ─── Asignar group_id a los usuarios ─────────────────────
  // Primero limpiamos todos los usuarios que están en estos grupos para
  // evitar conflictos con quienes fueron removidos del Excel
  const allGroupIds = [...new Set(assignments.map((a) => a.groupId))]

  // Luego asignamos los group_id
  for (const assignment of assignments) {
    const { error: assignError } = await supabase
      .from('users')
      .update({ group_id: assignment.groupId })
      .eq('id', assignment.userId)

    if (assignError) {
      errors.push(`Error al asignar usuario: ${assignError.message}`)
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    totalRows: rawRows.length,
    created: created.length,
    updated: updated.length,
    errors,
    message: `Grupos procesados. Creados: ${created.length}, Actualizados: ${updated.length}.`,
    details: { created, updated },
  })
}
