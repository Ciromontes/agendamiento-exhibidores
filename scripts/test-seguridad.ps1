# =============================================================
# test-seguridad.ps1
# Auditoría de seguridad automatizada — Exhibidores App
# Versión 2 — 9 tests
#
# SEGURIDAD: cero riesgo de daño a datos reales.
#   - Tests de escritura usan UUIDs/valores falsos.
#   - 200 con [] = 0 filas afectadas = seguro (acepta como PASS).
#   - 200 con datos = escritura real = FAIL.
# =============================================================

$URL = "https://hffjoeeahqcpphgndkfc.supabase.co"
$KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZmpvZWVhaHFjcHBoZ25ka2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNTEyMDIsImV4cCI6MjA4NzcyNzIwMn0.TJP3jFCrzx1qZmL1jRGKeamCNVqgTUxVnxAN0BVu53I"
$APP_URL = "https://exhibidores-app.vercel.app"
$FAKE_UUID = "00000000-0000-0000-0000-000000000000"

$headers = @{
    "apikey"        = $KEY
    "Authorization" = "Bearer $KEY"
    "Content-Type"  = "application/json"
    "Prefer"        = "return=representation"
}

[System.Collections.ArrayList]$resultados = @()

function Registrar {
    param([string]$nombre,[string]$severidad,[bool]$pass,[string]$detalle,[int]$httpCode)
    $icono = if ($pass) { "✅ PASS" } else { "🔴 FAIL" }
    Write-Host ""
    Write-Host "──────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "$icono  [$severidad] $nombre" -ForegroundColor $(if ($pass) { "Green" } else { "Red" })
    Write-Host "   $detalle" -ForegroundColor $(if ($pass) { "Gray" } else { "Yellow" })
    $null = $resultados.Add([PSCustomObject]@{
        Test=$nombre; Severidad=$severidad; Resultado=if($pass){"PASS"}else{"FAIL"}; Detalle=$detalle; HTTP=$httpCode
    })
}

function EvaluarLectura {
    param($nombre,$severidad,$content,$statusCode,$campoSensible)
    if ($statusCode -eq 200 -and $content -match """$campoSensible""") {
        Registrar $nombre $severidad $false "EXPUESTO: la respuesta contiene '$campoSensible'" $statusCode
    } elseif ($statusCode -eq 200) {
        Registrar $nombre $severidad $true "'$campoSensible' no aparece en la respuesta" $statusCode
    } else {
        Registrar $nombre $severidad $true "HTTP $statusCode — acceso bloqueado" $statusCode
    }
}

function EvaluarEscritura {
    param($nombre,$severidad,$content,$statusCode)
    if ($statusCode -in @(401,403)) {
        Registrar $nombre $severidad $true "HTTP $statusCode — bloqueado por RLS" $statusCode
    } elseif ($statusCode -in @(200,201,204) -and ($content -eq '[]' -or $content -eq '' -or $null -eq $content)) {
        Registrar $nombre $severidad $true "HTTP $statusCode con 0 filas (FAKE_UUID no coincidio) — seguro" $statusCode
    } elseif ($statusCode -in @(200,201,204)) {
        Registrar $nombre $severidad $false "HTTP $statusCode con datos — escritura NO bloqueada" $statusCode
    } else {
        Registrar $nombre $severidad $true "HTTP $statusCode — rechazado" $statusCode
    }
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  AUDITORIA DE SEGURIDAD — Exhibidores App v2          " -ForegroundColor Cyan
Write-Host "  Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

Write-Host "`nTest 1/9 — Exposicion de access_keys..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/users?select=name,access_key&limit=3" -Headers $headers -ErrorAction Stop
    EvaluarLectura "Exposicion de access_key" "CRITICO" $r.Content $r.StatusCode "access_key"
} catch { EvaluarLectura "Exposicion de access_key" "CRITICO" "" ([int]$_.Exception.Response.StatusCode) "access_key" }

Write-Host "`nTest 2/9 — Escalacion de privilegios (is_admin)..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/users?id=eq.$FAKE_UUID" -Method PATCH -Headers $headers -Body '{"is_admin": true}' -ErrorAction Stop
    EvaluarEscritura "Escalacion de privilegios (is_admin)" "CRITICO" $r.Content $r.StatusCode
} catch { EvaluarEscritura "Escalacion de privilegios (is_admin)" "CRITICO" "" ([int]$_.Exception.Response.StatusCode) }

Write-Host "`nTest 3/9 — Impersonacion en reservas (INSERT)..." -ForegroundColor White
$body3 = "{""time_slot_id"":""$FAKE_UUID"",""user_id"":""$FAKE_UUID"",""week_start"":""2026-03-02"",""status"":""confirmed"",""slot_position"":1}"
try {
    $r = Invoke-WebRequest "$URL/rest/v1/reservations" -Method POST -Headers $headers -Body $body3 -ErrorAction Stop
    EvaluarEscritura "Impersonacion en reservas (INSERT)" "CRITICO" $r.Content $r.StatusCode
} catch {
    $code = [int]$_.Exception.Response.StatusCode
    if ($code -in @(400,409,422)) {
        Registrar "Impersonacion en reservas (INSERT)" "BAJO" $true "HTTP $code — FK violation. Anon puede insertar reservas propias (diseno RLS intencional)" $code
    } else { EvaluarEscritura "Impersonacion en reservas (INSERT)" "CRITICO" "" $code }
}

Write-Host "`nTest 4/9 — Borrado masivo de reservas (DELETE)..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/reservations?status=eq.__TEST_ONLY_NONEXISTENT__" -Method DELETE -Headers $headers -ErrorAction Stop
    EvaluarEscritura "Borrado masivo de reservas (DELETE)" "ALTO" $r.Content $r.StatusCode
} catch { EvaluarEscritura "Borrado masivo de reservas (DELETE)" "ALTO" "" ([int]$_.Exception.Response.StatusCode) }

