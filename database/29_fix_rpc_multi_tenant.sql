-- ═══════════════════════════════════════════════════════════════
-- 29 – Corregir funciones RPC para multi-tenant
-- ═══════════════════════════════════════════════════════════════
-- PROBLEMA:
--   Las funciones reset_app_data, ajustar_inicio_dia y
--   resetear_horarios_defecto operan sin filtrar por congregación,
--   afectando datos de TODAS las congregaciones.
--
-- SOLUCIÓN:
--   1. reset_app_data: busca la congregation_id del admin y filtra
--      todos los DELETE por esa congregación.
--   2. ajustar_inicio_dia: nuevo parámetro p_congregation_id para
--      filtrar el modo GLOBAL.
--   3. resetear_horarios_defecto: idem.
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. reset_app_data  (reemplazo completo)
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS reset_app_data(UUID);

CREATE OR REPLACE FUNCTION reset_app_data(p_admin_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin        BOOLEAN;
  v_name            TEXT;
  v_congregation_id UUID;
  v_res_count       INTEGER;
  v_inv_count       INTEGER;
  v_rel_count       INTEGER;
  v_abs_count       INTEGER;
BEGIN

  -- ── 1. Verificar que el usuario existe, es admin y obtener su congregación ──
  SELECT is_admin, name, congregation_id
    INTO v_is_admin, v_name, v_congregation_id
    FROM users
   WHERE id = p_admin_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Usuario no encontrado.'
    );
  END IF;

  IF NOT v_is_admin THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Acceso denegado: el usuario no es administrador.'
    );
  END IF;

  IF v_congregation_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'message', 'El administrador no tiene congregación asignada.'
    );
  END IF;

  -- ── 2. Contar registros de ESTA congregación antes de borrar ──
  SELECT COUNT(*) INTO v_res_count FROM reservations    WHERE congregation_id = v_congregation_id;
  SELECT COUNT(*) INTO v_inv_count FROM invitations     WHERE congregation_id = v_congregation_id;
  SELECT COUNT(*) INTO v_rel_count FROM relief_requests WHERE congregation_id = v_congregation_id;
  SELECT COUNT(*) INTO v_abs_count FROM absences        WHERE congregation_id = v_congregation_id;

  -- ── 3. Borrar solo datos de esta congregación (respetar FK) ──
  DELETE FROM relief_requests WHERE congregation_id = v_congregation_id;
  DELETE FROM absences        WHERE congregation_id = v_congregation_id;
  DELETE FROM invitations     WHERE congregation_id = v_congregation_id;
  DELETE FROM reservations    WHERE congregation_id = v_congregation_id;

  -- ── 4. Retornar resumen del reset ──
  RETURN json_build_object(
    'success', true,
    'message', format(
      'Reset completado por %s. Datos operativos de la congregación eliminados.',
      v_name
    ),
    'deleted', json_build_object(
      'reservations',    v_res_count,
      'invitations',     v_inv_count,
      'relief_requests', v_rel_count,
      'absences',        v_abs_count
    )
  );

END;
$$;

GRANT EXECUTE ON FUNCTION reset_app_data(UUID) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. ajustar_inicio_dia  (reemplazo completo)
--    Nuevo parámetro: p_congregation_id
--    Modo GLOBAL filtra exhibitors por congregación.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS ajustar_inicio_dia(integer, time, uuid, boolean);

