/**
 * 44_familiares.sql — Vínculo familiar (además del cónyuge)
 * ─────────────────────────────────────────────────────────────
 * Permite que el admin vincule dos familiares (padre/hijo,
 * madre/hija u otra consanguinidad) para que puedan compartir
 * un turno aunque sean de distinto sexo.
 *
 * El cónyuge (spouse_id) no cambia. Este vínculo es aparte y
 * solo se asigna al editar un usuario en el panel de admin.
 *
 * IMPORTANTE: Ejecutar en el SQL Editor de Supabase DESPUÉS
 * de los scripts 01-43.
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. COLUMNAS EN users
-- =============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS family_relation text
    CHECK (family_relation IS NULL OR family_relation IN ('padre', 'madre', 'hijo', 'hija', 'otro'));

CREATE INDEX IF NOT EXISTS idx_users_family ON users(family_id) WHERE family_id IS NOT NULL;

COMMENT ON COLUMN users.family_id IS
  'UUID del familiar vinculado (padre, hijo, etc.). Bidireccional como spouse_id.';
COMMENT ON COLUMN users.family_relation IS
  'Parentesco visto desde este usuario: padre, madre, hijo, hija u otro.';

-- =============================================================
-- 2. VINCULAR FAMILIARES
-- =============================================================
-- p_relation es el parentesco de p_user_a respecto de p_user_b.
-- El inverso se calcula según el género de p_user_b.
CREATE OR REPLACE FUNCTION vincular_familiares(
  p_user_a uuid,
  p_user_b uuid,
  p_relation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gender_b text;
  v_inverse  text;
BEGIN
  IF p_user_a = p_user_b THEN
    RAISE EXCEPTION 'No se puede vincular un usuario consigo mismo';
  END IF;

  IF p_relation IS NULL OR p_relation NOT IN ('padre', 'madre', 'hijo', 'hija', 'otro') THEN
    RAISE EXCEPTION 'Relación familiar inválida';
  END IF;

  IF EXISTS (
    SELECT 1 FROM users
     WHERE id = p_user_a AND spouse_id = p_user_b
  ) THEN
    RAISE EXCEPTION 'No se puede vincular como familiar a quien ya es cónyuge';
  END IF;

  SELECT gender INTO v_gender_b FROM users WHERE id = p_user_b;

  v_inverse := CASE
    WHEN p_relation IN ('padre', 'madre') THEN
      CASE WHEN v_gender_b = 'F' THEN 'hija' ELSE 'hijo' END
    WHEN p_relation IN ('hijo', 'hija') THEN
      CASE WHEN v_gender_b = 'F' THEN 'madre' ELSE 'padre' END
    ELSE 'otro'
  END;

  UPDATE users SET family_id = NULL, family_relation = NULL
    WHERE family_id IN (p_user_a, p_user_b);
  UPDATE users SET family_id = NULL, family_relation = NULL
    WHERE id IN (p_user_a, p_user_b);

  UPDATE users SET family_id = p_user_b, family_relation = p_relation WHERE id = p_user_a;
  UPDATE users SET family_id = p_user_a, family_relation = v_inverse  WHERE id = p_user_b;
END;
$$;

-- =============================================================
-- 3. DESVINCULAR FAMILIARES
-- =============================================================
CREATE OR REPLACE FUNCTION desvincular_familiares(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id
    FROM users WHERE id = p_user_id;

  IF v_family_id IS NOT NULL THEN
    UPDATE users SET family_id = NULL, family_relation = NULL
      WHERE id IN (p_user_id, v_family_id);
  END IF;
END;
$$;

-- =============================================================
-- 4. PERMISOS DE LECTURA (anon no ve access_key; sí family_id)
-- =============================================================
GRANT SELECT (family_id, family_relation) ON TABLE public.users TO anon;
GRANT SELECT (family_id, family_relation) ON TABLE public.users TO authenticated;

-- =============================================================
-- Verificación
-- =============================================================
SELECT column_name
  FROM information_schema.columns
 WHERE table_name = 'users'
   AND column_name IN ('family_id', 'family_relation');

SELECT routine_name
  FROM information_schema.routines
 WHERE routine_schema = 'public'
   AND routine_name IN ('vincular_familiares', 'desvincular_familiares');
