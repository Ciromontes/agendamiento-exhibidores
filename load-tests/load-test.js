/**
 * load-test.js — Prueba de Carga Normal
 * ─────────────────────────────────────────────────────────────
 * Simula el flujo completo de un usuario en Exhibidores App:
 *   1. Cargar datos del dashboard (exhibidores, time_slots, reservas)
 *   2. Reservar un turno disponible
 *   3. Cancelar esa reserva (deja limpio para la siguiente iteración)
 *
 * Ejecutar 50 VUs (2 min):
 *   k6 run --vus 50 --duration 2m load-tests/load-test.js
 *
 * Ejecutar 100 VUs (3 min):
 *   k6 run --vus 100 --duration 3m load-tests/load-test.js
 *
 * Con output JSON para análisis:
 *   k6 run --vus 50 --duration 2m --out json=load-tests/results/50vu.json load-tests/load-test.js
 * ─────────────────────────────────────────────────────────────
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Configuración de conexión ────────────────────────────────
// NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY son claves
// públicas (clave "anon" = solo lectura pública). No incluir SUPABASE_SERVICE_ROLE_KEY aquí.
const SUPABASE_URL     = 'https://hffjoeeahqcpphgndkfc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZmpvZWVhaHFjcHBoZ25ka2ZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNTEyMDIsImV4cCI6MjA4NzcyNzIwMn0.TJP3jFCrzx1qZmL1jRGKeamCNVqgTUxVnxAN0BVu53I';

// UUID de la congregación Terranova (obtenido de Supabase)
const CONGREGATION_ID = 'cf2678ea-91a7-4a05-8ac3-fbcc98f37280';

// Headers estándar para la Supabase REST API
const SUPA_HEADERS = {
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type':  'application/json',
};

// ── Thresholds de aceptación ─────────────────────────────────
export const options = {
  thresholds: {
    // El 95% de las peticiones debe resolver en menos de 2 segundos
    'http_req_duration': ['p(95)<2000'],
    // Menos del 2% de peticiones pueden fallar — el 1-2% extra son conflictos
    // de concurrencia esperados (409/23505) cuando 100 VUs compiten por el mismo slot.
    // No son caídas del servidor; son rechazos correctos por RLS/unique constraint.
    'http_req_failed': ['rate<0.02'],
    // Al menos 95% de los checks deben pasar
    'checks': ['rate>0.95'],
  },
};

// ── Calcula el lunes de la semana actual (YYYY-MM-DD) ─────────
function getWeekStart() {
  const now  = new Date();
  const day  = now.getDay();                             // 0=Dom, 1=Lun, ...
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // retroceder al lunes
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return monday.toISOString().split('T')[0];
}

// ── setup() — Se ejecuta UNA SOLA VEZ antes de que arranquen los VUs ──
// Carga los 100 usuarios de prueba desde Supabase en una sola petición.
// Esto evita pasar por el rate-limiter del endpoint /api/auth/login
// (que solo permite 10 intentos / 15 min por IP).
export function setup() {
  console.log('Cargando usuarios de prueba vía RPC...');

  // Usamos una función RPC en lugar de query directa porque
  // la clave anon no tiene acceso directo a la tabla users (RLS).
  // La función se ejecuta con SECURITY DEFINER (rol de propietario).
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_test_user_ids`,
    JSON.stringify({ p_congregation_id: CONGREGATION_ID }),
    { headers: SUPA_HEADERS }
  );

  check(res, {
    'setup: RPC exitoso (200)': (r) => r.status === 200,
  });

  if (res.status !== 200) {
    throw new Error(
      `setup: Error al llamar get_test_user_ids. Status: ${res.status}. ` +
      `¿Ejecutaste el CREATE FUNCTION en Supabase SQL Editor?\nBody: ${res.body.substring(0, 300)}`
    );
  }

  const users = res.json();

  if (!users || !Array.isArray(users) || users.length === 0) {
    throw new Error(
      'setup: La función RPC no devolvió usuarios. ' +
      'Verifica que existan usuarios con is_admin=false en la congregación Terranova.'
    );
  }

  console.log(`✓ ${users.length} usuarios de prueba listos.`);
  return { users };
}

// ── Función principal — Se ejecuta en cada iteración de cada VU ──
export default function (data) {
  // Cada VU usa un usuario diferente, de forma cíclica si hay más VUs que usuarios
  const vuUser    = data.users[(__VU - 1) % data.users.length];
  const congId    = CONGREGATION_ID;
  const weekStart = getWeekStart();

  let timeSlotIds          = [];
  let existingReservations = [];

  // ── Fase 1: Cargar dashboard ──────────────────────────────────
  group('01_dashboard', () => {
    // 1a. Configuración de la congregación (counting_mode, prioridades, etc.)
    const cfgRes = http.get(
      `${SUPABASE_URL}/rest/v1/app_config` +
      `?congregation_id=eq.${congId}&limit=1`,
      { headers: SUPA_HEADERS }
    );
    check(cfgRes, { 'config cargada': (r) => r.status === 200 });

    // 1b. Exhibidores activos (para poblar el selector)
    const exhibRes = http.get(
      `${SUPABASE_URL}/rest/v1/exhibitors` +
      `?is_active=eq.true&congregation_id=eq.${congId}&order=name`,
      { headers: SUPA_HEADERS }
    );
    check(exhibRes, { 'exhibidores cargados': (r) => r.status === 200 });

    // 1c. Time slots de la congregación (bloques horarios)
    const slotsRes = http.get(
      `${SUPABASE_URL}/rest/v1/time_slots` +
      `?congregation_id=eq.${congId}&select=id`,
      { headers: SUPA_HEADERS }
    );
    check(slotsRes, { 'time_slots cargados': (r) => r.status === 200 });
    if (slotsRes.status === 200) {
      timeSlotIds = slotsRes.json().map((s) => s.id);
    }

    // 1d. Reservas activas de la semana actual
    const resRes = http.get(
      `${SUPABASE_URL}/rest/v1/reservations` +
      `?week_start=eq.${weekStart}` +
      `&congregation_id=eq.${congId}` +
      `&status=neq.cancelled` +
      `&select=id,time_slot_id,user_id`,
      { headers: SUPA_HEADERS }
    );
    check(resRes, { 'reservas de la semana cargadas': (r) => r.status === 200 });
    if (resRes.status === 200) {
      existingReservations = resRes.json();
    }
  });

  // Si no hay time_slots configurados, saltar iteración
  if (timeSlotIds.length === 0) {
    console.warn(`VU ${__VU}: no hay time_slots en la congregación. ¿Está configurada?`);
    sleep(2);
    return;
  }

  // ── Fase 2: Reservar un turno disponible ──────────────────────
  let reservationId = null;

  group('02_reservar', () => {
    // Calcular cuántos ocupantes tiene cada slot
    const ocupacion = {};
    existingReservations.forEach((r) => {
      ocupacion[r.time_slot_id] = (ocupacion[r.time_slot_id] || 0) + 1;
    });

    // Filtrar slots con menos de 2 ocupantes
    const disponibles = timeSlotIds.filter((id) => (ocupacion[id] || 0) < 2);

    if (disponibles.length === 0) {
      // Todos los turnos llenos en esta iteración → skip silencioso
      return;
    }

    // Elegir un slot disponible al azar
    const slotId   = disponibles[randomIntBetween(0, disponibles.length - 1)];
    const position = (ocupacion[slotId] || 0) + 1; // 1 si vacío, 2 si hay uno

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
        headers: {
          ...SUPA_HEADERS,
          'Prefer': 'return=representation', // para obtener el ID creado
        },
      }
    );

    check(bookRes, {
      'reserva creada (201)': (r) => r.status === 201 || r.status === 200,
    });

    // Guardar el ID de la reserva creada para poder cancelarla
    if (bookRes.status === 201 || bookRes.status === 200) {
      try {
        const body = bookRes.json();
        reservationId = Array.isArray(body) ? body[0]?.id : body?.id;
      } catch (_) {
        // Sin ID → no podremos cancelar, pero no es error crítico
      }
    }
  });

  // Pausa realista: el usuario ve la grilla antes de hacer otra acción
  sleep(randomIntBetween(1, 3));

  // ── Fase 3: Cancelar la reserva (limpieza para la siguiente iteración) ──
  if (reservationId) {
    group('03_cancelar', () => {
      const cancelRes = http.patch(
        `${SUPABASE_URL}/rest/v1/reservations?id=eq.${reservationId}`,
        JSON.stringify({ status: 'cancelled' }),
        { headers: SUPA_HEADERS }
      );

      check(cancelRes, {
        'reserva cancelada (204)': (r) => r.status === 204 || r.status === 200,
      });
    });
  }

  // Pausa entre iteraciones (simula tiempo de lectura entre acciones)
  sleep(randomIntBetween(1, 2));
}
