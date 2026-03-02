/**
 * app/api/auth/login/route.ts — V4 Multi-Tenant
 * ─────────────────────────────────────────────────────────────
 * POST /api/auth/login
 *
 * Reemplaza el acceso directo al cliente de Supabase desde el
 * navegador para verificar access_key. Usa service_role_key
 * (servidor) para que la columna access_key nunca sea legible
 * desde el browser con el anon key.
 *
 * V4: Acepta `slug` opcional para aislar la búsqueda por
 *     congregación. Si se omite slug, busca en todas las
 *     congregaciones (para el login global de la landing page).
 *
 * Seguridad:
 *   - Rate limiting: máx 10 intentos / 15 min por IP (→ 429)
 *   - Header Retry-After informa al cliente cuándo reintentar
 *
 * Body:  { access_key: string, slug?: string }
 * OK:    200 { user: User, congregationSlug: string }
 * Error: 400 Clave requerida
 *        401 Clave inválida o usuario inactivo
 *        404 Congregación no encontrada (si se pasa slug inválido)
 *        429 Demasiados intentos (+ header Retry-After)
 *        500 Error interno
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // ── Rate limiting por IP ──────────────────────────────────
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
    const { access_key, slug } = body as { access_key?: string; slug?: string }

    if (!access_key || typeof access_key !== 'string' || !access_key.trim()) {
      return NextResponse.json({ error: 'Clave requerida' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── V4: Si se provee slug, filtrar por congregation_id ──
    if (slug) {
      // 1. Buscar la congregación por slug
      const { data: congregation, error: congError } = await supabase
        .from('congregations')
        .select('id, slug, name')
        .eq('slug', slug.trim().toLowerCase())
        .eq('is_active', true)
        .single()

      if (congError || !congregation) {
        return NextResponse.json(
          { error: 'Congregación no encontrada' },
          { status: 404 }
        )
      }

      // 2. Buscar usuario en esa congregación
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('access_key', access_key.trim())
        .eq('is_active', true)
        .eq('congregation_id', congregation.id)
        .single()

      if (error || !data) {
        return NextResponse.json(
          { error: 'Clave inválida o usuario inactivo' },
          { status: 401 }
        )
      }

      return NextResponse.json({
        user: data,
        congregationSlug: congregation.slug,
      })
    }

    // ── Sin slug: buscar en todas las congregaciones (login global) ──
    const { data, error } = await supabase
      .from('users')
      .select('*, congregation:congregations(slug)')
      .eq('access_key', access_key.trim())
      .eq('is_active', true)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: 'Clave inválida o usuario inactivo' },
        { status: 401 }
      )
    }

    // Extraer el slug del join
    const congregationSlug =
      (data.congregation as unknown as { slug: string } | null)?.slug ?? 'principal'

    // Devolver el user sin el campo anidado congregation (no está en el tipo User)
    const { congregation: _congregation, ...user } = data

    return NextResponse.json({ user, congregationSlug })
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
