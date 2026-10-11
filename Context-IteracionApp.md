# Context-IteracionApp.md — Guía rápida para cualquier IA (o persona) sin contexto

> **Propósito:** Que quien abra este código por primera vez entienda de inmediato qué es la app,
> cómo está organizada, cómo funciona cada flujo clave y dónde están los puntos delicados,
> sin tener que hacer las mismas preguntas y búsquedas que ya se hicieron antes.

---

## 1. ¿Qué es esta app?

App de **reserva de turnos para exhibidores** (puntos de predicación pública) de los Testigos de Jehová.
Los publicadores de una congregación reservan turnos de 2 horas en puntos de exhibición,
con límites por tipo de usuario, invitaciones entre compañeros, relevos, ausencias y gestión administrativa.

- **Multi-tenant:** cada congregación es un "tenant" separado, identificado por `congregation_id` y un `slug` en la URL (`/[slug]/dashboard`).
- **Idioma:** toda la UI y los mensajes están en **español**.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 16 (App Router) / React 19 / TypeScript 5 |
| Backend | Supabase (PostgreSQL + RLS + Realtime + funciones RPC) |
| Estilos | Tailwind CSS 4 |
| Paquetería | **pnpm** (no npm/yarn) |
| Librerías clave | `@supabase/supabase-js`, `@supabase/ssr`, `date-fns`, `xlsx`, `html2canvas` + `jspdf`, `react-hot-toast` |

**Comandos útiles:**
```bash
pnpm dev          # servidor de desarrollo (localhost:3000)
pnpm build        # build de producción
pnpm lint         # eslint
npx tsc --noEmit  # typecheck rápido (no hay script dedicado)
```

---

## 3. Estructura de carpetas (lo importante)

```
src/
├── app/
│   ├── page.tsx                  # Landing / login
│   ├── [slug]/                   # Dashboard por congregación (URL dinámica)
│   ├── admin/                    # Panel de administración
│   ├── super-admin/              # Super admin global (todas las congregaciones)
│   └── api/                      # API Routes (backend serverless)
│       ├── admin/
│       │   ├── week/reset/       # Acciones rápidas de semana (avanzar/reiniciar/retroceder)
│       │   ├── users/            # CRUD de usuarios + envío de claves
│       │   ├── reservations/     # Reservas + importación Excel
│       │   ├── groups/           # Grupos y capitanes
│       │   └── reports/          # Ranking mensual
│       ├── invite-candidates/    # Candidatos para invitar a un turno
│       ├── auth/login/           # Login por access_key
│       └── users/[id]/           # Datos de usuario
├── components/                   # Componentes React (ver sección 5)
├── context/UserContext.tsx       # Contexto global del usuario logueado
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Cliente browser (anon key)
│   │   ├── server.ts             # Cliente server (cookies)
│   │   ├── service.ts            # Cliente con service_role (SOLO en API Routes)
│   │   └── admin-auth.ts         # verifyAdmin(): valida header x-access-key
│   ├── slots/excel-import.ts     # Lógica compartida de importación Excel
│   └── rate-limit.ts             # Rate limiting
└── types/index.ts                # TODOS los tipos + constantes + helpers de formato
```

---

## 4. Modelo de datos (tablas principales)

| Tabla | Qué guarda | Notas |
|-------|-----------|-------|
| `congregations` | Congregaciones (tenant) | `slug` único para URL |
| `users` | Publicadores y admins | `user_type`, `gender`, `spouse_id`, `family_id`, `access_key`, `is_admin`, `is_super_admin` |
| `exhibitors` | Puntos de exhibición | ej: "Torres de San Juan" |
| `time_slots` | Horarios por exhibidor/día | rango de 2h, `is_active`, `block_reason` |
| `reservations` | Reservas de turnos | máx 2 por slot (`slot_position` 1 y 2), `status`: `confirmed`/`cancelled` |
| `invitations` | Invitaciones entre usuarios | `status`: `pending`/`accepted`/`declined`, expiran en 2h |
| `relief_requests` | Solicitudes de relevo | `status`: `pending`/`accepted`/`cancelled` |
| `absences` | Ausencias programadas | |
| `app_config` | Config por congregación | `active_week_start`, `counting_mode`, ventanas de apertura/cancelación, etc. |
| `user_groups` | Grupos con capitanes | para ranking mensual |

