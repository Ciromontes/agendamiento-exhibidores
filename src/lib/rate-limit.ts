/**
 * lib/rate-limit.ts
 * ─────────────────────────────────────────────────────────────
 * Rate limiter en memoria para rutas de API de Next.js.
 *
 * Diseño:
 *   - Solo cuenta intentos FALLIDOS (clave incorrecta).
 *     Los logins exitosos no consumen cuota.
 *   - Map<ip, { count, resetAt }> en el módulo (persiste entre
 *     requests dentro de la misma instancia serverless).
 *   - Ventana fija: WINDOW_MS por defecto 15 minutos.
 *   - Límite: MAX_FAILURES intentos fallidos por ventana por IP.
 *
 * Limitaciones conocidas:
 *   - En Vercel, múltiples instancias no comparten estado.
 *     Para 100 usuarios esto es aceptable (ataque distribuido
 *     necesitaría muchas más IPs y no paga la complejidad de KV).
 *   - Si la función se enfría (cold start) el contador se resetea.
 *     Esto es aceptable: el atacante tampoco acumula intentos.
 *
 * Uso:
 *   1. checkRateLimit(ip)   → si blocked, rechaza con 429
 *   2. recordFailure(ip)    → llamar solo cuando la clave es incorrecta
 * ─────────────────────────────────────────────────────────────
 */

const WINDOW_MS      = 15 * 60 * 1_000  // 15 minutos
const MAX_FAILURES   = 10               // máx intentos fallidos por ventana

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
 * checkRateLimit - Verifica si la IP está bloqueada por demasiados fallos.
 * NO incrementa el contador — solo consulta.
 * Llama a recordFailure(ip) después de confirmar que la clave es incorrecta.
 */
export function checkRateLimit(ip: string): RateLimitResult {
  evictExpired()

  const now = Date.now()
  const entry = store.get(ip)

  if (!entry || now >= entry.resetAt) return { allowed: true }

  if (entry.count >= MAX_FAILURES) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1_000)
    return { allowed: false, retryAfterSec }
  }

  return { allowed: true }
}

/**
 * recordFailure - Registra un intento fallido para la IP.
 * Llamar solo cuando la autenticación falla (clave incorrecta).
 */
export function recordFailure(ip: string): void {
  evictExpired()

  const now = Date.now()
  const entry = store.get(ip)

  if (!entry || now >= entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS })
  } else {
    entry.count++
  }
}
