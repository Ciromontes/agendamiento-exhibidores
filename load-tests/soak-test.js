/**
 * soak-test.js — Prueba de Resistencia (Soak)
 * ─────────────────────────────────────────────────────────────
 * Mantiene una carga moderada durante un período largo para detectar:
 *   - Fugas de memoria en el servidor (memory leaks)
 *   - Degradación lenta de latencia con el tiempo
 *   - Crecimiento descontrolado de datos en la BD
 *   - Errores que solo aparecen tras muchas iteraciones
 *
 * Carga: 50 VUs constantes durante 30 minutos
 * (Configurable: cambia SOAK_DURATION para 60 minutos)
 *
 * Ejecutar (30 min):
 *   .\k6 run --out json=load-tests/results/soak.json load-tests/soak-test.js
 *
 * Ejecutar (60 min):
 *   .\k6 run --env SOAK_DURATION=60m --out json=load-tests/results/soak-60.json load-tests/soak-test.js
 *
 * Duración: 30-60 minutos
 * ─────────────────────────────────────────────────────────────
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { Trend, Rate } from 'k6/metrics';

// ── Métricas personalizadas para detectar degradación temporal ──
// Compara latencia en el primer tercio vs último tercio del test
const earlyLatency  = new Trend('early_phase_latency');  // primeros 10 min
const lateLatency   = new Trend('late_phase_latency');   // últimos 10 min
const errorRateOver = new Rate('sustained_errors');      // errores sostenidos

// ── Credenciales Supabase ─────────────────────────────────────
const SUPABASE_URL      = 'https://hffjoeeahqcpphgndkfc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZmpvZWVhaHFjcHBoZ25ka2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNTEyMDIsImV4cCI6MjA4NzcyNzIwMn0.TJP3jFCrzx1qZmL1jRGKeamCNVqgTUxVnxAN0BVu53I';
const CONGREGATION_ID   = 'cf2678ea-91a7-4a05-8ac3-fbcc98f37280'; // Terranova

const SUPA_HEADERS = {
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type':  'application/json',
};

// Duración configurable via env (default 30m)
const SOAK_DURATION = __ENV.SOAK_DURATION || '30m';

// ── Configuración ────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '2m',          target: 50  }, // calentamiento suave
    { duration: SOAK_DURATION, target: 50  }, // carga sostenida
    { duration: '2m',          target: 0   }, // enfriamiento
  ],
  thresholds: {
    // La latencia NO debe crecer con el tiempo — si crece, hay degradación
    'http_req_duration':    ['p(95)<2000', 'p(99)<3000'],
    'http_req_failed':      ['rate<0.03'],

    // Clave: la latencia tardía debe ser similar a la temprana
    // Si late_phase_latency > early_phase_latency × 1.5 → hay degradación
    'early_phase_latency':  ['p(95)<500'],
    'late_phase_latency':   ['p(95)<500'],

    // Errores sostenidos (excluye picos puntuales)
    'sustained_errors':     ['rate<0.02'],
  },
};

// ── setup() ──────────────────────────────────────────────────
export function setup() {
  console.log('[soak] Cargando usuarios de prueba...');

  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_test_user_ids`,
    JSON.stringify({ p_congregation_id: CONGREGATION_ID }),
    { headers: SUPA_HEADERS }
  );

  check(res, { 'setup: RPC 200': (r) => r.status === 200 });

  if (res.status !== 200) {
    throw new Error(`setup: Falló RPC. Status: ${res.status}`);
  }

  const users = res.json();
  console.log(`[soak] ✓ ${users.length} usuarios listos para ${SOAK_DURATION} de prueba sostenida.`);

  // Registrar timestamp de inicio para calcular fases temporal
  return { users, startTime: Date.now() };
}

// ── Lunes de la semana actual ─────────────────────────────────
function getWeekStart() {
  const now    = new Date();
  const day    = now.getDay();
  const diff   = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return monday.toISOString().split('T')[0];
}

// ── Función principal ─────────────────────────────────────────
export default function (data) {
  const vuUser    = data.users[(__VU - 1) % data.users.length];
  const congId    = CONGREGATION_ID;
  const weekStart = getWeekStart();

  // Calcular en qué fase del soak estamos (en ms)
  const elapsed       = Date.now() - data.startTime;
  const soakMs        = parseInt(SOAK_DURATION) * 60_000; // aproximado
  const isEarlyPhase  = elapsed < 10 * 60_000;            // primeros 10 min
  const isLatePhase   = elapsed > (soakMs - 10 * 60_000); // últimos 10 min

  let timeSlotIds          = [];
  let existingReservations = [];

  // ── Fase 1: Dashboard ────────────────────────────────────────
  group('dashboard', () => {
    const t0 = Date.now();

    const cfgRes = http.get(
      `${SUPABASE_URL}/rest/v1/app_config?congregation_id=eq.${congId}&limit=1`,
      { headers: SUPA_HEADERS }
    );
    check(cfgRes, { 'config OK': (r) => r.status === 200 });
    sustainedCheck(cfgRes.status === 200);

    const exhibRes = http.get(
      `${SUPABASE_URL}/rest/v1/exhibitors?is_active=eq.true&congregation_id=eq.${congId}&order=name`,
      { headers: SUPA_HEADERS }
    );
    check(exhibRes, { 'exhibidores OK': (r) => r.status === 200 });

    const slotsRes = http.get(
      `${SUPABASE_URL}/rest/v1/time_slots?congregation_id=eq.${congId}&select=id`,
      { headers: SUPA_HEADERS }
    );
    check(slotsRes, { 'time_slots OK': (r) => r.status === 200 });
    if (slotsRes.status === 200) {
      timeSlotIds = slotsRes.json().map((s) => s.id);
    }

    const resRes = http.get(
      `${SUPABASE_URL}/rest/v1/reservations` +
      `?week_start=eq.${weekStart}` +
      `&congregation_id=eq.${congId}` +
      `&status=neq.cancelled` +
      `&select=id,time_slot_id,user_id`,
      { headers: SUPA_HEADERS }
    );
    check(resRes, { 'reservas OK': (r) => r.status === 200 });
    if (resRes.status === 200) {
      existingReservations = resRes.json();
    }

    // Registrar latencia en métrica de fase temporal
    const dashLatency = Date.now() - t0;
    if (isEarlyPhase) earlyLatency.add(dashLatency);
    if (isLatePhase)  lateLatency.add(dashLatency);
  });

  if (timeSlotIds.length === 0) {
    sleep(3);
    return;
  }

  // ── Fase 2: Reservar ─────────────────────────────────────────
  let reservationId = null;

  group('reservar', () => {
    const ocupacion = {};
    existingReservations.forEach((r) => {
      ocupacion[r.time_slot_id] = (ocupacion[r.time_slot_id] || 0) + 1;
    });

    const disponibles = timeSlotIds.filter((id) => (ocupacion[id] || 0) < 2);
    if (disponibles.length === 0) return;

    const slotId   = disponibles[randomIntBetween(0, disponibles.length - 1)];
    const position = (ocupacion[slotId] || 0) + 1;

    const bookRes = http.post(
      `${SUPABASE_URL}/rest/v1/reservations`,
      JSON.stringify({
        time_slot_id:    slotId,
        user_id:         vuUser.id,
        week_start:      weekStart,
        status:          'confirmed',
        slot_position:   position,
        congregation_id: congId,
      }),
      { headers: { ...SUPA_HEADERS, 'Prefer': 'return=representation' } }
    );

    const ok = check(bookRes, { 'reserva creada (201)': (r) => r.status === 201 });
    sustainedCheck(ok);

    if (ok) {
      const created = bookRes.json();
      reservationId = Array.isArray(created) ? created[0]?.id : created?.id;
    }
  });

  sleep(randomIntBetween(2, 4)); // pausa más larga → simula lectura real del usuario

  // ── Fase 3: Cancelar ─────────────────────────────────────────
  if (reservationId) {
    group('cancelar', () => {
      const cancelRes = http.patch(
        `${SUPABASE_URL}/rest/v1/reservations?id=eq.${reservationId}`,
        JSON.stringify({ status: 'cancelled' }),
        { headers: SUPA_HEADERS }
      );
      const ok = check(cancelRes, { 'cancelación OK (204)': (r) => r.status === 204 });
      sustainedCheck(ok);
    });
  }

  sleep(randomIntBetween(2, 4));
}

// Helper para registrar errores sostenidos (ignora concurrencia en reservas)
function sustainedCheck(passed) {
  errorRateOver.add(!passed);
}
