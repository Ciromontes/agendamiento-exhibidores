-- =============================================================
-- 02_crear_tablas.sql
-- =============================================================
-- PROPÓSITO:
--   Crear todas las tablas necesarias para la aplicación de
--   agendamiento de exhibidores. Este esquema es el DEFINITIVO
--   y coincide exactamente con los tipos definidos en:
--     src/types/index.ts
--
-- ESQUEMA DE RELACIONES:
--   users (1) ──< reservations >── (1) time_slots
--   users (1) ──< invitations  >── (1) reservations
--   exhibitors (1) ──< time_slots
--
-- INSTRUCCIONES:
--   1. Asegúrate de haber ejecutado 01_drop_tablas_viejas.sql
--   2. Pegar este script en Supabase SQL Editor
--   3. Hacer clic en "Run"
--   4. Luego ejecutar 03_seed_datos_iniciales.sql
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- Extensión para generar UUIDs automáticos
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =============================================================
-- TABLA: users
-- =============================================================
-- Almacena los publicadores/usuarios del sistema.
-- Cada usuario tiene una clave de acceso única (access_key)
-- que usa para iniciar sesión (no usamos Supabase Auth).
--
-- Campos clave:
--   access_key  → Clave personal para login (única, tipo password)
--   user_type   → 'A' = máximo 1 turno/semana, 'B' = máximo 2
--   is_admin    → true = puede gestionar horarios y usuarios
--   is_active   → false = usuario deshabilitado, no puede entrar
-- =============================================================
CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT        NOT NULL,                              -- Nombre completo del publicador
  access_key      TEXT        NOT NULL UNIQUE,                       -- Clave de acceso para login
  user_type       TEXT        NOT NULL DEFAULT 'A'                   -- 'A'=1 turno/semana, 'B'=2 turnos
                              CHECK (user_type IN ('A', 'B')),
  gender          TEXT        CHECK (gender IN ('M', 'F')),          -- 'M'=Masculino, 'F'=Femenino (opcional)
  marital_status  TEXT,                                              -- Estado civil (opcional, para futuro)
  is_active       BOOLEAN     NOT NULL DEFAULT true,                 -- Si el usuario puede acceder al sistema
  is_admin        BOOLEAN     NOT NULL DEFAULT false,                -- Si tiene permisos de administrador
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()                 -- Fecha de creación automática
);

-- Índice para búsqueda rápida por clave de acceso (login)
CREATE INDEX idx_users_access_key ON users(access_key);


-- =============================================================
-- TABLA: exhibitors
-- =============================================================
-- Los 3 puntos de exhibición donde se colocan los publicadores.
-- Cada exhibidor tiene su propia grilla de horarios.
--
-- Exhibidores iniciales:
--   - Torres de San Juan
--   - Verona-Capri
--   - La Estación
-- =============================================================
CREATE TABLE exhibitors (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL UNIQUE,                           -- Nombre del exhibidor (único)
  is_active   BOOLEAN     NOT NULL DEFAULT true,                     -- Si está habilitado para reservas
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()                     -- Fecha de creación automática
);


-- =============================================================
-- TABLA: time_slots
-- =============================================================
-- Bloques horarios de 2 horas para cada exhibidor y cada día.
-- Hay 6 bloques por día (06:00-18:00) × 6 días (Lun-Sáb)
-- = 36 slots por exhibidor = 108 slots en total.
--
-- El admin puede activar/desactivar cada slot desde su panel.
-- Los slots con block_reason (ej: 'Reunión') no se pueden
-- modificar ni reservar — siempre aparecen bloqueados.
--
-- Campos clave:
--   day_of_week  → 1=Lunes, 2=Martes, ..., 6=Sábado
--   start_time   → Hora de inicio (formato TIME, ej: '06:00:00')
--   end_time     → Hora de fin (formato TIME, ej: '08:00:00')
--   is_active    → true = disponible para reservas
--   block_reason → Si tiene valor, el slot está bloqueado
--                   permanentemente (ej: 'Reunión' los Sáb 4-6 PM)
-- =============================================================
CREATE TABLE time_slots (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  exhibitor_id  UUID        NOT NULL                                 -- A qué exhibidor pertenece
                            REFERENCES exhibitors(id) ON DELETE CASCADE,
  day_of_week   INTEGER     NOT NULL                                 -- 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb
                            CHECK (day_of_week BETWEEN 1 AND 6),
  start_time    TIME        NOT NULL,                                -- Hora de inicio del bloque
  end_time      TIME        NOT NULL,                                -- Hora de fin del bloque
  is_active     BOOLEAN     NOT NULL DEFAULT true,                   -- ¿Está disponible para reservar?
  block_reason  TEXT,                                                -- Razón de bloqueo (NULL=normal, 'Reunión'=bloqueado)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),                  -- Fecha de creación automática

  -- Restricción: no puede haber dos slots iguales para el mismo exhibidor+día+hora
  UNIQUE (exhibitor_id, day_of_week, start_time)
);

