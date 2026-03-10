-- =============================================================
-- Script 34 — Columna `notes` en reservations (Paso 4.1)
-- =============================================================
-- Añade una columna de texto libre a reservations para etiquetar
-- filas con su origen (p. ej. 'SIMULACION-3M').
--
-- INSTRUCCIONES:
--   Ejecutar UNA SOLA VEZ en Supabase SQL Editor antes de correr
--   el script  load-tests/simulate-3-months.js
-- =============================================================

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Índice parcial para limpiar/filtrar simulaciones rápidamente.
-- Solo indexa filas que tienen notas (la mayoría de filas reales
-- tendrá notes = NULL y no ocupan espacio en el índice).
CREATE INDEX IF NOT EXISTS idx_reservations_notes
  ON public.reservations (notes)
  WHERE notes IS NOT NULL;

-- Verificación
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'reservations'
   AND column_name  = 'notes';
-- Debe devolver: notes | text
