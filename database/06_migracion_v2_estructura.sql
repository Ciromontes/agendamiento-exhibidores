-- =============================================================
-- 06_migracion_v2_estructura.sql
-- =============================================================
-- PROPÓSITO:
--   Migrar la base de datos de V1 a V2 para soportar:
--     - 3 tipos de usuario (publicador, precursor_regular, precursor_auxiliar)
--     - 2 personas por celda (slot_position 1 y 2)
--     - Domingos (day_of_week = 0)
--     - Parejas (spouse_id)
--     - Configuración global del admin (app_config)
--
-- PRERREQUISITO:
--   Haber ejecutado los scripts 01-05 previamente.
--   Los datos existentes se migran automáticamente.
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. Luego ejecutar 07_seed_domingos_y_config.sql
--
-- ⚠️  CAMBIOS DESTRUCTIVOS:
--   - Se eliminan constraints viejos y se crean nuevos
--   - Los user_type 'A' se convierten a 'publicador'
--   - Los user_type 'B' se convierten a 'precursor_regular'
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- PASO 1: MIGRAR user_type DE 'A'/'B' A TIPOS REALES
-- ─────────────────────────────────────────────────────────────
-- Antes:  'A' = 1 turno/semana, 'B' = 2 turnos/semana
-- Ahora:  'publicador' = 1/semana
--         'precursor_regular' = 2/semana
--         'precursor_auxiliar' = 6/mes (se controla mensualmente)
-- ─────────────────────────────────────────────────────────────

-- Primero eliminar la restricción vieja (que solo permite 'A' y 'B')
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;

-- Ahora sí convertir los valores existentes
UPDATE users SET user_type = 'publicador'       WHERE user_type = 'A';
UPDATE users SET user_type = 'precursor_regular' WHERE user_type = 'B';

-- Crear la nueva restricción con los 3 tipos válidos
ALTER TABLE users ADD CONSTRAINT users_user_type_check
  CHECK (user_type IN ('publicador', 'precursor_regular', 'precursor_auxiliar'));


-- ─────────────────────────────────────────────────────────────
-- PASO 2: AGREGAR COLUMNA spouse_id (PAREJA)
-- ─────────────────────────────────────────────────────────────
-- Permite vincular dos usuarios como pareja.
-- El vínculo es bidireccional: si A.spouse_id = B.id,
-- entonces B.spouse_id debe ser A.id.
-- Se usará en Fase 3 para "Agendar con mi pareja".
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS spouse_id UUID REFERENCES users(id);

-- Índice para buscar parejas rápidamente
CREATE INDEX IF NOT EXISTS idx_users_spouse ON users(spouse_id) WHERE spouse_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- PASO 3: EXPANDIR day_of_week PARA INCLUIR DOMINGOS
-- ─────────────────────────────────────────────────────────────
-- Antes: CHECK (day_of_week BETWEEN 1 AND 6) → Lun-Sáb
-- Ahora: CHECK (day_of_week BETWEEN 0 AND 6) → Dom-Sáb
-- Donde 0 = Domingo
-- ─────────────────────────────────────────────────────────────

ALTER TABLE time_slots DROP CONSTRAINT IF EXISTS time_slots_day_of_week_check;
ALTER TABLE time_slots ADD CONSTRAINT time_slots_day_of_week_check
  CHECK (day_of_week BETWEEN 0 AND 6);


-- ─────────────────────────────────────────────────────────────
-- PASO 4: AGREGAR slot_position A RESERVACIONES
-- ─────────────────────────────────────────────────────────────
-- Cada celda de horario ahora acepta 2 personas:
--   slot_position = 1 → Primera persona
--   slot_position = 2 → Segunda persona (compañero)
--
-- Las reservaciones existentes se quedan en posición 1.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS slot_position INTEGER NOT NULL DEFAULT 1;

-- Restricción: solo posiciones 1 o 2
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_slot_position_check'
  ) THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_slot_position_check
      CHECK (slot_position IN (1, 2));
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- PASO 5: ACTUALIZAR ÍNDICES ÚNICOS DE RESERVACIONES
-- ─────────────────────────────────────────────────────────────
-- Antes: Solo 1 reserva activa por slot+semana
-- Ahora: Hasta 2 reservas activas por slot+semana (pos 1 y 2)
--
-- También agregamos un índice para evitar que el mismo usuario
-- reserve el mismo slot dos veces en la misma semana.
-- ─────────────────────────────────────────────────────────────

-- Eliminar restricciones e índices viejos
ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_time_slot_id_week_start_status_key;
DROP INDEX IF EXISTS idx_reservations_unique_active;

-- Nuevo: máximo 2 personas por slot activo por semana (posición 1 y 2)
CREATE UNIQUE INDEX idx_reservations_unique_active
  ON reservations (time_slot_id, week_start, slot_position)
  WHERE status IN ('confirmed', 'pending');

-- Nuevo: un usuario no puede reservar el mismo slot dos veces
CREATE UNIQUE INDEX idx_reservations_user_slot_week
  ON reservations (time_slot_id, week_start, user_id)
  WHERE status IN ('confirmed', 'pending');


-- ─────────────────────────────────────────────────────────────
-- PASO 6: CREAR TABLA app_config (CONFIGURACIÓN GLOBAL)
-- ─────────────────────────────────────────────────────────────
-- Tabla de un solo registro con la configuración del sistema.
-- El admin puede modificar estos valores desde su panel.
--
-- Campos:
--   counting_mode           → 'weekly' o 'monthly'
--                              Cómo se cuentan los turnos para límites
--   precursor_priority_hours → Horas de ventaja para precursores
--                              al abrir la agenda semanal
--   booking_opens_day       → Día que se abren las reservas (0=Dom)
--   booking_opens_time      → Hora que se abren para precursores
--   global_blocked_slots    → JSONB con bloqueos que aplican a
--                              TODOS los exhibidores simultáneamente
--   service_year_start_month → Mes de inicio del año de servicio (9=Sep)
--   max_per_slot            → Máximo de personas por celda (default 2)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_config (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  counting_mode             TEXT        NOT NULL DEFAULT 'weekly'
                                        CHECK (counting_mode IN ('weekly', 'monthly')),
  precursor_priority_hours  INTEGER     NOT NULL DEFAULT 2,
  booking_opens_day         INTEGER     NOT NULL DEFAULT 0
                                        CHECK (booking_opens_day BETWEEN 0 AND 6),
  booking_opens_time        TIME        NOT NULL DEFAULT '18:00:00',
  global_blocked_slots      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  service_year_start_month  INTEGER     NOT NULL DEFAULT 9
                                        CHECK (service_year_start_month BETWEEN 1 AND 12),
  max_per_slot              INTEGER     NOT NULL DEFAULT 2,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================
-- ✅ Migración V2 completada.
-- Ahora ejecuta 07_seed_domingos_y_config.sql
-- =============================================================
