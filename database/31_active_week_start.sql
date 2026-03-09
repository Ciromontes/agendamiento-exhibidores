-- ═══════════════════════════════════════════════════════════════════════════
-- Script 31: Semana activa controlada manualmente por el admin
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROPÓSITO:
--   En lugar de que el sistema use siempre la semana calendario actual,
--   el administrador decide manualmente cuándo "avanzar" a la siguiente
--   semana de reservas. Esto permite:
--     - Lanzar la app en cualquier fecha (ej: viernes 13 de marzo) y
--       los usuarios reservan la semana del lunes 9 al sábado 14.
--     - Una vez terminada esa semana, el admin abre la siguiente con un botón.
--     - El historial de semanas anteriores quedará registrado automáticamente.
--
-- CAMBIO:
--   Añadir columna `active_week_start DATE` a `app_config`.
--   Este valor corresponde al lunes (AAAA-MM-DD) de la semana abierta.
--
-- INSTRUCCIONES:
--   Ejecutar UNA SOLA VEZ en Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS active_week_start DATE;

-- Inicializar con el lunes de la semana actual para todas las congregaciones
-- date_trunc('week', ...) en Postgres retorna el lunes (ISO 8601)
UPDATE public.app_config
SET active_week_start = date_trunc('week', CURRENT_DATE)::date
WHERE active_week_start IS NULL;

-- ─── Verificación ─────────────────────────────────────────────────────────
-- SELECT id, congregation_id, active_week_start FROM app_config;
