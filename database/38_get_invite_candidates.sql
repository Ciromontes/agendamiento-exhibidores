-- ═══════════════════════════════════════════════════════════════
-- 38 — get_invite_candidates
-- ═══════════════════════════════════════════════════════════════
-- Retorna candidatos válidos para invitar: usuarios activos de la
-- misma congregación y género. Usa SECURITY DEFINER para evitar
-- que las políticas RLS bloqueen la consulta filtrada por
-- congregation_id desde el cliente anon (browser).
--
-- Retorna: id, name, user_type
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_invite_candidates(
  p_congregation_id UUID,
  p_gender          TEXT
)
RETURNS TABLE (id UUID, name TEXT, user_type TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.name, u.user_type
  FROM users u
  WHERE u.congregation_id = p_congregation_id
    AND u.gender          = p_gender
    AND u.is_active       = true
  ORDER BY u.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_invite_candidates(UUID, TEXT) TO anon, authenticated;
