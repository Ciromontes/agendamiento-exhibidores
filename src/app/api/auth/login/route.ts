/**
 * app/api/auth/login/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST /api/auth/login
 *
 * Reemplaza el acceso directo al cliente de Supabase desde el
 * navegador para verificar access_key. Usa service_role_key
 * (servidor) para que la columna access_key nunca sea legible
 * desde el browser con el anon key.
 *
 * Body:  { access_key: string }
 * OK:    200 { user: User }
 * Error: 401 { error: "Clave inválida o usuario inactivo" }
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { access_key } = body as { access_key?: string }

    if (!access_key || typeof access_key !== 'string' || !access_key.trim()) {
      return NextResponse.json({ error: 'Clave requerida' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('access_key', access_key.trim())
      .eq('is_active', true)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: 'Clave inválida o usuario inactivo' },
        { status: 401 }
      )
    }

    return NextResponse.json({ user: data })
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
