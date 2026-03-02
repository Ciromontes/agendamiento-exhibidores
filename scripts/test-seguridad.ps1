# =============================================================
# test-seguridad.ps1
# Auditoría de seguridad automatizada — Exhibidores App
# Basada en CIBERSEGURIDAD.md § 6 (8 tests)
#
# SEGURIDAD DEL SCRIPT: cero riesgo de daño a datos reales.
#   - Tests de escritura usan UUIDs falsos o condiciones que
#     no coinciden con ningún dato real.
#   - El objetivo de cada test es ver si devuelve 403 (✅ BLOQUEADO)
#     o 200/201 (🔴 ABIERTO), no ejecutar cambios reales.
# =============================================================

$URL = "https://hffjoeeahqcpphgndkfc.supabase.co"
$KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZmpvZWVhaHFjcHBoZ25ka2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNTEyMDIsImV4cCI6MjA4NzcyNzIwMn0.TJP3jFCrzx1qZmL1jRGKeamCNVqgTUxVnxAN0BVu53I"

# UUID imposible — no existe en la BD, evita modificar datos reales
$FAKE_UUID = "00000000-0000-0000-0000-000000000000"

$headers = @{
    "apikey"        = $KEY
    "Authorization" = "Bearer $KEY"
    "Content-Type"  = "application/json"
    "Prefer"        = "return=representation"
}

$resultados = @()

function Evaluar {
    param($nombre, $severidad, $response, $statusCode, $modoFallo)
    # modoFallo: "200" = falla si devuelve 200/201 con datos, "403" = falla si no devuelve 403
    $pass = $false
    $detalle = ""

    if ($modoFallo -eq "no_datos") {
        # Falla si la respuesta contiene datos sensibles (como access_key)
        if ($statusCode -eq 200 -and $response -match '"access_key"') {
            $pass = $false
            $detalle = "EXPUESTO: la respuesta contiene access_key"
        } elseif ($statusCode -eq 200 -and $response -notmatch '"access_key"') {
            $pass = $true
            $detalle = "access_key no aparece en la respuesta"
        } else {
            $pass = $true
            $detalle = "HTTP $statusCode — acceso bloqueado"
        }
    } elseif ($modoFallo -eq "bloqueo_escritura") {
        # Falla si devuelve 200/201 (escritura permitida) en lugar de error
        if ($statusCode -in @(200, 201, 204)) {
            $pass = $false
            $detalle = "HTTP $statusCode — escritura NO bloqueada por RLS"
        } else {
            $pass = $true
            $detalle = "HTTP $statusCode — escritura bloqueada correctamente"
        }
    } elseif ($modoFallo -eq "sql_injection") {
        # Debe devolver [] o error, nunca un error de SQL
        if ($response -match "syntax error|unexpected|DROP|ERROR") {
            $pass = $false
            $detalle = "Posible error SQL filtrado en la respuesta"
        } else {
            $pass = $true
            $detalle = "Respuesta segura: $($response.Substring(0, [Math]::Min(60, $response.Length)))..."
        }
    }

    $icono  = if ($pass) { "✅ PASS" } else { "🔴 FAIL" }
    $sev    = "[$severidad]"

    Write-Host ""
    Write-Host "──────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "$icono  $sev $nombre" -ForegroundColor $(if ($pass) { "Green" } else { "Red" })
    Write-Host "   $detalle" -ForegroundColor $(if ($pass) { "Gray" } else { "Yellow" })

    $resultados += [PSCustomObject]@{
        Test      = $nombre
        Severidad = $severidad
        Resultado = if ($pass) { "PASS" } else { "FAIL" }
        Detalle   = $detalle
        HTTP      = $statusCode
    }
    return $resultados
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🔒 AUDITORÍA DE SEGURIDAD — Exhibidores App          " -ForegroundColor Cyan
Write-Host "  Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan

# ─────────────────────────────────────────────────────────────
# TEST 1: ¿Se exponen los access_keys? (CRÍTICO)
# Busca si el campo access_key aparece en una respuesta pública.
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 1/9 — Exposición de access_keys..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/users?select=name,access_key&limit=3" `
        -Headers $headers -ErrorAction Stop
    $resultados = Evaluar "Exposición de access_keys" "CRÍTICO" $r.Content $r.StatusCode "no_datos"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $resultados = Evaluar "Exposición de access_keys" "CRÍTICO" "" $code "no_datos"
}

