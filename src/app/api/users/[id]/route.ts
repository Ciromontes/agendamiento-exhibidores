/**
 * app/api/users/[id]/route.ts
 * ─────────────────────────────────────────────────────────────
 * GET /api/users/[id]
 *   Devuelve datos PÚBLICOS de un usuario: id, name, gender.
 *   NO devuelve access_key ni datos sensibles.
 *   No requiere autenticación — el nombre es info pública (visible
 *   en el grid de reservas).
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, gender')   // Solo campos públicos — nunca access_key
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  }

  return NextResponse.json(data)
}
