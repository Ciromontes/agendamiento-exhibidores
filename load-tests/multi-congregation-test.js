/**
 * multi-congregation-test.js — Prueba de Carga Multi-Congregación
 * ─────────────────────────────────────────────────────────────────
 * Simula las 3 congregaciones activas usando el sistema al mismo tiempo.
 * Cada congregación corre en su propio escenario k6 con sus propios usuarios.
 *
 * Congregaciones:
 *   - Terranova  (91 usuarios de prueba, 3 exhibidores)
 *   - Principal  (83 usuarios de prueba)
 *   - Milan      (60 usuarios de prueba)
 *
 * Carga total: ~100 VUs distribuidos proporcionalmente al tamaño real
 *   - Terranova : 40 VUs  (la más grande)
 *   - Principal : 35 VUs
 *   - Milan     : 25 VUs
 *   ─────────────────────────────────────
 *   Total       : 100 VUs simultáneos
 *
 * Ejecutar:
 *   .\k6 run --out json=load-tests/results/multi-cong.json load-tests/multi-congregation-test.js
 *
 * Duración: ~3 minutos 30 segundos
 * ─────────────────────────────────────────────────────────────────
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Credenciales Supabase ─────────────────────────────────────
const SUPABASE_URL      = 'https://hffjoeeahqcpphgndkfc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZmpvZWVhaHFjcHBoZ25ka2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNTEyMDIsImV4cCI6MjA4NzcyNzIwMn0.TJP3jFCrzx1qZmL1jRGKeamCNVqgTUxVnxAN0BVu53I';

const SUPA_HEADERS = {
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type':  'application/json',
};

// ── IDs de las 3 congregaciones ───────────────────────────────
const CONGREGATIONS = {
  terranova: 'cf2678ea-91a7-4a05-8ac3-fbcc98f37280',
  principal: 'c8e5faa2-9cd3-4d04-b5c3-31ce10f9ccef',
  milan:     '87dbcfa3-217b-4d25-a42a-249ebd822925',
};

// ── Configuración: 3 escenarios paralelos ─────────────────────
export const options = {
  scenarios: {
    terranova: {
      executor:  'constant-vus',
      vus:       40,
      duration:  '3m',
      env:       { CONG_ID: CONGREGATIONS.terranova, CONG_NAME: 'terranova' },
      tags:      { congregation: 'terranova' },
    },
    principal: {
      executor:  'constant-vus',
      vus:       35,
      duration:  '3m',
      env:       { CONG_ID: CONGREGATIONS.principal, CONG_NAME: 'principal' },
      tags:      { congregation: 'principal' },
    },
    milan: {
      executor:  'constant-vus',
      vus:       25,
      duration:  '3m',
      env:       { CONG_ID: CONGREGATIONS.milan, CONG_NAME: 'milan' },
      tags:      { congregation: 'milan' },
    },
  },
  thresholds: {
    // Global: toda la carga combinada de las 3 congregaciones
    'http_req_duration':                        ['p(95)<2000'],
    'http_req_failed':                          ['rate<0.03'],
    // Por congregación
    'http_req_duration{congregation:terranova}': ['p(95)<2000'],
    'http_req_duration{congregation:principal}': ['p(95)<2000'],
    'http_req_duration{congregation:milan}':     ['p(95)<2000'],
  },
};

// ── setup() — Carga usuarios de las 3 congregaciones ──────────
export function setup() {
  const result = {};

  for (const [name, id] of Object.entries(CONGREGATIONS)) {
    console.log(`[setup] Cargando usuarios de ${name}...`);

    const res = http.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_test_user_ids`,
      JSON.stringify({ p_congregation_id: id }),
      { headers: SUPA_HEADERS }
    );

    check(res, { [`setup ${name}: RPC 200`]: (r) => r.status === 200 });

    if (res.status !== 200) {
      throw new Error(`setup: Falló carga de usuarios para ${name}. Status: ${res.status}`);
    }

    const users = res.json();
    result[id] = users;
    console.log(`[setup] ✓ ${users.length} usuarios listos para ${name}.`);
  }

  return result; // { [congregationId]: [{ id }] }
}

// ── Lunes de la semana actual ─────────────────────────────────
function getWeekStart() {
  const now    = new Date();
  const day    = now.getDay();
  const diff   = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return monday.toISOString().split('T')[0];
}

// ── Función principal — Se ejecuta en cada iteración de cada VU ──
export default function (data) {
  // Cada escenario inyecta CONG_ID vía env
  const congId    = __ENV.CONG_ID;
  const congName  = __ENV.CONG_NAME;
  const users     = data[congId];
  const vuUser    = users[(__VU - 1) % users.length];
  const weekStart = getWeekStart();

  let timeSlotIds          = [];
  let existingReservations = [];

  // ── Fase 1: Cargar dashboard ────────────────────────────────
  group(`${congName}_dashboard`, () => {
    const cfgRes = http.get(
      `${SUPABASE_URL}/rest/v1/app_config?congregation_id=eq.${congId}&limit=1`,
      { headers: SUPA_HEADERS }
    );
    check(cfgRes, { 'config cargada': (r) => r.status === 200 });

    const exhibRes = http.get(
      `${SUPABASE_URL}/rest/v1/exhibitors?is_active=eq.true&congregation_id=eq.${congId}&order=name`,
      { headers: SUPA_HEADERS }
    );
    check(exhibRes, { 'exhibidores cargados': (r) => r.status === 200 });

    const slotsRes = http.get(
      `${SUPABASE_URL}/rest/v1/time_slots?congregation_id=eq.${congId}&select=id`,
      { headers: SUPA_HEADERS }
    );
    check(slotsRes, { 'time_slots cargados': (r) => r.status === 200 });
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
    check(resRes, { 'reservas cargadas': (r) => r.status === 200 });
    if (resRes.status === 200) {
      existingReservations = resRes.json();
    }
  });

  if (timeSlotIds.length === 0) {
    console.warn(`VU ${__VU} [${congName}]: sin time_slots. ¿Exhibidores configurados?`);
    sleep(2);
    return;
  }

  // ── Fase 2: Reservar ─────────────────────────────────────────
  let reservationId = null;

  group(`${congName}_reservar`, () => {
    const ocupacion  = {};
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
      const created   = bookRes.json();
      reservationId   = Array.isArray(created) ? created[0]?.id : created?.id;
    }
  });

  sleep(randomIntBetween(1, 2));

  // ── Fase 3: Cancelar ─────────────────────────────────────────
  if (reservationId) {
    group(`${congName}_cancelar`, () => {
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
