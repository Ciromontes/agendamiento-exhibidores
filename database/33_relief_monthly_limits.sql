-- =============================================================
-- Script 33 — Límites configurables de relevos aceptados por mes
-- Paso 3.1 del Roadmap — Simulación y Mejoras
-- =============================================================
-- Cambios:
--   1. app_config: relief_limit_publicador, relief_limit_precursor
--   2. relief_requests: acceptor_id, accepted_at
--   3. accept_relief(): agrega chequeo del límite mensual de relevos
-- =============================================================

-- ── 1. Nuevas columnas en app_config ─────────────────────────
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS relief_limit_publicador INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS relief_limit_precursor  INT DEFAULT 2;

-- ── 2. Nuevas columnas en relief_requests ────────────────────
-- acceptor_id: quién aceptó el relevo (NULL mientras está pendiente)
-- accepted_at: cuándo fue aceptado (para contar relevos del mes)
ALTER TABLE public.relief_requests
  ADD COLUMN IF NOT EXISTS acceptor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_relief_acceptor_month
  ON public.relief_requests (acceptor_id, accepted_at)
  WHERE status = 'accepted';

-- ── 3. Función actualizada: accept_relief ─────────────────────
-- Reemplaza la función del script 17 añadiendo:
--   a. Verifica el límite mensual de relevos aceptados por el usuario.
--   b. Guarda acceptor_id y accepted_at al marcar como aceptado.
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
  v_rel              relief_requests%ROWTYPE;
  v_from_gender      TEXT;
  v_acc_gender       TEXT;
  v_acc_type         TEXT;
  v_congregation_id  UUID;
  v_counting_mode    TEXT;
  v_lim_pub          INTEGER;
  v_lim_prec         INTEGER;
  v_relief_limit     INTEGER;
  v_relief_count     INTEGER;
  v_acc_count        INTEGER;
  v_max_turnos       INTEGER;
  v_month_start      DATE;
BEGIN
  -- 1. Obtener la solicitud de relevo (solo pendientes)
  SELECT * INTO v_rel
    FROM relief_requests
    WHERE id = p_relief_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Solicitud no encontrada o ya procesada.');
  END IF;

  -- 2. Verificar que no haya expirado
  IF NOW() > v_rel.expires_at THEN
    UPDATE relief_requests SET status = 'cancelled' WHERE id = p_relief_id;
    RETURN jsonb_build_object('success', false,
      'error', 'Esta solicitud de relevo ha expirado.');
  END IF;

  -- 3. Verificar compatibilidad de género
  SELECT gender INTO v_from_gender FROM users WHERE id = v_rel.from_user_id;
  SELECT gender, user_type, congregation_id
    INTO v_acc_gender, v_acc_type, v_congregation_id
    FROM users WHERE id = p_acceptor_id;

  IF v_from_gender IS DISTINCT FROM v_acc_gender THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Solo hermanos del mismo género pueden aceptar el relevo.');
  END IF;

  -- 4. Leer configuración de la congregación
  SELECT counting_mode, relief_limit_publicador, relief_limit_precursor
    INTO v_counting_mode, v_lim_pub, v_lim_prec
    FROM app_config
    WHERE congregation_id = v_congregation_id LIMIT 1;

  v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;

  -- 5. Verificar límite de reservas (turnos del período)
  IF v_counting_mode = 'monthly' THEN
    SELECT COUNT(*) INTO v_acc_count
      FROM reservations
      WHERE user_id    = p_acceptor_id
        AND week_start >= v_month_start
        AND status    != 'cancelled';
    v_max_turnos := CASE v_acc_type
      WHEN 'publicador'         THEN 4
      WHEN 'precursor_regular'  THEN 8
      WHEN 'precursor_auxiliar' THEN 6
      ELSE 1
    END;
  ELSE
    SELECT COUNT(*) INTO v_acc_count
      FROM reservations
      WHERE user_id    = p_acceptor_id
        AND week_start = v_rel.week_start
        AND status    != 'cancelled';
    v_max_turnos := CASE v_acc_type
      WHEN 'publicador'         THEN 1
      WHEN 'precursor_regular'  THEN 2
      WHEN 'precursor_auxiliar' THEN 2
      ELSE 1
    END;
  END IF;

  IF v_acc_count >= v_max_turnos THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Ya alcanzaste tu límite de turnos para este período.');
  END IF;

  -- 6. Verificar límite mensual de relevos aceptados (Paso 3.1)
  IF v_acc_type IN ('precursor_auxiliar', 'precursor_regular') THEN
    v_relief_limit := COALESCE(v_lim_prec, 2);
  ELSE
    v_relief_limit := COALESCE(v_lim_pub, 1);
  END IF;

  SELECT COUNT(*) INTO v_relief_count
    FROM relief_requests
    WHERE acceptor_id = p_acceptor_id
      AND status      = 'accepted'
      AND accepted_at >= v_month_start;

  IF v_relief_count >= v_relief_limit THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Has alcanzado el límite de ' || v_relief_limit ||
               ' relevo(s) que puedes aceptar este mes.');
  END IF;

  -- 7. Transferir la reserva al aceptante
  UPDATE reservations
    SET user_id = p_acceptor_id
    WHERE id     = v_rel.reservation_id
      AND status != 'cancelled';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'La reserva ya no existe o fue cancelada.');
  END IF;

  -- 8. Marcar el relevo como aceptado (con acceptor_id y accepted_at)
  UPDATE relief_requests
    SET status      = 'accepted',
        acceptor_id = p_acceptor_id,
        accepted_at = NOW()
    WHERE id = p_relief_id;

  -- 9. Cancelar otros relevos pendientes para la misma reserva
  UPDATE relief_requests
    SET status = 'cancelled'
    WHERE reservation_id = v_rel.reservation_id
      AND status         = 'pending'
      AND id            != p_relief_id;

  -- 10. Cancelar invitaciones enviadas por el solicitante para ese slot/semana
  UPDATE invitations
    SET status = 'declined'
    WHERE from_user_id = v_rel.from_user_id
      AND slot_id      = v_rel.slot_id
      AND week_start   = v_rel.week_start
      AND status       = 'pending';

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false,
    'error', 'Error inesperado: ' || SQLERRM);
END;
$$;

-- ── Verificación ──────────────────────────────────────────────
SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'app_config' AND table_schema = 'public'
    AND column_name IN ('relief_limit_publicador', 'relief_limit_precursor');

SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'relief_requests' AND table_schema = 'public'
    AND column_name IN ('acceptor_id', 'accepted_at');

SELECT routine_name
  FROM information_schema.routines
  WHERE routine_name = 'accept_relief' AND routine_schema = 'public';
