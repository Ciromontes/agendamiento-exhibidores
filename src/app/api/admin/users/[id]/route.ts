/**
 * app/api/admin/users/[id]/route.ts
 * ─────────────────────────────────────────────────────────────
 * PATCH  /api/admin/users/[id]  → actualiza un usuario
 * DELETE /api/admin/users/[id]  → elimina permanentemente un usuario
 *
 * Acepta cualquier subconjunto de campos actualizables:
 *   name, access_key, user_type, gender, is_admin, is_active, phone
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  try {
    const body = await req.json()

    // Construir payload con solo los campos enviados
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {}

    if (body.name       !== undefined) payload.name       = String(body.name).trim()
    if (body.access_key !== undefined) payload.access_key = body.access_key
    if (body.user_type  !== undefined) payload.user_type  = body.user_type
    if (body.gender     !== undefined) payload.gender     = body.gender || null
    if (body.is_admin   !== undefined) payload.is_admin   = Boolean(body.is_admin)
    if (body.is_active  !== undefined) payload.is_active  = Boolean(body.is_active)
    if (body.phone      !== undefined) {
      payload.phone = body.phone ? String(body.phone).replace(/\D/g, '') || null : null
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('users')
      .update(payload)
      .eq('id', id)
      .eq('congregation_id', admin.congregation_id)

    if (error) {
      const isDuplicate = error.code === '23505'
      return NextResponse.json(
        { error: isDuplicate ? 'Esa clave de acceso ya está en uso.' : error.message },
        { status: isDuplicate ? 409 : 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ─── DELETE — eliminar usuario permanentemente ─────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  // No permitir que el admin se elimine a sí mismo
  if (id === admin.id) {
    return NextResponse.json({ error: 'No puedes eliminarte a ti mismo.' }, { status: 400 })
  }

  try {
    const supabase = createServiceClient()

    // Primero desvincular cónyuge si existe
    const { data: user } = await supabase
      .from('users')
      .select('spouse_id')
      .eq('id', id)
      .eq('congregation_id', admin.congregation_id)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 })
    }

    if (user.spouse_id) {
      await supabase
        .from('users')
        .update({ spouse_id: null })
        .eq('id', user.spouse_id)
        .eq('congregation_id', admin.congregation_id)
    }

    // Eliminar reservaciones del usuario
    await supabase
      .from('reservations')
      .delete()
      .eq('user_id', id)

    // Eliminar invitaciones del usuario
    await supabase
      .from('invitations')
      .delete()
      .or(`inviter_id.eq.${id},invitee_id.eq.${id}`)

    // Eliminar el usuario
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id)
      .eq('congregation_id', admin.congregation_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error interno al eliminar.' }, { status: 500 })
  }
}