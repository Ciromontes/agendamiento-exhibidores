# Roadmap — Simulación 3 Meses y Mejoras de Funcionalidades

> **Contexto:** La app se lanza al público el viernes 13 de marzo a las 3:00 p.m.  
> Los usuarios reservarán la **semana del 16 al 22 de marzo de 2026**.  
> Este documento define el orden lógico de implementación, con un prompt para IA y una explicación para humanos en cada paso.

---

## FASE 0 — Corrección de Bugs Urgentes (antes del lanzamiento)

---

### Paso 0.1 — Bug: género equivocado al usar un PC compartido

**Problema detectado:**  
Cuando se usa un solo PC para probar múltiples usuarios, la grilla de reservas no se recarga completamente al cambiar de sesión. Si una mujer reservó y luego entra un hombre, al hacer click en la misma celda el sistema agendó al hombre CON la mujer — lo cual viola la regla de compatibilidad de género. Esto ocurre porque `isCompatiblePartner` usa los datos del usuario actual pero la grilla todavía muestra datos del usuario anterior en caché.

**Explicación para humanos:**  
El problema es que cuando cambias de usuario, la grilla no borra inmediatamente las reservas visibles del usuario anterior. Al hacer click en una celda con una reserva de mujer el sistema "ve" que hay espacio y coloca al hombre, saltándose la validación porque los datos son stale (viejos).

**Prompt para IA:**
```
En src/components/ExhibitorGrid.tsx, el componente mantiene estado de reservas en memoria.
Cuando el usuario cambia (user?.id cambia), los estados locales no se resetean inmediatamente
antes de que `loadData` termine de cargar los nuevos datos. Esto puede causar que una reserva
del usuario anterior sea visible brevemente, y si se hace click en esa celda, la validación
`isCompatiblePartner` pase incorrectamente.

Solución:
1. Agrega un useEffect que observe `user?.id` y que al cambiar ejecute:
   setReservations([])
   setTimeSlots([])
   setSelectedExhibitor(null)
   (reset de todos los estados de datos antes de que loadData cargue)
2. Asegúrate de que `loadData` tenga un guard al inicio: 
   `if (!user?.id || !congregationId) { setLoading(false); return }`
3. En `handleReserve` (la función que crea la reserva), antes de hacer el INSERT,
   verifica de nuevo la compatibilidad de género consultando directamente la BD
   (no solo el estado local), para evitar race conditions en PC compartido.
```

---

### Paso 0.2 — Bug: relevo no aparece en usuarios elegibles

**Problema detectado:**  
Cuando se crea una solicitud de relevo desde un turno reservado con género incorrecto (por el bug 0.1), el relevo tampoco aparece en la interfaz de los usuarios que sí podrían cubrirlo. En `ReliefBadge.tsx` la consulta filtra `from_user.gender === user.gender`, pero si el género del `from_user` quedó mal grabado en la reserva, el filtro no encuentra coincidencias.

**Explicación para humanos:**  
Si el turno quedó mal asignado (hombre en celda de mujer), el relevo dice "busco a alguien del género F" pero el hombre que lo pide tiene género M. Nadie del género F ve el relevo porque viene de un usuario M, y los hombres no lo ven porque buscan que el que pide sea del mismo género que ellos. Quedó en un limbo invisible.

**Prompt para IA:**
```
En src/components/ReliefBadge.tsx, la función fetchReliefs filtra las solicitudes abiertas
comparando `from_user.gender === user.gender`.

El problema: si una reserva quedó mal asignada (género incorrecto por PC compartido),
el género del from_user no coincide con ningún grupo, y el relevo queda invisible.

Solución de fondo (depende del fix 0.1 aplicado primero):
1. Agrega validación de género en el servidor al crear una reserva (en la función RPC
   de Supabase o en el API route), que rechace una reserva si user.gender ≠ gender
   del otro ocupante del slot (a menos que sean cónyuge).
2. En ReliefBadge.tsx, para las solicitudes 'open' (type='open'), mostrar también
   las solicitudes donde el slot del relevo está vacío para el género del usuario actual
   (aunque el from_user tenga otro género), para evitar que queden invisibles.
   Mejor aún: el filtro de elegibilidad debe hacerse por el slot, no por el género del
   solicitante: "¿puede el usuario actual cubrir este horario?" es la pregunta correcta.
```

