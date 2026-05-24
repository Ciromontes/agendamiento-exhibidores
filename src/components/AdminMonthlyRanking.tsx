/**
 * components/AdminMonthlyRanking.tsx — V5: Ranking Mensual por Grupos
 * ─────────────────────────────────────────────────────────────
 * Muestra el ranking de uso de exhibidores por publicador y grupo
 * para un mes específico. Incluye exportación a PNG y PDF.
 *
 * Estructura:
 *   Por grupo: filas = publicadores, columnas = exhibidores + Total
 *   Totales del grupo al final de cada sección
 *   Usuarios sin grupo al final
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useUser } from '@/context/UserContext'

// ─── Tipos ───────────────────────────────────────────────────
type MemberRank = {
  id: string
  name: string
  user_type: string
  totalAssignments: number
  exhibitors: Record<string, number>
}

type GroupRank = {
  id: string
  name: string
  captain_name: string
  totalAssignments: number
  memberCount: number
  members: MemberRank[]
}

type RankingPayload = {
  ok: boolean
  year: number
  month: number
  monthLabel: string
  groups: GroupRank[]
  ungrouped: MemberRank[]
  totals: {
    totalGroups: number
    totalMembersInGroups: number
    totalUngrouped: number
    totalAssignments: number
    allExhibitors: string[]
  }
}

export default function AdminMonthlyRanking() {
  const { user } = useUser()
  const accessKey = user?.access_key ?? ''

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<RankingPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloadingPNG, setDownloadingPNG] = useState(false)
  const [downloadingPDF, setDownloadingPDF] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)

  const loadRanking = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/admin/reports/monthly-ranking?year=${year}&month=${month}`,
        { headers: { 'x-access-key': accessKey } },
      )
      const json = await res.json()
      if (json.ok) setData(json as RankingPayload)
      else setError(json.error ?? 'Error al cargar ranking.')
    } catch {
      setError('Error de conexión.')
    } finally {
      setLoading(false)
    }
  }, [year, month, accessKey])

  useEffect(() => {
    loadRanking()
  }, [loadRanking])

  // ─── Generar columnas de exhibidores ─────────────────────
  const allExhibitors = data?.totals.allExhibitors ?? []

  // ─── Exportar a PNG ───────────────────────────────────────
  const handleExportPNG = async () => {
    if (!reportRef.current) return
    setDownloadingPNG(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(reportRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png', 1.0)
      a.download = `ranking-${data?.monthLabel?.replace(/\s+/g, '-').toLowerCase()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setError('No se pudo generar el PNG.')
    } finally {
      setDownloadingPNG(false)
    }
  }

  // ─── Exportar a PDF ───────────────────────────────────────
  const handleExportPDF = async () => {
    if (!reportRef.current) return
    setDownloadingPDF(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')

      const canvas = await html2canvas(reportRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      const pxToPt = 72 / 96
      const pdfWidth = canvas.width * pxToPt
      const pdfHeight = canvas.height * pxToPt

      const pdf = new jsPDF({
        orientation: pdfWidth >= pdfHeight ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [pdfWidth, pdfHeight],
        compress: true,
      })

      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST')
      pdf.save(`ranking-${data?.monthLabel?.replace(/\s+/g, '-').toLowerCase()}.pdf`)
    } catch {
      setError('No se pudo generar el PDF.')
    } finally {
      setDownloadingPDF(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ─── Título y controles ───────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">
            📊 Ranking Mensual por Grupos
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Veces que cada publicador salió a los exhibidores en el mes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {[
              'Enero', 'Febrero', 'Marzo', 'Abril',
              'Mayo', 'Junio', 'Julio', 'Agosto',
              'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
            ].map((label, i) => (
              <option key={i} value={i + 1}>{label}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={loadRanking}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium
                       hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">❌ {error}</div>
      )}

      {/* ─── Botones de exportación ───────────────────────── */}
      {data && data.totals.totalAssignments > 0 && (
        <div className="flex gap-2">
          <button
            onClick={handleExportPNG}
            disabled={downloadingPNG}
            className="px-4 py-2 bg-slate-700 text-white text-sm rounded-lg font-medium
                       hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {downloadingPNG ? 'Generando...' : '⬇️ Descargar PNG'}
          </button>
          <button
            onClick={handleExportPDF}
            disabled={downloadingPDF}
            className="px-4 py-2 bg-rose-600 text-white text-sm rounded-lg font-medium
                       hover:bg-rose-700 disabled:opacity-50 transition-colors"
          >
            {downloadingPDF ? 'Generando...' : '⬇️ Descargar PDF'}
          </button>
        </div>
      )}

      {/* ─── Tabla de ranking (referencia para export) ────── */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando ranking...</div>
      ) : !data ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          Selecciona un mes y haz clic en &quot;Actualizar&quot;.
        </div>
      ) : data.totals.totalAssignments === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          No hay asignaciones registradas en {data.monthLabel}.
        </div>
      ) : (
        <div ref={reportRef} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto" style={{ padding: '24px' }}>
          {/* ─── Encabezado del reporte ──────────────────── */}
          <div className="mb-6">
            <h3 className="text-lg font-bold text-gray-900">Ranking Mensual de Uso de Exhibidores</h3>
            <p className="text-sm text-gray-500">{data.monthLabel}</p>
            <p className="text-xs text-gray-400 mt-1">
              Total de asignaciones: {data.totals.totalAssignments} — Grupos: {data.totals.totalGroups} — Miembros en grupos: {data.totals.totalMembersInGroups}
            </p>
          </div>

          {/* ─── Por cada grupo ──────────────────────────── */}
          {data.groups.map((group) => {
            if (group.members.length === 0) return null
            return (
              <div key={group.id} className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-indigo-800">
                    👥 {group.name}
                  </h4>
                  <div className="text-sm text-gray-500">
                    Capitán: <span className="font-medium text-gray-700">{group.captain_name}</span>
                    {' · '}Total: <span className="font-bold text-indigo-600">{group.totalAssignments}</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm" style={{ minWidth: '600px' }}>
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-gray-700">
                          Publicador
                        </th>
                        <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-gray-700">
                          Tipo
                        </th>
                        {allExhibitors.map((ex) => (
                          <th key={ex} className="text-center px-2 py-2 border border-gray-200 font-semibold text-gray-700 text-xs whitespace-nowrap">
                            {ex}
                          </th>
                        ))}
                        <th className="text-center px-3 py-2 border border-gray-200 font-semibold text-gray-700">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.members.map((m) => (
                        <tr key={m.id} className="hover:bg-gray-50 even:bg-gray-50/50">
                          <td className="px-3 py-2 border border-gray-200 font-medium text-gray-800 whitespace-nowrap">
                            {m.name}
                          </td>
                          <td className="px-3 py-2 border border-gray-200 text-gray-500 text-xs whitespace-nowrap">
                            {m.user_type === 'precursor_regular' ? 'PR' : m.user_type === 'precursor_auxiliar' ? 'PA' : 'Pub'}
                          </td>
                          {allExhibitors.map((ex) => (
                            <td key={ex} className="text-center px-2 py-2 border border-gray-200 text-gray-700 whitespace-nowrap">
                              {m.exhibitors[ex] ?? '-'}
                            </td>
                          ))}
                          <td className="text-center px-3 py-2 border border-gray-200 font-bold text-indigo-700">
                            {m.totalAssignments}
                          </td>
                        </tr>
                      ))}
                      {/* Fila total del grupo */}
                      <tr className="bg-indigo-50">
                        <td className="px-3 py-2 border border-gray-200 font-bold text-gray-700" colSpan={2}>
                          Total {group.name}
                        </td>
                        {allExhibitors.map((ex) => {
                          const totalEx = group.members.reduce(
                            (sum, m) => sum + (m.exhibitors[ex] ?? 0), 0,
                          )
                          return (
                            <td key={ex} className="text-center px-2 py-2 border border-gray-200 font-semibold text-indigo-700 whitespace-nowrap">
                              {totalEx > 0 ? totalEx : '-'}
                            </td>
                          )
                        })}
                        <td className="text-center px-3 py-2 border border-gray-200 font-bold text-indigo-700">
                          {group.totalAssignments}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* ─── Usuarios sin grupo ───────────────────────── */}
          {data.ungrouped.length > 0 && (
            <div className="mb-4">
              <h4 className="font-bold text-gray-600 mb-3">👤 Sin grupo asignado</h4>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" style={{ minWidth: '400px' }}>
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="text-left px-3 py-2 border border-gray-200 font-semibold text-gray-700">Publicador</th>
                      {allExhibitors.map((ex) => (
                        <th key={ex} className="text-center px-2 py-2 border border-gray-200 font-semibold text-gray-700 text-xs">{ex}</th>
                      ))}
                      <th className="text-center px-3 py-2 border border-gray-200 font-semibold text-gray-700">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ungrouped.map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50 even:bg-gray-50/50">
                        <td className="px-3 py-2 border border-gray-200 font-medium text-gray-800">{m.name}</td>
                        {allExhibitors.map((ex) => (
                          <td key={ex} className="text-center px-2 py-2 border border-gray-200 text-gray-700">
                            {m.exhibitors[ex] ?? '-'}
                          </td>
                        ))}
                        <td className="text-center px-3 py-2 border border-gray-200 font-bold text-gray-700">{m.totalAssignments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── Pie del reporte ─────────────────────────── */}
          <div className="mt-6 pt-4 border-t border-gray-200 flex justify-between text-xs text-gray-400">
            <span>Generado por el sistema de agendamiento de exhibidores</span>
            <span>{data.monthLabel} · Total asignaciones: {data.totals.totalAssignments}</span>
          </div>
        </div>
      )}
    </div>
  )
}