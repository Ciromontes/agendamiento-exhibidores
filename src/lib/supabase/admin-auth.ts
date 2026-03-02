/**
 * lib/supabase/admin-auth.ts
 * ─────────────────────────────────────────────────────────────
 * Helper para verificar que el request proviene de un admin.
 *
 * El cliente envía su access_key en el header "x-access-key".
 * Este helper la valida contra la BD con el service_role_key.
 *
 * Uso en API Routes:
 *   const admin = await verifyAdmin(request)
 *   if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest } from 'next/server'
import { createServiceClient } from './service'
import { User } from '@/types'

/**
 * Verifica que el header x-access-key corresponda a un usuario
 * activo con is_admin=true. Devuelve el usuario o null.
 */
export async function verifyAdmin(req: NextRequest): Promise<User | null> {
  const accessKey = req.headers.get('x-access-key')
  if (!accessKey) return null

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('access_key', accessKey)
    .eq('is_admin', true)
    .eq('is_active', true)
    .single()

  if (error || !data) return null
  return data as User
}
