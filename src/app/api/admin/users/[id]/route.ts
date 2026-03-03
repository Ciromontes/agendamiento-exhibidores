/**
 * app/api/admin/users/[id]/route.ts
 * ─────────────────────────────────────────────────────────────
 * PATCH /api/admin/users/[id]  → actualiza un usuario
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
