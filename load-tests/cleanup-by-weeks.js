'use strict';
// Borra todas las reservas simuladas por rango de semanas (sin depender de sim-state.json)
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
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* ignorar */ }
})();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = 'https://hffjoeeahqcpphgndkfc.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONGREGATION_ID  = 'cf2678ea-91a7-4a05-8ac3-fbcc98f37280';

if (!SERVICE_ROLE_KEY) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

(async function () {
  // Calcular el lunes de hoy
  const now    = new Date();
  const dayNum = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayNum === 0 ? 6 : dayNum - 1));
  monday.setHours(0, 0, 0, 0);

  // Construir las 12 semanas pasadas
  const weeks = [];
  for (let w = 12; w >= 1; w--) {
    const d = new Date(monday);
    d.setDate(monday.getDate() - w * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }

  console.log(`Semanas a limpiar: ${weeks[0]} → ${weeks[weeks.length - 1]}`);

  const { error } = await supabase
    .from('reservations')
    .delete()
    .eq('congregation_id', CONGREGATION_ID)
    .in('week_start', weeks);

  if (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }

  console.log('✅ Reservas borradas (relief_requests eliminados en cascada por FK).');

  // Eliminar sim-state.json si existe
  const stateFile = path.resolve(__dirname, 'sim-state.json');
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    console.log('✅ sim-state.json eliminado.');
  }
})();
