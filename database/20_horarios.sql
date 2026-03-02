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
  v_new_id uuid;
  v_overlap_count integer;
BEGIN
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser mayor que la hora de inicio';
  END IF;

  SELECT COUNT(*) INTO v_overlap_count
    FROM time_slots
    WHERE exhibitor_id = p_exhibitor_id
      AND day_of_week  = p_day_of_week
      AND start_time   < p_end_time
      AND end_time     > p_start_time;

  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'Ya existe un bloque horario solapado para ese exhibidor en ese día y horario';
  END IF;

  INSERT INTO time_slots (exhibitor_id, day_of_week, start_time, end_time, is_active, block_reason)
    VALUES (
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