/**
 * 13_prioridad_fase6.sql — Fase 6: Sistema de Prioridad de Agendamiento
 * ─────────────────────────────────────────────────────────────
 * Agrega las columnas necesarias a app_config para controlar
 * cuándo puede reservar cada tipo de usuario cada semana.
 *
 * IMPORTANTE: Ejecutar en el SQL Editor de Supabase DESPUÉS
 * de haber ejecutado los scripts 01-12.
 *
 * Columnas agregadas a app_config:
 *   priority_enabled       — Activa/desactiva el sistema de prioridad
 *   priority_mode          — 'none' | 'precursor_first' | 'tiered'
 *   priority_hours_auxiliar  — Horas de espera para Auxiliar (modo tiered)
 *   priority_hours_publicador — Horas de espera para Publicador
 *
 * Modos:
 *   'none'           → Todos reservan a la misma hora (sin prioridad)
 *   'precursor_first'→ Regular + Auxiliar abren a la hora X,
 *                      Publicador abre X + priority_hours_publicador horas después
 *   'tiered'         → Regular abre a la hora X,
 *                      Auxiliar abre X + priority_hours_auxiliar horas después,
 *                      Publicador abre X + priority_hours_publicador horas después
 *
 * Nota: booking_opens_day y booking_opens_time ya existen desde
 *       el script 07 y se reutilizan como "hora de apertura base".
 * ─────────────────────────────────────────────────────────────
 */

-- =============================================================
-- 1. AGREGAR COLUMNAS DE PRIORIDAD A app_config
-- =============================================================

-- Activar/desactivar el sistema completo de prioridad
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS priority_enabled boolean DEFAULT false;

-- Modo de prioridad: sin prioridad, precursores juntos, o escalonado
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS priority_mode text DEFAULT 'none'
    CHECK (priority_mode IN ('none', 'precursor_first', 'tiered'));

-- Horas de espera para Precursor Auxiliar (solo en modo 'tiered')
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS priority_hours_auxiliar integer DEFAULT 1;

-- Horas de espera para Publicador (aplica en ambos modos 'precursor_first' y 'tiered')
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS priority_hours_publicador integer DEFAULT 2;

-- =============================================================
-- 2. ASEGURAR VALORES DEFAULT EN LA FILA EXISTENTE
-- =============================================================
UPDATE app_config
  SET
    priority_enabled          = COALESCE(priority_enabled, false),
    priority_mode             = COALESCE(priority_mode, 'none'),
    priority_hours_auxiliar   = COALESCE(priority_hours_auxiliar, 1),
    priority_hours_publicador = COALESCE(priority_hours_publicador, 2)
  WHERE priority_enabled IS NULL
     OR priority_mode IS NULL;

-- =============================================================
-- Verificación: confirmar columnas creadas
-- =============================================================
SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_name = 'app_config'
    AND column_name IN (
      'priority_enabled', 'priority_mode',
      'priority_hours_auxiliar', 'priority_hours_publicador',
      'booking_opens_day', 'booking_opens_time'
    )
  ORDER BY column_name;
