/**
 * app/api/invite-candidates/route.ts
 * ─────────────────────────────────────────────────────────────
 * POST /api/invite-candidates
 *
 * Retorna los usuarios candidatos para invitar a un turno:
 * activos, misma congregación y mismo género que el solicitante.
 *
 * Seguridad:
 *   - Usa service client (servidor) → nunca expone datos por RLS o anon key
 *   - Verifica en BD que user_id pertenece a congregation_id antes de retornar
 *   - Solo devuelve campos no sensibles: id, name, user_type
 *   - Nunca expone: access_key, phone, congregation_id u otros campos privados
 *
 * Body:  { user_id: string, congregation_id: string, gender: string }
 * OK:    200 [{ id, name, user_type }]
 * Error: 400 Parámetros inválidos
 *        403 Usuario no pertenece a la congregación
 *        500 Error interno
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, congregation_id, gender } = body as {
      user_id?: string
      congregation_id?: string
      gender?: string
    }

    if (!user_id || !congregation_id || !gender) {
      return NextResponse.json({ error: 'Parámetros requeridos' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Verificar que el usuario solicitante pertenece a la congregación indicada
    const { data: caller } = await supabase
      .from('users')
      .select('id')
      .eq('id', user_id)
      .eq('congregation_id', congregation_id)
      .eq('is_active', true)
      .single()

    if (!caller) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 403 }
      )
    }

    // Retornar candidatos: solo campos no sensibles.
    // Excluir admins: ellos no acceden al dashboard de usuario.
    const { data: candidates, error } = await supabase
      .from('users')
      .select('id, name, user_type')
      .eq('congregation_id', congregation_id)
      .eq('gender', gender)
      .eq('is_active', true)
      .eq('is_admin', false)
      .order('name')

    if (error) {
      return NextResponse.json({ error: 'Error al obtener candidatos' }, { status: 500 })
    }

    return NextResponse.json(candidates ?? [])
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
