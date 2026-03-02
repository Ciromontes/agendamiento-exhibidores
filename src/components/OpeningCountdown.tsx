/**
 * components/OpeningCountdown.tsx — Anuncio de próxima apertura de reservas
 * ─────────────────────────────────────────────────────────────
 * Muestra un banner de cuenta regresiva en el dashboard del usuario
 * indicando cuándo puede empezar a reservar la próxima semana.
 *
 * Lee la configuración de la tabla app_config:
 *   - booking_opens_day   → Día de apertura (0=Dom … 6=Sáb)
 *   - booking_opens_time  → Hora de apertura base ('HH:mm:ss')
 *   - priority_mode       → 'none' | 'precursor_first' | 'tiered'
 *   - priority_hours_auxiliar   → offset horas para Auxiliar
 *   - priority_hours_publicador → offset horas para Publicador
 *
 * Estados del banner:
 *   1. Conteo regresivo > 24h  → "Reservas abren el [día] [fecha] a las [hora]"
 *   2. Conteo regresivo < 24h  → Reloj de cuenta regresiva visible
 *   3. Apertura general pero no turno del usuario aún → "Tu turno empieza a las X"
 *   4. Dentro del turno del usuario → Banner desaparece (puede reservar)
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import type { AppConfig } from '@/types'

// ─── Nombres de días en español ──────────────────────────────
const DAY_NAMES: Record<number, string> = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles',
  4: 'Jueves', 5: 'Viernes', 6: 'Sábado',
}

// ─── Labels de tipo de usuario ────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  precursor_regular:  'Precursor Regular',
  precursor_auxiliar: 'Precursor Auxiliar',
  publicador:         'Publicador',
}

/**
 * Calcula la fecha/hora de la próxima apertura base.
 * Si el día de apertura es HOY pero la hora ya pasó → siguiente semana.
 */
function getBaseOpening(config: AppConfig): Date {
  const now = new Date()
  const [h, m] = config.booking_opens_time.split(':').map(Number)

  const base = new Date(now)
  base.setHours(h, m, 0, 0)

  let daysUntil = config.booking_opens_day - now.getDay()
  if (daysUntil < 0) daysUntil += 7
  // Mismo día pero ya pasó la hora → próxima semana
  if (daysUntil === 0 && now >= base) daysUntil = 7

  base.setDate(base.getDate() + daysUntil)
  return base
}

/**
 * Calcula la apertura específica para el tipo de usuario,
 * aplicando los offsets de prioridad.
 */
function getUserOpening(config: AppConfig, userType: string): Date {
  const base = getBaseOpening(config)
  if (!config.priority_enabled || config.priority_mode === 'none') return base

  let extraHours = 0
  if (config.priority_mode === 'precursor_first') {
    // Regular + Auxiliar → hora base; Publicador → base + N horas
    if (userType === 'publicador') extraHours = config.priority_hours_publicador
  } else if (config.priority_mode === 'tiered') {
    // Regular → base; Auxiliar → base + N₁; Publicador → base + N₂
    if (userType === 'precursor_auxiliar') extraHours = config.priority_hours_auxiliar
    if (userType === 'publicador')         extraHours = config.priority_hours_publicador
  }

  return new Date(base.getTime() + extraHours * 3600 * 1000)
}

/**
 * Formatea una Date a "sábado 7 de marzo a las 11:15 a.m."
 */
function formatFechaHora(dt: Date): { fecha: string; hora: string } {
  const dayName  = DAY_NAMES[dt.getDay()]
  const day      = dt.getDate()
  const monthStr = dt.toLocaleString('es-CO', { month: 'long' })
  const hora     = dt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
  return { fecha: `${dayName} ${day} de ${monthStr}`, hora }
}

/**
 * Devuelve { days, hours, minutes, seconds } del tiempo restante.
 */
function getTimeLeft(target: Date): { days: number; hours: number; minutes: number; seconds: number; total: number } {
  const total = target.getTime() - Date.now()
  if (total <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 }
  const seconds = Math.floor((total / 1000) % 60)
  const minutes = Math.floor((total / 1000 / 60) % 60)
  const hours   = Math.floor((total / 1000 / 3600) % 24)
  const days    = Math.floor(total / 1000 / 3600 / 24)
  return { days, hours, minutes, seconds, total }
}

