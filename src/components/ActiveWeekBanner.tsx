/**
 * components/ActiveWeekBanner.tsx — Banner de semana activa de agendamiento
 * ─────────────────────────────────────────────────────────────
 * Muestra la semana para la que se están tomando reservas actualmente,
 * leyendo `active_week_start` de app_config.
 * Se actualiza automáticamente cuando el admin avanza la semana.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function formatWeekRange(weekStart: string): string {
  // weekStart es el lunes: 'YYYY-MM-DD'
  const monday = new Date(weekStart + 'T00:00:00')
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const diaLunes  = monday.getDate()
  const diaDomingo = sunday.getDate()
  const mesLunes   = monday.getMonth()
  const mesDomingo = sunday.getMonth()
  const año        = sunday.getFullYear()

  if (mesLunes === mesDomingo) {
    // Mismo mes: "16 al 22 de marzo de 2026"
    return `del ${diaLunes} al ${diaDomingo} de ${MESES[mesDomingo]} de ${año}`
  } else {
    // Distinto mes (cruce de mes): "30 de marzo al 5 de abril de 2026"
    return `del ${diaLunes} de ${MESES[mesLunes]} al ${diaDomingo} de ${MESES[mesDomingo]} de ${año}`
  }
}

export default function ActiveWeekBanner() {
  const { user } = useUser()
  const supabase  = createClient()
  const [weekLabel, setWeekLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.congregation_id) return
    const fetchWeek = async () => {
      const { data } = await supabase
        .from('app_config')
        .select('active_week_start')
        .eq('congregation_id', user.congregation_id)
        .limit(1)
        .single()
      if (data?.active_week_start) {
        setWeekLabel(formatWeekRange(data.active_week_start as string))
      }
    }
    fetchWeek()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.congregation_id])

  if (!weekLabel) return null

  return (
    <div className="mb-3 flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-800 text-sm font-medium">
      <span>📅</span>
      <span>Agendamiento de la semana <strong>{weekLabel}</strong></span>
    </div>
  )
}
