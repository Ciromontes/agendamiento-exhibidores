/**
 * 16_invitaciones_v2_fase7b.sql — Fase 7b: Mejoras al Sistema de Invitaciones
 * ─────────────────────────────────────────────────────────────
 * Recrea la tabla invitations con:
 *   • expires_at  (2h en día de apertura, 24h el resto)
 *   • RPC accept_invitation reforzado:
 *       - Verifica que la invitación no haya expirado
 *       - Verifica que el invitado aún tiene cupo en su límite
 *       - Protección atómica contra race conditions (slot lleno)
 *   • UNIQUE en reservations(time_slot_id, week_start, slot_position)
 *       - Garantiza que dos reservas simultáneas no ocupen la misma posición
 *
 * IMPORTANTE: Ejecutar DESPUÉS del script 15.
 * Este script descarta la tabla invitations anterior (vacía) y la recrea.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 0. PROTECCIÓN CONTRA RACE CONDITIONS EN RESERVATIONS
-- =============================================================
-- Si dos usuarios intentan ocupar la misma posición exacta en el
-- mismo slot y semana al mismo tiempo, la BD rechaza al segundo.
-- El frontend maneja el error con un reintento en la otra posición.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_slot_position
  ON reservations (time_slot_id, week_start, slot_position)
  WHERE status != 'cancelled';

-- =============================================================
-- 1. RECREAR TABLA invitations CON expires_at
-- =============================================================
DROP TABLE IF EXISTS invitations CASCADE;

CREATE TABLE invitations (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Qué turno / qué semana
  slot_id         UUID          NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  week_start      DATE          NOT NULL,

  -- Quién invita / quién es invitado
  from_user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Estado y expiración
  status          TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined')),

  -- El cliente calcula expires_at: 2h si es el día de apertura, 24h en otro caso.
  -- DEFAULT = 24h como respaldo (si el cliente no lo envía).
  expires_at      TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Un mismo invitado solo puede tener UNA invitación activa por slot+semana
CREATE UNIQUE INDEX idx_invitations_unique_to_user
  ON invitations (slot_id, week_start, to_user_id);

CREATE INDEX idx_invitations_to_user
  ON invitations (to_user_id, status, week_start);

CREATE INDEX idx_invitations_from_user
  ON invitations (from_user_id, week_start);

-- =============================================================
-- 2. RLS
-- =============================================================
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_invitations" ON invitations;
CREATE POLICY "anon_all_invitations" ON invitations
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================
-- 3. RPC: accept_invitation (versión reforzada)
-- =============================================================
-- Verifica en orden (dentro de una transacción atómica):
--   1. La invitación existe y está pendiente
--   2. La invitación no ha expirado
--   3. El invitado aún tiene cupo en su límite semanal/mensual
--   4. El slot aún tiene espacio (< 2 personas)
--   5. Inserta la reserva y marca la invitación como aceptada
--   6. Declina otras pendientes para ese slot si queda lleno (2/2)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inv              invitations%ROWTYPE;
  v_slot_count       INTEGER;
  v_position         INTEGER;
  v_invitee_count    INTEGER;
  v_invitee_type     TEXT;
  v_counting_mode    TEXT;
  v_week_start_date  DATE;
  v_month_start_date DATE;
  v_max_turnos       INTEGER;
BEGIN
  -- 1. Obtener la invitación (solo pendientes)
  SELECT * INTO v_inv
    FROM invitations
    WHERE id = p_invitation_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Invitación no encontrada o ya procesada');
  END IF;

  -- 2. Verificar que no haya expirado
  IF NOW() > v_inv.expires_at THEN
    UPDATE invitations SET status = 'declined' WHERE id = p_invitation_id;
    RETURN jsonb_build_object('success', false,
      'error', 'La invitación ha expirado. El turno vuelve a estar disponible para todos.');
  END IF;

  -- 3. Verificar límite del invitado
  -- Leer modo de conteo y tipo del invitado
  SELECT counting_mode INTO v_counting_mode FROM app_config LIMIT 1;
  SELECT user_type     INTO v_invitee_type  FROM users WHERE id = v_inv.to_user_id;

  -- Calcular inicio del período
  v_week_start_date  := v_inv.week_start;
  v_month_start_date := DATE_TRUNC('month', v_inv.week_start)::DATE;

  -- Contar reservas activas del invitado en el período
  IF v_counting_mode = 'monthly' THEN
    SELECT COUNT(*) INTO v_invitee_count
      FROM reservations
      WHERE user_id    = v_inv.to_user_id
        AND week_start >= v_month_start_date
        AND status    != 'cancelled';
    -- Límites mensuales: publicador=4, regular=8, auxiliar=6
    v_max_turnos := CASE v_invitee_type
      WHEN 'publicador'          THEN 4
      WHEN 'precursor_regular'   THEN 8
      WHEN 'precursor_auxiliar'  THEN 6
      ELSE 1
    END;
  ELSE
    SELECT COUNT(*) INTO v_invitee_count
      FROM reservations
      WHERE user_id    = v_inv.to_user_id
        AND week_start = v_week_start_date
        AND status    != 'cancelled';
    -- Límites semanales: publicador=1, regular=2, auxiliar=2
    v_max_turnos := CASE v_invitee_type
      WHEN 'publicador'          THEN 1
      WHEN 'precursor_regular'   THEN 2
      WHEN 'precursor_auxiliar'  THEN 2
      ELSE 1
    END;
  END IF;

  IF v_invitee_count >= v_max_turnos THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Ya alcanzaste tu límite de turnos para este período.');
  END IF;

  -- 4. Verificar espacio en el slot (protección race condition)
  SELECT COUNT(*) INTO v_slot_count
    FROM reservations
    WHERE time_slot_id = v_inv.slot_id
      AND week_start   = v_inv.week_start
      AND status      != 'cancelled';

  IF v_slot_count >= 2 THEN
    UPDATE invitations SET status = 'declined' WHERE id = p_invitation_id;
    RETURN jsonb_build_object('success', false,
      'error', 'El turno ya no tiene espacio disponible.');
  END IF;

  -- 5. Insertar reserva en la posición libre
  v_position := v_slot_count + 1;

  INSERT INTO reservations (time_slot_id, user_id, week_start, status, slot_position)
    VALUES (v_inv.slot_id, v_inv.to_user_id, v_inv.week_start, 'confirmed', v_position);

  -- Marcar como aceptada
  UPDATE invitations SET status = 'accepted' WHERE id = p_invitation_id;

  -- 6. Si el slot quedó lleno, declinar otras invitaciones pendientes para ese slot
  IF v_position = 2 THEN
    UPDATE invitations
      SET status = 'declined'
      WHERE slot_id    = v_inv.slot_id
        AND week_start = v_inv.week_start
        AND status     = 'pending'
        AND id        != p_invitation_id;
  END IF;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN unique_violation THEN
  -- Race condition: alguien más ocupó la misma posición al mismo tiempo
  RETURN jsonb_build_object('success', false,
    'error', 'El turno fue ocupado por otra persona en ese mismo instante. Intenta más tarde.');
END;
$$;

-- =============================================================
-- 4. HABILITAR REALTIME EN invitations
-- =============================================================
-- Permite que los clientes suscritos reciban cambios en tiempo real
-- (INSERT cuando alguien envía una invitación, UPDATE al aceptar/declinar).
-- Sin esto, la suscripción de canal en el frontend no recibe eventos.
ALTER PUBLICATION supabase_realtime ADD TABLE invitations;

-- =============================================================
-- Verificación
-- =============================================================
SELECT 'invitations' AS tabla,
       COUNT(*) AS columnas
  FROM information_schema.columns
  WHERE table_name = 'invitations' AND table_schema = 'public';

SELECT routine_name
  FROM information_schema.routines
  WHERE routine_name = 'accept_invitation' AND routine_schema = 'public';

SELECT indexname
  FROM pg_indexes
  WHERE tablename = 'reservations' AND indexname = 'idx_reservations_slot_position';
