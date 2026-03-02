-- =============================================================
-- 24_rls_users_select_publico.sql
-- 
-- PARCHE: permite SELECT público de usuarios (solo columnas seguras).
--
-- Problema: al habilitar RLS en users sin política SELECT, los JOINs
-- implícitos que hacen ExhibitorGrid, InvitationBadge, etc. fallan:
--   from('reservations').select('*, user:users(id, name, gender)')
--
-- Solución: agregar política SELECT para anon, manteniendo la protección
-- de access_key mediante REVOKE a nivel de columna (ya aplicado en 23_rls).
--
-- El anon key puede ver id, name, gender de usuarios — igual que en el
-- grid de reservas donde todos ven quién tiene cada turno.
-- El access_key permanece protegido por REVOKE SELECT (access_key).
-- =============================================================

-- Permite SELECT de filas de usuarios para anon.
-- La columna access_key está protegida vía REVOKE (script anterior).
-- Columnas visibles: id, name, gender, user_type, is_active, spouse_id, etc.
-- Columna oculta: access_key (REVOKE ya aplicado)
CREATE POLICY "anon_select_users_publico"
  ON public.users FOR SELECT TO anon USING (true);

-- Verificación:
-- SELECT tablename, policyname, roles, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'users';
-- → Debe mostrar 1 fila: anon_select_users_publico, SELECT