---

## FASE 1 — Semana Activa y Banner informativo

---

### Paso 1.1 — Banner "Semana del 16 al 22 de marzo" en todas las interfaces

**Explicación para humanos:**  
Todos los usuarios deben ver claramente para qué semana están agendando. El banner debe aparecer en el dashboard del usuario y en la grilla de exhibidores. Cuando el admin avance la semana, el banner se actualiza automáticamente.

**Prompt para IA:**
```
Crea un componente `src/components/ActiveWeekBanner.tsx` que:
1. Lea `active_week_start` de la tabla `app_config` para la congregación del usuario actual.
2. Muestre un banner con el texto:
   "📅 Agendamiento de la semana del {lunes} al {domingo} de {mes} de {año}"
   Ejemplo: "📅 Agendamiento de la semana del 16 al 22 de marzo de 2026"
3. Use clases Tailwind con fondo indigo-50, borde indigo-200, texto indigo-800.
4. Sea un componente small (no ocupa mucho espacio vertical).
5. Impleméntalo con su propio fetch a Supabase, sin props.

Luego importa y coloca <ActiveWeekBanner /> en:
- src/app/[slug]/dashboard/page.tsx: justo encima del <ExhibitorGrid />
- src/components/ExhibitorGrid.tsx: dentro del return, como primera línea visible
  (antes del selector de exhibidores)
```

---

### Paso 1.2 — Bloqueo automático de celdas pasadas + ventana mínima de agendamiento

**Explicación para humanos:**  
Si hoy es lunes a las 5:00 a.m. y el turno del lunes empieza a las 6:00 a.m., el usuario puede reservar pero verá un aviso que dice "Comunícate con el hermano que guarda el exhibidor para confirmar." Con menos de 15 minutos, la celda queda bloqueada. El admin puede configurar cuántas horas de anticipación mínima se requieren (por defecto 12h). Los turnos ya pasados se ven en gris bloqueado.

**Prompt para IA:**
```
En src/components/ExhibitorGrid.tsx, modifica la lógica de renderizado de celdas:

1. Para cada slot, calcula su `slotDatetime` = fecha y hora de inicio del turno en la semana activa.
2. Agrega tres estados para cada celda:
   - PASADO: slotDatetime < now → celda gris bloqueada, no clickeable, muestra "⛔ Pasado"
   - MUY_PRÓXIMO: slotDatetime entre now y now+15min → celda clickeable con aviso amarillo
     "⚠️ Turno muy próximo. Confirma con el custodio del exhibidor."
   - PRÓXIMO: slotDatetime entre now+15min y now+minAdvanceHours → celda disponible normal
   - DISPONIBLE: slotDatetime > now+minAdvanceHours → celda disponible normal

3. Lee `min_advance_hours` de app_config (nuevo campo, default 12).
4. En AdminConfigPanel.tsx, agrega un control numérico para configurar `min_advance_hours`
   con label "⏱ Horas mínimas de anticipación para reservar" (rango 0–48, default 12).
5. Agrega al script SQL `database/32_min_advance_hours.sql`:
   ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS min_advance_hours INT DEFAULT 12;
```

---

## FASE 2 — Sistema de Historial Completo

---

### Paso 2.1 — Historia se congela al avanzar semana (el admin decide el momento, solo el día correcto)

**Explicación para humanos:**  
El historial "se cierra" de dos formas:

1. **Automática:** Cuando llega exactamente el día y hora de apertura configurados (`booking_opens_day` + `booking_opens_time` de `app_config`), el sistema avanza solo: la semana actual pasa a historial read-only y la grilla muestra la nueva semana vacía.
2. **Manual (admin):** El botón "Avanzar semana" en AdminConfigPanel solo está habilitado el día configurado de apertura (p.ej. viernes). Si el admin lo pulsa antes de ese día, el sistema lo rechaza con un mensaje. Al pulsarlo el viernes (o cualquier día igual al configurado), ocurre lo mismo que la transición automática.

