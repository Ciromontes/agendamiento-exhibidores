-- =============================================================
-- 19_reset_demo.sql — Función de reinicio para demo
-- =============================================================
-- PROPÓSITO:
--   Crear la función RPC `reset_app_data` que borra únicamente
--   los datos transaccionales de la aplicación (reservas,
--   relevos, invitaciones y ausencias), dejando intacta toda
--   la estructura:
--
--   ✅ SE CONSERVA (estructura + configuración):
--       users         → publicadores y administradores
--       exhibitors    → puntos de exhibición
--       time_slots    → bloques horarios configurados
--       app_config    → configuración global
--
--   🗑️  SE BORRA (datos de operación):
--       reservations    → todas las reservas
--       invitations     → todas las invitaciones
--       relief_requests → todas las solicitudes de relevo
--       absences        → todos los registros de ausencia
--
-- SEGURIDAD:
--   - La función se ejecuta como SECURITY DEFINER (privilegios
--     del creador, no del invocador).
--   - Requiere pasar `p_admin_id` (UUID del usuario admin).
--   - La función verifica internamente que el usuario exista
--     y tenga is_admin = true antes de borrar nada.
--   - Si la verificación falla, devuelve error sin borrar.
--
-- INSTRUCCIONES:
--   1. Ir al SQL Editor de Supabase.
--   2. Pegar y ejecutar este script completo (Run).
--   3. La función queda disponible como llamada RPC:
--         supabase.rpc('reset_app_data', { p_admin_id: '...' })
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- Eliminar versión anterior si existe
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS reset_app_data(UUID);


-- ─────────────────────────────────────────────────────────────
-- Función: reset_app_data
-- ─────────────────────────────────────────────────────────────
-- Parámetro: p_admin_id — UUID del administrador que ejecuta el reset
-- Retorna:   JSON { success: bool, message: text, deleted: { ... } }
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reset_app_data(p_admin_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER           -- Corre con los privilegios del creador
SET search_path = public   -- Evitar ataques de path injection
AS $$
DECLARE
  v_is_admin    BOOLEAN;
  v_name        TEXT;
  v_res_count   INTEGER;
  v_inv_count   INTEGER;
  v_rel_count   INTEGER;
  v_abs_count   INTEGER;
BEGIN

  -- ── 1. Verificar que el usuario existe y es administrador ──
  SELECT is_admin, name
    INTO v_is_admin, v_name
    FROM users
   WHERE id = p_admin_id;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Usuario no encontrado.'
    );
  END IF;

  IF NOT v_is_admin THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Acceso denegado: el usuario no es administrador.'
    );
  END IF;

  -- ── 2. Contar registros antes de borrar (para el resumen) ──
  SELECT COUNT(*) INTO v_res_count FROM reservations;
  SELECT COUNT(*) INTO v_inv_count FROM invitations;
  SELECT COUNT(*) INTO v_rel_count FROM relief_requests;
  SELECT COUNT(*) INTO v_abs_count FROM absences;

  -- ── 3. Borrar en orden correcto (respetar FK) ──────────────
  --   relief_requests referencia reservations → borrar primero
  DELETE FROM relief_requests;
  DELETE FROM absences;
  DELETE FROM invitations;
  DELETE FROM reservations;

  -- ── 4. Retornar resumen del reset ─────────────────────────
  RETURN json_build_object(
    'success', true,
    'message', format(
      'Reset completado por %s. Datos operativos eliminados.',
      v_name
    ),
    'deleted', json_build_object(
      'reservations',    v_res_count,
      'invitations',     v_inv_count,
      'relief_requests', v_rel_count,
      'absences',        v_abs_count
    )
  );

END;
$$;


-- ─────────────────────────────────────────────────────────────
-- Permisos: permitir llamar la función desde el cliente anon
-- (la función hace su propia verificación de admin interna)
-- ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION reset_app_data(UUID) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- Verificar creación
-- ─────────────────────────────────────────────────────────────
-- SELECT reset_app_data('00000000-0000-0000-0000-000000000000');
-- → debería retornar { success: false, message: 'Usuario no encontrado.' }
