#!/usr/bin/env node
'use strict';
/**
 * load-tests/simulate-3-months.js
 * ════════════════════════════════════════════════════════════════════════════
 * Genera 12 semanas de reservas históricas realistas para la congregación
 * Terranova. Útil para probar el historial de admin y de usuarios.
 *
 * CONFIGURACIÓN:
 *   Agrega SUPABASE_SERVICE_ROLE_KEY a tu archivo .env.local (Next.js) o
 *   expórtala como variable de entorno antes de correr el script.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
 *
 * USO:
 *   node load-tests/simulate-3-months.js             → Insertar datos
 *   node load-tests/simulate-3-months.js --cleanup   → Borrar datos simulados
 *
 * Lo que ocurre después de la simulación:
 *   • 12 semanas de historia quedan en la BD.
 *   • Los IDs insertados se guardan en  load-tests/sim-state.json  para poder
 *     limpiarlos con --cleanup sin necesidad de columna extra en la BD.
 *   • active_week_start → lunes de la semana actual (semana vacía = abierta).
 *   • La grilla mostrará esa semana vasta para que puedas registrarte.
 *   • Admin → historial con 12 semanas de datos.
 *   • Cada usuario → puede ver sus turnos históricos simulados.
 *
 * URL de prueba: https://exhibidores-app.vercel.app/terranova/dashboard
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── Cargar .env.local automáticamente (sin depender de dotenv) ─────────────
const fs   = require('fs');
const path = require('path');

(function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val   = line.slice(eqIdx + 1).trim();
      // Quitar comillas opcionales
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env.local no existe, se usa process.env directamente */ }
})();

// ── Dependencias ────────────────────────────────────────────────────────────
// @supabase/supabase-js ya está en package.json del proyecto.
const { createClient } = require('@supabase/supabase-js');

// ── Configuración ───────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://hffjoeeahqcpphgndkfc.supabase.co';
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONGREGATION_ID   = 'cf2678ea-91a7-4a05-8ac3-fbcc98f37280'; // terranova
const WEEKS             = 12;
// Archivo local donde se guardan los IDs insertados (para poder limpiarlos).
const STATE_FILE        = path.resolve(__dirname, 'sim-state.json');
const ABSENCE_PROB      = 0.15;  // 15 % de ausencia por usuario/semana
const RELIEF_PROB       = 0.10;  // 10 % de reservas generan solicitud de relevo

// Límites semanales de turnos por tipo de usuario
const WEEKLY_LIMIT = {
  publicador:        1,
  precursor_regular: 2,
  precursor_auxiliar: 2,
};

// ── Utilidades ──────────────────────────────────────────────────────────────

/** Devuelve el lunes (Date) de la semana que contiene `date`. */
function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Formatea una Date como 'YYYY-MM-DD'. */
function fmt(date) {
  return date.toISOString().slice(0, 10);
}

/** Fisher-Yates shuffle — devuelve copia del array mezclado. */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Validar entorno ─────────────────────────────────────────────────────────
if (!SERVICE_ROLE_KEY) {
  console.error('\n❌  SUPABASE_SERVICE_ROLE_KEY no está definida.');
  console.error(    '    Agrégala a .env.local (raíz del proyecto) o expórtala:');
  console.error(    '    export SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...\n');
  process.exit(1);
}

// ── Cliente Supabase con service_role (bypassea RLS) ───────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Entrada principal ───────────────────────────────────────────────────────
const isCleanup = process.argv.includes('--cleanup');

