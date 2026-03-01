/**
 * components/AdminExhibitorManager.tsx — Fase 10C: Gestión de Exhibidores
 * ─────────────────────────────────────────────────────────────
 * CRUD completo para los puntos de exhibición (tabla `exhibitors`).
 *
 * Funcionalidades:
 *   • Listar todos los exhibidores (activos e inactivos)
 *   • Crear un nuevo exhibidor (nombre único)
 *   • Renombrar exhibidores existentes (edición inline)
 *   • Activar / Desactivar exhibidores (borrado lógico)
 *   • Contador de bloques horarios activos por exhibidor
 *   • Contador de reservas activas esta semana por exhibidor
 *   • Confirmación antes de desactivar (con advertencia si tiene reservas)
 *
 * Reglas:
 *   - El nombre debe tener al menos 3 caracteres
 *   - El nombre debe ser único (validado en BD)
 *   - Al desactivar un exhibidor, sus time_slots siguen existiendo
 *     pero no aparecen en la grilla de usuarios (filtran is_active)
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Exhibitor } from '@/types'

// ─── Tipo interno: exhibidor + contadores ────────────────────
type ExhibitorRow = Exhibitor & {
  slotsCount: number        // Bloques horarios activos
  reservationsCount: number // Reservas activas esta semana
}

/** Lunes de la semana actual (formato YYYY-MM-DD). */
function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.getFullYear(), now.getMonth(), diff)
  return monday.toISOString().split('T')[0]
}