# ─────────────────────────────────────────────────────────────
# TEST 2: Escalación de privilegios — ¿puedo hacerme admin? (CRÍTICO)
# Usa UUID falso → si RLS bloquea devuelve 403/401.
# Si RLS está abierto devuelve 200 con [] (array vacío, sin daño).
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 2/9 — Escalación de privilegios..." -ForegroundColor White
try {
    $body = '{"is_admin": true}'
    $r = Invoke-WebRequest "$URL/rest/v1/users?id=eq.$FAKE_UUID" `
        -Method PATCH -Headers $headers -Body $body -ErrorAction Stop
    $resultados = Evaluar "Escalación de privilegios (is_admin)" "CRÍTICO" $r.Content $r.StatusCode "bloqueo_escritura"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $resultados = Evaluar "Escalación de privilegios (is_admin)" "CRÍTICO" "" $code "bloqueo_escritura"
}

# ─────────────────────────────────────────────────────────────
# TEST 3: Impersonación — ¿puedo crear reserva como otro usuario? (CRÍTICO)
# Usa UUIDs falsos → si llega a BD falla por FK, pero el interés
# es si RLS lo bloquea ANTES (403) o lo deja pasar (400/409 por FK).
# 400/409 = RLS abierto (llegó a la BD). 403 = RLS bloqueó.
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 3/9 — Impersonación en reservas..." -ForegroundColor White
$body3 = "{`"time_slot_id`":`"$FAKE_UUID`",`"user_id`":`"$FAKE_UUID`",`"week_start`":`"2026-03-02`",`"status`":`"confirmed`",`"slot_position`":1}"
try {
    $r = Invoke-WebRequest "$URL/rest/v1/reservations" `
        -Method POST -Headers $headers -Body $body3 -ErrorAction Stop
    $resultados = Evaluar "Impersonación en reservas (INSERT)" "CRÍTICO" $r.Content $r.StatusCode "bloqueo_escritura"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    # 400/409 = llegó a la BD (RLS abierto, FK rechazó). 403 = RLS bloqueó.
    if ($code -in @(400, 409, 422)) {
        Write-Host ""
        Write-Host "──────────────────────────────────────────" -ForegroundColor DarkGray
        Write-Host "🔴 FAIL  [CRÍTICO] Impersonación en reservas (INSERT)" -ForegroundColor Red
        Write-Host "   HTTP $code — RLS NO bloqueó. La request llegó a la BD" -ForegroundColor Yellow
        Write-Host "   (FK violation o bad request, pero RLS no protegió)" -ForegroundColor Yellow
        $resultados += [PSCustomObject]@{ Test="Impersonación en reservas (INSERT)"; Severidad="CRÍTICO"; Resultado="FAIL"; Detalle="HTTP $code — RLS abierto, FK rechazó"; HTTP=$code }
    } else {
        $resultados = Evaluar "Impersonación en reservas (INSERT)" "CRÍTICO" "" $code "bloqueo_escritura"
    }
}

# ─────────────────────────────────────────────────────────────
# TEST 4: Borrado masivo — ¿puedo borrar reservas? (ALTO)
# Condición imposible: status='__TEST_ONLY__' no existe en la BD.
# Si RLS abierto: devuelve 200 con 0 filas afectadas (sin daño).
# Si RLS bloqueado: devuelve 403.
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 4/9 — Borrado masivo de reservas..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/reservations?status=eq.__TEST_ONLY_NONEXISTENT__" `
        -Method DELETE -Headers $headers -ErrorAction Stop
    $resultados = Evaluar "Borrado masivo de reservas (DELETE)" "ALTO" $r.Content $r.StatusCode "bloqueo_escritura"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $resultados = Evaluar "Borrado masivo de reservas (DELETE)" "ALTO" "" $code "bloqueo_escritura"
}

