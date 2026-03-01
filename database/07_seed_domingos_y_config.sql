-- =============================================================
-- 07_seed_domingos_y_config.sql
-- =============================================================
-- PROPÓSITO:
--   1. Crear bloques horarios de DOMINGO para todos los exhibidores
--      (inactivos por defecto — el admin los activa cuando quiera)
--   2. Insertar el registro inicial de configuración (app_config)
--
-- PRERREQUISITO:
--   Haber ejecutado 06_migracion_v2_estructura.sql
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. Luego ejecutar 08_rls_v2.sql
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- BLOQUES DE DOMINGO (day_of_week = 0)
-- ─────────────────────────────────────────────────────────────
-- Se crean los mismos 6 bloques de 2 horas (6AM-6PM) para
-- cada exhibidor, pero todos INACTIVOS (is_active = false).
-- El admin decide cuáles activar desde su panel.
--
-- Si algún exhibidor ya tiene slots de domingo (por si se
-- ejecutó dos veces), ON CONFLICT los ignora.
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  ex RECORD;
  -- Los mismos 6 bloques estándar de 2 horas
  blocks TEXT[][] := ARRAY[
    ['06:00:00','08:00:00'],   -- Bloque 1: 6:00 AM - 8:00 AM
    ['08:00:00','10:00:00'],   -- Bloque 2: 8:00 AM - 10:00 AM
    ['10:00:00','12:00:00'],   -- Bloque 3: 10:00 AM - 12:00 PM
    ['12:00:00','14:00:00'],   -- Bloque 4: 12:00 PM - 2:00 PM
    ['14:00:00','16:00:00'],   -- Bloque 5: 2:00 PM - 4:00 PM
    ['16:00:00','18:00:00']    -- Bloque 6: 4:00 PM - 6:00 PM
  ];
  b TEXT[];
BEGIN
  -- Iterar sobre cada exhibidor activo
  FOR ex IN SELECT id FROM exhibitors LOOP
    -- Crear cada bloque horario para el domingo
    FOREACH b SLICE 1 IN ARRAY blocks LOOP
      INSERT INTO time_slots (
        exhibitor_id,
        day_of_week,
        start_time,
        end_time,
        is_active,
        block_reason
      ) VALUES (
        ex.id,            -- Exhibidor actual
        0,                -- 0 = Domingo
        b[1]::TIME,       -- Hora de inicio
        b[2]::TIME,       -- Hora de fin
        false,            -- INACTIVO por defecto
        NULL              -- Sin razón de bloqueo
      )
      -- Si ya existe, no hacer nada (idempotente)
      ON CONFLICT (exhibitor_id, day_of_week, start_time) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- CONFIGURACIÓN INICIAL (app_config)
-- ─────────────────────────────────────────────────────────────
-- Un solo registro con los valores por defecto.
-- El admin puede cambiar estos valores desde su panel.
--
-- Valores iniciales:
--   - Modo de conteo: semanal (publicadores=1/sem, precursores=2/sem)
--   - Prioridad precursores: 2 horas de ventaja
--   - Apertura de reservas: Domingos a las 6:00 PM
--   - Bloqueos globales: Reunión sábado 4-6 PM
--   - Año de servicio: empieza en Septiembre
--   - Máximo por slot: 2 personas
-- ─────────────────────────────────────────────────────────────

-- Solo insertar si la tabla está vacía (evitar duplicados)
INSERT INTO app_config (
  counting_mode,
  precursor_priority_hours,
  booking_opens_day,
  booking_opens_time,
  global_blocked_slots,
  service_year_start_month,
  max_per_slot
)
SELECT
  'weekly',            -- Conteo semanal por defecto
  2,                   -- 2 horas de ventaja para precursores
  0,                   -- Domingos
  '18:00:00'::TIME,    -- 6:00 PM
  '[{"day_of_week": 6, "start_time": "16:00:00", "reason": "Reunión"}]'::jsonb,
  9,                   -- Septiembre
  2                    -- 2 personas por celda
WHERE NOT EXISTS (SELECT 1 FROM app_config);


-- ─────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────
-- Ejecuta estas consultas para confirmar:
--
--   SELECT COUNT(*) FROM time_slots WHERE day_of_week = 0;
--   -- Debe dar 18 (6 bloques × 3 exhibidores)
--
--   SELECT * FROM app_config;
--   -- Debe dar 1 registro con los valores por defecto
--
--   SELECT DISTINCT user_type FROM users;
--   -- Debe mostrar 'publicador' (y 'precursor_regular' si había tipo B)
-- ─────────────────────────────────────────────────────────────

-- =============================================================
-- ✅ Domingos y configuración creados.
-- Ahora ejecuta 08_rls_v2.sql
-- =============================================================
