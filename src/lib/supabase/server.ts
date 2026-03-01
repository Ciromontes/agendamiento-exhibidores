/**
 * lib/supabase/server.ts
 * ─────────────────────────────────────────────────────────────
 * Cliente de Supabase para uso en el SERVIDOR (Server Components,
 * Route Handlers, Server Actions).
 *
 * Usa createServerClient de @supabase/ssr con acceso a cookies
 * para mantener sesiones del lado del servidor.
 *
 * NOTA: En esta app no usamos Supabase Auth, pero el cliente
 * de servidor está preparado por si se necesita en el futuro.
 *
 * Uso:
 *   import { createClient } from '@/lib/supabase/server'
 *   const supabase = await createClient()
 *   const { data } = await supabase.from('users').select('*')
 * ─────────────────────────────────────────────────────────────
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const createClient = async () => {
  // Obtener el store de cookies del request actual
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,      // URL del proyecto Supabase
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,  // Clave anónima
    {
      cookies: {
        // Leer todas las cookies del request
        getAll() {
          return cookieStore.getAll()
        },
        // Escribir cookies en la respuesta
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignorar errores en Server Components (solo lectura)
            // Las cookies solo se pueden escribir en Route Handlers
          }
        },
      },
    }
  )
}