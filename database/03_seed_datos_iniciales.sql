-- =============================================================
-- 03_seed_datos_iniciales.sql
-- =============================================================
-- PROPÓSITO:
--   Insertar los datos iniciales necesarios para que la app
--   funcione: exhibidores, bloques horarios y usuarios de prueba.
--
-- PRERREQUISITO:
--   Haber ejecutado 02_crear_tablas.sql exitosamente.
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. Luego ejecutar 04_rls_y_realtime.sql
--
-- DATOS QUE SE CREAN:
--   - 3 exhibidores (Torres de San Juan, Verona-Capri, La Estación)
--   - 108 bloques horarios (36 por exhibidor: 6 bloques × 6 días)
--   - 1 usuario administrador (clave: admin2025)
--   - 3 usuarios de prueba (juan123, maria123, carlos123)
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- EXHIBIDORES
-- ─────────────────────────────────────────────────────────────
-- Los 3 puntos de exhibición de la congregación.
-- ON CONFLICT evita error si se ejecuta más de una vez.
-- ─────────────────────────────────────────────────────────────

INSERT INTO exhibitors (name) VALUES
  ('Torres de San Juan'),    -- Exhibidor principal
  ('Verona-Capri'),          -- Segundo exhibidor
  ('La Estación')            -- Tercer exhibidor
ON CONFLICT (name) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- BLOQUES HORARIOS (TIME SLOTS)
-- ─────────────────────────────────────────────────────────────
-- Se crean 36 slots por exhibidor:
--   6 bloques de 2 horas (06:00 a 18:00) × 6 días (Lun a Sáb)
--
-- Regla especial:
--   Sábado (day_of_week = 6) de 16:00 a 18:00
--   → is_active = false, block_reason = 'Reunión'
--   → Este slot NO se puede activar ni reservar (es la reunión)
--
-- Los demás slots se crean activos (is_active = true) para que
-- estén disponibles de inmediato. El admin puede desactivarlos
-- desde su panel cuando sea necesario.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  -- Variable para iterar sobre cada exhibidor
  ex RECORD;
  -- Variable para iterar sobre cada día (1=Lun a 6=Sáb)
  d INTEGER;
  -- Array con los 6 bloques horarios [inicio, fin]
  blocks TEXT[][] := ARRAY[
    ['06:00:00','08:00:00'],   -- Bloque 1: 6:00 AM - 8:00 AM
    ['08:00:00','10:00:00'],   -- Bloque 2: 8:00 AM - 10:00 AM
    ['10:00:00','12:00:00'],   -- Bloque 3: 10:00 AM - 12:00 PM
    ['12:00:00','14:00:00'],   -- Bloque 4: 12:00 PM - 2:00 PM
    ['14:00:00','16:00:00'],   -- Bloque 5: 2:00 PM - 4:00 PM
    ['16:00:00','18:00:00']    -- Bloque 6: 4:00 PM - 6:00 PM
  ];
  -- Variable para cada bloque en el loop
  b TEXT[];
  -- Flag para saber si el slot es la reunión del sábado
  is_blocked BOOLEAN;
BEGIN
  -- Iterar sobre cada exhibidor registrado
  FOR ex IN SELECT id FROM exhibitors LOOP
    -- Iterar sobre cada día de la semana (1=Lunes a 6=Sábado)
    FOR d IN 1..6 LOOP
      -- Iterar sobre cada bloque horario
      FOREACH b SLICE 1 IN ARRAY blocks LOOP
        -- ¿Es sábado (6) a las 16:00? → Reunión
        is_blocked := (d = 6 AND b[1] = '16:00:00');

        -- Insertar el slot horario
        INSERT INTO time_slots (
          exhibitor_id,
          day_of_week,
          start_time,
          end_time,
          is_active,
          block_reason
        ) VALUES (
          ex.id,                                              -- Exhibidor actual
          d,                                                  -- Día de la semana
          b[1]::TIME,                                         -- Hora de inicio
          b[2]::TIME,                                         -- Hora de fin
          NOT is_blocked,                                     -- Activo si NO es reunión
          CASE WHEN is_blocked THEN 'Reunión' ELSE NULL END  -- Motivo de bloqueo
        )
        -- Si ya existe ese slot, no hacer nada (idempotente)
        ON CONFLICT (exhibitor_id, day_of_week, start_time) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- USUARIO ADMINISTRADOR
-- ─────────────────────────────────────────────────────────────
-- Este es el usuario principal que gestiona horarios y usuarios.
-- Clave de acceso: admin2025
-- ─────────────────────────────────────────────────────────────

INSERT INTO users (name, access_key, user_type, is_admin, is_active) VALUES
  ('Administrador', 'admin2025', 'A', true, true)
ON CONFLICT (access_key) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- USUARIOS DE PRUEBA
-- ─────────────────────────────────────────────────────────────
-- Usuarios ficticios para probar el sistema antes de agregar
-- los publicadores reales.
--
-- Tipos:
--   'A' = puede reservar 1 turno por semana
--   'B' = puede reservar 2 turnos por semana
-- ─────────────────────────────────────────────────────────────

INSERT INTO users (name, access_key, user_type, gender, is_active) VALUES
  ('Juan Pérez',    'juan123',    'A', 'M', true),   -- Hermano, tipo A (1 turno)
  ('María López',   'maria123',   'B', 'F', true),   -- Hermana, tipo B (2 turnos)
  ('Carlos García', 'carlos123',  'A', 'M', true)    -- Hermano, tipo A (1 turno)
ON CONFLICT (access_key) DO NOTHING;


-- =============================================================
-- VERIFICACIÓN RÁPIDA
-- =============================================================
-- Ejecuta estas consultas para confirmar que todo se creó bien:
--
--   SELECT COUNT(*) FROM exhibitors;        -- Debe dar 3
--   SELECT COUNT(*) FROM time_slots;        -- Debe dar 108
--   SELECT COUNT(*) FROM users;             -- Debe dar 4
--   SELECT * FROM time_slots
--     WHERE block_reason IS NOT NULL;       -- Debe dar 3 (Reunión × 3 exhibidores)
--
-- =============================================================
-- ✅ Datos iniciales insertados.
-- Ahora ejecuta 04_rls_y_realtime.sql
-- =============================================================
