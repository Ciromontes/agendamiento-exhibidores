/**
 * 14_genero_fase7.sql — Fase 7: Verificación y refuerzo de columna gender
 * ─────────────────────────────────────────────────────────────
 * Asegura que la columna gender existe en la tabla users con las
 * restricciones correctas. Si el admin ya asignó géneros a los 43
 * usuarios, este script es idempotente (no borra datos existentes).
 *
 * IMPORTANTE: Ejecutar DESPUÉS de los scripts 01-13.
 *
 * Columna en users:
 *   gender  — 'M' (Masculino) | 'F' (Femenino) | NULL (sin definir)
 *
 * Regla de negocio implementada en el frontend (Fase 7):
 *   - Un hombre solo puede compartir turno con otro hombre
 *   - Una mujer solo puede compartir turno con otra mujer
 *   - Excepción: cónyuge vinculado (spouse_id) siempre puede compartir
 *   - Si gender = NULL, se permite compartir con cualquiera (sin restricción)
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. AGREGAR COLUMNA gender SI NO EXISTE (seguro si ya existe)
-- =============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender text
    CHECK (gender IN ('M', 'F'));

-- =============================================================
-- 2. COMENTARIO EN LA COLUMNA (documentación en BD)
-- =============================================================
COMMENT ON COLUMN users.gender IS
  'Género del usuario: M = Masculino, F = Femenino, NULL = sin definir.
   Controla con quién puede compartir un turno en el exhibidor.';

-- =============================================================
-- Verificación: resumen de géneros asignados
-- =============================================================
SELECT
  COUNT(*) FILTER (WHERE gender = 'M' AND is_active = true)  AS masculinos_activos,
  COUNT(*) FILTER (WHERE gender = 'F' AND is_active = true)  AS femeninos_activos,
  COUNT(*) FILTER (WHERE gender IS NULL AND is_active = true) AS sin_genero_activos,
  COUNT(*) FILTER (WHERE is_active = true)                    AS total_activos
FROM users;
