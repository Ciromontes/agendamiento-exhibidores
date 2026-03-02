/**
 * 21_ajuste_horario_dia.sql — Ajuste de horario por día + reset a defecto
 * ─────────────────────────────────────────────────────────────
 * Funciones para desplazar todos los bloques horarios de un día
 * a partir de una nueva hora de inicio, en modo local (un solo
 * exhibidor) o global (todos los exhibidores a la vez).
 *
 * CÓMO FUNCIONA EL DESPLAZAMIENTO
 *   Si el lunes tiene: 06-08, 08-10, 10-12, 12-14, 14-16, 16-18
 *   y el admin cambia el inicio a 05:00, el offset es -1h y queda:
 *                       05-07, 07-09, 09-11, 11-13, 13-15, 15-17
 *   La duración y la separación entre bloques se preservan.
 *   Cada exhibidor calcula su propio offset desde SU primer bloque.
 *
 * Funciones incluidas:
 *   1. ajustar_inicio_dia(day, nueva_hora, exhibitor_id, global)
 *      — Desplaza todos los slots de un día hacia la nueva hora.
 *   2. resetear_horarios_defecto(exhibitor_id, global)
 *      — Devuelve todos los días a empezar a las 06:00:00.
 *
 * EJECUTAR en Supabase SQL Editor.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. AJUSTAR INICIO DE DÍA
-- =============================================================
-- Desplaza todos los time_slots de un día específico para que
-- el primer bloque empiece en p_nueva_hora_inicio.
--
-- Parámetros:
--   p_day_of_week       → 0=Dom, 1=Lun, …, 6=Sáb
--   p_nueva_hora_inicio → Hora de inicio deseada (ej: '05:00:00')
--   p_exhibitor_id      → UUID del exhibidor (se ignora si p_global=true)
--   p_global            → Si true, aplica a TODOS los exhibidores
--
-- Comportamiento en modo global:
--   Cada exhibidor ajusta desde SU propio primer slot del día,
--   de modo que todos quedan comenzando a p_nueva_hora_inicio.
--
-- Retorna: número total de slots actualizados.
-- =============================================================
CREATE OR REPLACE FUNCTION ajustar_inicio_dia(
  p_day_of_week       integer,
  p_nueva_hora_inicio time,
  p_exhibitor_id      uuid    DEFAULT NULL,
  p_global            boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_start time;
  v_offset      interval;
  v_count       integer := 0;
  v_rows        integer;
  ex            RECORD;
BEGIN
  -- ──────────────────────────────────────────────────────────
  -- MODO GLOBAL: recorre cada exhibidor por separado y calcula
  -- su propio offset desde su primer slot del día.
  -- ──────────────────────────────────────────────────────────
  IF p_global THEN
    FOR ex IN
      SELECT DISTINCT exhibitor_id
        FROM time_slots
        WHERE day_of_week = p_day_of_week
    LOOP
      -- Hora del primer bloque de ESTE exhibidor en ESTE día
      SELECT MIN(start_time) INTO v_first_start
        FROM time_slots
        WHERE exhibitor_id = ex.exhibitor_id
          AND day_of_week  = p_day_of_week;

      IF v_first_start IS NULL OR v_first_start = p_nueva_hora_inicio THEN
        CONTINUE;  -- Nada que hacer para este exhibidor
      END IF;

      v_offset := p_nueva_hora_inicio - v_first_start;

      UPDATE time_slots
        SET start_time = start_time + v_offset,
            end_time   = end_time   + v_offset
        WHERE exhibitor_id = ex.exhibitor_id
          AND day_of_week  = p_day_of_week;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    END LOOP;

  -- ──────────────────────────────────────────────────────────
  -- MODO LOCAL: aplica solo al exhibidor indicado.
  -- ──────────────────────────────────────────────────────────
  ELSE
    IF p_exhibitor_id IS NULL THEN
      RAISE EXCEPTION 'Debes indicar un exhibidor cuando p_global = false';
    END IF;

    SELECT MIN(start_time) INTO v_first_start
      FROM time_slots
      WHERE exhibitor_id = p_exhibitor_id
        AND day_of_week  = p_day_of_week;

    IF v_first_start IS NULL THEN
      RAISE EXCEPTION 'El exhibidor no tiene bloques para el día indicado (day_of_week = %)', p_day_of_week;
    END IF;

    IF v_first_start = p_nueva_hora_inicio THEN
      RETURN 0;  -- Ya está en la hora correcta
    END IF;

    v_offset := p_nueva_hora_inicio - v_first_start;

    UPDATE time_slots
      SET start_time = start_time + v_offset,
          end_time   = end_time   + v_offset
      WHERE exhibitor_id = p_exhibitor_id
        AND day_of_week  = p_day_of_week;

    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN v_count;
END;
$$;


-- =============================================================
-- 2. RESETEAR HORARIOS A DEFECTO (06:00 AM)
-- =============================================================
-- Devuelve todos los bloques horarios a comenzar a las 06:00:00.
-- Para cada día y cada exhibidor afectado, calcula el offset
-- necesario y lo aplica a todos sus slots de ese día.
--
-- Los slots bloqueados (block_reason NOT NULL) también se
-- desplazan para mantener coherencia de horarios.
--
-- Parámetros:
--   p_exhibitor_id → UUID del exhibidor (ignorado si p_global=true)
--   p_global       → Si true, aplica a TODOS los exhibidores
--
-- Retorna: número total de slots actualizados.
-- =============================================================
CREATE OR REPLACE FUNCTION resetear_horarios_defecto(
  p_exhibitor_id uuid    DEFAULT NULL,
  p_global       boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_start time;
  v_offset      interval;
  v_count       integer := 0;
  v_rows        integer;
  ex            RECORD;
  day_rec       RECORD;
BEGIN
  -- ──────────────────────────────────────────────────────────
  -- MODO GLOBAL: recorre cada exhibidor × cada día
  -- ──────────────────────────────────────────────────────────
  IF p_global THEN
    FOR ex IN
      SELECT DISTINCT exhibitor_id FROM time_slots
    LOOP
      FOR day_rec IN
        SELECT DISTINCT day_of_week
          FROM time_slots
          WHERE exhibitor_id = ex.exhibitor_id
      LOOP
        SELECT MIN(start_time) INTO v_first_start
          FROM time_slots
          WHERE exhibitor_id = ex.exhibitor_id
            AND day_of_week  = day_rec.day_of_week;

        IF v_first_start IS NULL OR v_first_start = TIME '06:00:00' THEN
          CONTINUE;
        END IF;

        v_offset := TIME '06:00:00' - v_first_start;

        UPDATE time_slots
          SET start_time = start_time + v_offset,
              end_time   = end_time   + v_offset
          WHERE exhibitor_id = ex.exhibitor_id
            AND day_of_week  = day_rec.day_of_week;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_count := v_count + v_rows;
      END LOOP;
    END LOOP;

  -- ──────────────────────────────────────────────────────────
  -- MODO LOCAL: solo el exhibidor indicado
  -- ──────────────────────────────────────────────────────────
  ELSE
    IF p_exhibitor_id IS NULL THEN
      RAISE EXCEPTION 'Debes indicar un exhibidor cuando p_global = false';
    END IF;

    FOR day_rec IN
      SELECT DISTINCT day_of_week
        FROM time_slots
        WHERE exhibitor_id = p_exhibitor_id
    LOOP
      SELECT MIN(start_time) INTO v_first_start
        FROM time_slots
        WHERE exhibitor_id = p_exhibitor_id
          AND day_of_week  = day_rec.day_of_week;

      IF v_first_start IS NULL OR v_first_start = TIME '06:00:00' THEN
        CONTINUE;
      END IF;

      v_offset := TIME '06:00:00' - v_first_start;

      UPDATE time_slots
        SET start_time = start_time + v_offset,
            end_time   = end_time   + v_offset
        WHERE exhibitor_id = p_exhibitor_id
          AND day_of_week  = day_rec.day_of_week;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$$;


-- =============================================================
-- Recargar schema cache de PostgREST para que las RPCs
-- aparezcan disponibles de inmediato sin reiniciar.
-- =============================================================
NOTIFY pgrst, 'reload schema';


-- =============================================================
-- Verificación: las funciones deben aparecer aquí
-- =============================================================
SELECT routine_name, routine_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN ('ajustar_inicio_dia', 'resetear_horarios_defecto');
