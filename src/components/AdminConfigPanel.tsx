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
import { useUser } from '@/context/UserContext'

// Tipo: campos de app_config que gestiona este panel
type ConfigData = {
  id: string
  // ── Semana activa ─────────────────────────────
  active_week_start: string       // 'YYYY-MM-DD' lunes de la semana abierta
  // ── Fase 4: conteo ──────────────────────────
  counting_mode: 'weekly' | 'monthly'
  // ── Fase 6: prioridad ───────────────────────
  priority_enabled: boolean
  priority_mode: 'none' | 'precursor_first' | 'tiered'
  priority_hours_auxiliar: number
  priority_hours_publicador: number
  booking_opens_day: number
  booking_opens_time: string
  // ── Ventana de cancelación ───────────────────────────
  cancel_window_minutes: number  // ── Anticipo mínimo de reserva (Step 1.2) ─────────────
  min_advance_hours: number
  // ── Step 3.1: límites de relevos por mes ──────────────
  relief_limit_publicador: number
  relief_limit_precursor: number
  // ── Compensación última semana del mes ───────────────
  last_week_compensation: boolean
}

type WeekActionMode = 'reset_current' | 'advance_blank' | 'advance_keep' | 'advance_only'

export default function AdminConfigPanel() {
  // ─── Estado ────────────────────────────────────────────────
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  // Estado de guardado de la sección de prioridad (Fase 6)
  const [prioritySaving, setPrioritySaving] = useState(false)
  const [prioritySavedMsg, setPrioritySavedMsg] = useState(false)
  // Estado de guardado de la ventana de cancelación
  const [cancelSaving, setCancelSaving] = useState(false)
  const [cancelSavedMsg, setCancelSavedMsg] = useState(false)
  // Input manual para ventana de cancelación
  const [cancelManualInput, setCancelManualInput] = useState('')
  // Estado de guardado de horas mínimas de anticipación (Step 1.2)
  const [advanceSaving, setAdvanceSaving] = useState(false)
  const [advanceSavedMsg, setAdvanceSavedMsg] = useState(false)
  // Estado del bloque práctico de semana
  const [weekActionLoading, setWeekActionLoading] = useState<WeekActionMode | null>(null)
  const [weekActionMsg, setWeekActionMsg] = useState<string | null>(null)
  const [weekActionError, setWeekActionError] = useState<string | null>(null)
  // Estado de guardado de límites de relevos por mes (Step 3.1)
  const [reliefLimitSaving, setReliefLimitSaving] = useState(false)
  const [reliefLimitSavedMsg, setReliefLimitSavedMsg] = useState(false)
  // Estado de guardado de compensación de última semana
  const [compensationSaving, setCompensationSaving] = useState(false)
  const [compensationSavedMsg, setCompensationSavedMsg] = useState(false)

  const supabase = createClient()
  const { user } = useUser()
  const congregationId = user?.congregation_id ?? ''
  const accessKey = user?.access_key ?? ''

  // ─── Cargar configuración actual ───────────────────────────
  useEffect(() => {
    const fetchConfig = async () => {
      if (!congregationId) return
      const { data, error } = await supabase
        .from('app_config')
        .select('id, active_week_start, counting_mode, priority_enabled, priority_mode, priority_hours_auxiliar, priority_hours_publicador, booking_opens_day, booking_opens_time, cancel_window_minutes, min_advance_hours, relief_limit_publicador, relief_limit_precursor, last_week_compensation')
        .eq('congregation_id', congregationId)
        .limit(1)
        .single()
      if (data && !error) {
        setConfig(data as ConfigData)
      }
      setLoading(false)
    }
    fetchConfig()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congregationId])
  // ─── Acciones rápidas de semana (modo pruebas) ─────────────
  const handleWeekQuickAction = async (mode: WeekActionMode) => {
    if (!config || !accessKey) return

    const actionText: Record<WeekActionMode, string> = {
      reset_current: 'reiniciar la semana en curso y dejar todos los turnos en cero',
      advance_blank: 'abrir la nueva semana en blanco (sin reservas)',
      advance_keep: 'abrir la nueva semana manteniendo los cupos actuales',
      advance_only: 'abrir la siguiente semana sin modificar las reservas ya cargadas',
    }

    const ok = window.confirm(
      `¿Seguro que deseas ${actionText[mode]}?\n\n` +
      'Esta acción es de administración y puede afectar a todos los usuarios de tu congregación.'
    )
    if (!ok) return

    const securityWord = window.prompt('Escribe REINICIAR para confirmar')
    if ((securityWord ?? '').trim().toUpperCase() !== 'REINICIAR') {
      alert('Confirmación inválida. Operación cancelada.')
      return
    }

    setWeekActionLoading(mode)
    setWeekActionMsg(null)
    setWeekActionError(null)

    try {
      const res = await fetch('/api/admin/week/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-key': accessKey,
        },
        body: JSON.stringify({ mode }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setWeekActionError(json.error ?? `Error ${res.status}`)
        return
      }

      if (json.active_week_start) {
        setConfig(c => c ? { ...c, active_week_start: json.active_week_start as string } : c)
      }

      setWeekActionMsg(
        typeof json.message === 'string'
          ? json.message
          : 'Operación de semana ejecutada correctamente.'
      )
    } catch {
      setWeekActionError('Error de conexión al ejecutar la acción de semana.')
    } finally {
      setWeekActionLoading(null)
    }
  }
  // ─── Guardar cambio de modo ────────────────────────────────
  const handleModeChange = async (newMode: 'weekly' | 'monthly') => {
    if (!config) return
    setSaving(true)
    setSavedMsg(false)

    const { error } = await supabase
      .from('app_config')
      .update({ counting_mode: newMode })
      .eq('id', config.id)
      .eq('congregation_id', congregationId)

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
  // ─── Guardar ventana de cancelación ───────────────────────────
  const handleSaveCancelWindow = async () => {
    if (!config) return
    const mins = config.cancel_window_minutes
    if (!mins || mins < 1 || mins > 60) {
      alert('El valor debe estar entre 1 y 60 minutos.')
      return
    }
    setCancelSaving(true)
    setCancelSavedMsg(false)
    const { error } = await supabase
      .from('app_config')
      .update({ cancel_window_minutes: mins })
      .eq('id', config.id)
      .eq('congregation_id', congregationId)
    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      setCancelSavedMsg(true)
      setTimeout(() => setCancelSavedMsg(false), 3000)
    }
    setCancelSaving(false)
  }  // ── Guardar horas mínimas de anticipación (Step 1.2) ─────────────────
  const handleSaveMinAdvanceHours = async () => {
    if (!config) return
    const hours = config.min_advance_hours
    if (isNaN(hours) || hours < 0 || hours > 48) {
      alert('El valor debe estar entre 0 y 48 horas.')
      return
    }
    setAdvanceSaving(true)
    setAdvanceSavedMsg(false)
    const { error } = await supabase
      .from('app_config')
      .update({ min_advance_hours: hours })
      .eq('id', config.id)
      .eq('congregation_id', congregationId)
    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      setAdvanceSavedMsg(true)
      setTimeout(() => setAdvanceSavedMsg(false), 3000)
    }
    setAdvanceSaving(false)
  }  // ─── Guardar configuración de prioridad (Fase 6) ──────────────
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
      .eq('congregation_id', congregationId)
    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      setPrioritySavedMsg(true)
      setTimeout(() => setPrioritySavedMsg(false), 3000)
    }
    setPrioritySaving(false)
  }

  // ─── Guardar compensación de última semana ───────────────────
  const handleSaveLastWeekCompensation = async () => {
    if (!config) return
    setCompensationSaving(true)
    setCompensationSavedMsg(false)
    const { error } = await supabase
      .from('app_config')
      .update({ last_week_compensation: config.last_week_compensation })
      .eq('id', config.id)
      .eq('congregation_id', congregationId)
    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      setCompensationSavedMsg(true)
      setTimeout(() => setCompensationSavedMsg(false), 3000)
    }
    setCompensationSaving(false)
  }

  // ─── Guardar límites de relevos por mes (Step 3.1) ──────────
  const handleSaveReliefLimits = async () => {
    if (!config) return
    const pub  = config.relief_limit_publicador
    const prec = config.relief_limit_precursor
    if (isNaN(pub)  || pub  < 0 || pub  > 10 ||
        isNaN(prec) || prec < 0 || prec > 10) {
      alert('Los valores deben estar entre 0 y 10.')
      return
    }
    setReliefLimitSaving(true)
    setReliefLimitSavedMsg(false)
    const { error } = await supabase
      .from('app_config')
      .update({ relief_limit_publicador: pub, relief_limit_precursor: prec })
      .eq('id', config.id)
      .eq('congregation_id', congregationId)
    if (error) {
      alert('Error al guardar: ' + error.message)
    } else {
      setReliefLimitSavedMsg(true)
      setTimeout(() => setReliefLimitSavedMsg(false), 3000)
    }
    setReliefLimitSaving(false)
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

  // ─── Helpers para mostrar la semana activa ─────────────────
  function fmtWeekRange(weekStart: string) {
    const start = new Date(weekStart + 'T12:00:00')
    const end   = new Date(weekStart + 'T12:00:00')
    end.setDate(end.getDate() + 6)
    return {
      full: start.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      range: `${start.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      nextRange: (() => {
        const ns = new Date(start); ns.setDate(ns.getDate() + 7)
        const ne = new Date(ns);    ne.setDate(ne.getDate() + 6)
        return `${ns.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} – ${ne.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}`
      })(),
    }
  }
  const weekInfo = fmtWeekRange(config.active_week_start)

  return (
    <div className="space-y-6">

      {/* ══════════════════════════════════════════════════════
          SECCIÓN 0: SEMANA ACTIVA
          ══════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-1">🔄 Gestión práctica de semana</h2>
        <p className="text-sm text-gray-500 mb-5">
          Bloque rápido para pruebas y operación diaria como administrador.
          Estas acciones se aplican solo a tu congregación y piden doble confirmación de seguridad.
        </p>

        {/* Semana actual */}
        <div className="bg-indigo-50 border-2 border-indigo-300 rounded-xl px-5 py-4 mb-5">
          <p className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wide mb-1">Semana abierta actualmente</p>
          <p className="text-xl font-bold text-indigo-800 capitalize">{weekInfo.range}</p>
          <p className="text-xs text-indigo-500 mt-0.5 capitalize">Empieza el {weekInfo.full}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <button
            onClick={() => handleWeekQuickAction('advance_only')}
            disabled={weekActionLoading !== null}
            className="text-left rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 hover:bg-indigo-100 transition disabled:opacity-60"
          >
            <p className="text-sm font-bold text-indigo-800">Abrir siguiente semana (sin tocar cupos)</p>
            <p className="text-xs text-indigo-700 mt-1">
              Avanza a <strong className="capitalize">{weekInfo.nextRange}</strong> respetando reservas ya cargadas.
            </p>
            <p className="text-[11px] text-indigo-600 mt-2">
              {weekActionLoading === 'advance_only' ? 'Procesando...' : '⚠️ Pide confirmación de seguridad'}
            </p>
          </button>

          <button
            onClick={() => handleWeekQuickAction('reset_current')}
            disabled={weekActionLoading !== null}
            className="text-left rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition disabled:opacity-60"
          >
            <p className="text-sm font-bold text-amber-800">Reiniciar semana en curso</p>
            <p className="text-xs text-amber-700 mt-1">
              Deja la semana actual en cero: cancela reservas activas y pendientes operativas.
            </p>
            <p className="text-[11px] text-amber-600 mt-2">
              {weekActionLoading === 'reset_current' ? 'Procesando...' : '⚠️ Pide confirmación de seguridad'}
            </p>
          </button>

          <button
            onClick={() => handleWeekQuickAction('advance_blank')}
            disabled={weekActionLoading !== null}
            className="text-left rounded-xl border border-red-200 bg-red-50 px-4 py-3 hover:bg-red-100 transition disabled:opacity-60"
          >
            <p className="text-sm font-bold text-red-800">Abrir nueva semana en blanco</p>
            <p className="text-xs text-red-700 mt-1">
              Avanza a <strong className="capitalize">{weekInfo.nextRange}</strong> y deja turnos vacíos.
            </p>
            <p className="text-[11px] text-red-600 mt-2">
              {weekActionLoading === 'advance_blank' ? 'Procesando...' : '⚠️ Pide confirmación de seguridad'}
            </p>
          </button>

          <button
            onClick={() => handleWeekQuickAction('advance_keep')}
            disabled={weekActionLoading !== null}
            className="text-left rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 hover:bg-emerald-100 transition disabled:opacity-60"
          >
            <p className="text-sm font-bold text-emerald-800">Abrir nueva semana manteniendo cupos</p>
            <p className="text-xs text-emerald-700 mt-1">
              Avanza a <strong className="capitalize">{weekInfo.nextRange}</strong> copiando reservas actuales.
            </p>
            <p className="text-[11px] text-emerald-600 mt-2">
              {weekActionLoading === 'advance_keep' ? 'Procesando...' : '⚠️ Pide confirmación de seguridad'}
            </p>
          </button>
        </div>

        {weekActionMsg && (
          <div className="mt-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2">
            ✅ {weekActionMsg}
          </div>
        )}

        {weekActionError && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">
            ❌ {weekActionError}
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500">
          Este bloque ignora la ventana normal de apertura para facilitar pruebas controladas por administración.
        </p>
      </div>

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

      {/* ── Compensación de última semana — solo visible en modo semanal ── */}
      {config.counting_mode === 'weekly' && (
        <div className="bg-white rounded-xl border border-indigo-100 shadow-sm p-5 mt-2">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-bold text-gray-800">📅 Compensación en última semana del mes</h3>
              <p className="text-xs text-gray-500 mt-1">
                Cuando está activa, en la última semana del mes los usuarios pueden agendar
                más turnos para compensar los que no usaron. El límite semanal se reemplaza
                por la cuota mensual restante.
              </p>
            </div>
            <button
              onClick={() => setConfig(c => c ? { ...c, last_week_compensation: !c.last_week_compensation } : c)}
              aria-label="Activar o desactivar compensación de última semana"
              className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors ${
                config.last_week_compensation ? 'bg-indigo-500' : 'bg-gray-300'
              }`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
                config.last_week_compensation ? 'left-7' : 'left-1'
              }`} />
            </button>
          </div>

          {config.last_week_compensation ? (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-800 mb-3">
              ✅ <strong>Activo.</strong> En la última semana del mes:<br />
              <span className="text-indigo-600">
                Publicador: hasta 4 turnos · Precursor Regular: hasta 8 · Precursor Auxiliar: hasta 6
              </span>
              <br />
              <span className="text-indigo-500">Solo se cuentan los turnos ya tomados ese mes.</span>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-500 mb-3">
              ⬜ Desactivado — límite semanal normal aplica toda la semana.
            </div>
          )}

          {compensationSavedMsg && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg px-3 py-2 mb-3">
              ✅ Compensación guardada. Los usuarios verán el cambio al recargar.
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSaveLastWeekCompensation}
              disabled={compensationSaving}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-60"
            >
              {compensationSaving ? 'Guardando...' : '💾 Guardar compensación'}
            </button>
          </div>
        </div>
      )}

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

        {/* Día y hora de apertura — siempre visible */}
        <div className="space-y-5">
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

            {/* ── Preview: próxima apertura calculada ───────────── */}
            {(() => {
              const [h, m] = config.booking_opens_time.split(':').map(Number)
              const now = new Date()
              const base = new Date(now)
              base.setHours(h, m, 0, 0)
              let daysUntil = config.booking_opens_day - now.getDay()
              if (daysUntil < 0) daysUntil += 7
              if (daysUntil === 0 && now >= base) daysUntil = 7
              base.setDate(base.getDate() + daysUntil)

              // Lunes de la semana que contiene la apertura (= week_start en reservas)
              const dow = base.getDay()
              const daysFromMon = dow === 0 ? 6 : dow - 1
              const weekMonday = new Date(base)
              weekMonday.setDate(base.getDate() - daysFromMon)

              const fmtOpening = base.toLocaleDateString('es-CO', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })
              const hora = base.toLocaleTimeString('es-CO', {
                hour: '2-digit', minute: '2-digit', hour12: true,
              })
              const fmtWeek = weekMonday.toLocaleDateString('es-CO', {
                weekday: 'long', day: 'numeric', month: 'long',
              })
              const DAYS_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
              const openingDayName = DAYS_ES[config.booking_opens_day]

              return (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wide mb-2">
                    🗓️ Vista previa — próxima apertura
                  </p>
                  <p className="text-sm font-bold text-indigo-800 capitalize">{fmtOpening}</p>
                  <p className="text-sm text-indigo-600 mt-0.5">a las <strong>{hora}</strong></p>
                  <p className="text-[11px] text-indigo-400 mt-2">
                    📋 Al abrir, los usuarios reservarán turnos de la semana del <strong className="text-indigo-500 capitalize">{fmtWeek}</strong>.
                    Cada {openingDayName} el sistema reinicia — los turnos quedan libres para la nueva semana.
                  </p>
                </div>
              )
            })()}
        </div>

        {config.priority_enabled && (
          <div className="space-y-5">
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

      {/* ══════════════════════════════════════════════════════
          SECCIÓN 3: VENTANA DE CANCELACIÓN
          ══════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-1">⏱️ Ventana de Cancelación</h2>
        <p className="text-sm text-gray-500 mb-5">
          Tiempo (en minutos) que tiene un usuario para cancelar su reserva
          directamente tras haberla hecho. Después de ese tiempo solo podrá
          pedir relevo.
        </p>

        {/* Presets rápidos */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[1, 3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(min => (
            <button
              key={min}
              onClick={() => {
                setConfig(c => c ? { ...c, cancel_window_minutes: min } : c)
                setCancelManualInput('')
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition ${
                config.cancel_window_minutes === min
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {min} min
            </button>
          ))}
        </div>

        {/* Input manual */}
        <div className="flex items-center gap-3 mb-5">
          <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">O escribe manualmente:</label>
          <input
            type="number"
            min={1} max={60}
            value={cancelManualInput}
            onChange={e => {
              setCancelManualInput(e.target.value)
              const val = parseInt(e.target.value)
              if (!isNaN(val) && val >= 1 && val <= 60) {
                setConfig(c => c ? { ...c, cancel_window_minutes: val } : c)
              }
            }}
            placeholder={String(config.cancel_window_minutes)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="text-sm text-gray-500">minutos (1–60)</span>
        </div>

        {/* Valor actual */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800 mb-5">
          ⏱️ Ventana actual: <strong>{config.cancel_window_minutes} minuto{config.cancel_window_minutes !== 1 ? 's' : ''}</strong>.
          Tras ese tiempo, el botón «Cancelar» desaparece y el usuario solo puede pedir relevo.
        </div>

        {cancelSavedMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">
            ✅ Ventana de cancelación actualizada. Los usuarios verán el cambio al recargar.
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSaveCancelWindow}
            disabled={cancelSaving}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-60"
          >
            {cancelSaving ? 'Guardando...' : '💾 Guardar ventana'}
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECCIÓN 4: ANTICIPACIÓN MÍNIMA PARA RESERVAR (Step 1.2)
          ══════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-1">⏱ Horas mínimas de anticipación para reservar</h2>
        <p className="text-sm text-gray-500 mb-5">
          Si faltan menos de 15 minutos para el turno, el usuario verá un aviso amarillo
          al reservar. Los turnos ya pasados se muestran bloqueados (⛔ Pasado).
          Este campo define el umbral &quot;DISPONIBLE&quot; vs &quot;PRÓXIMO&quot; (0–48 h).
        </p>

        {/* Presets rápidos */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[0, 1, 2, 3, 6, 12, 24, 48].map(h => (
            <button
              key={h}
              onClick={() => setConfig(c => c ? { ...c, min_advance_hours: h } : c)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition ${
                config.min_advance_hours === h
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>

        {/* Input manual */}
        <div className="flex items-center gap-3 mb-5">
          <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">O escribe manualmente:</label>
          <input
            type="number"
            min={0} max={48}
            value={config.min_advance_hours}
            onChange={e => {
              const val = parseInt(e.target.value)
              if (!isNaN(val) && val >= 0 && val <= 48) {
                setConfig(c => c ? { ...c, min_advance_hours: val } : c)
              }
            }}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="text-sm text-gray-500">horas (0–48)</span>
        </div>

        {/* Valor actual */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800 mb-5">
          ⏱ Anticipo actual: <strong>{config.min_advance_hours} hora{config.min_advance_hours !== 1 ? 's' : ''}</strong>.
          Los turnos con menos de 15 minutos muestran aviso ⚠️; los pasados muestran ⛔.
        </div>

        {advanceSavedMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">
            ✅ Anticipación mínima actualizada. Los usuarios verán el cambio al recargar.
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSaveMinAdvanceHours}
            disabled={advanceSaving}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-60"
          >
            {advanceSaving ? 'Guardando...' : '💾 Guardar anticipación'}
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          SECCIÓN 5: LÍMITES DE RELEVOS POR MES (Step 3.1)
          ══════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-1">🔄 Límites de relevos por mes</h2>
        <p className="text-sm text-gray-500 mb-5">
          Define cuántos relevos puede <strong>aceptar</strong> cada tipo de usuario por mes.
          No afecta cuántos relevos puede <em>pedir</em>.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-5">
          {/* Publicador */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">
              👤 Publicador — relevos que puede aceptar/mes
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[0, 1, 2, 3].map(v => (
                <button
                  key={v}
                  onClick={() => setConfig(c => c ? { ...c, relief_limit_publicador: v } : c)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition ${
                    config.relief_limit_publicador === v
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <input
              type="number" min={0} max={10}
              value={config.relief_limit_publicador}
              onChange={e => {
                const val = parseInt(e.target.value)
                if (!isNaN(val) && val >= 0 && val <= 10) {
                  setConfig(c => c ? { ...c, relief_limit_publicador: val } : c)
                }
              }}
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="text-[11px] text-gray-400 mt-1">Mín. 0, máx. 10</p>
          </div>

          {/* Precursor */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">
              ⭐ Precursor (aux / regular) — relevos que puede aceptar/mes
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[0, 1, 2, 3, 4].map(v => (
                <button
                  key={v}
                  onClick={() => setConfig(c => c ? { ...c, relief_limit_precursor: v } : c)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition ${
                    config.relief_limit_precursor === v
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <input
              type="number" min={0} max={10}
              value={config.relief_limit_precursor}
              onChange={e => {
                const val = parseInt(e.target.value)
                if (!isNaN(val) && val >= 0 && val <= 10) {
                  setConfig(c => c ? { ...c, relief_limit_precursor: val } : c)
                }
              }}
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="text-[11px] text-gray-400 mt-1">Mín. 0, máx. 10</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800 mb-5">
          Límites actuales: publicadores{' '}
          <strong>{config.relief_limit_publicador}/mes</strong>,{' '}
          precursores <strong>{config.relief_limit_precursor}/mes</strong>.
        </div>

        {reliefLimitSavedMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2 mb-4">
            ✅ Límites de relevos actualizados. Los usuarios verán el cambio al recargar.
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSaveReliefLimits}
            disabled={reliefLimitSaving}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-60"
          >
            {reliefLimitSaving ? 'Guardando...' : '💾 Guardar límites'}
          </button>
        </div>
      </div>
    </div>
  )
}
