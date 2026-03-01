-- =============================================================
-- 05_funciones.sql
-- =============================================================
-- PROPÓSITO:
--   Crear funciones de utilidad para el sistema.
--   La principal es el reset semanal que limpia las reservas
--   viejas cada domingo a las 12:00 del mediodía.
--
-- PRERREQUISITO:
--   Haber ejecutado 04_rls_y_realtime.sql
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. ¡Listo! La base de datos está completamente configurada.
--
-- NOTA SOBRE CRON JOBS:
--   Para automatizar el reset semanal, puedes:
--   a) Usar la extensión pg_cron de Supabase (si está disponible)
--   b) Crear una Supabase Edge Function con un cron trigger
--   c) Llamar la función manualmente desde el admin panel
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: reset_weekly_reservations()
-- ─────────────────────────────────────────────────────────────
-- Esta función se ejecuta cada domingo al mediodía para:
--   1. Cancelar todas las reservas de semanas anteriores
--      que aún estén activas (confirmed/pending)
--   2. Expirar invitaciones pendientes que ya pasaron su
--      fecha límite
--
-- SEGURIDAD:
--   SECURITY DEFINER = se ejecuta con los permisos del creador
--   (bypasa RLS), necesario porque se llama desde un cron/edge
--   function que no tiene un usuario autenticado.
--
-- USO MANUAL (desde SQL Editor):
--   SELECT reset_weekly_reservations();
--
-- USO CON pg_cron (si está habilitado en tu plan de Supabase):
--   SELECT cron.schedule(
--     'reset-semanal',          -- nombre del job
--     '0 12 * * 0',             -- cada domingo a las 12:00
--     'SELECT reset_weekly_reservations()'
--   );
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reset_weekly_reservations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- El lunes de la semana actual
  current_week_start DATE;
  -- Contadores para el log
  reservations_cancelled INTEGER;
  invitations_expired INTEGER;
BEGIN
  -- ─── Calcular el lunes de esta semana ───
  -- date_trunc('week', ...) devuelve el lunes a las 00:00
  current_week_start := date_trunc('week', CURRENT_DATE)::DATE;

  -- ─── Cancelar reservas de semanas anteriores ───
  -- Solo afecta reservas que NO están ya canceladas
  -- y cuyo week_start es anterior al lunes actual
  UPDATE reservations
  SET status = 'cancelled'
  WHERE week_start < current_week_start
    AND status != 'cancelled';

  -- Guardar cuántas se cancelaron (para debug)
  GET DIAGNOSTICS reservations_cancelled = ROW_COUNT;

  -- ─── Expirar invitaciones vencidas ───
  -- Invitaciones pendientes cuyo expires_at ya pasó
  UPDATE invitations
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();

  -- Guardar cuántas expiraron (para debug)
  GET DIAGNOSTICS invitations_expired = ROW_COUNT;

  -- ─── Log informativo ───
  -- Se puede ver en los logs de Supabase
  RAISE NOTICE 'Reset semanal completado: % reservas canceladas, % invitaciones expiradas',
    reservations_cancelled, invitations_expired;
END;
$$;

