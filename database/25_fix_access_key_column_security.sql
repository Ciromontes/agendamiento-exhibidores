-- ─────────────────────────────────────────────────────────────
-- 25_fix_access_key_column_security.sql
-- ─────────────────────────────────────────────────────────────
-- Problema detectado en auditoría (Test 1):
--   REVOKE SELECT (access_key) ON users FROM anon
--   no funciona cuando el rol ya tiene GRANT SELECT de TABLA completa
--   (el GRANT de tabla-entera overridea el REVOKE de columna).
--
-- Solución correcta:
--   1) Revocar el SELECT de tabla completa para anon/authenticated
--   2) Re-otorgar SELECT columna por columna (sin access_key)
--
-- Resultado: anon jamás puede leer access_key desde el browser.
-- La autenticación sigue siendo solo por /api/auth/login (server-side).
-- ─────────────────────────────────────────────────────────────

-- Paso 1: Revocar SELECT de tabla entera
REVOKE SELECT ON TABLE public.users FROM anon;
REVOKE SELECT ON TABLE public.users FROM authenticated;

-- Paso 2: Otorgar columnas públicas (access_key excluida)
GRANT SELECT (
  id,
  name,
  user_type,
  gender,
  marital_status,
  phone,
  is_active,
  is_admin,
  spouse_id,
  created_at
) ON TABLE public.users TO anon;

GRANT SELECT (
  id,
  name,
  user_type,
  gender,
  marital_status,
  phone,
  is_active,
  is_admin,
  spouse_id,
  created_at
) ON TABLE public.users TO authenticated;

-- Verificación: esta query debe dar error 403/42501 si ejecutas
-- SELECT access_key FROM users con el anon key desde el browser.
-- SELECT id, name, access_key FROM public.users LIMIT 1;  -- debe fallar col access_key
