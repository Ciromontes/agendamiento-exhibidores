# 🚀 Plan de Ejecución — Prueba de Carga

**Estado actual (9 marzo 2026):**  
✅ 100 usuarios de prueba ya cargados en congregación **Terranova**  
✅ URL de prueba: `https://exhibidores-app.vercel.app/terranova`  
✅ Claves de prueba: `loadtest_key_1` a `loadtest_key_100` (slug: `terranova`)  

---

## Leyenda

| Símbolo | Quién actúa |
|---------|-------------|
| 🧑 **HUMANO** | Tú ejecutas el comando o abres el navegador |
| 🤖 **IA** | Dile este mensaje exacto al chat y la IA genera el código |

---

## Paso 1 — Instalar k6 ✅ HECHO

k6 ya fue descargado automáticamente por la IA en `load-tests/k6.exe`.

Verifica que funciona:

```powershell
.\load-tests\k6.exe version
```

**Resultado esperado:** `k6 v0.56.0 (...)`

---

## Paso 2 — Crear la carpeta de pruebas

🧑 **HUMANO** — En PowerShell, desde la raíz del proyecto:

```powershell
cd "d:\Teocráticos\Proyectos\ExhibidoresAgendamiento\exhibidores-app"
New-Item -ItemType Directory -Path "load-tests\results" -Force
```

Estructura que quedará:
```
load-tests/
  results/          ← aquí van los JSON de resultados
  load-test.js      ← la IA lo genera en el Paso 3
  stress-test.js    ← la IA lo genera en el Paso 3
```

---

## Paso 3 — Scripts k6 ✅ GENERADOS

✅ **Ya están creados por la IA.** No necesitas hacer nada en este paso.

Archivos generados:
- `load-tests/load-test.js` — prueba de 50 y 100 VUs
- `load-tests/stress-test.js` — ramp hasta 300 VUs

**Decisión técnica importante (no te pedimos login individual):**  
El endpoint `/api/auth/login` tiene rate-limit de 10 intentos / 15 min por IP.  
Con 100 VUs desde tu máquina → los VUs 11 en adelante recibirían `429`.  
**Solución:** `setup()` carga los 100 usuarios directamente desde Supabase en **1 sola petición** antes de que arranquen los VUs. Sin rate-limit, sin cookies.

---

## Paso 4 — Smoke test (verificar que todo funciona)

🧑 **HUMANO** — Ejecuta la prueba más pequeña posible primero (5 usuarios, 30 segundos):

```powershell
.\load-tests\k6.exe run --vus 5 --duration 30s load-tests/load-test.js
```

**Qué revisar en la salida:**
- Deben aparecer `✓` (checks verdes), no `✗`
- `http_req_failed` debe ser `0.00%`
- Si ves errores tipo `ECONNREFUSED` o `401`, el script tiene un problema → llama a la IA

🧑 Si hay errores, escríbele a la IA:
> "El smoke test falló con este error: [pega el error]"

---

## Paso 5 — Prueba de carga normal (50 usuarios)

🧑 **HUMANO** — Una vez que el smoke test pasa sin errores:

```powershell
.\load-tests\k6.exe run --vus 50 --duration 2m `
  --out json=load-tests/results/50vu.json `
  load-tests/load-test.js
```

⏱️ Duración: ~2 minutos. La terminal muestra el progreso en vivo.

Guarda la salida completa de la terminal para el Paso 7 (análisis).

---

## Paso 6 — Prueba de carga alta (100 usuarios)

🧑 **HUMANO** — Espera 2-3 minutos entre pruebas para que Supabase se recupere, luego:

```powershell
.\load-tests\k6.exe run --vus 100 --duration 3m `
  --out json=load-tests/results/100vu.json `
  load-tests/load-test.js
```

⏱️ Duración: ~3 minutos.

---

## Paso 7 — Stress test (hasta encontrar el límite)