En ambos casos: `active_week_start` pasa a la próxima semana, las reservas de la semana anterior quedan como históricas, y la grilla queda en blanco para agendar la nueva semana.

**Regla de negocio clave:** El avance puede ocurrir **desde el `booking_opens_day` hasta el domingo inclusive** (viernes, sábado o domingo). No puede suceder de lunes a jueves (los días anteriores al día de apertura configurado).

**Prompt para IA:**
```
El campo `active_week_start` en `app_config` ya controla la semana activa (script 31).
La función `handleAdvanceWeek` en AdminConfigPanel.tsx ya actualiza ese campo.
Los campos `booking_opens_day` (0=Dom…6=Sáb) y `booking_opens_time` ("HH:MM:SS")
también existen en `app_config`.

Cambios a implementar:

── 1. Restricción en AdminConfigPanel.tsx ────────────────────────────────────
En `handleAdvanceWeek` (antes de hacer el UPDATE):
  a. Leer `booking_opens_day` del config (0=Dom, 1=Lun, …, 5=Vie, 6=Sáb).
  b. Obtener `const todayDay = new Date().getDay()` (0=Dom … 6=Sáb).
  c. Calcular si hoy está en la "ventana de avance":
       La ventana va desde booking_opens_day hasta el domingo (0) de ese fin de semana.
       Días permitidos: booking_opens_day, booking_opens_day+1 (Sáb), y 0 (Dom).
       Ejemplo con viernes (5): permitidos = [5, 6, 0].
       Lógica:
         const allowed = [
           bookingOpensDay % 7,
           (bookingOpensDay + 1) % 7,
           (bookingOpensDay + 2) % 7,  // domingo si booking=viernes
         ]
         const canAdvance = allowed.includes(todayDay)
  d. Si !canAdvance → mostrar alert:
     "El avance de semana solo puede realizarse desde el [día configurado] hasta el domingo.
      Hoy es [día actual] y aún no ha llegado ese momento."
     y salir sin hacer cambios.
  e. Si canAdvance → continuar con el UPDATE existente.

── 2. Avance automático en ExhibitorGrid.tsx ─────────────────────────────────
Después de cargar el config (fetchConfig), comparar la hora de apertura con la hora actual:
  a. Construir la fecha/hora de apertura de esta semana:
       const openingDate = computed from (booking_opens_day + booking_opens_time)
       (mismo cálculo que ya usa computeBookingWindow)
  b. Si Date.now() >= openingDate.getTime()  AND  weekStart < expected_new_week_start:
       - Calcular el `expected_new_week_start`: la semana para la que se debería haber abierto.
         (lunes siguiente al viernes de apertura = openingDate + 3 días, o según la lógica existente)
       - Si active_week_start en BD < expected_new_week_start:
           Hacer UPDATE app_config SET active_week_start = expected_new_week_start
           y actualizar el estado local setWeekStart(expected_new_week_start).
     NOTA: solo hacer el UPDATE si el usuario tiene permisos de admin o vía una función RPC pública.
     Si no se quiere hacer el UPDATE desde el cliente del usuario normal, en cambio:
       - Mostrar un aviso en la grilla: "El admin debe avanzar la semana. Ya es hora de apertura."
       - Y bloquear la reserva hasta que active_week_start sea actualizado.
     (Elegir la opción más segura según el modelo de permisos actual de la app.)

── 3. Opción A para el historial (sin columnas nuevas) ─────────────────────
  - Las reservas son históricas si su `week_start` < `active_week_start`.
  - ExhibitorGrid.tsx ya filtra con .eq('week_start', weekStart) donde weekStart = active_week_start.
  - WeekHistoryPanel.tsx debe mostrar solo semanas con week_start < active_week_start (no la actual).
  - Verificar que WeekHistoryPanel no incluya la semana activa en su lista.

── 4. Día de apertura en el banner de AdminConfigPanel ──────────────────────
  En el botón "Avanzar semana" de AdminConfigPanel:
  - Si hoy es viernes, sábado o domingo (>= booking_opens_day en el fin de semana) → botón habilitado.
  - Si hoy es lunes–jueves (antes del día de apertura) → botón deshabilitado (opacity-50 cursor-not-allowed)
    con tooltip: "Solo disponible desde el [día configurado] hasta el domingo".
```

