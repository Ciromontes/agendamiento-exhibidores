-- =============================================================
-- 08_rls_v2.sql
-- =============================================================
-- PROPÓSITO:
--   Agregar políticas RLS para la nueva tabla app_config
--   y permitir al admin hacer CRUD completo de usuarios.
--
-- PRERREQUISITO:
--   Haber ejecutado 07_seed_domingos_y_config.sql
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. Luego ejecutar 09_funciones_v2.sql
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- PASO 1: RLS PARA app_config
-- ─────────────────────────────────────────────────────────────
-- Cualquiera puede leer la configuración (la app la necesita
-- para mostrar límites, prioridades, etc.)
-- Cualquiera puede actualizar (el admin lo hace desde el frontend).
-- En producción, se restringiría al admin con Supabase Auth.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Lectura: todos pueden leer la config
CREATE POLICY "app_config_select_todos"
  ON app_config FOR SELECT
  USING (true);

-- Actualización: permitida (el admin actualiza desde su panel)
CREATE POLICY "app_config_update_todos"
  ON app_config FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────
-- PASO 2: POLÍTICAS ADICIONALES PARA users (CRUD del Admin)
-- ─────────────────────────────────────────────────────────────
-- El admin necesita poder:
--   - Crear nuevos usuarios (INSERT)
--   - Actualizar datos de usuarios (UPDATE) — ya existía
--   - Eliminar usuarios (DELETE)
--
-- NOTA: En producción con Supabase Auth, estas políticas
-- verificarían que el usuario tenga is_admin = true.
-- ─────────────────────────────────────────────────────────────

-- Insertar usuarios (el admin crea nuevos publicadores/precursores)
CREATE POLICY "users_insert_todos"
  ON users FOR INSERT
  WITH CHECK (true);

-- Actualizar usuarios (cambiar tipo, nombre, contraseña, etc.)
CREATE POLICY "users_update_todos"
  ON users FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Eliminar usuarios (el admin puede desactivar o eliminar)
CREATE POLICY "users_delete_todos"
  ON users FOR DELETE
  USING (true);


-- ─────────────────────────────────────────────────────────────
-- PASO 3: POLÍTICA DELETE PARA RESERVACIONES
-- ─────────────────────────────────────────────────────────────
-- Necesaria para que el admin pueda limpiar reservaciones
-- si fuera necesario (por ejemplo al eliminar un usuario).
-- ─────────────────────────────────────────────────────────────

CREATE POLICY "reservations_delete_todos"
  ON reservations FOR DELETE
  USING (true);


-- ─────────────────────────────────────────────────────────────
-- PASO 4: POLÍTICAS PARA time_slots (INSERT/DELETE)
-- ─────────────────────────────────────────────────────────────
-- El admin necesita poder crear nuevos bloques horarios
-- (horas impares, bloques personalizados) y eliminar los
-- que ya no se necesiten.
-- ─────────────────────────────────────────────────────────────

-- Insertar nuevos bloques horarios
CREATE POLICY "time_slots_insert_todos"
  ON time_slots FOR INSERT
  WITH CHECK (true);

-- Eliminar bloques horarios
CREATE POLICY "time_slots_delete_todos"
  ON time_slots FOR DELETE
  USING (true);


-- =============================================================
-- ✅ Políticas RLS V2 creadas.
-- Ahora ejecuta 09_funciones_v2.sql
-- =============================================================
