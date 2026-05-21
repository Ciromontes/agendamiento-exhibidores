# PROJECT CONTEXT — Exhibidores Agendamiento

## Objetivo del proyecto
App de reserva de turnos para exhibidores (puntos de predicación pública). Permite a publicadores de una congregación reservar turnos en puntos de exhibición de forma organizada, con control de límites por tipo de usuario y gestión administrativa vía importación de Excel.

## Stack tecnológico
- **Frontend:** Next.js 16 / React 19 / TypeScript 5
- **Backend:** Supabase (PostgreSQL con RLS, Realtime, funciones RPC)
- **Estilos:** Tailwind CSS 4
- **Librerías clave:**
  - `@supabase/supabase-js` + `@supabase/ssr` — Cliente y manejo de sesión
  - `date-fns` — Manipulación de fechas
  - `xlsx` — Lectura/importación de archivos Excel
  - `html2canvas` + `jspdf` — Exportación a PDF
  - `react-hot-toast` — Notificaciones toast
- **Seguridad:** Content Security Policy estricta, headers HTTP hardening (HSTS, X-Frame-Options, X-Content-Type-Options)
- **Arquitectura:** Multi-tenant (multi-congregación) con slugs en URL (`/[slug]/dashboard`)

## Estructura de base de datos
- **congregations:** Congregaciones (tenant). Slug único para URLs
- **users:** Publicadores y administradores con roles (`publicador`, `precursor_regular`, `precursor_auxiliar`), género, cónyuge, teléfono, congregación
- **exhibitors:** Puntos de exhibición (ej: "Torres de San Juan")
- **time_slots:** Horarios por exhibidor, día y rango horario (2h). Configurable con estado `enabled`/`disabled`
- **reservations:** Usuarios vinculados a slots (máx 2 personas por slot). Estados: `confirmed`, `cancelled`
- **invitations:** Sistema de invitaciones entre usuarios para cubrir turnos
- **reliefs:** Sistema de relevos entre parejas
- **absences:** Registro de ausencias programadas
- **app_config:** Configuración global por congregación (mínimo de horas de anticipación, semana activa, etc.)

## Decisiones de arquitectura tomadas
- El Excel es la fuente de verdad para configuración de slots
- Los slots se crean automáticamente si no existen en BD
- Solo se rechaza si hay cruces horarios reales
- `hasTimeConflict()` detecta conflictos convirtiendo rangos a minutos desde medianoche
- Autenticación propia vía `access_key` (no Supabase Auth), con RLS permisivo en BD
- Realtime habilitado en `reservations` e `invitations` para actualizaciones en vivo
- Las reservas nunca se eliminan (DELETE), solo se cancelan (UPDATE `status='cancelled'`)
- Límites de turnos: publicador 1/semana, precursor regular 2/semana, precursor auxiliar 6/mes

## Estado actual del proyecto
- **Iteración 1 COMPLETADA:** Análisis de conflictos documentado
- **Iteración 2 COMPLETADA:** Backend con creación automática de slots. Endpoint `POST /api/admin/reservations/excel` crea slots automáticamente si no existen (usando `hasTimeConflict()`), reporta `slotActions` con CREADO/EXISTENTE/ERROR. Lógica compartida en `src/lib/slots/excel-import.ts`.
- **Iteración 3 COMPLETADA:** UI Preview. Endpoint `POST /api/admin/reservations/excel/preview` analiza el Excel sin aplicar cambios. `AdminExcelPanel` ahora tiene flujo: seleccionar archivo → ver preview (slots a crear/actualizar, errores, asignaciones) → confirmar o cancelar.
- **Iteración 4 COMPLETADA:** Sincronización visual del Grid. `AdminScheduleGrid` ahora se suscribe a Realtime (`time_slots` + `reservations`) y escucha el evento `reservations-imported` para refrescar automáticamente tras una importación confirmada.

## Problema que estamos resolviendo
~~El Excel no genera slots cuando ya hay reservas. El Excel debe determinar si un slot está disponible, no la BD.~~ **RESUELTO.**

## Tarea actual
Iteraciones 2, 3 y 4 completadas. El sistema de importación Excel ahora: (1) crea slots automáticamente si no existen, (2) muestra vista previa de cambios antes de confirmar, y (3) refresca la grilla automáticamente vía Realtime + eventos.

## Próximos pasos
1. Pruebas del flujo completo de importación con preview
2. Posiblemente: mejorar el reporte visual post-importación en el frontend

## Reglas importantes
- Máximo 2 personas por slot
- No cancelar reservas existentes al modificar slots
- Reportar acciones: CREADO / ACTUALIZADO / ERROR con razón