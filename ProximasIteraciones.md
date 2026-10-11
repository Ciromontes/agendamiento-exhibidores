# ProximasIteraciones.md — Próxima iteración: Identificación por nombre de usuario (handle) en WhatsApp

> **Objetivo:** Reemplazar el uso del **número de teléfono** como identificador visible en el envío
> de claves por WhatsApp, por un **nombre de usuario (handle)** que el admin registra, para no
> exponer el número real de los usuarios.
>
> **Estado:** PLANIFICADO (no implementado aún).

---

## ⚠️ Advertencia técnica importante (leer primero)

WhatsApp **no permite abrir un chat por un "handle" arbitrario inventado por nosotros**.
El enlace `https://wa.me/<valor>` solo funciona con:

1. **Un número de teléfono** (ej: `wa.me/573001234567`), o
2. **Un "username" oficial de WhatsApp** (el perfil sin número que WhatsApp asigna al usuario,
   ej: `wa.me/miUsuario`). Este username lo define el propio usuario en su app de WhatsApp,
   **no** lo puede inventar el admin.

**Consecuencia:** si reemplazamos el número por un handle propio, el botón "Abrir WhatsApp"
dejará de poder abrir el chat directamente. Hay dos caminos posibles:

- **Opción A (recomendada):** Mantener el número en la BD (oculto), pero **mostrar y usar el handle
  como identificador visible** en toda la UI. El envío sigue usando el número internamente para
  abrir el chat, pero el admin nunca ve el número, solo el handle.
- **Opción B:** Usar el **username oficial de WhatsApp** del usuario (el admin lo copia del perfil
  del usuario). Entonces `wa.me/<username>` sí abre el chat sin número.

> **Decisión pendiente:** confirmar cuál de las dos opciones se implementa. El paso a paso de abajo
> asume la **Opción A** (la más segura y la que no rompe el envío), pero se indica dónde cambia
> para la Opción B.

---

## Paso a paso de implementación

### Paso 1 — Migración SQL: nueva columna `whatsapp_handle`

Crear un nuevo script en `database/` (el siguiente número disponible, ej: `45_whatsapp_handle.sql`):

```sql
-- 45_whatsapp_handle.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_handle text;

-- Único por congregación (no global, para permitir el mismo handle en distintas congregaciones)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whatsapp_handle
  ON users (congregation_id, whatsapp_handle)
  WHERE whatsapp_handle IS NOT NULL;

COMMENT ON COLUMN users.whatsapp_handle IS
  'Nombre de usuario (handle) visible para identificar al usuario en el envío por WhatsApp.';

-- Permisos de lectura (igual que phone)
GRANT SELECT (whatsapp_handle) ON TABLE public.users TO anon;
GRANT SELECT (whatsapp_handle) ON TABLE public.users TO authenticated;
```

> Ejecutar en el SQL Editor de Supabase, después de los scripts 01-44.

---

### Paso 2 — Actualizar el tipo `User` en `src/types/index.ts`

En el tipo `User` (alrededor de la línea 49, junto a `phone`), agregar:

```ts
phone: string | null         // Teléfono WhatsApp (se mantiene oculto, solo uso interno)
whatsapp_handle: string | null // Handle visible para identificar al usuario (nuevo)
```

> **Nota:** en la Opción A el `phone` se conserva (oculto). En la Opción B se podría
> eliminar `phone` y usar solo `whatsapp_handle` como username oficial.

---

### Paso 3 — API: aceptar el nuevo campo en la edición de usuario

Archivo: `src/app/api/admin/users/[id]/route.ts` (método `PATCH`).

Agregar al bloque de construcción del `payload`:

```ts
if (body.whatsapp_handle !== undefined) {
  const handle = body.whatsapp_handle
    ? String(body.whatsapp_handle).trim().toLowerCase().replace(/\s+/g, '_')
    : null
  payload.whatsapp_handle = handle
}
```

> Normalizar el handle (minúsculas, sin espacios) evita duplicados y facilita la búsqueda.
> El error `23505` (duplicado) ya está manejado en ese endpoint, pero el mensaje actual dice
> "clave de acceso ya está en uso"; conviene ajustarlo para distinguir si el duplicado es de
> `access_key` o de `whatsapp_handle`.

