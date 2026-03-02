/**
 * app/api/super-admin/congregations/[id]/route.ts
 * ─────────────────────────────────────────────────────────────
 * PATCH /api/super-admin/congregations/:id → Actualizar congregación
 *   Permite cambiar: name, is_active
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

function validateSuperAdminKey(req: NextRequest): boolean {
  const key = req.headers.get('x-super-admin-key')
  const expected = process.env.SUPER_ADMIN_KEY
  if (!expected) return false
  return key === expected
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateSuperAdminKey(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()
  const { name, is_active } = body as { name?: string; is_active?: boolean }

  const updates: Record<string, unknown> = {}
  if (typeof name === 'string') updates.name = name.trim()
  if (typeof is_active === 'boolean') updates.is_active = is_active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('congregations')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Congregación no encontrada' },
      { status: error ? 500 : 404 }
    )
  }

  return NextResponse.json(data)
}
