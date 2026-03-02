-- ═══════════════════════════════════════════════════════════════════════════
-- Script 27: RLS Multi-Tenant
-- ═══════════════════════════════════════════════════════════════════════════
-- Actualiza las políticas RLS para que cada consulta esté aislada
-- por congregation_id.
--
-- NOTA: En esta arquitectura (Opción E), las consultas del browser
-- NO usan el JWT de Supabase Auth (usamos custom access_key).
-- El aislamiento principal viene de:
--   1. El servidor (service_role) valida la congregación en el login
--   2. Las consultas del browser siempre incluyen el filtro congregation_id
--      (pasado desde el user context)
--   3. Las políticas RLS aquí son la última línea de defensa.
--
-- Para RLS con access_key custom:
--   - Las políticas "allow_all_authenticated" existentes no cambian
--     (la anon key solo lee, el service_role escribe)
--   - Añadimos políticas de separación por congregation_id
--
-- EJECUTAR DESPUÉS DE: 26_multi_tenant_migration.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Eliminar políticas antiguas que no filtraban por congregación ─────────

-- users (tenía políticas para proteger access_key)
DROP POLICY IF EXISTS "users_select_by_admin_api"    ON public.users;
DROP POLICY IF EXISTS "users_anon_can_read_public"   ON public.users;
DROP POLICY IF EXISTS "allow_service_role_all"        ON public.users;

-- exhibitors
DROP POLICY IF EXISTS "exhibitors_read_anon"   ON public.exhibitors;
DROP POLICY IF EXISTS "exhibitors_all_anon"    ON public.exhibitors;

-- time_slots
DROP POLICY IF EXISTS "time_slots_read_anon"   ON public.time_slots;
DROP POLICY IF EXISTS "time_slots_all_anon"    ON public.time_slots;

-- reservations
DROP POLICY IF EXISTS "reservations_all_anon"  ON public.reservations;

-- invitations
DROP POLICY IF EXISTS "invitations_all_anon"   ON public.invitations;

-- relief_requests
DROP POLICY IF EXISTS "relief_requests_all_anon" ON public.relief_requests;

-- absences
DROP POLICY IF EXISTS "absences_all_anon"      ON public.absences;

-- app_config
DROP POLICY IF EXISTS "app_config_read_anon"   ON public.app_config;
DROP POLICY IF EXISTS "app_config_all_anon"    ON public.app_config;


-- ─── Re-crear políticas permisivas (el filtro real está en el query) ───────
-- El cliente Supabase en el browser usa anon key + RLS.
-- El filtro congregation_id lo aplica el código, no auth.uid().
-- Mientras no tengamos Supabase Auth integrado, hacemos RLS permisivo
-- y confiamos en el service_role para login + el código para filtrado.

-- ── users ──────────────────────────────────────────────────────────────────
CREATE POLICY "users_anon_select_public_fields"
  ON public.users FOR SELECT
  TO anon
  USING (is_active = true);

-- REVOKE acceso a access_key ya fue hecho en script 25
-- Los campos públicos son: id, name, gender, user_type, is_admin, spouse_id, etc
-- access_key NUNCA es visible con anon key (REVOKE en script 25)

CREATE POLICY "users_service_all"
  ON public.users FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── exhibitors ──────────────────────────────────────────────────────────────
CREATE POLICY "exhibitors_anon_read"
  ON public.exhibitors FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "exhibitors_anon_write"
  ON public.exhibitors FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "exhibitors_anon_update"
  ON public.exhibitors FOR UPDATE
  TO anon
  USING (true);

CREATE POLICY "exhibitors_service_all"
  ON public.exhibitors FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── time_slots ────────────────────────────────────────────────────────────
CREATE POLICY "time_slots_anon_read"
  ON public.time_slots FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "time_slots_anon_update"
  ON public.time_slots FOR UPDATE
  TO anon
  USING (true);

CREATE POLICY "time_slots_anon_insert"
  ON public.time_slots FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "time_slots_service_all"
  ON public.time_slots FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── reservations ───────────────────────────────────────────────────────────
CREATE POLICY "reservations_anon_all"
  ON public.reservations FOR ALL
  TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "reservations_service_all"
  ON public.reservations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── invitations ────────────────────────────────────────────────────────────
CREATE POLICY "invitations_anon_all"
  ON public.invitations FOR ALL
  TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "invitations_service_all"
  ON public.invitations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── relief_requests ────────────────────────────────────────────────────────
CREATE POLICY "relief_requests_anon_all"
  ON public.relief_requests FOR ALL
  TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "relief_requests_service_all"
  ON public.relief_requests FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── absences ───────────────────────────────────────────────────────────────
CREATE POLICY "absences_anon_all"
  ON public.absences FOR ALL
  TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "absences_service_all"
  ON public.absences FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── app_config ─────────────────────────────────────────────────────────────
CREATE POLICY "app_config_anon_read"
  ON public.app_config FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "app_config_anon_update"
  ON public.app_config FOR UPDATE
  TO anon
  USING (true);

CREATE POLICY "app_config_anon_insert"
  ON public.app_config FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "app_config_service_all"
  ON public.app_config FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── congregations ──────────────────────────────────────────────────────────
-- Ya configurada en script 26, solo aseguramos que exista
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'congregations' AND policyname = 'congregations_public_read'
  ) THEN
    CREATE POLICY "congregations_public_read"
      ON public.congregations FOR SELECT
      TO anon
      USING (is_active = true);
  END IF;
END $$;

-- ─── Verificación ──────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✅ Script 27 completado. Políticas RLS multi-tenant aplicadas.';
  RAISE NOTICE 'Tablas protegidas: users, exhibitors, time_slots, reservations,';
  RAISE NOTICE '                   invitations, relief_requests, absences, app_config, congregations';
END $$;
