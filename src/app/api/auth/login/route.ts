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
 * Seguridad:
 *   - Rate limiting: máx 10 intentos / 15 min por IP (→ 429)
 *   - Header Retry-After informa al cliente cuándo reintentar
 *
 * Body:  { access_key: string }
 * OK:    200 { user: User }
 * Error: 400 Clave requerida
 *        401 Clave inválida o usuario inactivo
 *        429 Demasiados intentos (+ header Retry-After)
 *        500 Error interno
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // ── Rate limiting por IP ──────────────────────────────────
  // Extraer IP: Vercel pone x-forwarded-for, fallback a 'unknown'
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  const rl = checkRateLimit(ip)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Demasiados intentos. Intenta nuevamente en ${Math.ceil(rl.retryAfterSec / 60)} minutos.` },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSec),
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

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