-- Índice para consultas rápidas por exhibidor
CREATE INDEX idx_time_slots_exhibitor ON time_slots(exhibitor_id);


-- =============================================================
-- TABLA: reservations
-- =============================================================
-- Cada reserva vincula un usuario con un slot horario para una
-- semana específica (identificada por week_start = lunes).
--
-- Estados posibles:
--   'confirmed' → Reserva activa y confirmada
--   'pending'   → Esperando confirmación (para invitaciones)
--   'cancelled' → Reserva cancelada por el usuario
--
-- El índice parcial idx_reservations_unique_active evita que
-- dos personas reserven el mismo slot en la misma semana.
-- =============================================================
CREATE TABLE reservations (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  time_slot_id  UUID        NOT NULL                                 -- Bloque horario reservado
                            REFERENCES time_slots(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL                                 -- Quién hizo la reserva
                            REFERENCES users(id) ON DELETE CASCADE,
  week_start    DATE        NOT NULL,                                -- Lunes de la semana (identifica la semana)
  status        TEXT        NOT NULL DEFAULT 'confirmed'             -- Estado de la reserva
                            CHECK (status IN ('confirmed', 'pending', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),                  -- Cuándo se creó la reserva

  -- Restricción básica: un slot solo aparece una vez por semana+estado
  UNIQUE (time_slot_id, week_start, status)
);

-- Índice ÚNICO parcial: evita doble reserva en slots activos
-- Solo aplica para reservas que NO están canceladas
CREATE UNIQUE INDEX idx_reservations_unique_active
  ON reservations (time_slot_id, week_start)
  WHERE status IN ('confirmed', 'pending');

-- Índices para consultas frecuentes
CREATE INDEX idx_reservations_week ON reservations(week_start);      -- Filtrar por semana
CREATE INDEX idx_reservations_user ON reservations(user_id);         -- Reservas de un usuario
CREATE INDEX idx_reservations_slot ON reservations(time_slot_id);    -- Reservas de un slot


-- =============================================================
-- TABLA: invitations (Fase 2 - Sistema de invitaciones)
-- =============================================================
-- Permite que un usuario invite a otro a compartir su turno.
-- La invitación expira después de 24 horas si no es aceptada.
--
-- Estados posibles:
--   'pending'  → Enviada, esperando respuesta
--   'accepted' → El invitado aceptó
--   'declined' → El invitado rechazó
--   'expired'  → Pasaron 24h sin respuesta
-- =============================================================
CREATE TABLE invitations (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id  UUID        NOT NULL                               -- Reserva asociada
                              REFERENCES reservations(id) ON DELETE CASCADE,
  inviter_id      UUID        NOT NULL                               -- Quién invita
                              REFERENCES users(id) ON DELETE CASCADE,
  invitee_id      UUID        NOT NULL                               -- A quién se invita
                              REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending'             -- Estado de la invitación
                              CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at      TIMESTAMPTZ NOT NULL,                              -- Cuándo expira (24h después de crear)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()                 -- Fecha de creación automática
);

-- =============================================================
-- ✅ Tablas creadas exitosamente.
-- Ahora ejecuta 03_seed_datos_iniciales.sql
-- =============================================================
