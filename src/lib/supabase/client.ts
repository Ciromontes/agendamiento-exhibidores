/**
 * lib/supabase/client.ts
 * ─────────────────────────────────────────────────────────────
 * Cliente de Supabase para uso en el NAVEGADOR (Client Components).
 *
 * Usa createBrowserClient de @supabase/ssr para crear una
 * instancia del cliente que funciona en componentes con 'use client'.
 *
 * Las variables de entorno NEXT_PUBLIC_* son accesibles en el
 * navegador porque tienen el prefijo NEXT_PUBLIC_.
 * Se configuran en el archivo .env.local.
 *
 * Uso:
 *   import { createClient } from '@/lib/supabase/client'
 *   const supabase = createClient()
 *   const { data } = await supabase.from('users').select('*')
 * ─────────────────────────────────────────────────────────────
 */
import { createBrowserClient } from '@supabase/ssr'

export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,      // URL del proyecto Supabase
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!   // Clave anónima (pública, segura para el navegador)
  )