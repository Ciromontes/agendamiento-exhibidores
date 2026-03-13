-- ═══════════════════════════════════════════════════════════════
-- 36 — Fix accept_invitation: congregation_id + multi-tenant
-- ═══════════════════════════════════════════════════════════════
-- PROBLEMA CRÍTICO (lanzamiento):
--   El RPC accept_invitation insertaba en reservations sin
--   congregation_id, causando:
--   "null value in column \"congregation_id\" of relation \"reservations\""
--
-- SOLUCIÓN:
--   1) Insertar reservation con congregation_id
--   2) Filtrar conteos por congregation_id (multi-tenant)
--   3) Leer app_config por congregation_id
--   4) Soportar compensación de última semana si está habilitada
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION accept_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv                     invitations%ROWTYPE;
  v_slot_count              INTEGER;
  v_position                INTEGER;
  v_invitee_count           INTEGER;
  v_invitee_type            TEXT;
  v_counting_mode           TEXT;
  v_last_week_compensation  BOOLEAN;
  v_week_start_date         DATE;
  v_month_start_date        DATE;
  v_is_last_week_of_month   BOOLEAN;
  v_use_monthly_limit       BOOLEAN;
  v_max_turnos              INTEGER;
  v_congregation_id         UUID;
BEGIN
  -- 1) Obtener invitación pendiente
  SELECT * INTO v_inv
    FROM invitations
    WHERE id = p_invitation_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Invitación no encontrada o ya procesada');
  END IF;

  -- 2) Resolver congregación (primero de la invitación, fallback desde usuario)
  v_congregation_id := v_inv.congregation_id;
  IF v_congregation_id IS NULL THEN
    SELECT congregation_id INTO v_congregation_id
    FROM users
    WHERE id = v_inv.to_user_id;
  END IF;

  IF v_congregation_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'No se pudo resolver la congregación de la invitación.');
  END IF;

  -- 3) Verificar expiración
  IF NOW() > v_inv.expires_at THEN
    UPDATE invitations
      SET status = 'declined'
      WHERE id = p_invitation_id;
    RETURN jsonb_build_object('success', false,
      'error', 'La invitación ha expirado. El turno vuelve a estar disponible para todos.');
  END IF;

  -- 4) Leer config y tipo de usuario en contexto multi-tenant
  SELECT counting_mode, COALESCE(last_week_compensation, false)
    INTO v_counting_mode, v_last_week_compensation
    FROM app_config
    WHERE congregation_id = v_congregation_id
    LIMIT 1;

  IF v_counting_mode IS NULL THEN
    v_counting_mode := 'weekly';
  END IF;

  SELECT user_type INTO v_invitee_type
    FROM users
    WHERE id = v_inv.to_user_id;

  v_week_start_date  := v_inv.week_start;
  v_month_start_date := DATE_TRUNC('month', v_inv.week_start)::DATE;
  v_is_last_week_of_month := DATE_TRUNC('month', (v_inv.week_start + INTERVAL '7 days'))
                             <> DATE_TRUNC('month', v_inv.week_start);

  v_use_monthly_limit :=
    v_counting_mode = 'monthly'
    OR (
      v_counting_mode = 'weekly'
      AND v_last_week_compensation
      AND v_is_last_week_of_month
    );

  -- 5) Validar límite de turnos
  IF v_use_monthly_limit THEN
    SELECT COUNT(*) INTO v_invitee_count
      FROM reservations
      WHERE congregation_id = v_congregation_id
        AND user_id    = v_inv.to_user_id
        AND week_start >= v_month_start_date
        AND status    != 'cancelled';

    v_max_turnos := CASE v_invitee_type
      WHEN 'publicador'         THEN 4
      WHEN 'precursor_regular'  THEN 8
      WHEN 'precursor_auxiliar' THEN 6
      ELSE 1
    END;
  ELSE
    SELECT COUNT(*) INTO v_invitee_count
      FROM reservations
      WHERE congregation_id = v_congregation_id
        AND user_id    = v_inv.to_user_id
        AND week_start = v_week_start_date
        AND status    != 'cancelled';

    v_max_turnos := CASE v_invitee_type
      WHEN 'publicador'         THEN 1
      WHEN 'precursor_regular'  THEN 2
      WHEN 'precursor_auxiliar' THEN 2
      ELSE 1
    END;
  END IF;

  IF v_invitee_count >= v_max_turnos THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Ya alcanzaste tu límite de turnos para este período.');
  END IF;

  -- 6) Verificar espacio en el slot
  SELECT COUNT(*) INTO v_slot_count
    FROM reservations
    WHERE congregation_id = v_congregation_id
      AND time_slot_id = v_inv.slot_id
      AND week_start   = v_inv.week_start
      AND status      != 'cancelled';

  IF v_slot_count >= 2 THEN
    UPDATE invitations
      SET status = 'declined'
      WHERE id = p_invitation_id;
    RETURN jsonb_build_object('success', false,
      'error', 'El turno ya no tiene espacio disponible.');
  END IF;

  -- 7) Insertar reserva con congregation_id (fix principal)
  v_position := v_slot_count + 1;

  INSERT INTO reservations (
    time_slot_id,
    user_id,
    week_start,
    status,
    slot_position,
    congregation_id
  ) VALUES (
    v_inv.slot_id,
    v_inv.to_user_id,
    v_inv.week_start,
    'confirmed',
    v_position,
    v_congregation_id
  );

  -- 8) Marcar invitación como aceptada
  UPDATE invitations
    SET status = 'accepted'
    WHERE id = p_invitation_id;

  -- 9) Si el slot quedó lleno, declinar otras pendientes del mismo slot
  IF v_position = 2 THEN
    UPDATE invitations
      SET status = 'declined'
      WHERE congregation_id = v_congregation_id
        AND slot_id         = v_inv.slot_id
        AND week_start      = v_inv.week_start
        AND status          = 'pending'
        AND id             != p_invitation_id;
  END IF;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false,
    'error', 'El turno fue ocupado por otra persona en ese mismo instante. Intenta más tarde.');
END;
$$;

GRANT EXECUTE ON FUNCTION accept_invitation(UUID) TO anon, authenticated;
