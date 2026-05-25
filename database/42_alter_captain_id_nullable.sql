-- =============================================================
-- 42_alter_captain_id_nullable.sql
-- =============================================================
-- PROPÓSITO:
--   Modificar la columna captain_id de la tabla user_groups para que sea nullable.
--   Esto permite crear grupos sin especificar un capitán inicialmente.
--
-- PRERREQUISITO:
--   Haber ejecutado el script 40_grupos_capitanes.sql (que crea la tabla user_groups).
-- =============================================================

ALTER TABLE user_groups
  ALTER COLUMN captain_id DROP NOT NULL;