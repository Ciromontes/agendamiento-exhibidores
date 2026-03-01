/**
 * components/AdminConfigPanel.tsx — Fase 4-6: Configuración Global
 * ─────────────────────────────────────────────────────────────
 * Panel para que el administrador configure parámetros globales.
 *
 * Sección 1 — Modo de Conteo (Fase 4):
 *   - 'weekly'  = semanal (Publicador: 1, P. Regular: 2, P. Auxiliar: 2)
 *   - 'monthly' = mensual (Publicador: 4, P. Regular: 8, P. Auxiliar: 6)
 *
 * Sección 2 — Prioridad de Agendamiento (Fase 6):
 *   - Activar/desactivar prioridad semanal
 *   - Día y hora de apertura semanal
 *   - Modos: Sin prioridad / Precursores primero / Escalonado
 *   - Horas de espera configurables por tipo de usuario
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WEEKLY_LIMITS, MONTHLY_LIMITS, USER_TYPE_LABELS } from '@/types'

// Tipo: campos de app_config que gestiona este panel
type ConfigData = {
  id: string
  // ── Fase 4: conteo ───────────────────────────────────
  counting_mode: 'weekly' | 'monthly'
  // ── Fase 6: prioridad ───────────────────────────────
  priority_enabled: boolean
  priority_mode: 'none' | 'precursor_first' | 'tiered'
  priority_hours_auxiliar: number
  priority_hours_publicador: number
  booking_opens_day: number
  booking_opens_time: string
}

export default function AdminConfigPanel() {
  // ─── Estado ────────────────────────────────────────────────
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  // Estado de guardado de la sección de prioridad (Fase 6)
  const [prioritySaving, setPrioritySaving] = useState(false)
  const [prioritySavedMsg, setPrioritySavedMsg] = useState(false)

  const supabase = createClient()

  // ─── Cargar configuración actual ───────────────────────────
  useEffect(() => {
    const fetchConfig = async () => {
      const { data, error } = await supabase
        .from('app_config')
        .select('id, counting_mode, priority_enabled, priority_mode, priority_hours_auxiliar, priority_hours_publicador, booking_opens_day, booking_opens_time')
        .limit(1)
        .single()
      if (data && !error) {
        setConfig(data as ConfigData)
      }
      setLoading(false)
    }
    fetchConfig()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Guardar cambio de modo ────────────────────────────────
  const handleModeChange = async (newMode: 'weekly' | 'monthly') => {
    if (!config) return
    setSaving(true)
    setSavedMsg(false)

    const { error } = await supabase
      .from('app_config')
      .update({ counting_mode: newMode })
      .eq('id', config.id)

    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      setConfig({ ...config, counting_mode: newMode })
      setSavedMsg(true)
      // Ocultar mensaje después de 3 segundos
      setTimeout(() => setSavedMsg(false), 3000)
    }
    setSaving(false)
  }

  // ─── Guardar configuración de prioridad (Fase 6) ──────────────
  const handleSavePriority = async () => {
    if (!config) return
    setPrioritySaving(true)
    setPrioritySavedMsg(false)
    const { error } = await supabase
      .from('app_config')
      .update({
        priority_enabled:          config.priority_enabled,
        priority_mode:             config.priority_mode,
        priority_hours_auxiliar:   config.priority_hours_auxiliar,
        priority_hours_publicador: config.priority_hours_publicador,
        booking_opens_day:         config.booking_opens_day,
        booking_opens_time:        config.booking_opens_time,
      })
      .eq('id', config.id)
    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      setPrioritySavedMsg(true)
      setTimeout(() => setPrioritySavedMsg(false), 3000)
    }
    setPrioritySaving(false)
  }

  // ─── Spinner de carga ──────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Cargando configuración...</p>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="text-center py-12 text-red-500">
        No se encontró la configuración. Verifica que la tabla app_config tenga datos.
      </div>
    )
  }

  // Tabla de límites a mostrar según el modo seleccionado
  const currentLimits = config.counting_mode === 'monthly' ? MONTHLY_LIMITS : WEEKLY_LIMITS
  const periodSuffix = config.counting_mode === 'monthly' ? '/mes' : '/semana'

  return (
    <div className="space-y-6">
      {/* Tarjeta principal: Modo de Conteo */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-1">⚙️ Modo de Conteo de Turnos</h2>
        <p className="text-sm text-gray-500 mb-5">
          Define cómo se cuentan los turnos para aplicar los límites por tipo de usuario.
        </p>

        {/* Selector de modo: dos opciones tipo card */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Opción: Semanal */}
          <button
            onClick={() => handleModeChange('weekly')}
            disabled={saving}
            className={`text-left p-4 rounded-xl border-2 transition-all ${
              config.counting_mode === 'weekly'
                ? 'border-indigo-500 bg-indigo-50 shadow-md'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                config.counting_mode === 'weekly' ? 'border-indigo-500' : 'border-gray-300'
              }`}>
                {config.counting_mode === 'weekly' && (
                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                )}
              </span>
              <span className="font-bold text-gray-800">📅 Semanal</span>
            </div>
            <p className="text-sm text-gray-600 ml-6">
              Los turnos se cuentan por <strong>semana</strong> (lunes a domingo).
              Se reinicia cada lunes.
            </p>
            <div className="ml-6 mt-2 text-xs text-gray-500">
              <p>Publicador: <strong>1/semana</strong></p>
              <p>Precursor Regular: <strong>2/semana</strong></p>
              <p>Precursor Auxiliar: <strong>2/semana</strong></p>
            </div>
          </button>

          {/* Opción: Mensual */}
          <button
            onClick={() => handleModeChange('monthly')}
            disabled={saving}
            className={`text-left p-4 rounded-xl border-2 transition-all ${
              config.counting_mode === 'monthly'
                ? 'border-indigo-500 bg-indigo-50 shadow-md'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                config.counting_mode === 'monthly' ? 'border-indigo-500' : 'border-gray-300'
              }`}>
                {config.counting_mode === 'monthly' && (
                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                )}
              </span>
              <span className="font-bold text-gray-800">🗓️ Mensual</span>
            </div>
            <p className="text-sm text-gray-600 ml-6">
              Los turnos se cuentan por <strong>mes calendario</strong>.
              Se reinicia el día 1 de cada mes.
            </p>
            <div className="ml-6 mt-2 text-xs text-gray-500">
              <p>Publicador: <strong>4/mes</strong></p>
              <p>Precursor Regular: <strong>8/mes</strong></p>
              <p>Precursor Auxiliar: <strong>6/mes</strong></p>
            </div>
          </button>
        </div>

        {/* Mensaje de guardado exitoso */}
        {savedMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">
            ✅ Modo de conteo actualizado correctamente. Los usuarios verán el cambio al recargar la página.
          </div>
        )}

        {saving && (
          <div className="text-sm text-gray-400 mb-4">Guardando...</div>
        )}
      </div>

      {/* Tarjeta informativa: Límites actuales */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h3 className="text-md font-bold text-gray-800 mb-3">📊 Límites Actuales</h3>
        <p className="text-sm text-gray-500 mb-4">
          Modo activo: <strong className="text-indigo-600">
            {config.counting_mode === 'monthly' ? '🗓️ Mensual' : '📅 Semanal'}
          </strong>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-4 py-2 font-medium text-gray-600">Tipo de Usuario</th>
                <th className="text-center px-4 py-2 font-medium text-gray-600">Máx. Turnos</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(currentLimits).map(([type, limit]) => (
                <tr key={type} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 text-gray-700">
                    {USER_TYPE_LABELS[type] || type}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-bold text-xs">
                      {limit}{periodSuffix}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota informativa — modo de conteo */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>💡 Nota:</strong> Cambiar el modo de conteo afecta a todos los usuarios inmediatamente.
        Las reservas existentes no se eliminan; solo cambia cómo se cuentan los límites.
        <br />
        <span className="text-amber-600">
          Ejemplo: Si un usuario tiene 3 reservas en el mes y cambias a modo semanal,
          solo contará las reservas de la semana en curso.
        </span>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECCIÓN 2: PRIORIDAD DE AGENDAMIENTO (Fase 6)
          ══════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-800">🔒 Prioridad de Agendamiento</h2>
          {/* Toggle principal ON/OFF */}
          <button
            onClick={() => setConfig(c => c ? { ...c, priority_enabled: !c.priority_enabled } : c)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              config.priority_enabled ? 'bg-indigo-500' : 'bg-gray-300'
            }`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
              config.priority_enabled ? 'left-7' : 'left-1'
            }`} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Controla cuándo puede empezar a reservar cada tipo de usuario cada semana.
          {config.priority_enabled
            ? <span className="text-indigo-600 font-medium"> Activo</span>
            : <span className="text-gray-400"> Desactivado — todos reservan al mismo tiempo</span>
          }
        </p>

        {config.priority_enabled && (
          <div className="space-y-5">
            {/* Día y hora de apertura semanal */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  📅 Día de apertura semanal
                </label>
                <select
                  value={config.booking_opens_day}
                  onChange={e => setConfig(c => c ? { ...c, booking_opens_day: parseInt(e.target.value) } : c)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value={1}>Lunes</option>
                  <option value={2}>Martes</option>
                  <option value={3}>Miércoles</option>
                  <option value={4}>Jueves</option>
                  <option value={5}>Viernes</option>
                  <option value={6}>Sábado</option>
                  <option value={0}>Domingo</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Día en que abren las reservas para la semana</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  🕐 Hora de apertura
                </label>
                <input
                  type="time"
                  value={config.booking_opens_time.slice(0, 5)}
                  onChange={e => setConfig(c => c ? { ...c, booking_opens_time: e.target.value + ':00' } : c)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">Hora exacta en que el primer grupo puede reservar</p>
              </div>
            </div>

            {/* Modo de prioridad */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Modo de prioridad</label>
              <div className="space-y-2">
                {/* Sin prioridad */}
                <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  config.priority_mode === 'none' ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio" name="priority_mode" value="none"
                    checked={config.priority_mode === 'none'}
                    onChange={() => setConfig(c => c ? { ...c, priority_mode: 'none' } : c)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Sin prioridad</p>
                    <p className="text-xs text-gray-500">Todos los tipos de usuario abren a la misma hora</p>
                  </div>
                </label>
                {/* Precursores primero */}
                <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  config.priority_mode === 'precursor_first' ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio" name="priority_mode" value="precursor_first"
                    checked={config.priority_mode === 'precursor_first'}
                    onChange={() => setConfig(c => c ? { ...c, priority_mode: 'precursor_first' } : c)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Precursores primero</p>
                    <p className="text-xs text-gray-500">
                      Regular y Auxiliar abren a la hora X.<br />
                      Publicador abre X + N horas después.
                    </p>
                  </div>
                </label>
                {/* Escalonado */}
                <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  config.priority_mode === 'tiered' ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio" name="priority_mode" value="tiered"
                    checked={config.priority_mode === 'tiered'}
                    onChange={() => setConfig(c => c ? { ...c, priority_mode: 'tiered' } : c)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Escalonado</p>
                    <p className="text-xs text-gray-500">
                      Regular abre a la hora X.<br />
                      Auxiliar abre X + N₁ horas después.<br />
                      Publicador abre X + N₂ horas después.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Horas de espera — ajustable según modo */}
            {config.priority_mode !== 'none' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Horas auxiliar — solo en modo tiered */}
                {config.priority_mode === 'tiered' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">
                      ⏱ Espera para Precursor Auxiliar (horas)
                    </label>
                    <input
                      type="number" min={0} max={72}
                      value={config.priority_hours_auxiliar}
                      onChange={e => setConfig(c => c ? { ...c, priority_hours_auxiliar: parseInt(e.target.value) || 0 } : c)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">0 = mismo tiempo que Regular</p>
                  </div>
                )}
                {/* Horas publicador — siempre visible cuando hay modo */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">
                    ⏱ Espera para Publicador (horas)
                  </label>
                  <input
                    type="number" min={0} max={72}
                    value={config.priority_hours_publicador}
                    onChange={e => setConfig(c => c ? { ...c, priority_hours_publicador: parseInt(e.target.value) || 0 } : c)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">0 = mismo tiempo que los precursores</p>
                </div>
              </div>
            )}

            {/* Resumen visual del horario resultante */}
            {config.priority_mode !== 'none' && (
              <div className="bg-gray-50 rounded-xl p-4 text-xs space-y-1.5">
                <p className="font-semibold text-gray-600 mb-2">📋 Resumen de apertura:</p>
                <p>
                  <span className="inline-block w-3 h-3 rounded-full bg-indigo-400 mr-1.5 align-middle"></span>
                  <strong>Precursor Regular:</strong> hora configurada
                </p>
                {config.priority_mode === 'tiered' && (
                  <p>
                    <span className="inline-block w-3 h-3 rounded-full bg-purple-400 mr-1.5 align-middle"></span>
                    <strong>Precursor Auxiliar:</strong> hora configurada
                    {config.priority_hours_auxiliar > 0 && ` + ${config.priority_hours_auxiliar}h`}
                  </p>
                )}
                {config.priority_mode === 'precursor_first' && (
                  <p>
                    <span className="inline-block w-3 h-3 rounded-full bg-purple-400 mr-1.5 align-middle"></span>
                    <strong>Precursor Auxiliar:</strong> hora configurada (mismo que Regular)
                  </p>
                )}
                <p>
                  <span className="inline-block w-3 h-3 rounded-full bg-orange-400 mr-1.5 align-middle"></span>
                  <strong>Publicador:</strong> hora configurada
                  {config.priority_hours_publicador > 0 && ` + ${config.priority_hours_publicador}h`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Mensajes de guardado */}
        {prioritySavedMsg && (
          <div className="mt-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2">
            ✅ Configuración de prioridad guardada. Los usuarios verán el cambio al recargar.
          </div>
        )}

        {/* Botón guardar prioridad */}
        <div className="mt-5 flex justify-end">
          <button
            onClick={handleSavePriority}
            disabled={prioritySaving}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-60"
          >
            {prioritySaving ? 'Guardando...' : '💾 Guardar prioridad'}
          </button>
        </div>
      </div>

      {/* Nota informativa final */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>💡 Sobre la prioridad:</strong> El sistema calcula la ventana de apertura a partir del
        día y hora configurados. Cada semana el contador se reinicia automáticamente.
        Si un publicador intenta reservar antes de su ventana, verá un mensaje indicando
        cuándo puede hacerlo.
      </div>
    </div>
  )
}
