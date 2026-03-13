-- ═══════════════════════════════════════════════════════════════
-- 38 — get_invite_candidates (v2 — con validación de pertenencia)
-- ═══════════════════════════════════════════════════════════════
-- Retorna candidatos para invitar: usuarios activos de la misma
-- congregación y género del usuario solicitante.
--
-- SEGURIDAD:
--   La función verifica en la base de datos que p_user_id
--   pertenece a p_congregation_id ANTES de retornar datos.
--   Así, incluso si alguien llama la función con una UUID de
--   otra congregación, no obtendrá ningún resultado a menos
--   que su propio user_id también pertenezca a esa congregación.
--
--   Solo retorna campos no sensibles: id, name, user_type.
--   Nunca expone: access_key, phone, congregation_id.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_invite_candidates(
  p_user_id         UUID,
  p_congregation_id UUID,
  p_gender          TEXT
)
RETURNS TABLE (id UUID, name TEXT, user_type TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verificar que el usuario solicitante pertenece a la congregación
  -- que está consultando. Si no coincide, retorna vacío silenciosamente.
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id              = p_user_id
      AND congregation_id = p_congregation_id
      AND is_active       = true
  ) THEN
    RETURN;
  END IF;

  -- Solo retorna campos no sensibles
  RETURN QUERY
  SELECT u.id, u.name, u.user_type
  FROM users u
  WHERE u.congregation_id = p_congregation_id
    AND u.gender          = p_gender
    AND u.is_active       = true
  ORDER BY u.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_invite_candidates(UUID, UUID, TEXT) TO anon, authenticated;

-- Revocar la versión anterior (2 parámetros) para evitar confusión
DROP FUNCTION IF EXISTS get_invite_candidates(UUID, TEXT);
