-- ============================================================
-- CREAR funciones crear_time_slot y eliminar_time_slot
-- (Fase 5 — ejecutar si aún no existen)
-- ============================================================

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
  v_new_id        uuid;
  v_congregation  uuid;
BEGIN
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser mayor que la hora de inicio';
  END IF;

  -- Obtener congregation_id del exhibidor
  SELECT congregation_id INTO v_congregation
    FROM exhibitors WHERE id = p_exhibitor_id;

  IF v_congregation IS NULL THEN
    RAISE EXCEPTION 'Exhibidor no encontrado o sin congregación';
  END IF;

  -- Eliminar automáticamente slots solapados del mismo exhibidor/día
  -- (el frontend ya pidió confirmación al admin si eran activos)
  DELETE FROM time_slots
    WHERE exhibitor_id = p_exhibitor_id
      AND day_of_week  = p_day_of_week
      AND start_time   < p_end_time
      AND end_time     > p_start_time
      AND id NOT IN (
        SELECT DISTINCT time_slot_id FROM reservations
        WHERE status != 'cancelled'
          AND week_start >= date_trunc('week', CURRENT_DATE)::date
      );

  INSERT INTO time_slots (congregation_id, exhibitor_id, day_of_week, start_time, end_time, is_active, block_reason)
    VALUES (
      v_congregation,
      p_exhibitor_id,
      p_day_of_week,
      p_start_time,
      p_end_time,
      CASE WHEN p_block_reason IS NULL THEN true ELSE false END,
      p_block_reason
    )
    RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- ── Recargar schema cache de PostgREST ──────────────────────
NOTIFY pgrst, 'reload schema';