/**
 * 15_invitaciones_fase7.sql — Fase 7: Sistema de Invitaciones
 * ─────────────────────────────────────────────────────────────
 * Crea la tabla invitations y las funciones necesarias para que
 * un usuario pueda invitar a otro a compartir su turno.
 *
 * IMPORTANTE: Ejecutar DESPUÉS de los scripts 01-14.
 *
 * Flujo de uso:
 *   1. Usuario A tiene turno en pos 1 (1/2 ocupado)
 *   2. Usuario A abre modal "✉️ Invitar" y selecciona al Usuario B
 *   3. Se inserta un registro en invitations (status = 'pending')
 *   4. Usuario B ve la invitación en su panel "Mis invitaciones"
 *   5. Usuario B acepta → RPC accept_invitation inserta la reserva
 *   6. Usuario B rechaza → UPDATE status = 'declined'
 *
 * Restricciones de negocio (aplicadas en frontend + BD):
 *   - Solo se puede invitar a alguien del mismo género (o cónyuge)
 *   - Un usuario solo puede tener UNA invitación pendiente por slot+semana
 *   - Si el slot ya está lleno (2/2) al aceptar, la invitación se declina
 *   - Solo se puede invitar si el slot tiene espacio (1/2)
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 0. LIMPIAR intento previo fallido (la tabla quedó incompleta)
-- =============================================================
DROP TABLE IF EXISTS invitations CASCADE;

-- =============================================================
-- 1. TABLA: invitations
-- =============================================================
CREATE TABLE invitations (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Qué turno / qué semana
  slot_id         UUID          NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  week_start      DATE          NOT NULL,

  -- Quién invita y quién es invitado
  from_user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Estado de la invitación
  status          TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined')),

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Índice único separado (idempotente, no falla si la tabla ya existía)
-- Garantiza: un usuario solo puede tener UNA invitación pendiente por slot+semana
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_unique_pending
  ON invitations (slot_id, week_start, to_user_id);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_invitations_to_user
  ON invitations (to_user_id, status, week_start);

CREATE INDEX IF NOT EXISTS idx_invitations_from_user
  ON invitations (from_user_id, week_start);

-- =============================================================
-- 2. RLS — Política permisiva (auth es access_key, no Supabase Auth)
-- =============================================================
-- El control de acceso real se hace en la aplicación.
-- Habilitamos RLS pero con política abierta para la clave anónima.
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Permitir todas las operaciones al rol anon (usado por el cliente)
-- DROP + CREATE para que sea idempotente en re-ejecuciones
DROP POLICY IF EXISTS "anon_all_invitations" ON invitations;
CREATE POLICY "anon_all_invitations" ON invitations
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================
-- 3. RPC: accept_invitation
-- =============================================================
-- Acepta una invitación pendiente:
--   1. Verifica que la invitación existe y está pendiente
--   2. Verifica que el slot aún tiene espacio (< 2 personas)
--   3. Inserta la reserva del invitado en la posición libre
--   4. Marca la invitación como 'accepted'
--   5. Declina otras invitaciones pendientes para el mismo slot+semana
--      si el slot quedó lleno (2/2)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inv        invitations%ROWTYPE;
  v_slot_count INTEGER;
  v_position   INTEGER;
BEGIN
  -- 1. Obtener la invitación (solo pendientes)
  SELECT * INTO v_inv
    FROM invitations
    WHERE id = p_invitation_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Invitación no encontrada o ya procesada'
    );
  END IF;

  -- 2. Contar reservas actuales en el slot para esa semana
  SELECT COUNT(*) INTO v_slot_count
    FROM reservations
    WHERE time_slot_id = v_inv.slot_id
      AND week_start   = v_inv.week_start
      AND status      != 'cancelled';

  IF v_slot_count >= 2 THEN
    -- Slot ya lleno — declinar automáticamente
    UPDATE invitations SET status = 'declined' WHERE id = p_invitation_id;
    RETURN jsonb_build_object(
      'success', false,
      'error',   'El turno ya no tiene espacio disponible'
    );
  END IF;

  -- 3. Insertar reserva del invitado en la posición libre
  v_position := v_slot_count + 1;  -- pos 1 si estaba vacío, pos 2 si había uno

  INSERT INTO reservations (time_slot_id, user_id, week_start, status, slot_position)
    VALUES (v_inv.slot_id, v_inv.to_user_id, v_inv.week_start, 'confirmed', v_position);

  -- 4. Marcar invitación como aceptada
  UPDATE invitations SET status = 'accepted' WHERE id = p_invitation_id;

  -- 5. Si el slot quedó lleno (posición 2 ocupada), declinar otras invitaciones pendientes
  IF v_position = 2 THEN
    UPDATE invitations
      SET status = 'declined'
      WHERE slot_id     = v_inv.slot_id
        AND week_start  = v_inv.week_start
        AND status      = 'pending'
        AND id         != p_invitation_id;
  END IF;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN unique_violation THEN
  -- El invitado ya tiene reserva en ese slot (condición de carrera)
  RETURN jsonb_build_object(
    'success', false,
    'error',   'Ya tienes una reserva en ese turno'
  );
END;
$$;

-- =============================================================
-- Verificación: confirmar que todo se creó correctamente
-- =============================================================
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = 'invitations') AS columnas
FROM information_schema.tables
WHERE table_name = 'invitations'
  AND table_schema = 'public';

-- Verificar que el RPC existe
SELECT routine_name, routine_type
  FROM information_schema.routines
  WHERE routine_name = 'accept_invitation'
    AND routine_schema = 'public';