(async function main() {
  if (isCleanup) {
    await cleanup();
  } else {
    await simulate();
  }
})().catch(err => {
  console.error('Error inesperado:', err.message);
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════════════════
// LIMPIEZA
// ═══════════════════════════════════════════════════════════════════════════
async function cleanup() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  LIMPIEZA — Eliminando datos de simulación');
  console.log('══════════════════════════════════════════════════\n');

  // Leer IDs del archivo de estado generado al simular
  if (!fs.existsSync(STATE_FILE)) {
    console.error('  ❌  No se encontró sim-state.json.');
    console.error('      Ejecuta primero el script sin --cleanup para generar los datos.\n');
    process.exit(1);
  }

  const state  = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const resIds = state.reservationIds ?? [];
  console.log(`  Reservas simuladas a borrar: ${resIds.length}`);
  console.log(`  (simuladas el ${state.simulatedAt ?? '?'})`);

  if (resIds.length === 0) {
    console.log('  Nada que borrar.\n');
    fs.unlinkSync(STATE_FILE);
    return;
  }

  // Borrar en lotes de 500 (relief_requests se eliminan en cascada)
  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < resIds.length; i += BATCH) {
    const batch = resIds.slice(i, i + BATCH);
    const { error } = await supabase
      .from('reservations')
      .delete()
      .in('id', batch);
    if (error) console.error(`  ⚠ Error en lote ${i / BATCH + 1}:`, error.message);
    else deleted += batch.length;
  }

  console.log(`  ✓ ${deleted} reservas eliminadas (relief_requests en cascada)`);

  // Borrar archivo de estado
  fs.unlinkSync(STATE_FILE);
  console.log('  ✓ sim-state.json eliminado');
  console.log('\n✅  Limpieza completada.\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULACIÓN
// ═══════════════════════════════════════════════════════════════════════════
async function simulate() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  SIMULACIÓN DE 12 SEMANAS — Congregación Terranova');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── 1. Cargar usuarios activos ──────────────────────────────────────────
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, user_type, gender, spouse_id, is_active')
    .eq('congregation_id', CONGREGATION_ID)
    .eq('is_active', true);

  if (uErr || !users?.length) {
    console.error('❌  Error cargando usuarios:', uErr?.message ?? 'Sin resultados');
    process.exit(1);
  }
  console.log(`  Usuarios activos:  ${users.length}`);

  // Lookup rápido userId → user
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  // ── 2. Cargar exhibidores activos (sin deleted_at) ──────────────────────
  const { data: exhibitors, error: exErr } = await supabase
    .from('exhibitors')
    .select('id, name')
    .eq('congregation_id', CONGREGATION_ID)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (exErr || !exhibitors?.length) {
    console.error('❌  Error cargando exhibidores:', exErr?.message ?? 'Sin resultados');
    process.exit(1);
  }
  const validExhibitorIds = new Set(exhibitors.map(e => e.id));
  console.log(`  Exhibidores activos: ${exhibitors.length}  (${exhibitors.map(e => e.name).join(', ')})`);

  // ── 3. Cargar time_slots activos solo de exhibidores válidos ──────────
  const { data: allSlots, error: sErr } = await supabase
    .from('time_slots')
    .select('id, exhibitor_id, day_of_week, start_time')
    .eq('congregation_id', CONGREGATION_ID)
    .eq('is_active', true);

  if (sErr || !allSlots?.length) {
    console.error('❌  Error cargando time_slots:', sErr?.message ?? 'Sin resultados');
    process.exit(1);
  }

  // Filtrar solo los slots que pertenecen a exhibidores activos y no eliminados
  const slots = allSlots.filter(s => validExhibitorIds.has(s.exhibitor_id));

  if (!slots.length) {
    console.error('❌  Ningún slot pertenece a un exhibidor activo y no eliminado.');
    process.exit(1);
  }
  console.log(`  Slots activos:     ${slots.length}`);

  // ── 4. Calcular las 12 semanas a simular ────────────────────────────────
  // La semana activa después de la simulación = lunes de HOY (vacía, abierta).
  // Las 12 semanas van desde 12 semanas atrás hasta la semana PASADA.
  const thisMonday = getMondayOf(new Date());

  const weeks = [];
  for (let w = WEEKS; w >= 1; w--) {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() - w * 7);
    weeks.push(fmt(d));
  }
  // weeks[0]  = 12 semanas atrás (la más antigua)
  // weeks[11] = semana pasada    (la más reciente)
  console.log(`  Rango:  ${weeks[0]}  →  ${weeks[WEEKS - 1]}`);
  console.log(`  Semana activa post-simulación: ${fmt(thisMonday)}\n`);

  // ── 4. Simular cada semana ──────────────────────────────────────────────
  let totalReservations = 0;
  let totalRelief       = 0;
  const userCounter     = {}; // userId → count, para el resumen final
  const allInsertedIds  = []; // para sim-state.json

  for (const weekStart of weeks) {
    process.stdout.write(`  ${weekStart}: `);

    // Estado de ocupación: slotOccupancy[id] = { 1: {userId,gender}|null, 2: ... }
    const slotOccupancy = {};
    for (const s of slots) slotOccupancy[s.id] = { 1: null, 2: null };

    const toInsert = []; // reservas de esta semana

    // Procesar usuarios en orden aleatorio para evitar sesgo
    for (const user of shuffle(users)) {
      // ¿Ausente esta semana?
      if (Math.random() < ABSENCE_PROB) continue;

      const limit = WEEKLY_LIMIT[user.user_type] ?? 1;
      let   assigned = 0;

      // Slots disponibles y aleatorios para este usuario
      const eligibleSlots = shuffle(slots).filter(slot => {
        const occ = slotOccupancy[slot.id];

        // ¿Hay alguna posición libre?
        const pos1Free = occ[1] === null;
        const pos2Free = occ[2] === null;
        if (!pos1Free && !pos2Free) return false; // slot lleno

        // Si pos1 está tomada, verificar compatibilidad de género con pos2
        if (!pos1Free && pos2Free) {
          const takenGender = occ[1].gender;
          // Solo bloquear si AMBOS tienen género definido y son distintos
          if (takenGender && user.gender && takenGender !== user.gender) return false;
        }
        return true;
      });

      for (const slot of eligibleSlots) {
        if (assigned >= limit) break;

        const occ      = slotOccupancy[slot.id];
        const position = occ[1] === null ? 1 : 2;

        // Marcar ocupado
        occ[position] = { userId: user.id, gender: user.gender };

        toInsert.push({
          time_slot_id:    slot.id,
          user_id:         user.id,
          week_start:      weekStart,
          status:          'confirmed',
          slot_position:   position,
          congregation_id: CONGREGATION_ID,
        });

        assigned++;
      }
    }

    if (toInsert.length === 0) {
      console.log('(sin asignaciones esta semana)');
      continue;
    }

    // ── 4a. Insertar reservas ─────────────────────────────────────────────
    const { data: inserted, error: insErr } = await supabase
      .from('reservations')
      .insert(toInsert)
      .select('id, user_id, time_slot_id');

    if (insErr) {
      console.error(`\n  ❌  Error insertando reservas en ${weekStart}:`, insErr.message);
      continue;
    }
    totalReservations += inserted.length;

    // Contabilizar solo filas efectivamente insertadas
    for (const res of inserted) {
      userCounter[res.user_id] = (userCounter[res.user_id] || 0) + 1;
      allInsertedIds.push(res.id);
    }

    // ── 4b. Generar solicitudes de relevo (≈10 %) ─────────────────────────
    const reliefCandidates = shuffle(inserted)
      .slice(0, Math.max(1, Math.round(inserted.length * RELIEF_PROB)));

    const reliefRows = [];
    const weekDate   = new Date(weekStart + 'T00:00:00Z');

    for (const res of reliefCandidates) {
      const requester = userMap[res.user_id];
      if (!requester) continue;

      // Buscar aceptante compatible (mismo género, distinto usuario)
      const compatible = users.filter(u =>
        u.id !== res.user_id &&
        (!u.gender || !requester.gender || u.gender === requester.gender)
      );
      if (!compatible.length) continue;

      const acceptor   = compatible[Math.floor(Math.random() * compatible.length)];
      const acceptedAt = new Date(weekDate);
      acceptedAt.setDate(weekDate.getDate() + Math.floor(Math.random() * 5)); // 0-4 días después

      reliefRows.push({
        reservation_id:  res.id,
        slot_id:         res.time_slot_id,
        week_start:      weekStart,
        from_user_id:    res.user_id,
        to_user_id:      null,          // relevo abierto
        status:          'accepted',
        expires_at:      new Date(weekDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        acceptor_id:     acceptor.id,
        accepted_at:     acceptedAt.toISOString(),
        congregation_id: CONGREGATION_ID,
      });
    }

    if (reliefRows.length > 0) {
      const { error: rrErr } = await supabase
        .from('relief_requests')
        .insert(reliefRows);
      if (!rrErr) totalRelief += reliefRows.length;
    }

    console.log(`${inserted.length} reservas  |  ${reliefRows.length} relevos`);
  }

  // ── 5. Actualizar active_week_start ─────────────────────────────────────
  const { error: cfgErr } = await supabase
    .from('app_config')
    .update({ active_week_start: fmt(thisMonday) })
    .eq('congregation_id', CONGREGATION_ID);

  if (cfgErr) {
    console.error('\n  ⚠  No se pudo actualizar active_week_start:', cfgErr.message);
  } else {
    console.log(`\n  ✓ active_week_start actualizado → ${fmt(thisMonday)}`);
  }

  // ── 6. Guardar estado en sim-state.json (necesario para --cleanup) ────────
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    simulatedAt:    new Date().toISOString(),
    congregationId: CONGREGATION_ID,
    weeks,
    reservationIds: allInsertedIds,
  }, null, 2));
  console.log(`\n  ✓ sim-state.json guardado (${allInsertedIds.length} IDs)`);

  // ── 7. Resumen ───────────────────────────────────────────────────────────
  const top5 = Object.entries(userCounter)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Semanas simuladas:     ${WEEKS}`);
  console.log(`  Reservas insertadas:   ${totalReservations}`);
  console.log(`  Relevos insertados:    ${totalRelief}`);
  console.log('');
  console.log('  Top 5 usuarios más activos:');
  for (const [uid, count] of top5) {
    const name = userMap[uid]?.name ?? uid.slice(0, 8);
    console.log(`    ${name.padEnd(30, '.')} ${count} turnos`);
  }
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('✅  Simulación completada.');
  console.log('');
  console.log('  Ver resultados:');
  console.log('    https://exhibidores-app.vercel.app/terranova/dashboard');
  console.log('');
  console.log('  Para limpiar los datos simulados:');
  console.log('    node load-tests/simulate-3-months.js --cleanup');
  console.log('══════════════════════════════════════════════════════════════\n');
}
