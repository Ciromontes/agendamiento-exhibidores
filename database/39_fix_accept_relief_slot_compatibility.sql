-- =============================================================
-- Script 39 — Alinear accept_relief con compatibilidad real del slot
-- =============================================================
-- Objetivo:
--   1) Validar relevo personalizado: solo lo puede aceptar to_user_id.
--   2) Validar compatibilidad por ocupantes que permanecen en el slot
--      (no por genero del solicitante).
--   3) Mantener validaciones de cupo por periodo y limite mensual de relevos.
-- =============================================================

CREATE OR REPLACE FUNCTION accept_relief(
  p_relief_id   UUID,
  p_acceptor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rel                relief_requests%ROWTYPE;
  v_acc_gender         TEXT;
  v_acc_type           TEXT;
  v_congregation_id    UUID;
  v_counting_mode      TEXT;
  v_lim_pub            INTEGER;
  v_lim_prec           INTEGER;
  v_relief_limit       INTEGER;
  v_relief_count       INTEGER;
  v_acc_count          INTEGER;
  v_max_turnos         INTEGER;
  v_month_start        DATE;
  v_month_end          DATE;
  v_incompatible_slot  BOOLEAN;
BEGIN
  -- 1) Obtener solicitud pendiente y bloquearla para evitar carreras.
  SELECT *
    INTO v_rel
    FROM relief_requests
   WHERE id = p_relief_id
     AND status = 'pending'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Solicitud no encontrada o ya procesada.'
    );
  END IF;

  -- 2) Verificar expiracion.
  IF NOW() > v_rel.expires_at THEN
    UPDATE relief_requests
       SET status = 'cancelled'
     WHERE id = p_relief_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Esta solicitud de relevo ha expirado.'
    );
  END IF;

  -- 3) Si el relevo es personalizado, solo puede aceptarlo ese usuario.
  IF v_rel.to_user_id IS NOT NULL AND v_rel.to_user_id <> p_acceptor_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Este relevo fue asignado a otro usuario.'
    );
  END IF;

  -- 4) Datos del aceptante.
  SELECT gender, user_type, congregation_id
    INTO v_acc_gender, v_acc_type, v_congregation_id
    FROM users
   WHERE id = p_acceptor_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Usuario aceptante no encontrado.'
    );
  END IF;

  -- 5) Defensa multi-tenant.
  IF v_rel.congregation_id IS DISTINCT FROM v_congregation_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No puedes aceptar un relevo de otra congregacion.'
    );
  END IF;

  -- 6) Compatibilidad por ocupantes que quedan en el slot.
  --    Se excluye al solicitante porque su lugar sera transferido.
  SELECT EXISTS (
    SELECT 1
      FROM reservations r
 LEFT JOIN users u ON u.id = r.user_id
     WHERE r.time_slot_id = v_rel.slot_id
       AND r.week_start   = v_rel.week_start
       AND r.status      != 'cancelled'
       AND r.user_id     != v_rel.from_user_id
       AND v_acc_gender IS NOT NULL
       AND u.gender IS NOT NULL
       AND u.gender <> v_acc_gender
  )
    INTO v_incompatible_slot;

  IF v_incompatible_slot THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No eres compatible con el ocupante restante de este turno.'
    );
  END IF;

  -- 7) Leer configuracion de la congregacion.
  SELECT counting_mode, relief_limit_publicador, relief_limit_precursor
    INTO v_counting_mode, v_lim_pub, v_lim_prec
    FROM app_config
   WHERE congregation_id = v_congregation_id
   LIMIT 1;

  v_counting_mode := COALESCE(v_counting_mode, 'weekly');

  v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  v_month_end   := (v_month_start + INTERVAL '1 month')::DATE;

  -- 8) Verificar limite de turnos por periodo.
  IF v_counting_mode = 'monthly' THEN
    SELECT COUNT(*)
      INTO v_acc_count
      FROM reservations
     WHERE user_id         = p_acceptor_id
       AND congregation_id = v_congregation_id
       AND week_start     >= v_month_start
       AND week_start      < v_month_end
       AND status         != 'cancelled';

    v_max_turnos := CASE v_acc_type
      WHEN 'publicador'         THEN 4
      WHEN 'precursor_regular'  THEN 8
      WHEN 'precursor_auxiliar' THEN 6
      ELSE 1
    END;
  ELSE
    SELECT COUNT(*)
      INTO v_acc_count
      FROM reservations
     WHERE user_id         = p_acceptor_id
       AND congregation_id = v_congregation_id
       AND week_start      = v_rel.week_start
       AND status         != 'cancelled';

    v_max_turnos := CASE v_acc_type
      WHEN 'publicador'         THEN 1
      WHEN 'precursor_regular'  THEN 2
      WHEN 'precursor_auxiliar' THEN 2
      ELSE 1
    END;
  END IF;

  IF v_acc_count >= v_max_turnos THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ya alcanzaste tu limite de turnos para este periodo.'
    );
  END IF;

  -- 9) Verificar limite mensual de relevos aceptados.
  IF v_acc_type IN ('precursor_auxiliar', 'precursor_regular') THEN
    v_relief_limit := COALESCE(v_lim_prec, 2);
  ELSE
    v_relief_limit := COALESCE(v_lim_pub, 1);
  END IF;

  SELECT COUNT(*)
    INTO v_relief_count
    FROM relief_requests
   WHERE acceptor_id      = p_acceptor_id
     AND congregation_id  = v_congregation_id
     AND status           = 'accepted'
     AND accepted_at     >= v_month_start
     AND accepted_at      < v_month_end;

  IF v_relief_count >= v_relief_limit THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Has alcanzado el limite de relevos que puedes aceptar este mes.'
    );
  END IF;

  -- 10) Transferir reserva al aceptante.
  UPDATE reservations
     SET user_id = p_acceptor_id
   WHERE id     = v_rel.reservation_id
     AND status != 'cancelled'
     AND user_id = v_rel.from_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'La reserva ya no existe, fue cancelada o ya cambio de propietario.'
    );
  END IF;

  -- 11) Marcar relevo como aceptado.
  UPDATE relief_requests
     SET status      = 'accepted',
         acceptor_id = p_acceptor_id,
         accepted_at = NOW()
   WHERE id = p_relief_id;

  -- 12) Cancelar otros relevos pendientes de la misma reserva.
  UPDATE relief_requests
     SET status = 'cancelled'
   WHERE reservation_id = v_rel.reservation_id
     AND status         = 'pending'
     AND id            != p_relief_id;

  -- 13) Cancelar invitaciones pendientes del solicitante para ese slot/semana.
  UPDATE invitations
     SET status = 'declined'
   WHERE from_user_id = v_rel.from_user_id
     AND slot_id      = v_rel.slot_id
     AND week_start   = v_rel.week_start
     AND status       = 'pending';

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Error inesperado: ' || SQLERRM
  );
END;
$$;

-- Verificacion rapida
SELECT routine_name
  FROM information_schema.routines
 WHERE routine_name = 'accept_relief'
   AND routine_schema = 'public';
