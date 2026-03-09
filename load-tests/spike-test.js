/**
 * spike-test.js — Prueba de Pico (Spike)
 * ─────────────────────────────────────────────────────────────
 * Simula una llegada masiva e instantánea de usuarios (0 → 100 en 5s)
 * para medir cómo reacciona Supabase ante un pico repentino de tráfico.
 *
 * Caso de uso real: todos los hermanos de una congregación abren la app
 * al mismo tiempo justo cuando se anuncia que los turnos están disponibles.
 *
 * Fases:
 *   00:00 → 00:05   0 → 100 VUs  (pico instantáneo)
 *   00:05 → 02:05   100 VUs      (sostenido 2 min)
 *   02:05 → 02:35   100 → 0 VUs  (bajada)
 *
 * Lo que medimos:
 *   - ¿Cuánto sube la latencia en el impacto inicial?
 *   - ¿Cuántos requests fallan en los primeros 10 segundos?
 *   - ¿Se recupera Supabase rápidamente una vez absorbido el pico?
 *
 * Ejecutar:
 *   .\k6 run --out json=load-tests/results/spike.json load-tests/spike-test.js
 *
 * Duración total: ~3 minutos
 * ─────────────────────────────────────────────────────────────
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { Trend } from 'k6/metrics';

// ── Métricas personalizadas para medir el impacto del pico ───
const spikeLatency    = new Trend('spike_phase_latency');   // latencia durante el pico
const recoveryLatency = new Trend('recovery_phase_latency'); // latencia en la recuperación

// ── Credenciales Supabase ─────────────────────────────────────
const SUPABASE_URL      = 'https://hffjoeeahqcpphgndkfc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZmpvZWVhaHFjcHBoZ25ka2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNTEyMDIsImV4cCI6MjA4NzcyNzIwMn0.TJP3jFCrzx1qZmL1jRGKeamCNVqgTUxVnxAN0BVu53I';
const CONGREGATION_ID   = 'cf2678ea-91a7-4a05-8ac3-fbcc98f37280'; // Terranova

const SUPA_HEADERS = {
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type':  'application/json',
};

// ── Configuración del spike ───────────────────────────────────
export const options = {
  stages: [
    { duration: '5s',  target: 100 }, // ← pico: 0 a 100 VUs en 5 segundos
    { duration: '2m',  target: 100 }, // sostenido
    { duration: '30s', target: 0   }, // bajada
  ],
  thresholds: {
    // Durante el pico se tolera más latencia que en carga normal
    'http_req_duration':      ['p(95)<3000', 'p(99)<5000'],
    'http_req_failed':        ['rate<0.05'],
    // Métricas personalizadas: comparar pico vs recuperación
    'spike_phase_latency':    ['p(95)<3000'],
    'recovery_phase_latency': ['p(95)<1000'], // debe bajar una vez absorbido el pico
  },
};

// ── setup() ──────────────────────────────────────────────────
export function setup() {
  console.log('[spike] Cargando usuarios de prueba...');

  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_test_user_ids`,
    JSON.stringify({ p_congregation_id: CONGREGATION_ID }),
    { headers: SUPA_HEADERS }
  );

  check(res, { 'setup: RPC 200': (r) => r.status === 200 });

  if (res.status !== 200) {
    throw new Error(`setup: Falló RPC. Status: ${res.status}. Body: ${res.body.substring(0, 200)}`);
  }

  const users = res.json();
  console.log(`[spike] ✓ ${users.length} usuarios listos.`);
  return { users };
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

  // Detectar en qué fase estamos según el tiempo transcurrido
  // 0-15s = impacto del pico, >15s = recuperación
  const isSpike = __ITER === 0; // primera iteración de cada VU = durante el pico

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

    // Registrar latencia en la métrica correspondiente a la fase
    const elapsed = Date.now() - t0;
    if (isSpike) {
      spikeLatency.add(elapsed);
    } else {
      recoveryLatency.add(elapsed);
    }
  });

  if (timeSlotIds.length === 0) {
    sleep(2);
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
    if (ok) {
      const created = bookRes.json();
      reservationId = Array.isArray(created) ? created[0]?.id : created?.id;
    }
  });

  sleep(randomIntBetween(1, 2));

  // ── Fase 3: Cancelar ─────────────────────────────────────────
  if (reservationId) {
    group('cancelar', () => {
      const cancelRes = http.patch(
        `${SUPABASE_URL}/rest/v1/reservations?id=eq.${reservationId}`,
        JSON.stringify({ status: 'cancelled' }),
        { headers: SUPA_HEADERS }
      );
      check(cancelRes, { 'cancelación OK (204)': (r) => r.status === 204 });
    });
  }

  sleep(randomIntBetween(1, 2));
}
