-- ═══════════════════════════════════════════════════════════════════════════
-- Script 28: Crear Admin para nueva congregación (Ejemplo Milán)
-- ═══════════════════════════════════════════════════════════════════════════
-- Este script muestra cómo buscar el ID de una congregación recién creada
-- y asignarle su primer usuario administrador.
--
-- PASOS AUTOMATIZADOS EN ESTE SCRIPT:
-- 1. Busca la congregación por su slug ('milan').
-- 2. Inserta el usuario administrador y lo asocia a esa congregación.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_cong_id UUID;
BEGIN
  -- 1. Buscar el UUID de la congregación 'milan'
  SELECT id INTO v_cong_id FROM public.congregations WHERE slug = 'milan';

  IF v_cong_id IS NULL THEN
    RAISE EXCEPTION 'La congregación con slug ''milan'' no existe. Créala primero desde el Super Admin.';
  END IF;

  -- 2. Asegurarse que no exista ya la clave para evitar errores unique_violation
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE access_key = 'MILAN-ADMIN-2026') THEN

    -- 3. Insertar el primer administrador para Milán
    INSERT INTO public.users (
      name, 
      user_type, 
      is_admin, 
      is_active, 
      access_key, 
      congregation_id
    ) VALUES (
      'Administrador Milán', -- Nombre visible
      'publicador',          -- Tipo (publicador, precursor_regular, etc)
      true,                  -- Es admin
      true,                  -- Está activo
      'MILAN-ADMIN-2026',    -- Clave de acceso (¡cámbiala en producción!)
      v_cong_id              -- El ID de la congregación obtenida
    );

    RAISE NOTICE '✅ Administrador creado exitosamente para Milán.';
  ELSE
    RAISE NOTICE '⚠️ Ya existe un usuario con esa access_key.';
  END IF;
END $$;