---

### Paso 2.2 — Historial personal enriquecido con estadísticas

**Explicación para humanos:**  
En la pestaña "Historial" el usuario verá una tabla limpia con: fecha, exhibidor y horario de cada turno que hizo. Al final de la lista, un resumen con el total de turnos, total de horas, y qué exhibidor usó más. Todo descargable como PDF.

**Prompt para IA:**
```
Modifica src/components/WeekHistoryPanel.tsx para agregar una sección de estadísticas personales:

1. Debajo del selector de semanas, agrega una tarjeta "📊 Mi Resumen" que muestre:
   - Total de turnos en el período visible (todas las semanas del historial)
   - Total de horas estimadas (sum de (end_time - start_time) por turno)
   - Exhibidor más frecuentado (el que más aparece en sus reservas)
   - Semana con más actividad

2. Agrega una tabla "🗓️ Mi historial completo" con columnas:
   | Semana | Día | Exhibidor | Horario | Estado |
   Ordenada de más reciente a más antigua.
   Cada fila: semana formateada ("16–22 mar"), día (Lunes), exhibidor (nombre),
   horario (7:00–9:00 a.m.), estado (✅ Completado / ❌ Cancelado).

3. Agrega botón "⬇ Descargar PDF" que genere un PDF usando la librería `jspdf` + `jspdf-autotable`.
   El PDF debe incluir el nombre del usuario, congregación, fecha de generación,
   la tabla completa y el resumen estadístico.
   Instala: npm install jspdf jspdf-autotable

4. Mantén la vista actual por semana con el grid de exhibidores como pestaña secundaria.
```

---

### Paso 2.3 — Historial grupal (admin): tabla por exhibidor y semana

**Explicación para humanos:**  
El admin tiene una vista que muestra semana a semana quién agendó qué exhibidor y cuándo. Es una tabla donde las filas son semanas y las columnas son exhibidores, y en cada celda aparecen los nombres de los hermanos que salieron. También descargable en PDF.

**Prompt para IA:**
```
Crea src/components/AdminHistoryMatrix.tsx:

1. Fetch: carga todas las reservas con status != 'cancelled' de las últimas 12 semanas
   (anteriores a active_week_start), junto con user.name, exhibitor.name, slot.day_of_week,
   slot.start_time.

2. Construye una matriz: filas = semanas (descendente), columnas = exhibidores.
   En cada celda: lista de nombres con su horario (ej. "Juan P. — Lun 7:00").

3. Estilos: tabla con scroll horizontal, encabezados fijos, alternancia de colores por fila.
   Cada celda muestra máx 3 nombres y un "+N más" si hay más.

4. Botón "⬇ Descargar PDF" que exporta la matriz completa con jspdf-autotable.

5. Añade este componente como una nueva vista en src/app/[slug]/admin/page.tsx
   con una pestaña/tab "📋 Historial Grupal".
```

---

## FASE 3 — Límites de Relevos por Mes

---

### Paso 3.1 — Máximo de relevos aceptados por mes (configurable por el admin)

**Explicación para humanos:**  
Actualmente cualquier usuario puede aceptar relevos sin límite. Ahora el admin define cuántos relevos puede aceptar cada tipo de usuario por mes:
- **Por defecto:** publicadores = 1 relevo/mes, precursores (aux + regular) = 2 relevos/mes.
- **El admin puede subir ese límite** hasta un máximo configurable (ej. precursores hasta 4/mes, publicadores hasta 3/mes).
- El límite aplica solo a cuando *aceptan* un relevo, no a cuando lo piden.

