-- ═══════════════════════════════════════════════════════════════════════════
-- Script 30: Arreglar unicidad de nombre de exhibidor por congregación
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA:
--   La tabla `exhibitors` fue creada con UNIQUE(name) global.
--   Dos congregaciones distintas no pueden tener un exhibidor con
--   el mismo nombre (ej: "Plaza Central" en Terranova y en Milán).
--
-- SOLUCIÓN:
--   1. Eliminar el constraint único global sobre `name`.
--   2. Crear un índice único PARCIAL sobre (name, congregation_id)
--      que excluye los registros eliminados (deleted_at IS NOT NULL).
--
--   Resultado:
--   ✅ Mismo nombre en distintas congregaciones  → permitido
--   ❌ Mismo nombre activo en la misma congreg. → rechazado
--   ✅ Nombre reutilizado tras soft-delete       → permitido
--
-- INSTRUCCIONES:
--   Ejecutar UNA SOLA VEZ en Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Asegurar que deleted_at existe (por si no se ejecutó antes) ───────
ALTER TABLE public.exhibitors
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- ─── 2. Eliminar el constraint único global de nombre ─────────────────────
--   Postgres nombra el constraint inline "exhibitors_name_key"
ALTER TABLE public.exhibitors
  DROP CONSTRAINT IF EXISTS exhibitors_name_key;

-- ─── 3. Nuevo índice único PARCIAL: nombre único dentro de la congregación --
--   Solo aplica a los exhibidores NO eliminados (deleted_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS exhibitors_name_congregation_unique
  ON public.exhibitors (name, congregation_id)
  WHERE deleted_at IS NULL;

-- ─── Verificación ─────────────────────────────────────────────────────────
-- Ejecuta esto para confirmar que el índice se creó:
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'exhibitors';
--
-- Deberías ver "exhibitors_name_congregation_unique" con la cláusula WHERE.