CREATE OR REPLACE FUNCTION ajustar_inicio_dia(
  p_day_of_week       integer,
  p_nueva_hora_inicio time,
  p_exhibitor_id      uuid    DEFAULT NULL,
  p_global            boolean DEFAULT false,
  p_congregation_id   uuid    DEFAULT NULL
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
  ex            RECORD;
  slot_rec      RECORD;
BEGIN
  -- ──────────────────────────────────────────────────────────
  -- MODO GLOBAL: recorre cada exhibidor de la congregación
  -- ──────────────────────────────────────────────────────────
  IF p_global THEN
    IF p_congregation_id IS NULL THEN
      RAISE EXCEPTION 'p_congregation_id es obligatorio en modo global';
    END IF;

    FOR ex IN
      SELECT DISTINCT exhibitor_id
        FROM time_slots
        WHERE day_of_week = p_day_of_week
          AND congregation_id = p_congregation_id
    LOOP
      SELECT MIN(start_time) INTO v_first_start
        FROM time_slots
        WHERE exhibitor_id = ex.exhibitor_id
          AND day_of_week  = p_day_of_week;

      IF v_first_start IS NULL OR v_first_start = p_nueva_hora_inicio THEN
        CONTINUE;
      END IF;

      v_offset := p_nueva_hora_inicio - v_first_start;

      FOR slot_rec IN
        SELECT id FROM time_slots
          WHERE exhibitor_id = ex.exhibitor_id
            AND day_of_week  = p_day_of_week
          ORDER BY CASE WHEN v_offset > INTERVAL '0' THEN start_time END DESC NULLS LAST,
                   CASE WHEN v_offset <= INTERVAL '0' THEN start_time END ASC  NULLS LAST
      LOOP
        UPDATE time_slots
          SET start_time = start_time + v_offset,
              end_time   = end_time   + v_offset
          WHERE id = slot_rec.id;
        v_count := v_count + 1;
      END LOOP;
    END LOOP;

  -- ──────────────────────────────────────────────────────────
  -- MODO LOCAL: aplica solo al exhibidor indicado (sin cambios).
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
      RETURN 0;
    END IF;

    v_offset := p_nueva_hora_inicio - v_first_start;

    FOR slot_rec IN
      SELECT id FROM time_slots
        WHERE exhibitor_id = p_exhibitor_id
          AND day_of_week  = p_day_of_week
        ORDER BY CASE WHEN v_offset > INTERVAL '0' THEN start_time END DESC NULLS LAST,
                 CASE WHEN v_offset <= INTERVAL '0' THEN start_time END ASC  NULLS LAST
    LOOP
      UPDATE time_slots
        SET start_time = start_time + v_offset,
            end_time   = end_time   + v_offset
        WHERE id = slot_rec.id;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION ajustar_inicio_dia(integer, time, uuid, boolean, uuid) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. resetear_horarios_defecto  (reemplazo completo)
--    Nuevo parámetro: p_congregation_id
--    Modo GLOBAL filtra exhibitors por congregación.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS resetear_horarios_defecto(uuid, boolean);

CREATE OR REPLACE FUNCTION resetear_horarios_defecto(
  p_exhibitor_id    uuid    DEFAULT NULL,
  p_global          boolean DEFAULT false,
  p_congregation_id uuid    DEFAULT NULL
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
  ex            RECORD;
  day_rec       RECORD;
  slot_rec      RECORD;
BEGIN
  -- ──────────────────────────────────────────────────────────
  -- MODO GLOBAL: recorre cada exhibidor × cada día de la congregación
  -- ──────────────────────────────────────────────────────────
  IF p_global THEN
    IF p_congregation_id IS NULL THEN
      RAISE EXCEPTION 'p_congregation_id es obligatorio en modo global';
    END IF;

    FOR ex IN
      SELECT DISTINCT exhibitor_id
        FROM time_slots
        WHERE congregation_id = p_congregation_id
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

        FOR slot_rec IN
          SELECT id FROM time_slots
            WHERE exhibitor_id = ex.exhibitor_id
              AND day_of_week  = day_rec.day_of_week
            ORDER BY CASE WHEN v_offset > INTERVAL '0' THEN start_time END DESC NULLS LAST,
                     CASE WHEN v_offset <= INTERVAL '0' THEN start_time END ASC  NULLS LAST
        LOOP
          UPDATE time_slots
            SET start_time = start_time + v_offset,
                end_time   = end_time   + v_offset
            WHERE id = slot_rec.id;
          v_count := v_count + 1;
        END LOOP;
      END LOOP;
    END LOOP;

  -- ──────────────────────────────────────────────────────────
  -- MODO LOCAL: solo el exhibidor indicado (sin cambios)
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

      FOR slot_rec IN
        SELECT id FROM time_slots
          WHERE exhibitor_id = p_exhibitor_id
            AND day_of_week  = day_rec.day_of_week
          ORDER BY CASE WHEN v_offset > INTERVAL '0' THEN start_time END DESC NULLS LAST,
                   CASE WHEN v_offset <= INTERVAL '0' THEN start_time END ASC  NULLS LAST
      LOOP
        UPDATE time_slots
          SET start_time = start_time + v_offset,
              end_time   = end_time   + v_offset
          WHERE id = slot_rec.id;
        v_count := v_count + 1;
      END LOOP;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION resetear_horarios_defecto(uuid, boolean, uuid) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. crear_time_slot  (reemplazo completo)
--    Ahora incluye congregation_id en el INSERT,
--    derivándolo del exhibitor.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS crear_time_slot(uuid, integer, time, time, text);

CREATE OR REPLACE FUNCTION crear_time_slot(
  p_exhibitor_id uuid,
  p_day_of_week  integer,
  p_start_time   time,
  p_end_time     time,
  p_block_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id           uuid;
  v_overlap_count    integer;
  v_congregation_id  uuid;
BEGIN
  -- Validar que hora fin > hora inicio
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser mayor que la hora de inicio';
  END IF;

  -- Obtener la congregación del exhibidor
  SELECT congregation_id INTO v_congregation_id
    FROM exhibitors
    WHERE id = p_exhibitor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exhibidor no encontrado';
  END IF;

  -- Verificar solapamientos en el mismo exhibidor y día
  SELECT COUNT(*) INTO v_overlap_count
    FROM time_slots
    WHERE exhibitor_id = p_exhibitor_id
      AND day_of_week  = p_day_of_week
      AND start_time   < p_end_time
      AND end_time     > p_start_time;

  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'Ya existe un bloque horario solapado para ese exhibidor en ese día y horario';
  END IF;

  -- Insertar el nuevo bloque CON congregation_id
  INSERT INTO time_slots (exhibitor_id, day_of_week, start_time, end_time, is_active, block_reason, congregation_id)
    VALUES (
      p_exhibitor_id,
      p_day_of_week,
      p_start_time,
      p_end_time,
      CASE WHEN p_block_reason IS NULL THEN true ELSE false END,
      p_block_reason,
      v_congregation_id
    )
    RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION crear_time_slot(uuid, integer, time, time, text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- Verificación
-- ─────────────────────────────────────────────────────────────
SELECT routine_name, routine_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN (
      'reset_app_data',
      'ajustar_inicio_dia',
      'resetear_horarios_defecto',
      'crear_time_slot'
    );
