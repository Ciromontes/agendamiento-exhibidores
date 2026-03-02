/**
 * app/api/admin/users/route.ts
 * ─────────────────────────────────────────────────────────────
 * GET  /api/admin/users        → lista todos los usuarios
 * POST /api/admin/users        → crea un usuario nuevo
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

// ─── GET — listar usuarios ────────────────────────────────────
export async function GET(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data })
}

// ─── POST — crear usuario ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  try {
    const body = await req.json()
    const { name, access_key, user_type, gender, is_admin, phone } = body

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('users')
      .insert({
        name: name?.trim(),
        access_key,
        user_type,
        gender: gender || null,
        is_admin: is_admin ?? false,
        is_active: true,
        phone: phone ? String(phone).replace(/\D/g, '') || null : null,
      })

    if (error) {
      const isDuplicate = error.code === '23505'
      return NextResponse.json(
        { error: isDuplicate ? 'Esa clave de acceso ya está en uso.' : error.message },
        { status: isDuplicate ? 409 : 500 }
      )
    }

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