export default function AdminExhibitorManager() {
  // ─── Estado ────────────────────────────────────────────────
  const [exhibitors, setExhibitors] = useState<ExhibitorRow[]>([])
  const [loading, setLoading] = useState(true)

  // Formulario de creación
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Edición inline de nombre
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Confirmación de desactivación
  const [confirmToggleId, setConfirmToggleId] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  // Filtro de visualización
  const [showInactive, setShowInactive] = useState(false)

  const supabase = createClient()
  const weekStart = getWeekStart()

  // ─── Cargar exhibidores con contadores ─────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)

    // 1. Todos los exhibidores
    const { data: exhData } = await supabase
      .from('exhibitors')
      .select('*')
      .order('name')

    if (!exhData) { setLoading(false); return }

    // 2. Contar time_slots activos por exhibidor
    const { data: slotsData } = await supabase
      .from('time_slots')
      .select('exhibitor_id')
      .eq('is_active', true)

    const slotCounts = new Map<string, number>()
    slotsData?.forEach(s => {
      slotCounts.set(s.exhibitor_id, (slotCounts.get(s.exhibitor_id) ?? 0) + 1)
    })

    // 3. Contar reservas activas esta semana por exhibidor
    //    Necesitamos JOIN con time_slots para saber el exhibitor_id
    const { data: resData } = await supabase
      .from('reservations')
      .select('time_slot_id, time_slot:time_slots(exhibitor_id)')
      .eq('week_start', weekStart)
      .neq('status', 'cancelled')

    const resCounts = new Map<string, number>()
    resData?.forEach(r => {
      const exhId = (r.time_slot as unknown as { exhibitor_id: string })?.exhibitor_id
      if (exhId) resCounts.set(exhId, (resCounts.get(exhId) ?? 0) + 1)
    })

    // Combinar datos
    const rows: ExhibitorRow[] = exhData.map(ex => ({
      ...ex,
      slotsCount: slotCounts.get(ex.id) ?? 0,
      reservationsCount: resCounts.get(ex.id) ?? 0,
    }))

    setExhibitors(rows)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => { loadData() }, [loadData])

  // ─── Crear exhibidor ──────────────────────────────────────
  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (trimmed.length < 3) {
      setCreateError('El nombre debe tener al menos 3 caracteres.')
      return
    }

    setCreating(true)
    setCreateError(null)

    const { error } = await supabase.from('exhibitors').insert({
      name: trimmed,
      is_active: true,
    })

    if (error) {
      if (error.code === '23505') {
        setCreateError('Ya existe un exhibidor con ese nombre.')
      } else {
        setCreateError('Error al crear: ' + error.message)
      }
    } else {
      setNewName('')
      setShowCreateForm(false)
      await loadData()
    }
    setCreating(false)
  }

  // ─── Renombrar exhibidor ──────────────────────────────────
  const handleRename = async (id: string) => {
    const trimmed = editName.trim()
    if (trimmed.length < 3) return

    setEditSaving(true)
    const { error } = await supabase
      .from('exhibitors')
      .update({ name: trimmed })
      .eq('id', id)

    if (error) {
      if (error.code === '23505') {
        alert('Ya existe un exhibidor con ese nombre.')
      } else {
        alert('Error al renombrar: ' + error.message)
      }
    } else {
      setEditingId(null)
      await loadData()
    }
    setEditSaving(false)
  }

  // ─── Activar / Desactivar exhibidor ───────────────────────
  const handleToggleActive = async (ex: ExhibitorRow) => {
    // Si se va a desactivar y tiene reservas, pedir confirmación
    if (ex.is_active && ex.reservationsCount > 0 && confirmToggleId !== ex.id) {
      setConfirmToggleId(ex.id)
      return
    }

    setToggling(true)
    const { error } = await supabase
      .from('exhibitors')
      .update({ is_active: !ex.is_active })
      .eq('id', ex.id)

    if (error) {
      alert('Error al cambiar estado: ' + error.message)
    } else {
      setConfirmToggleId(null)
      await loadData()
    }
    setToggling(false)
  }

  // ─── Filtro de exhibidores visibles ───────────────────────
  const visibleExhibitors = showInactive
    ? exhibitors
    : exhibitors.filter(ex => ex.is_active)

  const activeCount = exhibitors.filter(ex => ex.is_active).length
  const inactiveCount = exhibitors.filter(ex => !ex.is_active).length

  // ─── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-gray-500">Cargando exhibidores...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Resumen ── */}
      <div className="bg-white rounded-xl shadow-md p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              📍 Gestión de Exhibidores
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {activeCount} activo{activeCount !== 1 ? 's' : ''}
              {inactiveCount > 0 && (
                <span className="text-gray-400"> · {inactiveCount} inactivo{inactiveCount !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Toggle: mostrar inactivos */}
            {inactiveCount > 0 && (
              <button
                onClick={() => setShowInactive(!showInactive)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                  showInactive
                    ? 'bg-gray-100 border-gray-300 text-gray-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {showInactive ? '🙈 Ocultar inactivos' : '👁️ Ver inactivos'}
              </button>
            )}
            {/* Botón crear */}
            <button
              onClick={() => {
                setShowCreateForm(true)
                setCreateError(null)
                setNewName('')
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm"
            >
              + Nuevo exhibidor
            </button>
          </div>
        </div>
      </div>

      {/* ── Formulario de creación ── */}
      {showCreateForm && (
        <div className="bg-white rounded-xl shadow-md p-5 border-l-4 border-indigo-500">
          <h3 className="font-semibold text-gray-700 mb-3">Crear nuevo exhibidor</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => { setNewName(e.target.value); setCreateError(null) }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Ej: Plaza Central Norte"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              autoFocus
              maxLength={100}
            />
            <button
              onClick={handleCreate}
              disabled={creating || newName.trim().length < 3}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
            >
              {creating ? '...' : 'Crear'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-gray-400 hover:text-gray-600 px-3 py-2 text-sm transition"
            >
              Cancelar
            </button>
          </div>
          {createError && (
            <p className="text-red-500 text-xs mt-2">{createError}</p>
          )}
        </div>
      )}

      {/* ── Lista de exhibidores ── */}
      <div className="space-y-2">
        {visibleExhibitors.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-400">
            <p className="text-4xl mb-2">📍</p>
            <p>No hay exhibidores {showInactive ? '' : 'activos'}.</p>
            <p className="text-sm mt-1">Crea uno con el botón &quot;+ Nuevo exhibidor&quot;.</p>
          </div>
        ) : (
          visibleExhibitors.map(ex => (
            <div
              key={ex.id}
              className={`bg-white rounded-xl shadow-sm border transition overflow-hidden ${
                ex.is_active
                  ? 'border-gray-100 hover:shadow-md'
                  : 'border-red-100 bg-red-50/30 opacity-70'
              }`}
            >
              <div className="p-4 flex items-center gap-4">
                {/* Indicador de estado */}
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  ex.is_active ? 'bg-green-400' : 'bg-red-300'
                }`} />

                {/* Nombre (modo lectura o edición) */}
                <div className="flex-1 min-w-0">
                  {editingId === ex.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRename(ex.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 border border-indigo-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        autoFocus
                        maxLength={100}
                      />
                      <button
                        onClick={() => handleRename(ex.id)}
                        disabled={editSaving || editName.trim().length < 3}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                      >
                        {editSaving ? '...' : '✓'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-gray-400 hover:text-gray-600 text-xs px-2 py-1.5"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div>
                      <span className="font-semibold text-gray-800 text-sm">
                        {ex.name}
                      </span>
                      {!ex.is_active && (
                        <span className="ml-2 text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full font-medium">
                          Inactivo
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Contadores */}
                <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                  <span
                    title="Bloques horarios activos"
                    className="flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-lg"
                  >
                    🕐 {ex.slotsCount} bloque{ex.slotsCount !== 1 ? 's' : ''}
                  </span>
                  <span
                    title="Reservas activas esta semana"
                    className="flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-lg"
                  >
                    📅 {ex.reservationsCount} reserva{ex.reservationsCount !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Renombrar */}
                  {editingId !== ex.id && (
                    <button
                      onClick={() => {
                        setEditingId(ex.id)
                        setEditName(ex.name)
                      }}
                      className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                      title="Renombrar"
                    >
                      ✏️
                    </button>
                  )}
                  {/* Activar / Desactivar */}
                  <button
                    onClick={() => handleToggleActive(ex)}
                    disabled={toggling}
                    className={`p-2 rounded-lg transition ${
                      ex.is_active
                        ? 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                        : 'text-green-500 hover:text-green-700 hover:bg-green-50'
                    }`}
                    title={ex.is_active ? 'Desactivar' : 'Activar'}
                  >
                    {ex.is_active ? '🔴' : '🟢'}
                  </button>
                </div>
              </div>

              {/* Barra de confirmación de desactivación */}
              {confirmToggleId === ex.id && (
                <div className="bg-amber-50 border-t border-amber-200 px-4 py-3 flex items-center gap-3">
                  <span className="text-xs text-amber-700 flex-1">
                    ⚠️ Este exhibidor tiene <strong>{ex.reservationsCount}</strong> reserva{ex.reservationsCount !== 1 ? 's' : ''} activa{ex.reservationsCount !== 1 ? 's' : ''} esta semana.
                    Al desactivarlo, no aparecerá en la grilla de usuarios.
                  </span>
                  <button
                    onClick={() => handleToggleActive(ex)}
                    disabled={toggling}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                  >
                    {toggling ? '...' : 'Sí, desactivar'}
                  </button>
                  <button
                    onClick={() => setConfirmToggleId(null)}
                    className="text-gray-500 hover:text-gray-700 text-xs px-2 py-1.5"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

    </div>
  )
}