# ─────────────────────────────────────────────────────────────
# TEST 5: Modificación de configuración global (ALTO)
# Usa UUID imposible como filtro → 0 filas afectadas si RLS abierto.
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 5/9 — Modificación de app_config..." -ForegroundColor White
try {
    $body5 = '{"counting_mode": "__TEST_ONLY__"}'
    $r = Invoke-WebRequest "$URL/rest/v1/app_config?id=eq.$FAKE_UUID" `
        -Method PATCH -Headers $headers -Body $body5 -ErrorAction Stop
    $resultados = Evaluar "Modificación de app_config (UPDATE)" "ALTO" $r.Content $r.StatusCode "bloqueo_escritura"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $resultados = Evaluar "Modificación de app_config (UPDATE)" "ALTO" "" $code "bloqueo_escritura"
}

# ─────────────────────────────────────────────────────────────
# TEST 6: Inyección SQL vía access_key (BAJO)
# Verifica que Supabase parametrice correctamente y devuelva []
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 6/9 — Inyección SQL vía access_key..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/users?access_key=eq.';DROP TABLE users;--&is_active=eq.true&select=id" `
        -Headers $headers -ErrorAction Stop
    $resultados = Evaluar "Inyección SQL vía access_key" "BAJO" $r.Content $r.StatusCode "sql_injection"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $resultados = Evaluar "Inyección SQL vía access_key" "BAJO" "" $code "sql_injection"
}

