/**
 * lib/supabase/service.ts
 * ─────────────────────────────────────────────────────────────
 * Cliente de Supabase con service_role_key.
 *
 * SOLO para uso en el servidor (API Routes, Server Actions).
 * Bypasea el RLS → tiene acceso completo a la BD.
 *
 * NUNCA importar en Client Components ni exponer al navegador.
 * La variable SUPABASE_SERVICE_ROLE_KEY NO tiene prefijo NEXT_PUBLIC_
 * para que Next.js nunca la envíe al bundle del cliente.
 * ─────────────────────────────────────────────────────────────
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const createServiceClient = () =>
  createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,   // ← SIN prefijo NEXT_PUBLIC_
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
