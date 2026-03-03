-- ═══════════════════════════════════════════════════════════════
-- DIAGNÓSTICO: Verificar aislamiento multi-tenant
-- ═══════════════════════════════════════════════════════════════
-- Ejecutar en el SQL Editor de Supabase para verificar que
-- los datos de cada congregación están correctamente aislados.
-- ═══════════════════════════════════════════════════════════════

-- 1. Listar todas las congregaciones
SELECT id, name, slug FROM congregations ORDER BY name;

-- 2. Verificar admins por congregación
SELECT
  u.name,
  u.is_admin,
  u.access_key,
  u.congregation_id,
  c.name AS congregation_name,
  c.slug
FROM users u
JOIN congregations c ON c.id = u.congregation_id
WHERE u.is_admin = true
ORDER BY c.name, u.name;

-- 3. Conteo de usuarios por congregación
SELECT
  c.name AS congregation,
  c.slug,
  COUNT(u.id) AS total_users,
  COUNT(CASE WHEN u.is_admin THEN 1 END) AS admins
FROM congregations c
LEFT JOIN users u ON u.congregation_id = c.id
GROUP BY c.id, c.name, c.slug
ORDER BY c.name;

-- 4. Verificar que app_config tiene una fila por congregación
SELECT
  ac.id,
  ac.congregation_id,
  c.name AS congregation,
  ac.counting_mode,
  ac.priority_mode
FROM app_config ac
JOIN congregations c ON c.id = ac.congregation_id
ORDER BY c.name;

-- 5. Verificar exhibitores por congregación
SELECT
  c.name AS congregation,
  COUNT(e.id) AS exhibitors
FROM congregations c
LEFT JOIN exhibitors e ON e.congregation_id = c.id
GROUP BY c.id, c.name
ORDER BY c.name;
