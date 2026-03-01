-- =============================================================
-- 01_drop_tablas_viejas.sql
-- =============================================================
-- PROPÓSITO:
--   Eliminar las tablas creadas previamente con el esquema viejo.
--   Las tablas viejas usan nombres de columnas y tipos diferentes
--   (ej: users.type en vez de user_type, time_slots.day TEXT en
--   vez de day_of_week INTEGER, etc.) y son INCOMPATIBLES con
--   el código actual de la aplicación.
--
-- INSTRUCCIONES:
--   1. Ir a Supabase Dashboard → SQL Editor
--   2. Pegar este script completo
--   3. Hacer clic en "Run"
--   4. Verificar que no haya errores
--   5. Luego ejecutar 02_crear_tablas.sql
--
-- NOTA: DROP CASCADE elimina también las foreign keys y datos.
--   Si tienes datos que quieras conservar, haz backup antes.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- Primero eliminamos las tablas en orden inverso de dependencias
-- (las que tienen FK se borran primero)
-- ─────────────────────────────────────────────────────────────

-- Eliminar tabla de invitaciones (depende de reservations y users)
DROP TABLE IF EXISTS invitations CASCADE;

-- Eliminar tabla de reservaciones (depende de time_slots y users)
DROP TABLE IF EXISTS reservations CASCADE;

-- Eliminar tabla de bloques horarios (depende de exhibitors)
DROP TABLE IF EXISTS time_slots CASCADE;

-- Eliminar tabla de exhibidores
DROP TABLE IF EXISTS exhibitors CASCADE;

-- Eliminar tabla de usuarios
DROP TABLE IF EXISTS users CASCADE;

-- ─────────────────────────────────────────────────────────────
-- También eliminamos el archivo SQL viejo de la raíz si existe
-- como publicación de realtime (por si se configuró antes)
-- ─────────────────────────────────────────────────────────────

-- Quitar tablas de la publicación Realtime (si estaban agregadas)
-- Esto no da error si no existían
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS reservations;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS invitations;

-- =============================================================
-- ✅ Listo. Ahora ejecuta 02_crear_tablas.sql
-- =============================================================