-- Comentario en la función para documentación
COMMENT ON FUNCTION reset_weekly_reservations()
  IS 'Cancela reservas de semanas anteriores y expira invitaciones vencidas. Ejecutar cada domingo a las 12:00.';


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: get_user_weekly_reservation_count(p_user_id, p_week)
-- ─────────────────────────────────────────────────────────────
-- Función auxiliar que cuenta cuántas reservas activas tiene
-- un usuario en una semana específica. Útil para validar
-- del lado del servidor que no exceda su límite (A=1, B=2).
--
-- USO:
--   SELECT get_user_weekly_reservation_count(
--     'uuid-del-usuario',
--     '2026-02-23'  -- lunes de la semana
--   );
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_weekly_reservation_count(
  p_user_id UUID,     -- ID del usuario a consultar
  p_week_start DATE   -- Lunes de la semana a consultar
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE              -- No modifica datos, solo consulta
SECURITY DEFINER    -- Bypasa RLS para consultas internas
AS $$
DECLARE
  reservation_count INTEGER;
BEGIN
  -- Contar reservas activas (no canceladas) del usuario en esa semana
  SELECT COUNT(*)
  INTO reservation_count
  FROM reservations
  WHERE user_id = p_user_id
    AND week_start = p_week_start
    AND status IN ('confirmed', 'pending');

  RETURN reservation_count;
END;
$$;

-- Comentario en la función para documentación
COMMENT ON FUNCTION get_user_weekly_reservation_count(UUID, DATE)
  IS 'Devuelve el número de reservas activas de un usuario en una semana específica.';


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: get_weekly_stats(p_week_start)
-- ─────────────────────────────────────────────────────────────
-- Función para el panel de admin que devuelve estadísticas
-- de la semana: total de reservas, slots disponibles, etc.
--
-- USO:
--   SELECT * FROM get_weekly_stats('2026-02-23');
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_weekly_stats(
  p_week_start DATE   -- Lunes de la semana a consultar
)
RETURNS TABLE (
  total_reservations  BIGINT,   -- Total de reservas activas
  total_active_slots  BIGINT,   -- Total de slots disponibles
  total_users         BIGINT,   -- Total de usuarios activos
  occupancy_rate      NUMERIC   -- Porcentaje de ocupación
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Contar reservas confirmadas/pendientes de la semana
    (SELECT COUNT(*) FROM reservations
     WHERE week_start = p_week_start
       AND status IN ('confirmed', 'pending'))
    AS total_reservations,

    -- Contar slots activos (sin block_reason y con is_active=true)
    (SELECT COUNT(*) FROM time_slots
     WHERE is_active = true AND block_reason IS NULL)
    AS total_active_slots,

    -- Contar usuarios activos
    (SELECT COUNT(*) FROM users
     WHERE is_active = true AND is_admin = false)
    AS total_users,

    -- Calcular porcentaje de ocupación
    CASE
      WHEN (SELECT COUNT(*) FROM time_slots
            WHERE is_active = true AND block_reason IS NULL) = 0
      THEN 0
      ELSE ROUND(
        (SELECT COUNT(*) FROM reservations
         WHERE week_start = p_week_start
           AND status IN ('confirmed', 'pending'))::NUMERIC
        /
        (SELECT COUNT(*) FROM time_slots
         WHERE is_active = true AND block_reason IS NULL)::NUMERIC
        * 100, 1
      )
    END
    AS occupancy_rate;
END;
$$;

-- Comentario en la función para documentación
COMMENT ON FUNCTION get_weekly_stats(DATE)
  IS 'Devuelve estadísticas de ocupación para una semana: reservas, slots, usuarios y porcentaje.';


-- =============================================================
-- ✅ ¡BASE DE DATOS COMPLETAMENTE CONFIGURADA!
-- =============================================================
--
-- Resumen de lo que se ejecutó en orden:
--   01_drop_tablas_viejas.sql  → Eliminó tablas con esquema viejo
--   02_crear_tablas.sql        → Creó 5 tablas con esquema nuevo
--   03_seed_datos_iniciales.sql→ Insertó exhibidores, slots y usuarios
--   04_rls_y_realtime.sql      → Configuró seguridad y tiempo real
--   05_funciones.sql           → Creó funciones de utilidad
--
-- Credenciales de prueba:
--   Admin:          access_key = 'admin2025'
--   Juan (Tipo A):  access_key = 'juan123'
--   María (Tipo B): access_key = 'maria123'
--   Carlos (Tipo A):access_key = 'carlos123'
--
-- Para verificar todo funciona:
--   SELECT COUNT(*) FROM exhibitors;     -- 3
--   SELECT COUNT(*) FROM time_slots;     -- 108
--   SELECT COUNT(*) FROM users;          -- 4
--   SELECT * FROM get_weekly_stats(date_trunc('week', CURRENT_DATE)::DATE);
--
-- =============================================================
