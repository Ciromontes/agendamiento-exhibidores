# Database - Scripts SQL para Supabase

## Orden de ejecución

Ejecutar en **Supabase Dashboard → SQL Editor**, uno por uno, en este orden:

### V1 — Esquema base
| # | Archivo | Qué hace |
|---|---------|----------|
| 1 | `01_drop_tablas_viejas.sql` | Borra tablas del esquema viejo |
| 2 | `02_crear_tablas.sql` | Crea las 5 tablas con esquema nuevo |
| 3 | `03_seed_datos_iniciales.sql` | Inserta exhibidores, 108 slots y 4 usuarios |
| 4 | `04_rls_y_realtime.sql` | Configura seguridad (RLS) y Realtime |
| 5 | `05_funciones.sql` | Crea funciones (reset semanal, stats) |

### V2 — Migración Fase 1 (ejecutar después de V1)
| # | Archivo | Qué hace |
|---|---------|----------|
| 6 | `06_migracion_v2_estructura.sql` | Migra user_type ('A'→publicador, 'B'→precursor_regular), agrega spouse_id, slot_position (2 personas/turno), crea tabla app_config |
| 7 | `07_seed_domingos_y_config.sql` | Inserta 18 slots de domingo (inactivos) y configuración global por defecto |
| 8 | `08_rls_v2.sql` | Policies RLS para app_config y operaciones CRUD de admin |
| 9 | `09_funciones_v2.sql` | Funciones actualizadas para conteo semanal/mensual y stats V2 |

## Credenciales de prueba

| Rol | Clave (`access_key`) | Tipo |
|-----|---------------------|------|
| Administrador | `admin2025` | Admin |
| Juan Pérez | `juan123` | Publicador (1 turno/semana) |
| María López | `maria123` | Precursor Regular (2 turnos/semana) |
| Carlos García | `carlos123` | Publicador (1 turno/semana) |

## Verificación V1

```sql
SELECT COUNT(*) FROM exhibitors;     -- Debe dar 3
SELECT COUNT(*) FROM time_slots;     -- Debe dar 108
SELECT COUNT(*) FROM users;          -- Debe dar 4
SELECT * FROM time_slots WHERE block_reason IS NOT NULL;  -- 3 filas (Reunión)
```

## Verificación V2

Después de ejecutar scripts 06-09:

```sql
-- Verificar tipos de usuario migrados
SELECT name, user_type FROM users;
-- Juan y Carlos = 'publicador', María = 'precursor_regular'

-- Verificar slots de domingo creados (18 = 6 bloques × 3 exhibidores)
SELECT COUNT(*) FROM time_slots WHERE day_of_week = 0;  -- Debe dar 18

-- Verificar que domingos están inactivos por defecto
SELECT COUNT(*) FROM time_slots WHERE day_of_week = 0 AND is_active = false;  -- 18

-- Verificar configuración global
SELECT counting_mode, max_per_slot FROM app_config;  -- weekly, 2

-- Verificar columna slot_position en reservations
SELECT column_name FROM information_schema.columns
WHERE table_name = 'reservations' AND column_name = 'slot_position';
```

## Nota

Esta carpeta está en `.gitignore` porque contiene estructura sensible de la base de datos.
