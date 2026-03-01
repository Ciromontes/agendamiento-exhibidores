/**
 * 10_parejas_v3.sql — Fase 3: Sistema de Parejas
 * ─────────────────────────────────────────────────────────────
 * Funciones SQL para vincular/desvincular cónyuges de forma
 * atómica (ambos usuarios se actualizan en la misma transacción).
 *
 * IMPORTANTE: Ejecutar en el SQL Editor de Supabase DESPUÉS
 * de haber ejecutado los scripts 01-09.
 *
 * Funciones incluidas:
 *   1. vincular_conyuges(user_a, user_b) — vincula una pareja
 *   2. desvincular_conyuges(user_id)     — desvincula una pareja
 *
 * Notas:
 *   - Ambas funciones usan SECURITY DEFINER para poder
 *     modificar users sin importar RLS del caller.
 *   - Solo deben ser llamadas desde el panel de admin.
 *   - Si un usuario ya tenía cónyuge previo, se desvincula
 *     automáticamente antes de crear la nueva vinculación.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. VINCULAR CÓNYUGES
-- =============================================================
-- Recibe los UUIDs de dos usuarios y los vincula mutuamente.
-- Si alguno tenía un cónyuge previo, se desvincula primero.
-- Todo dentro de una sola transacción (atómico).
CREATE OR REPLACE FUNCTION vincular_conyuges(p_user_a uuid, p_user_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Validar: no se puede vincular a uno mismo
  IF p_user_a = p_user_b THEN
    RAISE EXCEPTION 'No se puede vincular un usuario consigo mismo';
  END IF;

  -- Limpiar vínculos previos de ambos usuarios.
  -- Si user_a tenía un cónyuge anterior, ese cónyuge queda libre.
  -- Lo mismo para user_b.
  UPDATE users SET spouse_id = NULL
    WHERE spouse_id IN (p_user_a, p_user_b);
  UPDATE users SET spouse_id = NULL
    WHERE id IN (p_user_a, p_user_b);

  -- Crear el vínculo bidireccional
  UPDATE users SET spouse_id = p_user_b WHERE id = p_user_a;
  UPDATE users SET spouse_id = p_user_a WHERE id = p_user_b;
END;
$$;

-- =============================================================
-- 2. DESVINCULAR CÓNYUGES
-- =============================================================
-- Recibe el UUID de un usuario y desvincula a ambos cónyuges.
-- Si el usuario no tiene cónyuge, no hace nada.
CREATE OR REPLACE FUNCTION desvincular_conyuges(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_spouse_id uuid;
BEGIN
  -- Buscar el cónyuge actual
  SELECT spouse_id INTO v_spouse_id
    FROM users WHERE id = p_user_id;

  -- Si tiene cónyuge, limpiar ambos
  IF v_spouse_id IS NOT NULL THEN
    UPDATE users SET spouse_id = NULL
      WHERE id IN (p_user_id, v_spouse_id);
  END IF;
END;
$$;

-- =============================================================
-- Verificación: listar funciones creadas
-- =============================================================
SELECT routine_name, routine_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN ('vincular_conyuges', 'desvincular_conyuges');