function pad(n: number) { return String(n).padStart(2, '0') }

// ─────────────────────────────────────────────────────────────

export default function OpeningCountdown() {
  const { user } = useUser()
  const supabase = createClient()

  const [config, setConfig]     = useState<AppConfig | null>(null)
  const [now, setNow]           = useState(new Date())
  const [visible, setVisible]   = useState(true)

  // Cargar config solo una vez
  useEffect(() => {
    supabase
      .from('app_config')
      .select('*')
      .single()
      .then(({ data }) => { if (data) setConfig(data as AppConfig) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualizar reloj cada segundo
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // No renderizar si no hay config, usuario, o el usuario ya cerró el banner manualmente
  if (!config || !user || !visible) return null

  const baseOpening = getBaseOpening(config)
  const userOpening = getUserOpening(config, user.user_type)

  // Si ya es el turno del usuario: ocultar el banner (puede reservar)
  if (now >= userOpening) return null

  const timeLeft      = getTimeLeft(userOpening)
  const baseTimeLeft  = getTimeLeft(baseOpening)
  const baseOpen      = now >= baseOpening    // Apertura general ya ocurrió
  const dayName       = DAY_NAMES[baseOpening.getDay()]
  const { fecha, hora: horaBase } = formatFechaHora(baseOpening)
  const { hora: horaUser }        = formatFechaHora(userOpening)

  const showClock = timeLeft.total < 24 * 3600 * 1000  // Últimas 24h → reloj
  const openingSoon = timeLeft.total < 3600 * 1000       // Últimos 60 min → "pronto"

  // ─── Calcular horario escalonado para mostrar en tabla ────
  const hasPriority = config.priority_enabled && config.priority_mode !== 'none'
  const staggerRows: { label: string; dt: Date }[] = []
  if (hasPriority) {
    staggerRows.push({ label: 'Precursor Regular', dt: baseOpening })
    if (config.priority_mode === 'precursor_first') {
      staggerRows.push({ label: 'Precursor Auxiliar', dt: baseOpening })
      staggerRows.push({
        label: 'Publicador',
        dt: new Date(baseOpening.getTime() + config.priority_hours_publicador * 3600 * 1000),
      })
    } else if (config.priority_mode === 'tiered') {
      staggerRows.push({
        label: 'Precursor Auxiliar',
        dt: new Date(baseOpening.getTime() + config.priority_hours_auxiliar * 3600 * 1000),
      })
      staggerRows.push({
        label: 'Publicador',
        dt: new Date(baseOpening.getTime() + config.priority_hours_publicador * 3600 * 1000),
      })
    }
  }

  // Color del banner según estado
  const bannerClass = baseOpen
    ? 'bg-amber-50 border-amber-300'       // Apertura general ya fue, esperando turno
    : openingSoon
      ? 'bg-indigo-50 border-indigo-400'   // Menos de 1 hora
      : 'bg-blue-50 border-blue-300'       // Más de 1 hora

  return (
    <div className={`relative mb-5 rounded-2xl border-2 shadow-sm px-5 py-4 ${bannerClass}`}>
      {/* Botón cerrar */}
      <button
        onClick={() => setVisible(false)}
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-lg leading-none"
        title="Cerrar anuncio"
      >
        ×
      </button>

      {/* ── Estado: apertura general ya ocurrió pero es el turno de otro tipo ── */}
      {baseOpen ? (
        <div className="flex items-start gap-3">
          <span className="text-2xl">⏳</span>
          <div>
            <p className="font-bold text-amber-900 text-sm">
              Las reservas ya están abiertas para algunos
            </p>
            <p className="text-amber-800 text-sm mt-0.5">
              Tu turno como <strong>{TYPE_LABELS[user.user_type]}</strong> comienza
              hoy a las <strong>{horaUser}</strong>.
            </p>
            {/* Reloj de cuenta regresiva */}
            <div className="mt-3 flex gap-2">
              {['Horas', 'Minutos', 'Segundos'].map((label, i) => {
                const val = [timeLeft.hours, timeLeft.minutes, timeLeft.seconds][i]
                return (
                  <div key={label} className="bg-amber-100 border border-amber-300 rounded-xl px-4 py-2 text-center min-w-[64px]">
                    <span className="text-2xl font-mono font-bold text-amber-900">{pad(val)}</span>
                    <p className="text-[10px] text-amber-600 mt-0.5">{label}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        // ── Estado: aún no ha abierto la ventana de reservas ──
        <div>
          <div className="flex items-start gap-3">
            <span className="text-2xl">{openingSoon ? '🚀' : '📅'}</span>
            <div className="flex-1">
              <p className={`font-bold text-sm ${openingSoon ? 'text-indigo-800' : 'text-blue-900'}`}>
                {openingSoon
                  ? '¡Las reservas abren muy pronto!'
                  : `Próxima apertura de reservas — ${dayName}`}
              </p>

              {/* Mensaje principal con fecha */}
              {!openingSoon && (
                <p className="text-blue-800 text-sm mt-0.5">
                  Las reservas para la próxima semana abren el{' '}
                  <strong>{fecha}</strong> a las <strong>{horaBase}</strong>.
                  {hasPriority && (
                    <span className="text-blue-600">
                      {' '}Tu ingreso (como {TYPE_LABELS[user.user_type]}) es a las <strong>{horaUser}</strong>.
                    </span>
                  )}
                </p>
              )}

              {/* Reloj de cuenta regresiva (últimas 24h o modo "pronto") */}
              {showClock && (
                <div className="mt-3 flex gap-2">
                  {timeLeft.days > 0 && (
                    <div className="bg-blue-100 border border-blue-300 rounded-xl px-4 py-2 text-center min-w-[64px]">
                      <span className="text-2xl font-mono font-bold text-blue-900">{pad(timeLeft.days)}</span>
                      <p className="text-[10px] text-blue-600 mt-0.5">Días</p>
                    </div>
                  )}
                  {[
                    { label: 'Horas',    val: timeLeft.hours },
                    { label: 'Minutos',  val: timeLeft.minutes },
                    { label: 'Segundos', val: timeLeft.seconds },
                  ].map(({ label, val }) => (
                    <div key={label} className={`border rounded-xl px-4 py-2 text-center min-w-[64px] ${
                      openingSoon
                        ? 'bg-indigo-100 border-indigo-300'
                        : 'bg-blue-100 border-blue-300'
                    }`}>
                      <span className={`text-2xl font-mono font-bold ${openingSoon ? 'text-indigo-900' : 'text-blue-900'}`}>
                        {pad(val)}
                      </span>
                      <p className={`text-[10px] mt-0.5 ${openingSoon ? 'text-indigo-600' : 'text-blue-600'}`}>
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Apertura por fecha lejana (> 24h): solo texto, sin reloj */}
              {!showClock && (
                <p className="text-blue-600 text-xs mt-2">
                  Faltan{' '}
                  {timeLeft.days > 0 && `${timeLeft.days} día${timeLeft.days > 1 ? 's' : ''} y `}
                  {timeLeft.hours} hora{timeLeft.hours !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Tabla de horarios escalonados */}
          {hasPriority && staggerRows.length > 0 && (
            <div className="mt-4 border-t border-blue-200 pt-3">
              <p className="text-xs font-semibold text-blue-700 mb-2">🔒 Horario escalonado de apertura:</p>
              <div className="space-y-1.5">
                {staggerRows.map(row => {
                  const { hora: h } = formatFechaHora(row.dt)
                  const isMyType = row.label === TYPE_LABELS[user.user_type]
                  return (
                    <div
                      key={row.label}
                      className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 ${
                        isMyType
                          ? 'bg-indigo-100 border border-indigo-300 font-semibold text-indigo-800'
                          : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      <span>{isMyType ? '👤 ' : ''}{row.label}</span>
                      <span className="font-mono">{h}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
