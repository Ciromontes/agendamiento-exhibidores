-- =============================================================
-- 23_rls_bloqueo_acceso_directo.sql
--
-- ESTRATEGIA: bloqueo quirúrgico (no rompe la app)
--
-- ⚠️  EJECUTAR SOLO DESPUÉS de que las API Routes estén
--    desplegadas en Vercel Y la variable SUPABASE_SERVICE_ROLE_KEY
--    esté configurada en Vercel. Si se ejecuta antes, el login
--    y el panel de admin dejarán de funcionar.
--
-- QUÉ HACE:
--   • Tabla "users"       → DENY ALL para anon (sin políticas)
--     El service_role_key (API Routes) bypasea el RLS siempre.
--     Soluciona Tests 1 (access_key expuesto), 2 (escalación),
--     4 parcial (usuarios), 7 (XSS en users).
--
--   • Tabla "reservations" → permite SELECT/INSERT/UPDATE para anon
--     pero BLOQUEA DELETE (sin política DELETE para anon).
--     Soluciona Test 4 (borrado masivo).
--     Las reservas del usuario siguen funcionando normalmente.
--
--   • Tabla "app_config"  → permite SELECT pero BLOQUEA UPDATE/INSERT/DELETE.
--     Soluciona Test 5 (modificación de config global).
--     La lectura de config en ExhibitorGrid sigue funcionando.
--
--   • Tablas admin (time_slots, invitations, etc.) → sin cambios por ahora.
--     Las funciones de admin del grid de horarios siguen funcionando.
--
--   • Columna "access_key" → revocada para anon como capa extra.
--
-- NOTA: el service_role_key (SUPABASE_SERVICE_ROLE_KEY) SIEMPRE bypasea
--       RLS, así que las API Routes del servidor tienen acceso completo.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- PASO 1: Limpiar políticas previas en las tablas afectadas
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'reservations', 'app_config')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
        RAISE NOTICE 'Política eliminada: % en %', pol.policyname, pol.tablename;
    END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- PASO 2: Tabla "users" — DENY ALL para anon
-- Ninguna política = RLS habilitado bloquea todo acceso anon.
-- El service_role (API Routes) bypasea y tiene acceso total.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- (Sin políticas para anon = DENY ALL implícito)

-- Capa extra: revocar SELECT sobre la columna access_key
REVOKE SELECT (access_key) ON public.users FROM anon;
REVOKE SELECT (access_key) ON public.users FROM authenticated;

-- ─────────────────────────────────────────────────────────────
-- PASO 3: Tabla "reservations" — permitir SELECT/INSERT/UPDATE,
--         bloquear DELETE (sin política DELETE para anon)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_reservations"
  ON public.reservations FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_reservations"
  ON public.reservations FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_reservations"
  ON public.reservations FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- (Sin política DELETE = anon no puede borrar reservas)

-- ─────────────────────────────────────────────────────────────
-- PASO 4: Tabla "app_config" — solo lectura para anon
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_app_config"
  ON public.app_config FOR SELECT TO anon USING (true);

-- (Sin política UPDATE/INSERT/DELETE = bloquea modificaciones)

-- ─────────────────────────────────────────────────────────────
-- Verificación — corre esto después de ejecutar el script:
-- ─────────────────────────────────────────────────────────────
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('users', 'reservations', 'app_config');
-- → Esperado: rowsecurity = true en los tres
--
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('users', 'reservations', 'app_config');
-- → Esperado: 0 políticas para users, 3 para reservations, 1 para app_config
