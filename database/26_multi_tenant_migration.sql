-- ═══════════════════════════════════════════════════════════════════════════
-- Script 26: Migración Multi-Tenant (Opción E)
-- ═══════════════════════════════════════════════════════════════════════════
-- Añade soporte multi-congregación al sistema.
--
-- Cambios:
--   1. Crea tabla `congregations` (id, name, slug, is_active, created_at)
--   2. Inserta la "Congregación Principal" para los datos existentes
--   3. Añade columna `congregation_id` (UUID FK) a todas las tablas:
--      users, exhibitors, time_slots, reservations, invitations,
--      relief_requests, absences, app_config
--   4. Migra todos los registros existentes a la congregación por defecto
--   5. Pone NOT NULL en congregation_id en todas las tablas
--   6. Crea índices para rendimiento
--   7. Añade `is_super_admin` a users
--   8. Actualiza RLS para que cada usuario solo vea su congregación
--
-- INSTRUCCIONES:
--   Ejecutar UNA SOLA VEZ en Supabase SQL Editor.
--   Después ejecutar el script 27_rls_multi_tenant.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Tabla de congregaciones ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.congregations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,   -- identificador en la URL (/torres-rio/dashboard)
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS para congregations (la anon key puede leer slugs activos para validar en login)
ALTER TABLE public.congregations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "congregations_public_read"
  ON public.congregations FOR SELECT
  USING (is_active = true);

-- Solo service_role puede insertar/actualizar/borrar congregaciones
CREATE POLICY "congregations_service_write"
  ON public.congregations FOR ALL
  USING (false) WITH CHECK (false);


-- ─── 2. Migrar datos existentes en un bloque atómico ─────────────────────
DO $$
DECLARE
  cong_id   UUID;
  cfg_id    UUID;
BEGIN

  -- 2a. Crear la congregación por defecto para los datos existentes
  --     Si ya existe (re-run), obtener su ID sin fallar
  INSERT INTO public.congregations (name, slug, is_active)
  VALUES ('Congregación Principal', 'principal', true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO cong_id;

  -- Si ya existía (ON CONFLICT no retorna), buscarla manualmente
  IF cong_id IS NULL THEN
    SELECT id INTO cong_id FROM public.congregations WHERE slug = 'principal';
  END IF;

  RAISE NOTICE 'Congregación principal ID: %', cong_id;

  -- ── 3. Añadir congregation_id a cada tabla (nullable primero) ──────────

  -- users
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.users
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- exhibitors
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='exhibitors' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.exhibitors
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- time_slots
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='time_slots' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.time_slots
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- reservations
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='reservations' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.reservations
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- invitations
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='invitations' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.invitations
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- relief_requests
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='relief_requests' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.relief_requests
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- absences
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='absences' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.absences
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- app_config
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='app_config' AND column_name='congregation_id'
  ) THEN
    ALTER TABLE public.app_config
      ADD COLUMN congregation_id UUID REFERENCES public.congregations(id);
  END IF;

  -- ── 4. Migrar TODOS los registros existentes a la congregación por defecto
  UPDATE public.users            SET congregation_id = cong_id WHERE congregation_id IS NULL;
  UPDATE public.exhibitors       SET congregation_id = cong_id WHERE congregation_id IS NULL;
  UPDATE public.time_slots       SET congregation_id = cong_id WHERE congregation_id IS NULL;
  UPDATE public.reservations     SET congregation_id = cong_id WHERE congregation_id IS NULL;
  UPDATE public.invitations      SET congregation_id = cong_id WHERE congregation_id IS NULL;
  UPDATE public.relief_requests  SET congregation_id = cong_id WHERE congregation_id IS NULL;
  UPDATE public.absences         SET congregation_id = cong_id WHERE congregation_id IS NULL;
  UPDATE public.app_config       SET congregation_id = cong_id WHERE congregation_id IS NULL;

  -- Verificar que app_config tiene al menos una fila para la congregación
  IF NOT EXISTS (SELECT 1 FROM public.app_config WHERE congregation_id = cong_id) THEN
    INSERT INTO public.app_config (congregation_id)
    VALUES (cong_id);
  END IF;

  -- ── 5. Añadir NOT NULL ahora que todos los registros tienen valor ────────
  ALTER TABLE public.users           ALTER COLUMN congregation_id SET NOT NULL;
  ALTER TABLE public.exhibitors      ALTER COLUMN congregation_id SET NOT NULL;
  ALTER TABLE public.time_slots      ALTER COLUMN congregation_id SET NOT NULL;
  ALTER TABLE public.reservations    ALTER COLUMN congregation_id SET NOT NULL;
  ALTER TABLE public.invitations     ALTER COLUMN congregation_id SET NOT NULL;
  ALTER TABLE public.relief_requests ALTER COLUMN congregation_id SET NOT NULL;
  ALTER TABLE public.absences        ALTER COLUMN congregation_id SET NOT NULL;
  ALTER TABLE public.app_config      ALTER COLUMN congregation_id SET NOT NULL;

  RAISE NOTICE 'Migración de datos completada exitosamente.';
END $$;


-- ─── 6. Índices para rendimiento ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_congregation
  ON public.users(congregation_id);

CREATE INDEX IF NOT EXISTS idx_exhibitors_congregation
  ON public.exhibitors(congregation_id);

CREATE INDEX IF NOT EXISTS idx_time_slots_congregation
  ON public.time_slots(congregation_id);

CREATE INDEX IF NOT EXISTS idx_reservations_congregation
  ON public.reservations(congregation_id);

CREATE INDEX IF NOT EXISTS idx_invitations_congregation
  ON public.invitations(congregation_id);

CREATE INDEX IF NOT EXISTS idx_relief_requests_congregation
  ON public.relief_requests(congregation_id);

CREATE INDEX IF NOT EXISTS idx_absences_congregation
  ON public.absences(congregation_id);

CREATE INDEX IF NOT EXISTS idx_app_config_congregation
  ON public.app_config(congregation_id);


-- ─── 7. Añadir is_super_admin a users ────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;


-- ─── 8. Hacer slug único en congregations (ya es UNIQUE, solo refuerza) ──
-- Índice parcial para búsquedas de slug activo
CREATE INDEX IF NOT EXISTS idx_congregations_slug_active
  ON public.congregations(slug) WHERE is_active = true;


-- ─── Verificación final ───────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name, COUNT(*) as total
    FROM (
      SELECT 'users'           AS table_name, congregation_id FROM public.users
      UNION ALL
      SELECT 'exhibitors',       congregation_id FROM public.exhibitors
      UNION ALL
      SELECT 'time_slots',       congregation_id FROM public.time_slots
      UNION ALL
      SELECT 'reservations',     congregation_id FROM public.reservations
    ) t
    WHERE congregation_id IS NOT NULL
    GROUP BY table_name
  LOOP
    RAISE NOTICE 'Tabla % → % registros migrados', r.table_name, r.total;
  END LOOP;
  RAISE NOTICE '✅ Script 26 completado. Ejecuta ahora: 27_rls_multi_tenant.sql';
END $$;