**Prompt para IA:**
```
── 1. Script SQL: database/33_relief_monthly_limits.sql ─────────────────────
Agregar columnas a app_config para guardar los límites configurables:
  ALTER TABLE public.app_config
    ADD COLUMN IF NOT EXISTS relief_limit_publicador   INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS relief_limit_precursor    INT DEFAULT 2;
  -- Nota: no se necesitan columnas extra en relief_requests.
  -- El conteo se hace con: WHERE status='accepted' AND acceptor_id = x
  --   AND accepted_at >= date_trunc('month', CURRENT_DATE)

── 2. Función RPC `accept_relief_request` en Supabase ───────────────────────
Antes de marcar la solicitud como 'accepted':
  a. Leer de app_config los límites:
       SELECT relief_limit_publicador, relief_limit_precursor
       FROM app_config WHERE congregation_id = p_congregation_id LIMIT 1
  b. Leer el user_type del acceptor:
       SELECT user_type FROM users WHERE id = p_acceptor_id
  c. Determinar su límite:
       IF user_type IN ('precursor_auxiliar', 'precursor_regular') THEN
         lim := relief_limit_precursor
       ELSE
         lim := relief_limit_publicador
       END IF
  d. Contar relevos aceptados este mes:
       SELECT COUNT(*) FROM relief_requests
       WHERE acceptor_id = p_acceptor_id
         AND status = 'accepted'
         AND accepted_at >= date_trunc('month', CURRENT_DATE)
  e. Si count >= lim → retornar error:
       'Has alcanzado el límite de X relevos que puedes aceptar este mes.'

── 3. Panel de admin: nueva Sección en AdminConfigPanel.tsx ─────────────────
Agregar sección "🔄 Límites de relevos por mes" con:
  - Control para "Publicador — relevos/mes": input numérico, mín 0, máx 10, default 1
    Presets: [0, 1, 2, 3]
  - Control para "Precursor — relevos/mes": input numérico, mín 0, máx 10, default 2
    Presets: [0, 1, 2, 3, 4]
  - Botón "Guardar límites" → UPDATE app_config SET relief_limit_publicador=X, relief_limit_precursor=Y
  - Mensaje de confirmación tras guardar.
  Leer los valores actuales en el SELECT de fetchConfig (ya incluye app_config).

── 4. ReliefBadge.tsx — contador visual y bloqueo ───────────────────────────
Al cargar las solicitudes:
  a. Leer relief_limit_publicador y relief_limit_precursor de app_config.
  b. Contar cuántos relevos aceptó el usuario este mes:
       SELECT COUNT(*) FROM relief_requests
       WHERE acceptor_id = user.id AND status='accepted'
         AND accepted_at >= primer día del mes actual
  c. Determinar el límite del usuario según su user_type.
  d. Mostrar contador: "Has aceptado X de Y relevos este mes."
     - Verde si X < Y
     - Amarillo si X = Y - 1
     - Rojo si X >= Y
  e. Si X >= Y → deshabilitar el botón "Aceptar" de cada solicitud abierta
     con tooltip: "Has alcanzado tu límite de relevos para este mes (Y máx.)."
```

---

## FASE 4 — Simulación de 3 Meses (Historial de Pruebas Simuladas)

---

### Paso 4.1 — Script de simulación de 12 semanas

**Explicación para humanos:**  
Esto es una prueba especial: un script que genera automáticamente 12 semanas de reservas con todos los usuarios de la congregación, incluyendo relevos y ausencias aleatorias, para verificar que el historial funciona correctamente y que las estadísticas se ven bien. Los datos se guardan con un tag especial para no confundirse con datos reales.