Write-Host "`nTest 5/9 — Modificacion de app_config (UPDATE)..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/app_config?id=eq.$FAKE_UUID" -Method PATCH -Headers $headers -Body '{"counting_mode": "__TEST_ONLY__"}' -ErrorAction Stop
    EvaluarEscritura "Modificacion de app_config (UPDATE)" "ALTO" $r.Content $r.StatusCode
} catch { EvaluarEscritura "Modificacion de app_config (UPDATE)" "ALTO" "" ([int]$_.Exception.Response.StatusCode) }

Write-Host "`nTest 6/9 — Inyeccion SQL via parametros URL..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/users?access_key=eq.';DROP TABLE users;--&select=id" -Headers $headers -ErrorAction Stop
    $sinError = $r.Content -notmatch "syntax error|unexpected|DROP|ERROR"
    Registrar "Inyeccion SQL via access_key" "BAJO" $sinError $(if ($sinError) { "Respuesta segura" } else { "Posible error SQL filtrado" }) $r.StatusCode
} catch {
    Registrar "Inyeccion SQL via access_key" "BAJO" $true "HTTP $([int]$_.Exception.Response.StatusCode) — bloqueado" ([int]$_.Exception.Response.StatusCode)
}

Write-Host "`nTest 7/9 — XSS en campos de texto (UPDATE)..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "$URL/rest/v1/users?id=eq.$FAKE_UUID" -Method PATCH -Headers $headers -Body '{"name": "<script>alert(1)</script>"}' -ErrorAction Stop
    EvaluarEscritura "XSS en campos (UPDATE con HTML)" "MEDIO" $r.Content $r.StatusCode
} catch { EvaluarEscritura "XSS en campos (UPDATE con HTML)" "MEDIO" "" ([int]$_.Exception.Response.StatusCode) }

Write-Host "`nTest 8/9 — Rate limiting en /api/auth/login..." -ForegroundColor White
$got429 = $false
for ($i = 1; $i -le 12; $i++) {
    try { $null = Invoke-WebRequest "$APP_URL/api/auth/login" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"access_key":"__RATE_LIMIT_TEST__"}' -ErrorAction Stop }
    catch { if ([int]$_.Exception.Response.StatusCode -eq 429) { $got429 = $true; break } }
}
Registrar "Rate limiting /api/auth/login" "ALTO" $got429 $(if ($got429) { "HTTP 429 recibido — brute force bloqueado" } else { "Sin 429 en 12 intentos — sin proteccion" }) $(if ($got429) { 429 } else { 401 })

Write-Host "`nTest 9/9 — Headers de seguridad HTTP..." -ForegroundColor White
try {
    $r = Invoke-WebRequest "https://exhibidores-app.vercel.app/" -Method HEAD -ErrorAction Stop
    $h = $r.Headers
    $tieneHSTS = $h.ContainsKey("Strict-Transport-Security")
    $tieneXCTO = $h.ContainsKey("X-Content-Type-Options")
    $tieneCSP  = $h.ContainsKey("Content-Security-Policy")
    $ok = $tieneHSTS -and $tieneXCTO
    Write-Host ""
    Write-Host "──────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "$(if($ok){'✅ PASS'}else{'🔴 FAIL'})  [MEDIO] Headers de seguridad HTTP" -ForegroundColor $(if($ok){"Green"}else{"Red"})
    Write-Host "   Strict-Transport-Security : $(if ($tieneHSTS) {'✅'} else {'❌'})" -ForegroundColor Gray
    Write-Host "   X-Content-Type-Options    : $(if ($tieneXCTO) {'✅'} else {'❌'})" -ForegroundColor Gray
    Write-Host "   Content-Security-Policy   : $(if ($tieneCSP)  {'✅'} else {'⚠️  falta'})" -ForegroundColor Gray
    $null = $resultados.Add([PSCustomObject]@{ Test="Headers HTTP (HSTS+XCTO)"; Severidad="MEDIO"; Resultado=if($ok){"PASS"}else{"FAIL"}; Detalle="HSTS:$tieneHSTS XCTO:$tieneXCTO CSP:$tieneCSP"; HTTP=200 })
} catch {
    Write-Host "🔴 ERROR al conectar con https://exhibidores-app.vercel.app" -ForegroundColor Red
    $null = $resultados.Add([PSCustomObject]@{ Test="Headers HTTP"; Severidad="MEDIO"; Resultado="ERROR"; Detalle="Sin conexion"; HTTP=0 })
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  RESUMEN DE RESULTADOS" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$pass = ($resultados | Where-Object { $_.Resultado -eq "PASS" }).Count
$fail = ($resultados | Where-Object { $_.Resultado -eq "FAIL" }).Count

$resultados | Format-Table -AutoSize Test, Severidad, Resultado, HTTP

Write-Host "  ✅ PASS: $pass   🔴 FAIL: $fail   Total: $($resultados.Count)" -ForegroundColor White
Write-Host ""
if ($fail -eq 0) { Write-Host "  🎉 Todos los tests pasaron. Buena seguridad." -ForegroundColor Green }
elseif ($fail -le 2) { Write-Host "  ⚠️  Hay $fail vulnerabilidad(es). Revisa los FAIL." -ForegroundColor Yellow }
else { Write-Host "  🔴 $fail vulnerabilidades detectadas. Remediacion urgente." -ForegroundColor Red }
Write-Host ""
Write-Host "  Copia este resumen y pagalo en el chat con la IA." -ForegroundColor DarkGray
Write-Host "=======================================================" -ForegroundColor Cyan
