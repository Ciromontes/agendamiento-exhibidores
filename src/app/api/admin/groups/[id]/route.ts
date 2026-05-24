/**
 * app/api/admin/groups/[id]/route.ts
 * ──────────────────────────────────────────────────────
 * PUT    /api/admin/groups/[id]  → actualizar grupo
 * DELETE /api/admin/groups/[id]  → eliminar grupo
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ──────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export const dynamic = 'force-dynamic'

// ─── PUT — actualizar nombre o capitán ───────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params

  try {
    const body = await req.json()
    const { name, captain_id } = body

    const supabase = createServiceClient()

    // Verificar que el grupo existe en la congregación
    const { data: existing } = await supabase
      .from('user_groups')
      .select('id, captain_id')
      .eq('id', id)
      .eq('congregation_id', admin.congregation_id)
      .single()

    if (!existing) return NextResponse.json({ error: 'Grupo no encontrado.' }, { status: 404 })

    const updates: Record<string, unknown> = {}
    if (name?.trim()) updates.name = name.trim()

    if (captain_id) {
      const { data: captain } = await supabase
        .from('users')
        .select('id')
        .eq('id', captain_id)
        .eq('congregation_id', admin.congregation_id)
        .single()
      if (!captain) return NextResponse.json({ error: 'El capitán no existe.' }, { status: 400 })

      // Si cambia el capitán, actualizar el group_id del nuevo capitán
      if (captain_id !== existing.captain_id) {
        updates.captain_id = captain_id
        await supabase.from('users').update({ group_id: id }).eq('id', captain_id)
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No hay cambios para aplicar.' }, { status: 400 })
    }

    const { error } = await supabase
      .from('user_groups')
      .update(updates)
      .eq('id', id)

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe un grupo con ese nombre.' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error al procesar la solicitud.' }, { status: 400 })
  }
}

// ─── DELETE — eliminar grupo ─────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params

  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('user_groups')
    .select('id')
    .eq('id', id)
    .eq('congregation_id', admin.congregation_id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Grupo no encontrado.' }, { status: 404 })

  // Desasignar miembros antes de eliminar (group_id se pone en NULL por FK ON DELETE SET NULL)
  const { error } = await supabase
    .from('user_groups')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
