-- ─────────────────────────────────────────────────────────────
-- MIGRACIÓN 35 — last_week_compensation en app_config
-- ─────────────────────────────────────────────────────────────
-- Agrega la columna que habilita la compensación de última semana.
--
-- Cuando counting_mode = 'weekly' y last_week_compensation = TRUE:
--   En la última semana del mes (la semana cuyo lunes siguiente cae
--   en otro mes), los usuarios pueden agendar hasta su cuota mensual
--   completa en lugar del límite semanal normal. Esto les permite
--   compensar los turnos que no pudieron tomar durante el mes.
--
-- Ejmplo (Precursor Regular, 2/sem → 8/mes):
--   Sem 1: agendó 1  (1 sin usar)
--   Sem 2: agendó 0  (2 sin usar)
--   Sem 3: agendó 2  (0 sin usar)
--   Sem 4 (última): puede agendar hasta 8 - 3 = 5 veces
-- ─────────────────────────────────────────────────────────────

ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS last_week_compensation BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN app_config.last_week_compensation IS
  'Si TRUE y counting_mode=''weekly'': en la última semana del mes el usuario puede reservar hasta su cuota mensual (compensando semanas no usadas).';
