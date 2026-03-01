/**
 * 17_relevos_fase9a.sql — Fase 9A: Sistema de Relevos
 * ─────────────────────────────────────────────────────────────
 * Crea la infraestructura BD para solicitudes de relevo:
 *
 *   • Tabla relief_requests:
 *       - from_user_id: quien pide ser relevado
 *       - to_user_id:   NULL = abierto a todos / UUID = personalizado
 *       - reservation_id: qué reserva se quiere transferir
 *       - expires_at: expira cuando empieza el turno (máx 24h)
 *
 *   • RPC accept_relief(p_relief_id, p_acceptor_id):
 *       Verifica género, capacidad del aceptante y transfiere
 *       la reserva atómicamente.
 *
 *   • Habilita Realtime en relief_requests para notificaciones
 *     instantáneas en NotificationBell y ReliefBadge.
 *
 * IMPORTANTE: Ejecutar DESPUÉS del script 16.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. TABLA relief_requests
-- =============================================================
CREATE TABLE IF NOT EXISTS relief_requests (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Qué reserva se quiere transferir
  reservation_id  UUID          NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  slot_id         UUID          NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  week_start      DATE          NOT NULL,

  -- Quién pide el relevo / a quién va dirigido
  from_user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = relevo abierto (cualquier usuario compatible)
  -- UUID = relevo personalizado (usuario específico)
  to_user_id      UUID          REFERENCES users(id) ON DELETE SET NULL,

  -- Estado
  status          TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'cancelled')),

  -- Expira cuando empieza el turno (calculado por el cliente)
  -- DEFAULT = 24h como respaldo
  expires_at      TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_relief_from_user
  ON relief_requests (from_user_id, week_start, status);

CREATE INDEX IF NOT EXISTS idx_relief_to_user
  ON relief_requests (to_user_id, status, week_start);

CREATE INDEX IF NOT EXISTS idx_relief_reservation
  ON relief_requests (reservation_id, status);

-- =============================================================
-- 2. RLS
-- =============================================================
ALTER TABLE relief_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_reliefs" ON relief_requests;
CREATE POLICY "anon_all_reliefs" ON relief_requests
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================
-- 3. RPC: accept_relief
-- =============================================================
-- Flujo atómico al aceptar un relevo:
--   1. Verificar que la solicitud existe y está pendiente
--   2. Verificar que no haya expirado
--   3. Verificar que el aceptante tiene el mismo género que el solicitante
--   4. Verificar que el aceptante tiene cupo en su límite
--   5. Transferir la reserva: UPDATE reservations SET user_id = acceptor
--   6. Marcar el relevo como aceptado
--   7. Cancelar otros relevos pendientes para la misma reserva
--   8. Cancelar invitaciones enviadas por el solicitante para ese slot/semana
-- ─────────────────────────────────────────────────────────────
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
  v_counting_mode    TEXT;
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
  SELECT gender INTO v_acc_gender  FROM users WHERE id = p_acceptor_id;

  IF v_from_gender IS DISTINCT FROM v_acc_gender THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Solo hermanos del mismo género pueden aceptar el relevo.');
  END IF;

  -- 4. Verificar límite del aceptante
  SELECT counting_mode INTO v_counting_mode FROM app_config LIMIT 1;
  SELECT user_type     INTO v_acc_type      FROM users WHERE id = p_acceptor_id;

  v_month_start := DATE_TRUNC('month', v_rel.week_start)::DATE;

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

  -- 5. Transferir la reserva al aceptante
  UPDATE reservations
    SET user_id = p_acceptor_id
    WHERE id = v_rel.reservation_id
      AND status != 'cancelled';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'La reserva ya no existe o fue cancelada.');
  END IF;

  -- 6. Marcar el relevo como aceptado
  UPDATE relief_requests SET status = 'accepted' WHERE id = p_relief_id;

  -- 7. Cancelar otros relevos pendientes para la misma reserva
  UPDATE relief_requests
    SET status = 'cancelled'
    WHERE reservation_id = v_rel.reservation_id
      AND status         = 'pending'
      AND id            != p_relief_id;

  -- 8. Cancelar invitaciones enviadas por el solicitante para ese slot/semana
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

-- =============================================================
-- 4. HABILITAR REALTIME EN relief_requests
-- =============================================================
-- Permite que NotificationBell y ReliefBadge reciban cambios
-- al instante vía websocket (INSERT = nueva solicitud, UPDATE = aceptada/cancelada).
ALTER PUBLICATION supabase_realtime ADD TABLE relief_requests;

-- =============================================================
-- Verificación
-- =============================================================
SELECT 'relief_requests' AS tabla,
       COUNT(*) AS columnas
  FROM information_schema.columns
  WHERE table_name = 'relief_requests' AND table_schema = 'public';

SELECT routine_name
  FROM information_schema.routines
  WHERE routine_name = 'accept_relief' AND routine_schema = 'public';