**Reglas de negocio clave:**
- **Máximo 2 personas por slot** (posiciones 1 y 2).
- **Las reservas NUNCA se eliminan** (no hay DELETE), solo se cancelan con `UPDATE status='cancelled'`.
- **Límites de turnos:** publicador 1/semana, precursor regular 2/semana, precursor auxiliar 6/mes.
- **Género:** para compartir turno se requiere mismo género, EXCEPTO cónyuges (`spouse_id`) y familiares (`family_id`).
- **El Excel es la fuente de verdad** para la configuración de slots.

---

## 5. Componentes principales y qué hace cada uno

| Componente | Responsabilidad |
|-----------|----------------|
| `ExhibitorGrid.tsx` | **La grilla semanal** que ve el publicador. Celdas por día/horario, reservar, invitar, pedir relevo. Es el archivo más grande y complejo. |
| `AdminConfigPanel.tsx` | Configuración: modo de conteo, ventanas, **acciones rápidas de semana** (avanzar/reiniciar/retroceder). |
| `AdminUserManager.tsx` | CRUD de usuarios, **envío masivo de claves por WhatsApp**, vincular cónyuge/familiar. |
| `AdminScheduleGrid.tsx` | Grilla de horarios para el admin (configurar slots). |
| `AdminExcelPanel.tsx` | Importación de Excel (slots + reservas). |
| `AdminGroupManager.tsx` | Gestión de grupos y capitanes. |
| `AdminMonthlyRanking.tsx` | Ranking mensual con export PNG/PDF. |
| `AdminWeekReport.tsx` | Reporte semanal. |
| `AdminHistoryPanel.tsx` | Historial de turnos. |
| `InvitationBadge.tsx` / `ReliefBadge.tsx` | Notificaciones de invitaciones/relevos. |
| `GlobalReliefButton.tsx` | Botón global de pedir relevo. |
| `ActiveWeekBanner.tsx` | Banner de semana activa. |

---

## 6. Flujos clave (cómo funcionan)

### 6.1 Autenticación
- **No usa Supabase Auth.** Es autenticación propia por `access_key` (clave generada por el admin).
- El usuario se loguea con su `access_key` en `/api/auth/login`.
- El admin se autentica en API Routes enviando el header `x-access-key`, validado por `verifyAdmin()` en `lib/supabase/admin-auth.ts`.
- Hay 3 niveles: `publicador` (normal), `admin` (de su congregación), `super_admin` (global).

### 6.2 Reservar un turno
1. `ExhibitorGrid` carga `time_slots`, `reservations` e `invitations` de la semana activa (`app_config.active_week_start`).
2. El usuario hace clic en una celda "Disponible" → `handleReserve(slot.id)`.
3. Se inserta una `reservation` con `slot_position` 1 o 2 según lo que esté libre.
4. Realtime actualiza la grilla en vivo para todos.

### 6.3 Invitar a compartir turno
1. En un turno 1/2, el dueño hace clic "✉️ Invitar" → `handleOpenInviteModal(slot.id)`.
2. Llama a `POST /api/invite-candidates` (service client) que devuelve usuarios **activos, misma congregación, mismo género, no admin**.
3. Se excluyen: el propio usuario, su cónyuge, y quienes ya tienen reserva en ese slot.
4. El modal muestra la lista (con **buscador** para filtrar por nombre).
5. Al invitar se inserta en `invitations` con `expires_at = ahora + 2 horas`.

### 6.4 Acciones rápidas de semana (AdminConfigPanel → `/api/admin/week/reset`)
Hay 6 modos (`WeekActionMode`):

| Modo | Qué hace |
|------|---------|
| `reset_current` | Cancela reservas/invitaciones/relevos de la semana activa (la deja en cero). |
| `advance_blank` | Avanza a la próxima semana calendario y **borra** todo lo de esa semana destino. |
| `advance_keep` | Avanza y **copia** las reservas actuales a la nueva semana (borrando antes lo que hubiera). |
| `advance_only` | Avanza y **copia** las reservas actuales a la nueva semana **sin borrar** lo ya cargado (respeta posiciones ocupadas). |
| `rollback_only` | Retrocede una semana sin tocar reservas. |
| `rollback_blank` | Retrocede y borra reservas de la semana destino. |

