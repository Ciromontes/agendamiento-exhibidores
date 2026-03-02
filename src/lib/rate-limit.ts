/**
 * lib/rate-limit.ts
 * ─────────────────────────────────────────────────────────────
 * Rate limiter en memoria para rutas de API de Next.js.
 *
 * Diseño:
 *   - Map<ip, { count, resetAt }> en el módulo (persiste entre
 *     requests dentro de la misma instancia serverless).
 *   - Ventana fija: WINDOW_MS por defecto 15 minutos.
 *   - Límite: MAX_REQUESTS intentos por ventana por IP.
 *
 * Limitaciones conocidas:
 *   - En Vercel, múltiples instancias no comparten estado.
 *     Para 100 usuarios esto es aceptable (ataque distribuido
 *     necesitaría muchas más IPs y no paga la complejidad de KV).
 *   - Si la función se enfría (cold start) el contador se resetea.
 *     Esto es aceptable: el atacante tampoco acumula intentos.
 *
 * Retorna:
 *   { allowed: true }                        → puede continuar
 *   { allowed: false, retryAfterSec: number } → bloqueado
 * ─────────────────────────────────────────────────────────────
 */

const WINDOW_MS      = 15 * 60 * 1_000  // 15 minutos
const MAX_REQUESTS   = 10               // máx intentos por ventana

interface Entry {
  count: number
  resetAt: number   // timestamp en ms cuando se reinicia la ventana
}

// Map global de la instancia serverless
const store = new Map<string, Entry>()

// Limpieza periódica para evitar acumulación infinita de IPs
// (se ejecuta en cada llamada, O(n) pero el store es pequeño)
function evictExpired(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key)
  }
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number }

/**
 * checkRateLimit - Verifica si la IP puede hacer una nueva solicitud.
 * Incrementa el contador si está dentro del límite.
 *
 * @param ip  - Dirección IP del cliente (string)
 * @returns   RateLimitResult
 */
export function checkRateLimit(ip: string): RateLimitResult {
  evictExpired()

  const now = Date.now()
  const entry = store.get(ip)

  if (!entry || now >= entry.resetAt) {
    // Primera solicitud o ventana expirada → nueva ventana
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true }
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1_000)
    return { allowed: false, retryAfterSec }
  }

  entry.count++
  return { allowed: true }
}
