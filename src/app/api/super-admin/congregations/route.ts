/**
 * app/api/super-admin/congregations/route.ts
 * ─────────────────────────────────────────────────────────────
 * GET  /api/super-admin/congregations → Listar todas las congregaciones
 * POST /api/super-admin/congregations → Crear nueva congregación
 *
 * Seguridad: requiere header X-Super-Admin-Key con el valor de
 * la variable de entorno SUPER_ADMIN_KEY.
 *
 * Al crear una congregación, también crea:
 *   - Un registro en app_config con valores por defecto
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

// ── GET: listar congregaciones ────────────────────────────────
export async function GET(req: NextRequest) {
  if (!validateSuperAdminKey(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('congregations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// ── POST: crear congregación ──────────────────────────────────
export async function POST(req: NextRequest) {
  if (!validateSuperAdminKey(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const body = await req.json()
  const { name, slug } = body as { name?: string; slug?: string }

  if (!name || !slug) {
    return NextResponse.json(
      { error: 'Se requieren name y slug' },
      { status: 400 }
    )
  }

  // Normalizar slug: minúsculas, sin espacios, solo alfanumérico + guiones
  const normalizedSlug = slug
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')

  if (normalizedSlug.length < 2) {
    return NextResponse.json(
      { error: 'El slug debe tener al menos 2 caracteres válidos (a-z, 0-9, -)' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  // Crear la congregación
  const { data: congregation, error: congError } = await supabase
    .from('congregations')
    .insert({ name: name.trim(), slug: normalizedSlug, is_active: true })
    .select()
    .single()

  if (congError) {
    if (congError.code === '23505') {
      return NextResponse.json(
        { error: `Ya existe una congregación con el slug "${normalizedSlug}"` },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: congError.message }, { status: 500 })
  }

  // Crear app_config por defecto para la nueva congregación
  const { error: configError } = await supabase
    .from('app_config')
    .insert({ congregation_id: congregation.id })

  if (configError) {
    // No es fatal, pero lo reportamos
    console.error('Error creando app_config para nueva congregación:', configError.message)
  }

  return NextResponse.json(congregation, { status: 201 })
}
