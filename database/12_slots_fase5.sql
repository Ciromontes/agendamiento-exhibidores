/**
 * 12_slots_fase5.sql — Fase 5: Gestión Flexible de Bloques Horarios
 * ─────────────────────────────────────────────────────────────
 * Funciones SQL para crear y eliminar bloques horarios (time_slots)
 * con validaciones de solapamiento y reservas activas.
 *
 * IMPORTANTE: Ejecutar en el SQL Editor de Supabase DESPUÉS
 * de haber ejecutado los scripts 01-11.
 *
 * Funciones incluidas:
 *   1. crear_time_slot(exhibitor_id, day, start, end, reason)
 *      — Valida solapamientos y crea el bloque.
 *   2. eliminar_time_slot(slot_id)
 *      — Valida que no haya reservas futuras activas y elimina.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. CREAR BLOQUE HORARIO
-- =============================================================
-- Inserta un nuevo time_slot validando:
--   a. Que no exista ya un bloque solapado para ese
--      exhibidor en el mismo día.
--   b. Si block_reason es NULL, el slot se crea activo.
--      Si block_reason tiene valor, se crea inactivo (bloqueado).
CREATE OR REPLACE FUNCTION crear_time_slot(
  p_exhibitor_id uuid,
  p_day_of_week  integer,   -- 0=Dom, 1=Lun, ..., 6=Sáb
  p_start_time   time,
  p_end_time     time,
  p_block_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id uuid;
  v_overlap_count integer;
BEGIN
  -- Validar que hora fin > hora inicio
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser mayor que la hora de inicio';
  END IF;

  -- Verificar solapamientos en el mismo exhibidor y día
  -- Un solapamiento existe si el nuevo rango se intersecta con alguno existente
  SELECT COUNT(*) INTO v_overlap_count
    FROM time_slots
    WHERE exhibitor_id = p_exhibitor_id
      AND day_of_week  = p_day_of_week
      AND start_time   < p_end_time
      AND end_time     > p_start_time;

  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'Ya existe un bloque horario solapado para ese exhibidor en ese día y horario';
  END IF;

  -- Insertar el nuevo bloque
  INSERT INTO time_slots (exhibitor_id, day_of_week, start_time, end_time, is_active, block_reason)
    VALUES (
      p_exhibitor_id,
      p_day_of_week,
      p_start_time,
      p_end_time,
      -- Si tiene razón de bloqueo se crea inactivo, si no se crea activo
      CASE WHEN p_block_reason IS NULL THEN true ELSE false END,
      p_block_reason
    )
    RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- =============================================================
-- 2. ELIMINAR BLOQUE HORARIO
-- =============================================================
-- Elimina un time_slot solo si no tiene reservas activas
-- en semanas actuales o futuras (week_start >= hoy).
CREATE OR REPLACE FUNCTION eliminar_time_slot(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reservation_count integer;
BEGIN
  -- Verificar reservas activas futuras o presentes
  SELECT COUNT(*) INTO v_reservation_count
    FROM reservations
    WHERE time_slot_id = p_slot_id
      AND status != 'cancelled'
      AND week_start >= date_trunc('week', CURRENT_DATE)::date;

  IF v_reservation_count > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: el bloque tiene % reserva(s) activa(s) esta semana o en semanas futuras', v_reservation_count;
  END IF;

  -- Eliminar el bloque
  DELETE FROM time_slots WHERE id = p_slot_id;
END;
$$;

-- =============================================================
-- Verificación: listar funciones creadas
-- =============================================================
SELECT routine_name, routine_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN ('crear_time_slot', 'eliminar_time_slot');
