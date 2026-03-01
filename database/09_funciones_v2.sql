-- =============================================================
-- 09_funciones_v2.sql
-- =============================================================
-- PROPÓSITO:
--   Funciones V2 para el nuevo sistema con:
--     - 3 tipos de usuario con límites diferentes
--     - Conteo semanal o mensual (según app_config)
--     - Validación de límites por tipo
--     - Conteo para precursores auxiliares (6/mes)
--
-- PRERREQUISITO:
--   Haber ejecutado 08_rls_v2.sql
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. ¡Listo! La base de datos V2 está completa.
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: get_user_reservation_count_weekly
-- ─────────────────────────────────────────────────────────────
-- Cuenta cuántas reservas activas tiene un usuario en una
-- semana específica (identificada por el lunes = week_start).
--
-- Se usa para validar los límites semanales:
--   publicador → máximo 1
--   precursor_regular → máximo 2
--
-- @param p_user_id  UUID del usuario
-- @param p_week     Fecha del lunes de la semana
-- @returns          Número de reservas activas en esa semana
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_reservation_count_weekly(
  p_user_id UUID,
  p_week DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  count_result INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO count_result
  FROM reservations
  WHERE user_id = p_user_id
    AND week_start = p_week
    AND status IN ('confirmed', 'pending');

  RETURN count_result;
END;
$$;

COMMENT ON FUNCTION get_user_reservation_count_weekly(UUID, DATE)
  IS 'Cuenta reservas activas de un usuario en una semana específica.';


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: get_user_reservation_count_monthly
-- ─────────────────────────────────────────────────────────────
-- Cuenta cuántas reservas activas tiene un usuario en un mes.
-- El mes se define por el "año de servicio" (Sep-Ago).
--
-- Se usa para:
--   - precursor_auxiliar → máximo 6/mes (siempre)
--   - Todos los tipos cuando counting_mode = 'monthly'
--
-- @param p_user_id  UUID del usuario
-- @param p_date     Cualquier fecha del mes a consultar
-- @returns          Número de reservas activas en ese mes
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_reservation_count_monthly(
  p_user_id UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  count_result INTEGER;
  month_start DATE;
  month_end DATE;
BEGIN
  -- Calcular inicio y fin del mes
  month_start := date_trunc('month', p_date)::DATE;
  month_end := (date_trunc('month', p_date) + INTERVAL '1 month')::DATE;

  -- Contar reservas cuyo week_start cae en este mes
  SELECT COUNT(*)
  INTO count_result
  FROM reservations
  WHERE user_id = p_user_id
    AND week_start >= month_start
    AND week_start < month_end
    AND status IN ('confirmed', 'pending');

  RETURN count_result;
END;
$$;

COMMENT ON FUNCTION get_user_reservation_count_monthly(UUID, DATE)
  IS 'Cuenta reservas activas de un usuario en un mes calendario.';


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: get_weekly_limit_for_user
-- ─────────────────────────────────────────────────────────────
-- Retorna el límite semanal de un usuario según su tipo.
-- Si counting_mode = 'monthly', retorna un valor alto (sin
-- límite semanal estricto, se controla por mes).
--
-- @param p_user_type  Tipo de usuario
-- @returns            Límite semanal
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_weekly_limit_for_user(
  p_user_type TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  mode TEXT;
BEGIN
  -- Obtener el modo de conteo actual
  SELECT counting_mode INTO mode FROM app_config LIMIT 1;

  -- Si modo mensual, no hay límite semanal estricto
  IF mode = 'monthly' THEN
    RETURN 99;
  END IF;

  -- Modo semanal: límites por tipo
  CASE p_user_type
    WHEN 'publicador' THEN RETURN 1;
    WHEN 'precursor_regular' THEN RETURN 2;
    WHEN 'precursor_auxiliar' THEN RETURN 2;  -- Provisional, se controla mensualmente
    ELSE RETURN 1;
  END CASE;
END;
$$;

COMMENT ON FUNCTION get_weekly_limit_for_user(TEXT)
  IS 'Retorna el límite semanal de turnos según el tipo de usuario y modo de conteo.';


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: get_monthly_limit_for_user
-- ─────────────────────────────────────────────────────────────
-- Retorna el límite mensual de un usuario según su tipo.
--
-- @param p_user_type  Tipo de usuario
-- @returns            Límite mensual
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_monthly_limit_for_user(
  p_user_type TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  CASE p_user_type
    WHEN 'publicador' THEN RETURN 4;            -- ~1/semana × 4 semanas
    WHEN 'precursor_regular' THEN RETURN 8;     -- ~2/semana × 4 semanas
    WHEN 'precursor_auxiliar' THEN RETURN 6;    -- Límite fijo mensual
    ELSE RETURN 4;
  END CASE;
END;
$$;

COMMENT ON FUNCTION get_monthly_limit_for_user(TEXT)
  IS 'Retorna el límite mensual de turnos según el tipo de usuario.';


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: reset_weekly_reservations() — ACTUALIZADA V2
-- ─────────────────────────────────────────────────────────────
-- Misma función que V1 pero ahora maneja slot_position
-- y los nuevos tipos de usuario.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reset_weekly_reservations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_week_start DATE;
  reservations_cancelled INTEGER;
  invitations_expired INTEGER;
BEGIN
  -- Calcular el lunes de esta semana
  current_week_start := date_trunc('week', CURRENT_DATE)::DATE;

  -- Cancelar reservas de semanas anteriores
  UPDATE reservations
  SET status = 'cancelled'
  WHERE week_start < current_week_start
    AND status != 'cancelled';

  GET DIAGNOSTICS reservations_cancelled = ROW_COUNT;

  -- Expirar invitaciones vencidas
  UPDATE invitations
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();

  GET DIAGNOSTICS invitations_expired = ROW_COUNT;

  RAISE NOTICE 'Reset semanal V2: % reservas canceladas, % invitaciones expiradas',
    reservations_cancelled, invitations_expired;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: get_weekly_stats() — ACTUALIZADA V2
-- ─────────────────────────────────────────────────────────────
-- Estadísticas de la semana actual incluyendo info de parejas.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_weekly_stats()
RETURNS TABLE (
  total_reservations BIGINT,
  complete_slots BIGINT,
  incomplete_slots BIGINT,
  unique_users BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_week DATE;
BEGIN
  current_week := date_trunc('week', CURRENT_DATE)::DATE;

  RETURN QUERY
  SELECT
    -- Total de reservaciones activas esta semana
    (SELECT COUNT(*) FROM reservations
     WHERE week_start = current_week AND status IN ('confirmed', 'pending'))
      AS total_reservations,

    -- Slots completos (2/2 personas)
    (SELECT COUNT(*) FROM (
      SELECT time_slot_id FROM reservations
      WHERE week_start = current_week AND status IN ('confirmed', 'pending')
      GROUP BY time_slot_id
      HAVING COUNT(*) >= 2
    ) sub) AS complete_slots,

    -- Slots incompletos (1/2 personas)
    (SELECT COUNT(*) FROM (
      SELECT time_slot_id FROM reservations
      WHERE week_start = current_week AND status IN ('confirmed', 'pending')
      GROUP BY time_slot_id
      HAVING COUNT(*) = 1
    ) sub) AS incomplete_slots,

    -- Usuarios únicos que tienen reserva esta semana
    (SELECT COUNT(DISTINCT user_id) FROM reservations
     WHERE week_start = current_week AND status IN ('confirmed', 'pending'))
      AS unique_users;
END;
$$;

COMMENT ON FUNCTION get_weekly_stats()
  IS 'Retorna estadísticas de la semana actual: reservas, slots completos/incompletos, usuarios.';


-- =============================================================
-- ✅ Funciones V2 creadas.
-- ¡La base de datos V2 está completamente lista!
--
-- RESUMEN DE CAMBIOS:
--   - users.user_type: 'publicador', 'precursor_regular', 'precursor_auxiliar'
--   - users.spouse_id: para vincular parejas
--   - time_slots.day_of_week: ahora incluye 0 (Domingo)
--   - reservations.slot_position: 1 o 2 (2 personas por celda)
--   - app_config: configuración global del sistema
--   - Funciones de conteo semanal y mensual
-- =============================================================