🧑 **HUMANO** — Esta prueba sube hasta 300 VUs para encontrar el punto de quiebre:

```powershell
.\load-tests\k6.exe run --out json=load-tests/results/stress.json load-tests/stress-test.js
```

⏱️ Duración: ~5 minutos.

> ⚠️ Es normal que esta prueba falle thresholds — ese es el objetivo.  
> Observa en qué cantidad de VUs empiezan a aparecer errores.

---

## Paso 8 — Analizar los resultados

🤖 **IA** — Copia TODA la salida de la terminal de los pasos 5 y 6, y escribe:

---

> **analiza los resultados de la prueba de carga:**
>
> **Resultado 50 VUs:**  
> [pega aquí la salida completa del terminal del Paso 5]
>
> **Resultado 100 VUs:**  
> [pega aquí la salida completa del terminal del Paso 6]
>
> Dime:
> 1. ¿Pasó o falló según los thresholds?
> 2. Tiempos p50, p95, p99
> 3. Tasa de errores y tipo de errores si los hay
> 4. Throughput (req/s)
> 5. ¿La app soporta 100 usuarios concurrentes sin problemas?
> 6. Si hay problemas, ¿qué optimizar primero?

---

## Paso 9 — Limpiar los datos de prueba

🧑 **HUMANO** — Después de todas las pruebas, ve a Supabase SQL Editor y ejecuta:

```sql
-- Borrar reservas de usuarios de prueba
DELETE FROM reservations
WHERE user_id IN (
  SELECT u.id FROM users u
  JOIN congregations c ON c.id = u.congregation_id
  WHERE c.slug = 'terranova'
    AND u.access_key LIKE 'loadtest_key_%'
);

-- Borrar invitaciones de usuarios de prueba
DELETE FROM invitations
WHERE user_id IN (
  SELECT u.id FROM users u
  JOIN congregations c ON c.id = u.congregation_id
  WHERE c.slug = 'terranova'
    AND u.access_key LIKE 'loadtest_key_%'
)
OR invited_user_id IN (
  SELECT u.id FROM users u
  JOIN congregations c ON c.id = u.congregation_id
  WHERE c.slug = 'terranova'
    AND u.access_key LIKE 'loadtest_key_%'
);

-- Borrar los usuarios de prueba
DELETE FROM users
WHERE congregation_id = (SELECT id FROM congregations WHERE slug = 'terranova')
  AND access_key LIKE 'loadtest_key_%';
```

> ⚠️ **No borres la congregación Terranova completa** — mantente con el admin `TERA0001`  
> que creaste antes. Solo se eliminan los 100 usuarios `loadtest_key_*`.

---

## Resumen de tiempos estimados

| Paso | Quién | Tiempo estimado |
|------|-------|----------------|
| 1 — Instalar k6 | Humano | 2 minutos |
| 2 — Crear carpeta | Humano | < 1 minuto |
| 3 — Generar scripts | IA | 2-3 minutos |
| 4 — Smoke test | Humano + IA | 5 minutos |
| 5 — 50 VUs test | Humano | 2 minutos |
| 6 — 100 VUs test | Humano | 3 minutos |
| 7 — Stress test | Humano | 5 minutos |
| 8 — Análisis | IA | 3 minutos |
| 9 — Limpieza SQL | Humano | 2 minutos |
| **Total** | | **~25 minutos** |

---

## Criterios de éxito

| Métrica | Objetivo | Crítico |
|---------|----------|---------|
| `p(95)` latencia | < 2 segundos | < 3 segundos |
| `p(50)` latencia | < 500 ms | < 1 segundo |
| Tasa de errores | < 1% | < 5% |
| Throughput | > 50 req/s | > 20 req/s |

Si la prueba de 100 VUs pasa estos criterios → **la app está lista para producción multi-congregación**.

---

*Plan creado: 9 marzo 2026 — Basado en PRUEBA_DE_CARGA.md*
