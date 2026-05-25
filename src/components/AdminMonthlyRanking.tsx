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
  // ─── Estado del modal de crear/editar grupo ──────────────
  const [downloadingPNG, setDownloadingPNG] = useState(false)
  const [downloadingPDF, setDownloadingPDF] = useState(false)
  const [exportingGroupPNG, setExportingGroupPNG] = useState<string | null>(null)
  const [exportingGroupPDF, setExportingGroupPDF] = useState<string | null>(null)
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

  /**
   * Genera HTML con estilos inline para exportación.
   * Evita usar clases de Tailwind que contengan lab().
   */
  function buildRankingHtml(
    filterGroupId?: string,
  ): string {
    if (!data) return ''
    const label = data.monthLabel

    function rowHtml(label: string, style: string): string {
      return `<td style="padding:6px 10px;border:1px solid #ddd;${style}">${label}</td>`
    }
    function cellHtml(val: string | number, style = ''): string {
      return `<td style="padding:6px 10px;border:1px solid #ddd;text-align:center;${style}">${val}</td>`
    }

    const groupsToRender = filterGroupId
      ? data.groups.filter((g) => g.id === filterGroupId)
      : data.groups

    let html = `<div style="background:#fff;color:#374151;font-family:sans-serif;padding:24px;max-width:1200px">`

    // Encabezado
    html += `<div style="margin-bottom:20px">`
    html += `<h2 style="font-size:20px;font-weight:bold;margin:0 0 4px">Ranking Mensual de Uso de Exhibidores</h2>`
    html += `<p style="font-size:14px;color:#6b7280;margin:0">${label}</p>`
    html += `<p style="font-size:12px;color:#9ca3af;margin:4px 0 0">Total de asignaciones: ${data.totals.totalAssignments}</p>`
    html += `</div>`

    // Cada grupo
    for (const group of groupsToRender) {
      if (group.members.length === 0) continue

      html += `<div style="margin-bottom:32px">`
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">`
      html += `<h3 style="font-size:16px;font-weight:bold;color:#4338ca;margin:0">${group.name}</h3>`
      html += `<span style="font-size:13px;color:#6b7280">Capitán: <b style="color:#374151">${group.captain_name}</b> · Total: <b style="color:#4338ca">${group.totalAssignments}</b></span>`
      html += `</div>`

      html += `<table style="width:100%;border-collapse:collapse;font-size:13px">`
      html += `<thead><tr style="background:#f3f4f6">`
      html += rowHtml('Publicador', 'text-align:left;font-weight:600;color:#374151')
      html += rowHtml('Tipo', 'text-align:left;font-weight:600;color:#374151')
      for (const ex of allExhibitors) {
        html += cellHtml(ex, 'font-weight:600;color:#374151;font-size:12px;white-space:nowrap')
      }
      html += cellHtml('Total', 'font-weight:600;color:#374151')
      html += `</tr></thead><tbody>`

      for (const m of group.members) {
        const tipo = m.user_type === 'precursor_regular' ? 'PR' : m.user_type === 'precursor_auxiliar' ? 'PA' : 'Pub'
        html += `<tr style="background:#fafafa">`
        html += rowHtml(m.name, 'text-align:left;font-weight:500;color:#1f2937;white-space:nowrap')
        html += rowHtml(tipo, 'text-align:left;font-size:12px;color:#6b7280;white-space:nowrap')
        for (const ex of allExhibitors) {
          html += cellHtml(m.exhibitors[ex] ?? '-', 'color:#374151')
        }
        html += cellHtml(String(m.totalAssignments), 'font-weight:700;color:#4338ca')
        html += `</tr>`
      }

      // Fila total del grupo
      html += `<tr style="background:#eef2ff">`
      html += rowHtml(`Total ${group.name}`, 'text-align:left;font-weight:700;color:#374151;padding:6px 10px;border:1px solid #ddd')
      html += rowHtml('', 'text-align:left;padding:6px 10px;border:1px solid #ddd')
      for (const ex of allExhibitors) {
        const totalEx = group.members.reduce((s, m) => s + (m.exhibitors[ex] ?? 0), 0)
        html += cellHtml(totalEx > 0 ? String(totalEx) : '-', 'font-weight:600;color:#4338ca')
      }
      html += cellHtml(String(group.totalAssignments), 'font-weight:700;color:#4338ca')
      html += `</tr>`

      html += `</tbody></table></div>`
    }

    // Sin grupo
    if (data.ungrouped.length > 0 && !filterGroupId) {
      html += `<div style="margin-bottom:24px">`
      html += `<h4 style="font-size:14px;font-weight:bold;color:#6b7280;margin:0 0 12px">Sin grupo asignado</h4>`
      html += `<table style="width:100%;border-collapse:collapse;font-size:13px">`
      html += `<thead><tr style="background:#f3f4f6">`
      html += rowHtml('Publicador', 'text-align:left;font-weight:600;color:#374151')
      for (const ex of allExhibitors) {
        html += cellHtml(ex, 'font-weight:600;color:#374151;font-size:12px')
      }
      html += cellHtml('Total', 'font-weight:600;color:#374151')
      html += `</tr></thead><tbody>`
      for (const m of data.ungrouped) {
        html += `<tr style="background:#fafafa">`
        html += rowHtml(m.name, 'text-align:left;font-weight:500;color:#1f2937')
        for (const ex of allExhibitors) {
          html += cellHtml(m.exhibitors[ex] ?? '-', 'color:#374151')
        }
        html += cellHtml(String(m.totalAssignments), 'font-weight:700;color:#374151')
        html += `</tr>`
      }
      html += `</tbody></table></div>`
    }

    // Pie
    html += `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af">`
    html += `<span>Generado por el sistema de agendamiento de exhibidores</span>`
    html += `<span>${label}</span>`
    html += `</div>`
    html += `</div>`

    return html
  }

  /**
   * Exporta a PNG o PDF usando HTML con estilos inline.
   * evita el error 'lab()' de html2canvas con Tailwind.
   */
  const handleExport = async (type: 'png' | 'pdf', groupId?: string, groupName?: string) => {
    if (!data) return
    if (type === 'png') {
      if (groupId) setExportingGroupPNG(groupId)
      else setDownloadingPNG(true)
    } else {
      if (groupId) setExportingGroupPDF(groupId)
      else setDownloadingPDF(true)
    }
    try {
      const html2canvasModule = await import('html2canvas')
      const h2c = html2canvasModule.default ?? html2canvasModule

      const mountNode = document.createElement('div')
      mountNode.style.position = 'fixed'
      mountNode.style.left = '-10000px'
      mountNode.style.top = '0'
      mountNode.style.pointerEvents = 'none'
      mountNode.innerHTML = buildRankingHtml(groupId)
      document.body.appendChild(mountNode)

      const el = (mountNode.firstElementChild as HTMLElement) ?? mountNode

      const canvas = await h2c(el, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      document.body.removeChild(mountNode)

      const baseName = groupId && groupName
        ? `ranking-${groupName.toLowerCase().replace(/\s+/g, '-')}`
        : `ranking-${data.monthLabel.toLowerCase().replace(/\s+/g, '-')}`

      if (type === 'png') {
        const a = document.createElement('a')
        a.href = canvas.toDataURL('image/png', 1.0)
        a.download = `${baseName}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
      } else {
        const { jsPDF } = await import('jspdf')
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
        pdf.save(`${baseName}.pdf`)
      }
    } catch (err) {
      console.error(`Error exportando ${type}:`, err)
      setError(`No se pudo generar el ${type.toUpperCase()}.`)
    } finally {
      if (type === 'png') {
        if (groupId) setExportingGroupPNG(null)
        else setDownloadingPNG(false)
      } else {
        if (groupId) setExportingGroupPDF(null)
        else setDownloadingPDF(false)
      }
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

      {/* ─── Botones de exportación global ──────────────── */}
      {data && data.totals.totalAssignments > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => handleExport('png')}
            disabled={downloadingPNG}
            className="px-4 py-2 bg-slate-700 text-white text-sm rounded-lg font-medium
                       hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {downloadingPNG ? 'Generando...' : '⬇️ PNG Global'}
          </button>
          <button
            onClick={() => handleExport('pdf')}
            disabled={downloadingPDF}
            className="px-4 py-2 bg-rose-600 text-white text-sm rounded-lg font-medium
                       hover:bg-rose-700 disabled:opacity-50 transition-colors"
          >
            {downloadingPDF ? 'Generando...' : '⬇️ PDF Global'}
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
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h4 className="font-bold text-indigo-800">
                    👥 {group.name}
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm text-gray-500">
                      Capitán: <span className="font-medium text-gray-700">{group.captain_name}</span>
                      {' · '}Total: <span className="font-bold text-indigo-600">{group.totalAssignments}</span>
                    </div>
                    <button
                      onClick={() => handleExport('png', group.id, group.name)}
                      disabled={exportingGroupPNG === group.id}
                      className="px-2 py-1 bg-slate-600 text-white text-xs rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
                      title="Descargar PNG de este grupo"
                    >
                      {exportingGroupPNG === group.id ? '...' : '⬇ PNG'}
                    </button>
                    <button
                      onClick={() => handleExport('pdf', group.id, group.name)}
                      disabled={exportingGroupPDF === group.id}
                      className="px-2 py-1 bg-rose-600 text-white text-xs rounded hover:bg-rose-700 disabled:opacity-50 transition-colors"
                      title="Descargar PDF de este grupo"
                    >
                      {exportingGroupPDF === group.id ? '...' : '⬇ PDF'}
                    </button>
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