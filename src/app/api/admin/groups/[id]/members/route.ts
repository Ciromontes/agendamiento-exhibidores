/**
 * app/api/admin/groups/[id]/members/route.ts
 * ──────────────────────────────────────────────────────
 * GET    /api/admin/groups/[id]/members  → lista miembros
 * POST   /api/admin/groups/[id]/members  → agrega miembro
 * DELETE /api/admin/groups/[id]/members  → quita miembro
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ──────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export const dynamic = 'force-dynamic'

// ─── GET — listar miembros ───────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  const supabase = createServiceClient()

  const { data: group } = await supabase
    .from('user_groups')
    .select('id')
    .eq('id', id)
    .eq('congregation_id', admin.congregation_id)
    .single()

  if (!group) return NextResponse.json({ error: 'Grupo no encontrado.' }, { status: 404 })

  const { data, error } = await supabase
    .from('users')
    .select('id, name, user_type, gender')
    .eq('group_id', id)
    .eq('congregation_id', admin.congregation_id)
    .eq('is_active', true)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ members: data })
}

// ─── POST — agregar miembro ──────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params

  try {
    const body = await req.json()
    const { user_id } = body

    if (!user_id) return NextResponse.json({ error: 'Se requiere user_id.' }, { status: 400 })

    const supabase = createServiceClient()

    // Verificar que el grupo existe
    const { data: group } = await supabase
      .from('user_groups')
      .select('id')
      .eq('id', id)
      .eq('congregation_id', admin.congregation_id)
      .single()

    if (!group) return NextResponse.json({ error: 'Grupo no encontrado.' }, { status: 404 })

    // Verificar que el usuario existe y es de la congregación
    const { data: user } = await supabase
      .from('users')
      .select('id, name, group_id')
      .eq('id', user_id)
      .eq('congregation_id', admin.congregation_id)
      .eq('is_active', true)
      .single()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado o inactivo.' }, { status: 404 })

    if (user.group_id) {
      return NextResponse.json({ error: `"${user.name}" ya pertenece a otro grupo.` }, { status: 409 })
    }

    const { error } = await supabase
      .from('users')
      .update({ group_id: id })
      .eq('id', user_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, member: { id: user.id, name: user.name } }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Error al procesar la solicitud.' }, { status: 400 })
  }
}

// ─── DELETE — quitar miembro ─────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const user_id = searchParams.get('user_id')

  if (!user_id) return NextResponse.json({ error: 'Se requiere user_id.' }, { status: 400 })

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('users')
    .update({ group_id: null })
    .eq('id', user_id)
    .eq('group_id', id)
    .eq('congregation_id', admin.congregation_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
