-- =============================================================
-- 40_grupos_capitanes.sql
-- =============================================================
-- PROPÓSITO:
--   Agregar soporte para grupos de publicadores con capitanes.
--   Permite el ranking mensual por grupo y exportación de reportes
--   segmentados.
--
--   Un grupo tiene un capitán (usuario existente) y múltiples
--   miembros. Un usuario puede pertenecer a un solo grupo.
--
--   Esta estructura es compatible con import/export vía Excel
--   (Iteración 5) usando un formato plano por fila.
--
-- PRERREQUISITO:
--   Haber ejecutado todos los scripts anteriores (01-39).
--   La tabla users debe existir con datos.
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. Luego ejecutar 41_rls_grupos.sql
-- =============================================================


-- =============================================================
-- TABLA: user_groups
-- =============================================================
-- Representa un grupo de publicadores liderado por un capitán.
-- El capitán es un usuario que pertenece al mismo grupo.
-- =============================================================
CREATE TABLE user_groups (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT        NOT NULL,                              -- Nombre del grupo (ej: "Grupo Torres")
  captain_id      UUID                                    -- Usuario capitán del grupo (opcional)
                              REFERENCES users(id) ON DELETE RESTRICT,
  congregation_id UUID        NOT NULL                               -- Congregación a la que pertenece
                              REFERENCES congregations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- El nombre del grupo debe ser único dentro de la congregación
  UNIQUE (name, congregation_id)
);

-- Índice para búsqueda rápida por congregación
CREATE INDEX idx_user_groups_congregation ON user_groups(congregation_id);


-- =============================================================
-- COLUMNA: users.group_id
-- =============================================================
-- Relaciona cada usuario con un grupo (opcional).
-- Un usuario solo puede estar en un grupo a la vez.
-- =============================================================
ALTER TABLE users
  ADD COLUMN group_id UUID
  REFERENCES user_groups(id) ON DELETE SET NULL;

-- Índice para consultas de miembros por grupo
CREATE INDEX idx_users_group ON users(group_id);


-- =============================================================
-- RESTRICCIÓN: El capitán debe pertenecer al mismo grupo
-- =============================================================
-- Esto se valida en la aplicación (no con CHECK constraint
-- porque requeriría subqueries que PostgreSQL no permite en CHECK).
-- La validación se hará en el endpoint de creación/edición de grupos.
-- =============================================================

-- =============================================================
-- RESUMEN
-- =============================================================
--
-- Tablas nuevas:
--   user_groups  → Grupos con capitán y congregación
--
-- Columnas nuevas:
--   users.group_id → FK nullable a user_groups
--
-- Formato Excel para import/export (Iteración 5):
--   Columnas: grupo | nombre_usuario | es_capitan
--   Ejemplo:
--     Grupo A | Juan Perez    | SI
--     Grupo A | Maria Gomez   | NO
--     Grupo B | Carlos Ruiz   | SI
--     Grupo B | Ana Lopez     | NO
--
-- =============================================================
-- ✅ Grupos y capitanes configurados.
-- Ahora ejecuta 41_rls_grupos.sql
-- =============================================================