**Prompt para IA:**
```
Crea el archivo load-tests/simulate-3-months.js (script k6 o Node.js puro):

Parámetros de la simulación para la congregación /terranova:
- Duración: 12 semanas hacia atrás desde hoy (semanas históricas)
- Todos los usuarios con access_key existentes en la congregación
- Cada usuario reserva su máximo permitido por semana
- 15% de probabilidad de ausencia por semana por usuario
- 10% de los turnos generan una solicitud de relevo
- Los relevos son aceptados por usuarios del mismo género con cupo disponible
- Precursores pueden aceptar hasta 2 relevos/mes, publicadores 1

El script debe:
1. Autenticarse como admin con x-access-key
2. Leer los time_slots activos de todos los exhibidores
3. Para cada semana (empezando por la más antigua):
   a. Reservar turnos directamente via INSERT en Supabase (usando service_role_key)
   b. Generar relief_requests para las ausencias simuladas
   c. Aceptar los relevos con usuarios elegibles
4. Al final imprimir un resumen: total reservas, total relevos, usuarios más activos

IMPORTANTE: marcar cada reserva simulada con un campo `notes` = 'SIMULACION-3M'
para poder identificarlas y borrarlas si es necesario.
Agrega también una función `cleanup` que borre todas las reservas con notes='SIMULACION-3M'.
```

---

### Paso 4.2 — Sección "Historial de Pruebas Simuladas" en el admin

**Explicación para humanos:**  
Una pestaña separada en el panel de administración donde se puede ver el historial generado por la simulación. Tiene un botón para correr la simulación y otro para borrar los datos simulados. Esto no afecta el historial real.

**Prompt para IA:**
```
Crea src/components/AdminSimulationHistory.tsx:

1. Muestra todas las reservas con notes='SIMULACION-3M' de la congregación.
2. Las presenta en la misma matriz semana × exhibidor que AdminHistoryMatrix.
3. Agrega dos botones en el header:
   - "▶ Ejecutar simulación" → llama a un API route POST /api/admin/simulate
     que corre el script de simulación en el servidor (no en el browser).
   - "🗑 Borrar datos simulados" → llama a DELETE /api/admin/simulate con confirmación.
4. Muestra estadísticas de la simulación: semanas cubiertas, total reservas, total relevos.
5. Añade a src/app/[slug]/admin/page.tsx una pestaña "🧪 Simulación" que renderice este componente.
```

---

## Orden de Ejecución Recomendado

| Prioridad | Paso | Razón |
|-----------|------|-------|
| 🔴 HOY | 0.1 — Bug género compartido | Puede causar errores reales en el lanzamiento |
| 🔴 HOY | 0.2 — Bug relevo invisible | Misma razón |
| 🟡 Antes lanzamiento | 1.1 — Banner semana activa | Claridad para usuarios el viernes |
| 🟡 Antes lanzamiento | 1.2 — Bloqueo celdas pasadas | Evita reservas imposibles |
| 🟢 Post-lanzamiento | 2.1 — Historia congelada | Ya funciona parcialmente |
| 🟢 Post-lanzamiento | 2.2 — Historial personal PDF | Mejora de UX |
| 🟢 Post-lanzamiento | 2.3 — Historial grupal PDF | Para el admin |
| 🟢 Post-lanzamiento | 3.1 — Límites de relevos/mes | Nueva regla de negocio |
| 🔵 Prueba pre-launch | 4.1 — Script simulación | Para validar el historial |
| 🔵 Prueba pre-launch | 4.2 — Panel simulación admin | Para ver los datos simulados |

---

## SQL Scripts pendientes de ejecutar en Supabase

```sql
-- Ya creados, ejecutar en este orden:
-- 1. database/30_fix_exhibitor_name_unique_per_congregation.sql  ← si no se ejecutó aún
-- 2. database/31_active_week_start.sql                           ← OBLIGATORIO antes del lanzamiento

-- Pendientes de crear (se crean en los pasos de desarrollo):
-- 3. database/32_min_advance_hours.sql
-- 4. database/33_relief_monthly_limits.sql
--    → agrega relief_limit_publicador INT DEFAULT 1
--    → agrega relief_limit_precursor  INT DEFAULT 2
```

---

## Notas técnicas importantes

- **`active_week_start` debe existir en BD** antes del lanzamiento (script 31).
- **El admin debe establecer `active_week_start = '2026-03-16'`** antes del viernes, desde el panel de configuración.
- **El banner del paso 1.1** debe mostrar esa fecha apenas esté configurada.
- **La simulación** usa datos históricos (semanas pasadas) por lo que no interfiere con la semana activa real.