> ⚠️ **Importante:** `advance_only` y `advance_keep` son parecidos. La diferencia es que
> `advance_only` NO borra las reservas ya existentes en la semana destino (solo copia las que
> no chocan por posición), mientras que `advance_keep` primero limpia la semana destino y luego copia.

> ⚠️ **Doble confirmación:** el frontend pide `window.confirm` + escribir una palabra
> (`REINICIAR` o `RETROCEDER`) antes de ejecutar.

### 6.5 Envío masivo de claves (AdminUserManager)
1. Botón "📲 Envío masivo" → **modal de confirmación** que exige escribir `SEGURO`.
2. Al confirmar, `startBulkSend()` regenera la clave de cada usuario activo con teléfono
   (vía `POST /api/admin/users/[id]/key`).
3. Abre un modal secuencial que abre WhatsApp (`wa.me`) con el mensaje pre-escrito para cada usuario.

### 6.6 Importación Excel
- `POST /api/admin/reservations/excel/preview` analiza sin aplicar.
- `POST /api/admin/reservations/excel` aplica: crea slots si no existen (con `hasTimeConflict()`),
  reporta `slotActions` CREADO/EXISTENTE/ERROR.

---

## 7. Puntos delicados / gotchas

1. **`ExhibitorGrid.tsx` es enorme** (~2000 líneas). La lógica de renderizado de celdas tiene
   muchos casos: vacío (0/2), parcial (1/2), completo (2/2), pasado, pareja, relevo, invitación pendiente.
   Cambiar algo ahí requiere leer con calma el bloque completo.

2. **Las reservas no se borran.** Siempre `status='cancelled'`. No busques DELETE en reservas.

3. **`advance_only` vs `advance_keep`:** no confundirlos (ver 6.4).

4. **Formato de hora:** los `time_slots` guardan `start_time`/`end_time` como `'HH:mm:ss'`.
   Hay dos helpers en `types/index.ts`:
   - `formatTimeLabel()` → "6:00 AM - 8:00 AM" (para la columna de horarios).
   - `formatCompactTimeLabel()` → "6:00-8:00a.m" (para dentro de las celdas).

5. **El cliente browser usa anon key** (`lib/supabase/client.ts`); las API Routes usan
   `service.ts` (service_role). No usar service_role en el cliente.

6. **`week_start` es siempre el lunes** de la semana, en formato `'YYYY-MM-DD'`.

7. **Realtime** está habilitado en `reservations` e `invitations`; la grilla se actualiza sola.

8. **ESLint tiene errores pre-existentes** (setState en effects, variables sin usar) que no
   deben "arreglarse" de paso al tocar otros archivos.

---

## 8. Estado de git / historial reciente

- Rama principal: `main`. Remoto: `github.com/Ciromontes/agendamiento-exhibidores.git`.
- Deploy en **Vercel** (push a `main` = deploy automático).
- Commits recientes relevantes:
  - `1319178` — feat: vínculo familiar (tipos + migración SQL `44_familiares.sql`).
  - `c118595` — feat: buscador de invitación, horarios en celdas, copiar cupos al avanzar semana y confirmación de envío masivo.

---

## 9. Migraciones SQL

Los scripts SQL están en `database/` numerados (`01_...` a `44_...`). Se ejecutan manualmente
en el SQL Editor de Supabase, en orden. El último es `44_familiares.sql` (vínculo familiar
además del cónyuge, con funciones `vincular_familiares` y `desvincular_familiares`).

---

## 10. Cómo validar cambios (checklist rápido)

1. `npx tsc --noEmit` → debe pasar sin errores.
2. `pnpm lint` → revisar que no haya errores NUEVOS (los pre-existentes están documentados).
3. `pnpm build` → build de producción sin errores.
4. `pnpm dev` → probar manualmente los flujos afectados.
5. Para cambios en BD: ejecutar la migración SQL correspondiente en Supabase.