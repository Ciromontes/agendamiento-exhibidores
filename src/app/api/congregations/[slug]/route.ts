/**
 * app/api/congregations/[slug]/route.ts
 * ─────────────────────────────────────────────────────────────
 * GET /api/congregations/:slug
 * Retorna el nombre y datos básicos (no sensibles) de una congregación.
 * Usado por la página de login slug para mostrar el nombre.
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  if (!slug) {
    return NextResponse.json({ error: 'Slug requerido' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('congregations')
    .select('id, name, slug, is_active')
    .eq('slug', slug.trim().toLowerCase())
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Congregación no encontrada' }, { status: 404 })
  }

  return NextResponse.json(data)
}
