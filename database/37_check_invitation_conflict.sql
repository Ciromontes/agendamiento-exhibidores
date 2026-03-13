-- ═══════════════════════════════════════════════════════════════
-- 37 — check_invitation_accept_conflict
-- ═══════════════════════════════════════════════════════════════
-- Antes de aceptar una invitación, el cliente llama esta función
-- para saber si hacerlo liberaría un turno "huérfano" del usuario.
--
-- Un turno huérfano es una reserva del usuario donde el slot tiene
-- solo 1 persona (él/ella) y nadie más se ha unido.
--
-- Retorna:
--   { has_conflict: false }
--     → El usuario puede aceptar sin consecuencias (tiene cupo).
--
--   { has_conflict: true, exhibitor_name, day_of_week,
--     start_time, end_time, reservation_id, slot_id }
--     → El usuario está en su límite de turnos pero tiene un huérfano;
--       si acepta, ese turno quedará libre para otros.
--
-- El frontend usa esto para mostrar un modal de confirmación.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_invitation_accept_conflict(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv              invitations%ROWTYPE;
  v_congregation_id  UUID;
  v_user_type        TEXT;
  v_max_turnos       INTEGER;
  v_current_count    INTEGER;
  v_orphan           RECORD;
BEGIN
  -- 1) Obtener la invitación pendiente
  SELECT * INTO v_inv
    FROM invitations
    WHERE id = p_invitation_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_conflict', false);
  END IF;

  -- 2) Resolver congregación
  v_congregation_id := COALESCE(
    v_inv.congregation_id,
    (SELECT congregation_id FROM users WHERE id = v_inv.to_user_id)
  );

  -- 3) Tipo de usuario y límite semanal del invitado
  SELECT user_type INTO v_user_type
    FROM users WHERE id = v_inv.to_user_id;

  v_max_turnos := CASE v_user_type
    WHEN 'publicador'         THEN 1
    WHEN 'precursor_regular'  THEN 2
    WHEN 'precursor_auxiliar' THEN 2
    ELSE 1
  END;

  -- 4) Contar reservas activas del invitado esta semana
  SELECT COUNT(*) INTO v_current_count
    FROM reservations
    WHERE congregation_id = v_congregation_id
      AND user_id         = v_inv.to_user_id
      AND week_start      = v_inv.week_start
      AND status         != 'cancelled';

  -- 5) Si tiene cupo disponible → sin conflicto
  IF v_current_count < v_max_turnos THEN
    RETURN jsonb_build_object('has_conflict', false);
  END IF;

  -- 6) Está en su límite: buscar un turno huérfano
  --    (reserva del usuario donde el slot tiene solo 1 persona)
  SELECT
    r.id              AS reservation_id,
    r.time_slot_id    AS slot_id,
    e.name            AS exhibitor_name,
    ts.day_of_week,
    ts.start_time,
    ts.end_time
  INTO v_orphan
  FROM reservations r
  JOIN time_slots ts ON ts.id = r.time_slot_id
  JOIN exhibitors  e  ON e.id  = ts.exhibitor_id
  WHERE r.congregation_id = v_congregation_id
    AND r.user_id         = v_inv.to_user_id
    AND r.week_start      = v_inv.week_start
    AND r.status         != 'cancelled'
    AND (
      -- El slot tiene exactamente 1 reserva activa (solo el usuario, sin pareja)
      SELECT COUNT(*)
        FROM reservations r2
        WHERE r2.congregation_id = v_congregation_id
          AND r2.time_slot_id    = r.time_slot_id
          AND r2.week_start      = v_inv.week_start
          AND r2.status         != 'cancelled'
    ) = 1
  LIMIT 1;

  IF v_orphan IS NULL THEN
    -- En su límite pero todos sus turnos están emparejados
    -- (el filtro de candidatos debería haberlo excluido, pero lo manejamos)
    RETURN jsonb_build_object('has_conflict', false);
  END IF;

  -- 7) Hay conflicto: devolver datos del turno huérfano para el mensaje
  RETURN jsonb_build_object(
    'has_conflict',    true,
    'reservation_id',  v_orphan.reservation_id,
    'slot_id',         v_orphan.slot_id,
    'exhibitor_name',  v_orphan.exhibitor_name,
    'day_of_week',     v_orphan.day_of_week,
    'start_time',      v_orphan.start_time,
    'end_time',        v_orphan.end_time
  );

EXCEPTION WHEN OTHERS THEN
  -- En caso de error, no bloquear el flujo de aceptación
  RETURN jsonb_build_object('has_conflict', false);
END;
$$;

GRANT EXECUTE ON FUNCTION check_invitation_accept_conflict(UUID) TO anon, authenticated;
