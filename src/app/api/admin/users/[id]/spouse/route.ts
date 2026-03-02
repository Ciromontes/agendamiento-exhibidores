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
  const { error } = await supabase.rpc('desvincular_conyuges', {
    p_user_id: id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
