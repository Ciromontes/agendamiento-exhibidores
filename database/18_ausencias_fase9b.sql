/**
 * 18_ausencias_fase9b.sql — Fase 9B: Sistema de Ausencias
 * ─────────────────────────────────────────────────────────────
 * Crea la tabla `absences` para que los usuarios puedan marcar
 * que no estarán disponibles una semana determinada.
 *
 * Integración con Fase 9A (relevos):
 *   Al marcar ausencia, el cliente itera sobre todas las
 *   reservas activas del usuario esa semana y crea una
 *   solicitud de relevo abierto para cada una.
 *
 * IMPORTANTE: Ejecutar DESPUÉS del script 17.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. TABLA absences
-- =============================================================
CREATE TABLE IF NOT EXISTS absences (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Quién estará ausente
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Qué semana (lunes de la semana, mismo formato que week_start)
  week_start  DATE          NOT NULL,

  -- Motivo opcional (ej: "Viaje", "Enfermedad")
  reason      TEXT,

  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Un usuario solo puede estar ausente una vez por semana
  UNIQUE (user_id, week_start)
);

-- Índice para consultas frecuentes por semana (reporte admin)
CREATE INDEX IF NOT EXISTS idx_absences_week
  ON absences (week_start);

-- Índice para consultas del usuario
CREATE INDEX IF NOT EXISTS idx_absences_user
  ON absences (user_id, week_start);

-- =============================================================
-- 2. RLS
-- =============================================================
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_absences" ON absences;
CREATE POLICY "anon_all_absences" ON absences
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================
-- 3. HABILITAR REALTIME  
-- =============================================================
-- Permite que el panel admin actualice la lista de ausentes
-- al instante cuando alguien marca/quita su ausencia.
ALTER PUBLICATION supabase_realtime ADD TABLE absences;

-- =============================================================
-- Verificación
-- =============================================================
SELECT 'absences' AS tabla,
       COUNT(*)   AS columnas
  FROM information_schema.columns
  WHERE table_name = 'absences' AND table_schema = 'public';
