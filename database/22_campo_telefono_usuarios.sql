/**
 * 22_campo_telefono_usuarios.sql
 * ─────────────────────────────────────────────────────────────
 * Agrega el campo `phone` a la tabla `users` para almacenar el
 * número de WhatsApp de cada publicador.
 *
 * Formato esperado: número con código de país sin símbolos.
 *   Ejemplos: "573001234567" (Colombia), "12025551234" (EE.UU.)
 *   El prefijo internacional va incluido en el campo.
 *
 * EJECUTAR en Supabase SQL Editor.
 * ─────────────────────────────────────────────────────────────
 */

-- Agregar columna de teléfono (idempotente: no falla si ya existe)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone text DEFAULT NULL;

-- Comentario descriptivo en la columna
COMMENT ON COLUMN users.phone IS
  'Número de WhatsApp con código de país, sin espacios ni símbolos. Ej: 573001234567';

-- Verificar que se agregó
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'users'
    AND column_name  = 'phone';
