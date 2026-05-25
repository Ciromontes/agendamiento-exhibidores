/**
 * app/api/admin/groups/route.ts
 * ──────────────────────────────────────────────────────
 * GET  /api/admin/groups        → lista todos los grupos
 * POST /api/admin/groups        → crea un grupo nuevo
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ──────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export const dynamic = 'force-dynamic'

// ─── GET — listar grupos con conteo de miembros ──────────────
export async function GET(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('user_groups')
    .select(`
      id,
      name,
      captain_id,
      congregation_id,
      created_at,
      captain:users!user_groups_captain_id_fkey(name)
    `)
    .eq('congregation_id', admin.congregation_id)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Obtener conteo de miembros por grupo
  const { data: memberCounts, error: countError } = await supabase
    .from('users')
    .select('group_id')
    .eq('congregation_id', admin.congregation_id)
    .not('group_id', 'is', null)

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })

  const countMap = new Map<string, number>()
  for (const u of memberCounts ?? []) {
    if (u.group_id) {
      countMap.set(u.group_id, (countMap.get(u.group_id) ?? 0) + 1)
    }
  }

  const groups = (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    captain_id: g.captain_id,
    captain_name: Array.isArray(g.captain) ? (g.captain[0]?.name ?? '') : (g.captain as { name: string } | null)?.name ?? '',
    congregation_id: g.congregation_id,
    created_at: g.created_at,
    member_count: countMap.get(g.id) ?? 0,
  }))

  return NextResponse.json({ groups })
}

// ─── POST — crear grupo ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  try {
    const body = await req.json()
    const { name, captain_id } = body

    if (!name?.trim()) return NextResponse.json({ error: 'El nombre es obligatorio.' }, { status: 400 })

    const supabase = createServiceClient()

    // Validar que el capitán existe (si se especifica)
    if (captain_id) {
      const { data: captain } = await supabase
        .from('users')
        .select('id, name')
        .eq('id', captain_id)
        .eq('congregation_id', admin.congregation_id)
        .single()

      if (!captain) return NextResponse.json({ error: 'El capitán no existe o no pertenece a esta congregación.' }, { status: 400 })
    }

    // Crear el grupo
    const insertData: Record<string, unknown> = {
      name: name.trim(),
      congregation_id: admin.congregation_id,
    }
    if (captain_id) {
      insertData.captain_id = captain_id
    }

    const { data: group, error } = await supabase
      .from('user_groups')
      .insert(insertData)
      .select('id, name, captain_id, congregation_id, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe un grupo con ese nombre.' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Asignar el capitán al grupo (solo si se especificó)
    if (captain_id) {
      const { error: updateError } = await supabase
        .from('users')
        .update({ group_id: group.id })
        .eq('id', captain_id)

      if (updateError) {
        return NextResponse.json({ error: 'Grupo creado pero no se pudo asignar al capitán: ' + updateError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ group: { ...group, member_count: captain_id ? 1 : 0 } }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Error al procesar la solicitud.' }, { status: 400 })
  }
}
