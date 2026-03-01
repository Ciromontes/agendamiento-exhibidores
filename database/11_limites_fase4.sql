/**
 * 11_limites_fase4.sql — Fase 4: Límites por Tipo (Semanal / Mensual)
 * ─────────────────────────────────────────────────────────────
 * Ajustes en app_config para el sistema de conteo dual.
 *
 * IMPORTANTE: Ejecutar en el SQL Editor de Supabase DESPUÉS
 * de haber ejecutado los scripts 01-10.
 *
 * Cambios:
 *   1. Asegura que counting_mode = 'weekly' como default
 *   2. Crea función contar_reservas_periodo() que retorna
 *      la cantidad de reservas activas según el modo actual
 *      (semanal o mensual) para un usuario dado.
 *   3. Crea función get_app_config() para lectura rápida
 *      de la configuración global.
 *
 * Notas:
 *   - La lógica de modo de conteo se maneja principalmente
 *     en el frontend (ExhibitorGrid), pero estas funciones
 *     sirven como helpers y referencia.
 *   - El admin cambia counting_mode desde el panel de config.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. VERIFICAR Y ACTUALIZAR VALOR DEFAULT DE counting_mode
-- =============================================================
-- Si la fila de app_config ya existe, aseguramos el valor.
-- Si no existe, esto no hace nada (ya debería existir del script 07).
UPDATE app_config
  SET counting_mode = COALESCE(counting_mode, 'weekly');

-- =============================================================
-- 2. FUNCIÓN: get_app_config
-- =============================================================
-- Retorna la fila de configuración global.
-- Útil para que el frontend la llame con supabase.rpc().
CREATE OR REPLACE FUNCTION get_app_config()
RETURNS SETOF app_config
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT * FROM app_config LIMIT 1;
$$;

-- =============================================================
-- 3. FUNCIÓN: contar_reservas_periodo
-- =============================================================
-- Cuenta las reservas activas de un usuario para el período
-- actual según el counting_mode de app_config.
--   - 'weekly'  → reservas de la semana en curso (lunes a domingo)
--   - 'monthly' → reservas del mes calendario en curso
CREATE OR REPLACE FUNCTION contar_reservas_periodo(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_mode text;
  v_count integer;
  v_week_start date;
  v_month_start date;
BEGIN
  -- Obtener modo de conteo actual
  SELECT counting_mode INTO v_mode FROM app_config LIMIT 1;
  v_mode := COALESCE(v_mode, 'weekly');

  IF v_mode = 'monthly' THEN
    -- Inicio del mes actual
    v_month_start := date_trunc('month', CURRENT_DATE)::date;
    SELECT COUNT(*) INTO v_count
      FROM reservations
      WHERE user_id = p_user_id
        AND status != 'cancelled'
        AND week_start >= v_month_start;
  ELSE
    -- Inicio de la semana actual (lunes)
    v_week_start := date_trunc('week', CURRENT_DATE)::date;
    SELECT COUNT(*) INTO v_count
      FROM reservations
      WHERE user_id = p_user_id
        AND status != 'cancelled'
        AND week_start = v_week_start;
  END IF;

  RETURN v_count;
END;
$$;

-- =============================================================
-- Verificación: listar funciones creadas
-- =============================================================
SELECT routine_name, routine_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN ('get_app_config', 'contar_reservas_periodo');
