/**
 * app/api/admin/users/[id]/spouse/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST   /api/admin/users/[id]/spouse  → vincular cónyuge
 * DELETE /api/admin/users/[id]/spouse  → desvincular cónyuge
 *
 * POST body:  { spouse_id: string }
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

// ─── POST — vincular cónyuge ──────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  const { spouse_id } = await req.json()

  if (!id || !spouse_id) {
    return NextResponse.json({ error: 'Parámetros requeridos' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verificar que ambos usuarios pertenecen a la misma congregación que el admin
  const { data: users, error: checkError } = await supabase
    .from('users')
    .select('id, congregation_id')
    .in('id', [id, spouse_id])
    .eq('congregation_id', admin.congregation_id)

  if (checkError || !users || users.length !== 2) {
    return NextResponse.json({ error: 'Operación no permitida o usuarios no encontrados en esta congregación' }, { status: 403 })
  }

  const { error } = await supabase.rpc('vincular_conyuges', {
    p_user_a: id,
    p_user_b: spouse_id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ─── DELETE — desvincular cónyuge ────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  const supabase = createServiceClient()

  // Verificar que el usuario pertenece a la congregación del admin
  const { data: user, error: checkError } = await supabase
    .from('users')
    .select('id, congregation_id')
    .eq('id', id)
    .eq('congregation_id', admin.congregation_id)
    .single()

  if (checkError || !user) {
    return NextResponse.json({ error: 'Operación no permitida o usuario no encontrado' }, { status: 403 })
  }

  const { error } = await supabase.rpc('desvincular_conyuges', {
    p_user_id: id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
