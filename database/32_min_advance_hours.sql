-- Script 32: Agregar columna min_advance_hours a app_config
-- Ejecutar en Supabase SQL Editor
-- Define cuántas horas de anticipación mínima se requieren para reservar.
-- El valor por defecto es 12 (horas). Rango recomendado: 0–48.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS min_advance_hours INT DEFAULT 12;
