-- =============================================================
-- 04_rls_y_realtime.sql
-- =============================================================
-- PROPÓSITO:
--   Configurar Row Level Security (RLS) y Realtime en Supabase.
--
--   RLS controla quién puede leer/escribir en cada tabla.
--   Como esta app usa autenticación propia (access_key, no
--   Supabase Auth), las políticas son permisivas — cualquier
--   request con la anon key puede operar.
--
--   En producción, se podría migrar a Supabase Auth y hacer
--   políticas más restrictivas basadas en auth.uid().
--
-- PRERREQUISITO:
--   Haber ejecutado 03_seed_datos_iniciales.sql
--
-- INSTRUCCIONES:
--   1. Pegar este script en Supabase SQL Editor
--   2. Hacer clic en "Run"
--   3. Luego ejecutar 05_funciones.sql
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- PASO 1: HABILITAR RLS EN TODAS LAS TABLAS
-- ─────────────────────────────────────────────────────────────
-- Por defecto, con RLS habilitado y SIN políticas, nadie puede
-- acceder a la tabla. Por eso debemos crear políticas después.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE exhibitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- PASO 2: POLÍTICAS DE LECTURA (SELECT)
-- ─────────────────────────────────────────────────────────────
-- Todas las tablas son legibles por cualquiera.
-- Necesario para:
--   - users: mostrar nombres en reservas
--   - exhibitors: listar exhibidores en el dashboard
--   - time_slots: mostrar la grilla de horarios
--   - reservations: ver quién tiene qué turno
--   - invitations: ver invitaciones pendientes
-- ─────────────────────────────────────────────────────────────

-- Usuarios: cualquiera puede ver la lista (para nombres en reservas)
CREATE POLICY "users_select_todos"
  ON users FOR SELECT
  USING (true);

-- Exhibidores: cualquiera puede ver la lista
CREATE POLICY "exhibitors_select_todos"
  ON exhibitors FOR SELECT
  USING (true);

-- Bloques horarios: cualquiera puede ver los horarios
CREATE POLICY "time_slots_select_todos"
  ON time_slots FOR SELECT
  USING (true);

-- Reservas: cualquiera puede ver las reservas (para el calendario)
CREATE POLICY "reservations_select_todos"
  ON reservations FOR SELECT
  USING (true);

-- Invitaciones: cualquiera puede ver invitaciones
CREATE POLICY "invitations_select_todos"
  ON invitations FOR SELECT
  USING (true);


-- ─────────────────────────────────────────────────────────────
-- PASO 3: POLÍTICAS DE ESCRITURA - TIME_SLOTS
-- ─────────────────────────────────────────────────────────────
-- El admin necesita poder activar/desactivar bloques horarios
-- desde su panel de administración (AdminScheduleGrid.tsx).
-- ─────────────────────────────────────────────────────────────

-- Permitir actualizar bloques horarios (admin activa/desactiva slots)
CREATE POLICY "time_slots_update_todos"
  ON time_slots FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────
-- PASO 4: POLÍTICAS DE ESCRITURA - RESERVATIONS
-- ─────────────────────────────────────────────────────────────
-- Los usuarios necesitan poder:
--   - Crear reservas (INSERT) → al hacer clic en "Disponible"
--   - Cancelar reservas (UPDATE status='cancelled')
-- ─────────────────────────────────────────────────────────────

-- Cualquier usuario puede crear una reserva
CREATE POLICY "reservations_insert_todos"
  ON reservations FOR INSERT
  WITH CHECK (true);

-- Cualquier usuario puede actualizar reservas (para cancelar)
CREATE POLICY "reservations_update_todos"
  ON reservations FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────
-- PASO 5: POLÍTICAS DE ESCRITURA - INVITATIONS (Fase 2)
-- ─────────────────────────────────────────────────────────────
-- Para el sistema de invitaciones futuro.
-- ─────────────────────────────────────────────────────────────

-- Cualquiera puede crear invitaciones
CREATE POLICY "invitations_insert_todos"
  ON invitations FOR INSERT
  WITH CHECK (true);

-- Cualquiera puede actualizar invitaciones (aceptar/rechazar)
CREATE POLICY "invitations_update_todos"
  ON invitations FOR UPDATE
  USING (true)
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────
-- PASO 6: CONFIGURAR REALTIME
-- ─────────────────────────────────────────────────────────────
-- Supabase Realtime permite que el frontend reciba actualizaciones
-- en vivo cuando otro usuario hace una reserva o la cancela.
--
-- Esto se usa en ExhibitorGrid.tsx con:
--   supabase.channel('reservations-realtime')
--     .on('postgres_changes', { event: '*', schema: 'public',
--          table: 'reservations' }, () => loadData())
--
-- Solo habilitamos realtime en las tablas que necesitan
-- actualizaciones en vivo.
-- ─────────────────────────────────────────────────────────────

-- Reservas en tiempo real (para que todos vean cuando alguien reserva)
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;

-- Invitaciones en tiempo real (para notificar invitaciones - Fase 2)
ALTER PUBLICATION supabase_realtime ADD TABLE invitations;


-- =============================================================
-- RESUMEN DE POLÍTICAS CREADAS
-- =============================================================
--
-- ┌─────────────────┬─────────┬────────┬────────┬────────┐
-- │ Tabla           │ SELECT  │ INSERT │ UPDATE │ DELETE │
-- ├─────────────────┼─────────┼────────┼────────┼────────┤
-- │ users           │   ✓     │   ✗    │   ✗    │   ✗    │
-- │ exhibitors      │   ✓     │   ✗    │   ✗    │   ✗    │
-- │ time_slots      │   ✓     │   ✗    │   ✓    │   ✗    │
-- │ reservations    │   ✓     │   ✓    │   ✓    │   ✗    │
-- │ invitations     │   ✓     │   ✓    │   ✓    │   ✗    │
-- └─────────────────┴─────────┴────────┴────────┴────────┘
--
-- NOTA: Nadie puede DELETE directamente. Las reservas se
-- "cancelan" actualizando status='cancelled', y los datos
-- viejos se limpian con la función de reset semanal.
--
-- =============================================================
-- ✅ RLS y Realtime configurados.
-- Ahora ejecuta 05_funciones.sql
-- =============================================================
