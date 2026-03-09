/**
 * stress-test.js — Prueba de Estrés (Ramp hasta el punto de quiebre)
 * ─────────────────────────────────────────────────────────────
 * Sube progresivamente los usuarios virtuales de 10 hasta 300
 * para encontrar el límite del free tier de Supabase + Vercel.
 *
 * ⚠️ AVISO: Esta prueba está diseñada para fallar.
 *    El objetivo es saber CUÁNDO falla, no que todo pase.
 *    Es normal ver errores en las últimas etapas (200-300 VUs).
 *
 * Ejecutar:
 *   k6 run load-tests/stress-test.js
 *
 * Con output JSON:
 *   k6 run --out json=load-tests/results/stress.json load-tests/stress-test.js
 *
 * Stages:
 *   0:00 → 0:30   10 VUs   (calentamiento)
 *   0:30 → 1:30   50 VUs   (carga normal)
 *   1:30 → 2:30   100 VUs  (carga alta)
 *   2:30 → 3:30   200 VUs  (stress)
 *   3:30 → 4:00   300 VUs  (punto de quiebre)
 *   4:00 → 5:00   0 VUs    (enfriamiento)
 * ─────────────────────────────────────────────────────────────
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Configuración de conexión ─────────────────────────────────
const SUPABASE_URL      = 'https://hffjoeeahqcpphgndkfc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZmpvZWVhaHFjcHBoZ25ka2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNTEyMDIsImV4cCI6MjA4NzcyNzIwMn0.TJP3jFCrzx1qZmL1jRGKeamCNVqgTUxVnxAN0BVu53I';
const CONGREGATION_ID   = 'cf2678ea-91a7-4a05-8ac3-fbcc98f37280';

const SUPA_HEADERS = {
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type':  'application/json',
};

// ── Stages del stress test ────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 10  }, // calentamiento
    { duration: '1m',  target: 50  }, // carga normal (≈ producción)
    { duration: '1m',  target: 100 }, // carga alta
    { duration: '1m',  target: 200 }, // stress
    { duration: '30s', target: 300 }, // punto de quiebre
    { duration: '1m',  target: 0   }, // enfriamiento
  ],
  // Thresholds más permisivos que en load-test → el objetivo aquí es ENCONTRAR el límite
  thresholds: {
    'http_req_duration': ['p(95)<3000'], // 3 segundos en stress es aceptable
    'http_req_failed':   ['rate<0.05' ], // hasta 5% de errores tolerables
  },
};

// ── Lunes de la semana actual ─────────────────────────────────
function getWeekStart() {
  const now  = new Date();
  const day  = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return monday.toISOString().split('T')[0];
}

// ── setup() — Carga TODOS los usuarios de prueba UNA SOLA VEZ ─
// Con 300 VUs y solo 100 usuarios, los VUs 101-300 comparten usuarios
// de forma cíclica. Esto es intencional para el stress test.
export function setup() {
  console.log('[stress] Cargando usuarios de prueba vía RPC...');

  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_test_user_ids`,
    JSON.stringify({ p_congregation_id: CONGREGATION_ID }),
    { headers: SUPA_HEADERS }
  );

  check(res, { 'setup: RPC exitoso': (r) => r.status === 200 });

  if (res.status !== 200) {
    throw new Error(
      `[stress] Error RPC get_test_user_ids. Status: ${res.status}. ` +
      `¿Ejecutaste el CREATE FUNCTION en Supabase SQL Editor?\nBody: ${res.body.substring(0, 300)}`
    );
  }

  const users = res.json();
  if (!users || !Array.isArray(users) || users.length === 0) {
    throw new Error('[stress] No se encontraron usuarios en la congregación terranova.');
  }

  console.log(`[stress] ✓ ${users.length} usuarios listos. Con VUs > ${users.length}, se reutilizan cíclicamente.`);
  return { users };
}

// ── Función principal del VU ──────────────────────────────────
export default function (data) {
  // Con __VU hasta 300 pero solo 100 usuarios → módulo 100
  // VU 1→ usuario 0, VU 101 → usuario 0 (reutilizado), VU 201 → usuario 0, etc.
  const vuUser    = data.users[(__VU - 1) % data.users.length];
  const congId    = CONGREGATION_ID;
  const weekStart = getWeekStart();

  let timeSlotIds          = [];
  let existingReservations = [];

  // ── Fase 1: Cargar datos del dashboard ───────────────────────
  group('01_dashboard', () => {
    // Config de la congregación
    http.get(
      `${SUPABASE_URL}/rest/v1/app_config?congregation_id=eq.${congId}&limit=1`,
      { headers: SUPA_HEADERS }
    );

    // Exhibidores activos
    const exhibRes = http.get(
      `${SUPABASE_URL}/rest/v1/exhibitors` +
      `?is_active=eq.true&congregation_id=eq.${congId}&order=name`,
      { headers: SUPA_HEADERS }
    );
    check(exhibRes, { 'exhibidores OK': (r) => r.status === 200 });

    // Time slots
    const slotsRes = http.get(
      `${SUPABASE_URL}/rest/v1/time_slots` +
      `?congregation_id=eq.${congId}&select=id`,
      { headers: SUPA_HEADERS }
    );
    check(slotsRes, { 'time_slots OK': (r) => r.status === 200 });
    if (slotsRes.status === 200) {
      timeSlotIds = slotsRes.json().map((s) => s.id);
    }

    // Reservas activas de la semana
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
  });

  if (timeSlotIds.length === 0) {
    sleep(1);
    return;
  }

  // ── Fase 2: Intentar reservar un turno ───────────────────────
  let reservationId = null;

  group('02_reservar', () => {
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
      {
        headers: { ...SUPA_HEADERS, 'Prefer': 'return=representation' },
      }
    );

    check(bookRes, {
      'reserva creada': (r) => r.status === 201 || r.status === 200,
    });

    if (bookRes.status === 201 || bookRes.status === 200) {
      try {
        const body = bookRes.json();
        reservationId = Array.isArray(body) ? body[0]?.id : body?.id;
      } catch (_) { /* sin ID */ }
    }
  });

  // Pausa corta (stress test → menos espera para generar más presión)
  sleep(randomIntBetween(1, 2));

  // ── Fase 3: Cancelar la reserva ──────────────────────────────
  if (reservationId) {
    group('03_cancelar', () => {
      const cancelRes = http.patch(
        `${SUPABASE_URL}/rest/v1/reservations?id=eq.${reservationId}`,
        JSON.stringify({ status: 'cancelled' }),
        { headers: SUPA_HEADERS }
      );

      check(cancelRes, {
        'cancelación OK': (r) => r.status === 204 || r.status === 200,
      });
    });
  }

  // Pausa mínima entre iteraciones (más presión = menos espera)
  sleep(randomIntBetween(0, 1));
}