# ─────────────────────────────────────────────────────────────
# TEST 7: XSS — ¿puedo guardar HTML/JS en un campo? (MEDIO)
# Usa UUID falso → incluso si RLS abierto no modifica datos reales.
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 7/9 — XSS en campos de texto..." -ForegroundColor White
try {
    $body7 = '{"name": "<script>alert(1)</script>"}'
    $r = Invoke-WebRequest "$URL/rest/v1/users?id=eq.$FAKE_UUID" `
        -Method PATCH -Headers $headers -Body $body7 -ErrorAction Stop
    $resultados = Evaluar "XSS en campos (UPDATE con HTML)" "MEDIO" $r.Content $r.StatusCode "bloqueo_escritura"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $resultados = Evaluar "XSS en campos (UPDATE con HTML)" "MEDIO" "" $code "bloqueo_escritura"
}

# ─────────────────────────────────────────────────────────────# TEST 8: Rate limiting en /api/auth/login (ALTO)
# Dispara 12 intentos de login fallidos seguidos.
# A partir del intento 11 debe recibir HTTP 429.
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 8/9 — Rate limiting en /api/auth/login..." -ForegroundColor White
$APP_URL = "https://exhibidores-app.vercel.app"
$got429 = $false
$intentos = 12
for ($i = 1; $i -le $intentos; $i++) {
    try {
        $r = Invoke-WebRequest "$APP_URL/api/auth/login" `
            -Method POST `
            -Headers @{ "Content-Type" = "application/json" } `
            -Body '{"access_key":"__RATE_LIMIT_TEST__"}' `
            -ErrorAction Stop
        # 200 no esperado aquí (clave falsa)
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 429) { $got429 = $true; break }
    }
}

Write-Host ""
Write-Host "──────────────────────────────────────────" -ForegroundColor DarkGray
if ($got429) {
    Write-Host "✅ PASS  [ALTO] Rate limiting en /api/auth/login" -ForegroundColor Green
    Write-Host "   HTTP 429 recibido en el intento ≤ $intentos — brute force bloqueado" -ForegroundColor Gray
    $resultados += [PSCustomObject]@{ Test="Rate limiting /api/auth/login"; Severidad="ALTO"; Resultado="PASS"; Detalle="429 recibido correctamente"; HTTP=429 }
} else {
    Write-Host "🔴 FAIL  [ALTO] Rate limiting en /api/auth/login" -ForegroundColor Red
    Write-Host "   $intentos intentos fallidos sin recibir 429 — sin protección brute force" -ForegroundColor Yellow
    $resultados += [PSCustomObject]@{ Test="Rate limiting /api/auth/login"; Severidad="ALTO"; Resultado="FAIL"; Detalle="Sin 429 tras $intentos intentos"; HTTP=401 }
}

# ─────────────────────────────────────────────────────────────# TEST 8: Headers de seguridad HTTP (MEDIO)
# Verifica que Vercel devuelva los headers OWASP recomendados.
# ─────────────────────────────────────────────────────────────
Write-Host "`nTest 9/9 — Headers de seguridad HTTP..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "https://exhibidores-app.vercel.app/" -Method HEAD -ErrorAction Stop
    $h = $r.Headers
    $tieneHSTS    = $h.ContainsKey("Strict-Transport-Security")
    $tieneXCTO    = $h.ContainsKey("X-Content-Type-Options")
    $tieneCSP     = $h.ContainsKey("Content-Security-Policy")
    $ok = $tieneHSTS -and $tieneXCTO

    Write-Host ""
    Write-Host "──────────────────────────────────────────" -ForegroundColor DarkGray
    if ($ok) {
        Write-Host "✅ PASS  [MEDIO] Headers de seguridad HTTP" -ForegroundColor Green
    } else {
        Write-Host "🔴 FAIL  [MEDIO] Headers de seguridad HTTP" -ForegroundColor Red
    }
    Write-Host "   Strict-Transport-Security : $(if ($tieneHSTS) {'✅'} else {'❌ FALTA'})"  -ForegroundColor Gray
    Write-Host "   X-Content-Type-Options    : $(if ($tieneXCTO) {'✅'} else {'❌ FALTA'})"  -ForegroundColor Gray
    Write-Host "   Content-Security-Policy   : $(if ($tieneCSP)  {'✅'} else {'⚠️  FALTA (recomendado)'})" -ForegroundColor Gray

    $resultados += [PSCustomObject]@{ Test="Headers HTTP (HSTS+XCTO)"; Severidad="MEDIO"; Resultado=if($ok){"PASS"}else{"FAIL"}; Detalle="HSTS:$tieneHSTS XCTO:$tieneXCTO CSP:$tieneCSP"; HTTP=200 }
} catch {
    Write-Host "🔴 ERROR al conectar con https://exhibidores-app.vercel.app" -ForegroundColor Red
}

# ─────────────────────────────────────────────────────────────
# RESUMEN FINAL
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  RESUMEN DE RESULTADOS" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan

$pass = ($resultados | Where-Object { $_.Resultado -eq "PASS" }).Count
$fail = ($resultados | Where-Object { $_.Resultado -eq "FAIL" }).Count

$resultados | Format-Table -AutoSize Test, Severidad, Resultado, HTTP

Write-Host "  ✅ PASS: $pass   🔴 FAIL: $fail   Total: $($resultados.Count)" -ForegroundColor White
Write-Host ""

if ($fail -eq 0) {
    Write-Host "  🎉 Todos los tests pasaron. Buena seguridad." -ForegroundColor Green
} elseif ($fail -le 2) {
    Write-Host "  ⚠️  Hay $fail vulnerabilidades. Revisa los FAIL con tu IA." -ForegroundColor Yellow
} else {
    Write-Host "  🔴 $fail vulnerabilidades detectadas. Se requiere remediación urgente." -ForegroundColor Red
}

Write-Host ""
Write-Host "  Copia este resumen y pégalo en el chat con la IA." -ForegroundColor DarkGray
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
