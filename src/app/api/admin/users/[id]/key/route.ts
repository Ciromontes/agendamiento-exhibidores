/**
 * app/api/admin/users/[id]/key/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST /api/admin/users/[id]/key
 *   Genera una nueva clave segura para el usuario y la guarda.
 *   Devuelve la clave en texto plano UNA SOLA VEZ.
 *
 * Requiere header: x-access-key: <admin_access_key>
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'

/**
 * generateSecureKey — Genera una clave de 16 caracteres con ~96 bits de entropía.
 * Igual al algoritmo del cliente, pero ejecutado en el servidor (Node.js crypto).
 * Excluye caracteres visualmente confusos: 0/O, 1/l/I.
 */
function generateSecureKey(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789@#$%&*+!'
  // Node.js: usar crypto.getRandomValues a través de la API global (disponible en Node 20+)
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => chars[b % chars.length]).join('')
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verifyAdmin(req)
  if (!admin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 })

  const newKey = generateSecureKey()
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('users')
    .update({ access_key: newKey })
    .eq('id', id)
    .eq('congregation_id', admin.congregation_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Devolver la clave en texto plano una sola vez
  return NextResponse.json({ key: newKey })
}
