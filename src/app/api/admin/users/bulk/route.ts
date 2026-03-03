/**
 * app/api/admin/users/bulk/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST /api/admin/users/bulk
 *
 * Acciones masivas sobre un conjunto de usuarios:
 *   { action: 'deactivate' | 'activate' | 'delete', ids: string[] }
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

export async function POST(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  let body: { action: string; ids: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const { action, ids } = body

  if (!action || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'Se requiere "action" y un array "ids" no vacío.' }, { status: 400 })
  }

  if (!['deactivate', 'activate', 'delete'].includes(action)) {
    return NextResponse.json({ error: `Acción inválida: "${action}". Usa: deactivate, activate, delete.` }, { status: 400 })
  }

  // No permitir que el admin se afecte a sí mismo
  if (ids.includes(admin.id)) {
    return NextResponse.json({ error: 'No puedes incluirte a ti mismo en una acción masiva.' }, { status: 400 })
  }

  const supabase = createServiceClient()

  if (action === 'deactivate') {
    const { error } = await supabase
      .from('users')
      .update({ is_active: false })
      .in('id', ids)
      .eq('congregation_id', admin.congregation_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, affected: ids.length, action })
  }

  if (action === 'activate') {
    const { error } = await supabase
      .from('users')
      .update({ is_active: true })
      .in('id', ids)
      .eq('congregation_id', admin.congregation_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, affected: ids.length, action })
  }

  if (action === 'delete') {
    // Para eliminar: limpiar dependencias primero
    // 1. Desvincular cónyuges que apunten a los eliminados
    await supabase
      .from('users')
      .update({ spouse_id: null })
      .in('spouse_id', ids)
      .eq('congregation_id', admin.congregation_id)

    // 2. Eliminar reservaciones
    await supabase
      .from('reservations')
      .delete()
      .in('user_id', ids)

    // 3. Eliminar invitaciones
    for (const id of ids) {
      await supabase
        .from('invitations')
        .delete()
        .or(`inviter_id.eq.${id},invitee_id.eq.${id}`)
    }

    // 4. Eliminar usuarios
    const { error } = await supabase
      .from('users')
      .delete()
      .in('id', ids)
      .eq('congregation_id', admin.congregation_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, affected: ids.length, action })
  }

  return NextResponse.json({ error: 'Acción no procesada.' }, { status: 400 })
}