---

### Paso 4 — API de Excel (export/import) de usuarios

Archivo: `src/app/api/admin/users/excel/route.ts`.

- **Export (GET):** en el mapeo de filas (línea ~104), reemplazar o complementar `telefono`:
  ```ts
  whatsapp_handle: u.whatsapp_handle ?? '',
  ```
  (y ajustar el ancho de columna `ws['!cols']`).
- **Import (POST):** en el mapeo de columnas (línea ~347 y ~372), leer la columna del handle
  y guardarla en `whatsapp_handle` en lugar de (o además de) `phone`.

---

### Paso 5 — Formulario de crear/editar usuario

Archivo: `src/components/AdminUserManager.tsx`.

1. En el tipo `UserFormData` (línea ~40), agregar:
   ```ts
   whatsapp_handle: string
   ```
2. En `EMPTY_FORM` (línea ~48), inicializar `whatsapp_handle: ''`.
3. En el formulario (donde hoy está el campo "Teléfono WhatsApp", línea ~1474), reemplazar el
   campo por "Nombre de usuario (WhatsApp)" que edite `formData.whatsapp_handle`.
4. En `handleCreate` / `handleUpdate` (líneas ~267, ~338, ~378), incluir `whatsapp_handle` en el
   body enviado a la API.

---

### Paso 6 — Columna de la tabla de usuarios

Archivo: `src/components/AdminUserManager.tsx`.

- La columna "WhatsApp" (línea ~981) y la celda (línea ~1076-1102) hoy muestran `u.phone`.
  Cambiarlas para mostrar `u.whatsapp_handle` (o un placeholder si es null).
- El botón de envío individual (`openWhatsApp`, línea ~559) y el masivo (`openBulkWhatsApp`,
  línea ~643) deben seguir usando el **número** internamente para abrir el chat (Opción A),
  pero mostrar el **handle** en la UI.

---

### Paso 7 — Mensaje y apertura de WhatsApp

Archivo: `src/components/AdminUserManager.tsx`.

- `buildWAMessage` (línea ~541): no requiere cambios de fondo, pero se puede personalizar el
  saludo usando el handle si se desea.
- `openWhatsApp` (línea ~559) y `openBulkWhatsApp` (línea ~643):
  - **Opción A:** seguir usando `targetUser.phone` para `wa.me/<phone>`, pero validar/avisar
    usando el handle en los mensajes de alerta.
  - **Opción B:** usar `wa.me/<whatsapp_handle>` (username oficial) en lugar del número.
- `startBulkSend` (línea ~587): el filtro actual exige `phone` con >5 dígitos. Cambiarlo para
  filtrar por `whatsapp_handle` (Opción B) o mantener el filtro por `phone` (Opción A).

---

### Paso 8 — Validación

1. `npx tsc --noEmit` → sin errores.
2. `pnpm lint` → sin errores nuevos.
3. `pnpm build` → build de producción OK.
4. Probar manualmente:
   - Crear/editar un usuario con handle.
   - Verificar que la tabla muestra el handle y no el número.
   - Enviar clave individual y masivo: confirmar que el chat se abre correctamente.
   - Verificar que dos usuarios no puedan tener el mismo handle en la misma congregación.

---

## Resumen de archivos a tocar

| Archivo | Cambio |
|---------|--------|
| `database/45_whatsapp_handle.sql` | Nueva columna + índice único |
| `src/types/index.ts` | Campo `whatsapp_handle` en `User` |
| `src/app/api/admin/users/[id]/route.ts` | Aceptar `whatsapp_handle` en PATCH |
| `src/app/api/admin/users/excel/route.ts` | Export/import del handle |
| `src/components/AdminUserManager.tsx` | Formulario, tabla, envío individual y masivo |

---

## Preguntas abiertas antes de implementar

1. ¿Opción A (número oculto + handle visible) u Opción B (username oficial de WhatsApp)?
2. ¿El handle es obligatorio u opcional al crear un usuario?
3. ¿Se migran los datos existentes? (los usuarios actuales no tendrán handle → decidir si se
   genera uno automáticamente a partir del nombre, ej: `beatriz.valero`).