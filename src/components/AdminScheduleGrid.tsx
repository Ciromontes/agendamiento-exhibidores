/**
 * components/AdminScheduleGrid.tsx — V3 (Fase 5) - Grilla de Administración de Horarios
 * ─────────────────────────────────────────────────────────────
 * Componente exclusivo para administradores.
 * Permite gestionar completamente los bloques horarios.
 *
 * V2: Toggle activo/inactivo, bloques dinámicos, domingos.
 *
 * V3 (Fase 5): Gestión flexible de bloques.
 *   - Agregar nuevos bloques horarios (cualquier día y hora)
 *   - Eliminar bloques (solo si no tienen reservas activas)
 *   - Celdas vacías (—) son clicábles para agregar rápidamente
 *   - Pasa por SQL (RPC) para validar solapamientos
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Exhibitor, TimeSlot, DAYS_OF_WEEK, DAY_ORDER, formatTimeLabel } from '@/types'

export default function AdminScheduleGrid() {
  // --- Estado del componente ---
  const [exhibitors, setExhibitors] = useState<Exhibitor[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [selectedExhibitor, setSelectedExhibitor] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ─── Estado del modal “Agregar bloque” (Fase 5) ──────────────
  const [showAddModal, setShowAddModal] = useState(false)
  // Valores del formulario de creación de bloque
  const [addForm, setAddForm] = useState({
    day: '1',          // Día de la semana (0=Dom, 1=Lun, ...)
    startTime: '06:00',
    endTime: '08:00',
    blockReason: '',   // Opcional: si se llena, el slot se crea como bloqueado
  })
  const [addingSaving, setAddingSaving] = useState(false)
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null)

  // ─── Modo Global / Local ─────────────────────────────────────
  // false = Modo Local (solo exhibidor seleccionado)
  // true  = Modo Global (todos los exhibidores con mismo bloque)
  const [isGlobalMode, setIsGlobalMode] = useState(false)
  // IDs de slots modificados en cualquier exhibidor (para guardado global)
  const [changedSlotIds, setChangedSlotIds] = useState<Set<string>>(new Set())

  const supabase = createClient()

  // ─── Derivar bloques horarios dinámicamente ────────────────
  // Extraer combinaciones únicas (start_time, end_time) del exhibidor
  const dynamicBlocks = useMemo(() => {
    const slotsForExhibitor = timeSlots.filter(s => s.exhibitor_id === selectedExhibitor)
    const blockMap = new Map<string, { start: string; end: string; label: string }>()

    slotsForExhibitor.forEach(s => {
      if (!blockMap.has(s.start_time)) {
        blockMap.set(s.start_time, {
          start: s.start_time,
          end: s.end_time,
          label: formatTimeLabel(s.start_time, s.end_time),
        })
      }
    })

    return Array.from(blockMap.values()).sort((a, b) => a.start.localeCompare(b.start))
  }, [timeSlots, selectedExhibitor])

  /**
   * loadData - Carga exhibidores y time_slots en paralelo.
   */
  const loadData = useCallback(async () => {
    setLoading(true)
    const [exhibitorsRes, slotsRes] = await Promise.all([
      supabase.from('exhibitors').select('*').eq('is_active', true).order('name'),
      supabase.from('time_slots').select('*'),
    ])

    if (exhibitorsRes.data) {
      setExhibitors(exhibitorsRes.data)
      if (!selectedExhibitor && exhibitorsRes.data.length > 0) {
        setSelectedExhibitor(exhibitorsRes.data[0].id)
      }
    }
    if (slotsRes.data) setTimeSlots(slotsRes.data)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  /**
   * getSlot - Busca un slot por exhibidor, día y hora.
   */
  const getSlot = (dayNum: number, startTime: string) =>
    timeSlots.find(
      s =>
        s.exhibitor_id === selectedExhibitor &&
        s.day_of_week === dayNum &&
        s.start_time === startTime
    )

  /**
   * toggleSlot - Alterna activo/inactivo de un slot.
   * Modo local:  solo afecta el exhibidor seleccionado.
   * Modo global: propaga el cambio a TODOS los exhibidores
   *              que tengan ese mismo día y horario.
   */
  const toggleSlot = (dayNum: number, startTime: string) => {
    if (isGlobalMode) {
      // Modo global: buscar todos los slots con ese día y hora
      const matchingSlots = timeSlots.filter(
        s => s.day_of_week === dayNum && s.start_time === startTime && !s.block_reason
      )
      if (matchingSlots.length === 0) return

      // El nuevo estado lo determina el exhibidor actualmente visible
      const clickedSlot = matchingSlots.find(s => s.exhibitor_id === selectedExhibitor)
      const newActive = clickedSlot ? !clickedSlot.is_active : false

      setTimeSlots(prev =>
        prev.map(s =>
          s.day_of_week === dayNum && s.start_time === startTime && !s.block_reason
            ? { ...s, is_active: newActive }
            : s
        )
      )
      setChangedSlotIds(prev => {
        const next = new Set(prev)
        matchingSlots.forEach(s => next.add(s.id))
        return next
      })
    } else {
      // Modo local: solo afecta el slot del exhibidor seleccionado
      const slot = getSlot(dayNum, startTime)
      if (!slot || slot.block_reason) return

      setTimeSlots(prev =>
        prev.map(s => s.id === slot.id ? { ...s, is_active: !s.is_active } : s)
      )
      setChangedSlotIds(prev => new Set(prev).add(slot.id))
    }
    setHasChanges(true)
    setMessage(null)
  }

  /**
   * handleSave - Guarda cambios en BD.
   * Modo local:  guarda solo los slots del exhibidor seleccionado.
   * Modo global: guarda solo los slots que fueron modificados
   *              (puede ser en varios exhibidores).
   */
  const handleSave = async () => {
    setSaving(true)
    setMessage(null)

    let slotsToSave: typeof timeSlots
    if (isGlobalMode) {
      // Solo los que cambiaron globalmente
      slotsToSave = timeSlots.filter(s => changedSlotIds.has(s.id))
    } else {
      // Todos los del exhibidor activo (idempotente)
      slotsToSave = timeSlots.filter(s => s.exhibitor_id === selectedExhibitor)
    }

    const updates = slotsToSave.map(slot =>
      supabase.from('time_slots').update({ is_active: slot.is_active }).eq('id', slot.id)
    )

    const results = await Promise.all(updates)
    const hasError = results.some(r => r.error)

    if (hasError) {
      setMessage({ type: 'error', text: 'Error al guardar algunos horarios. Intenta de nuevo.' })
    } else {
      const exhibCount = isGlobalMode
        ? new Set(slotsToSave.map(s => s.exhibitor_id)).size
        : 1
      setMessage({
        type: 'success',
        text: isGlobalMode
          ? `Horarios actualizados en ${exhibCount} exhibidor${exhibCount > 1 ? 'es' : ''}.`
          : 'Horarios actualizados correctamente.',
      })
      setHasChanges(false)
      setChangedSlotIds(new Set())
    }
    setSaving(false)
  }

  /**
   * openAddModal - Abre el modal pre-llenando día y horario.
   * Se llama al hacer clic en una celda vacía (—) de la grilla.
   */
  const openAddModal = (dayNum: number, startTime: string, endTime: string) => {
    setAddForm({
      day: String(dayNum),
      startTime: startTime.slice(0, 5),
      endTime: endTime.slice(0, 5),
      blockReason: '',
    })
    setShowAddModal(true)
  }

  /**
   * handleAddSlot - Llama a crear_time_slot vía RPC.
   * La función SQL valida solapamientos antes de insertar.
   */
  const handleAddSlot = async () => {
    if (!selectedExhibitor) return
    // Validación client-side: hora fin debe ser mayor que hora inicio
    if (addForm.endTime <= addForm.startTime) {
      alert('La hora de fin debe ser mayor que la hora de inicio.')
      return
    }
    setAddingSaving(true)
    const { error } = await supabase.rpc('crear_time_slot', {
      p_exhibitor_id: selectedExhibitor,
      p_day_of_week:  parseInt(addForm.day),
      p_start_time:   addForm.startTime + ':00',
      p_end_time:     addForm.endTime + ':00',
      p_block_reason: addForm.blockReason.trim() || null,
    })
    if (error) {
      alert('Error: ' + error.message)
    } else {
      setShowAddModal(false)
      setMessage({ type: 'success', text: '✅ Bloque creado correctamente.' })
      await loadData()
    }
    setAddingSaving(false)
  }

  /**
   * handleDeleteSlot - Llama a eliminar_time_slot vía RPC.
   * La función SQL bloquea la eliminación si hay reservas activas.
   */
  const handleDeleteSlot = async (slotId: string) => {
    if (!confirm('¿Eliminar este bloque horario? Esta acción no se puede deshacer.')) return
    setDeletingSlotId(slotId)
    const { error } = await supabase.rpc('eliminar_time_slot', { p_slot_id: slotId })
    if (error) {
      alert('No se puede eliminar: ' + error.message)
    } else {
      setMessage({ type: 'success', text: '✅ Bloque eliminado correctamente.' })
      await loadData()
    }
    setDeletingSlotId(null)
  }

  /** enableAll - Activa slots (todos los exhibidores en modo global, solo el activo en local) */
  const enableAll = () => {
    setTimeSlots(prev =>
      prev.map(s => {
        const applies = isGlobalMode
          ? !s.block_reason
          : s.exhibitor_id === selectedExhibitor && !s.block_reason
        return applies ? { ...s, is_active: true } : s
      })
    )
    if (isGlobalMode) {
      setChangedSlotIds(new Set(
        timeSlots.filter(s => !s.block_reason).map(s => s.id)
      ))
    }
    setHasChanges(true)
    setMessage(null)
  }

  /** disableAll - Desactiva slots (todos los exhibidores en modo global, solo el activo en local) */
  const disableAll = () => {
    setTimeSlots(prev =>
      prev.map(s => {
        const applies = isGlobalMode
          ? !s.block_reason
          : s.exhibitor_id === selectedExhibitor && !s.block_reason
        return applies ? { ...s, is_active: false } : s
      })
    )
    if (isGlobalMode) {
      setChangedSlotIds(new Set(
        timeSlots.filter(s => !s.block_reason).map(s => s.id)
      ))
    }
    setHasChanges(true)
    setMessage(null)
  }

  // Contadores de slots activos
  const activeCount = timeSlots.filter(
    s => s.exhibitor_id === selectedExhibitor && s.is_active && !s.block_reason
  ).length
  const totalCount = timeSlots.filter(
    s => s.exhibitor_id === selectedExhibitor && !s.block_reason
  ).length

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

  return (
    <div>
      {/* ── Toggle Modo Global / Modo Local ───────────────────── */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">Modo de edición:</span>
          <div className="flex rounded-xl overflow-hidden border border-gray-200 shadow-sm text-xs font-semibold">
            <button
              onClick={() => { setIsGlobalMode(false); setChangedSlotIds(new Set()); setHasChanges(false); setMessage(null) }}
              className={`px-4 py-2 transition-all ${
                !isGlobalMode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              📍 Local
            </button>
            <button
              onClick={() => { setIsGlobalMode(true); setChangedSlotIds(new Set()); setHasChanges(false); setMessage(null) }}
              className={`px-4 py-2 transition-all ${
                isGlobalMode
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              🌐 Global
            </button>
          </div>
        </div>
        <span className="text-xs text-gray-400">
          {isGlobalMode
            ? `${exhibitors.length} exhibidores afectados`
            : 'Solo el exhibidor activo'}
        </span>
      </div>

      {/* Banner de advertencia en modo global */}
      {isGlobalMode && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <span className="text-orange-500 text-lg mt-0.5">&#9888;</span>
          <div>
            <p className="text-sm font-bold text-orange-800">Modo Global activo</p>
            <p className="text-xs text-orange-700 mt-0.5">
              Cada cambio que hagas se aplicará simultáneamente en{' '}
              <strong>todos los exhibidores</strong> que tengan ese mismo día y horario.
              Los cambios de solo un exhibidor usa <strong>Modo Local</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Selector de exhibidor */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
        {exhibitors.map((ex) => (
          <button
            key={ex.id}
            onClick={() => { setSelectedExhibitor(ex.id); setMessage(null) }}
            className={`px-5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              selectedExhibitor === ex.id
                ? isGlobalMode
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-indigo-600 text-white shadow-md'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {ex.name}
            {isGlobalMode && selectedExhibitor !== ex.id && (
              <span className="ml-1.5 text-[10px] text-orange-400 font-normal">🌐</span>
            )}
          </button>
        ))}
      </div>

      {/* Acciones rápidas y botón agregar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={enableAll}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              isGlobalMode
                ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            {isGlobalMode ? '🌐' : ''} ✓ Activar todos
          </button>
          <button
            onClick={disableAll}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              isGlobalMode
                ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                : 'bg-red-100 text-red-700 hover:bg-red-200'
            }`}
          >
            {isGlobalMode ? '🌐' : ''} ✕ Desactivar todos
          </button>
          {/* Fase 5: Abrir modal para crear nuevo bloque */}
          <button
            onClick={() => {
              setAddForm({ day: '1', startTime: '06:00', endTime: '08:00', blockReason: '' })
              setShowAddModal(true)
            }}
            className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            + Agregar bloque
          </button>
        </div>
        <span className="text-xs text-gray-500">
          {activeCount}/{totalCount} horarios activos
        </span>
      </div>

      {/* Instrucciones */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-800">
        <strong>Instrucciones:</strong> Toca una celda para activar/desactivar un horario.
        Las celdas <span className="inline-block w-3 h-3 rounded bg-green-400 align-middle mx-0.5"></span> verdes están activas
        y las <span className="inline-block w-3 h-3 rounded bg-gray-300 align-middle mx-0.5"></span> grises están desactivadas.
        Las celdas de <span className="font-semibold">Reunión</span> no se pueden modificar.
        {isGlobalMode && (
          <span className="ml-2 font-semibold text-orange-700">
            Los cambios aplicarán a todos los exhibidores.
          </span>
        )}
      </div>

      {/* ── Tabla de horarios ─ Bloques dinámicos × DAY_ORDER (Lun-Dom) ── */}
      <div className="bg-white rounded-xl shadow-md overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-indigo-600 text-white">
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider border-r border-indigo-500">
                Horario
              </th>
              {DAY_ORDER.map((dayNum) => (
                <th key={dayNum} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider border-r border-indigo-500 last:border-r-0">
                  {DAYS_OF_WEEK[dayNum]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dynamicBlocks.map((block) => (
              <tr key={block.start} className="border-b border-gray-100">
                <td className="px-3 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap bg-gray-50 border-r border-gray-200">
                  {block.label}
                </td>
                {DAY_ORDER.map((dayNum) => {
                  const slot = getSlot(dayNum, block.start)

                  if (!slot) {
                    // Celda vacía — clicáble para agregar bloque (Fase 5)
                    return (
                      <td key={dayNum} className="px-2 py-2 text-center">
                        <button
                          onClick={() => openAddModal(dayNum, block.start, block.end)}
                          className="w-full py-4 px-2 rounded-lg text-xs text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 border-2 border-dashed border-gray-200 hover:border-indigo-300 transition-all"
                          title="Agregar bloque en este día y horario"
                        >
                          +
                        </button>
                      </td>
                    )
                  }

                  // Slot bloqueado — muestra botón eliminar al pasar el cursor (Fase 5)
                  if (slot.block_reason) {
                    return (
                      <td key={dayNum} className="px-2 py-2 text-center">
                        <div className="relative group">
                          <div className="bg-purple-100 text-purple-700 rounded-lg px-2 py-3 text-xs font-bold border-2 border-purple-300">
                            🔒 {slot.block_reason}
                          </div>
                          <button
                            onClick={() => handleDeleteSlot(slot.id)}
                            disabled={deletingSlotId === slot.id}
                            className="mt-1 w-full text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 rounded py-0.5 transition opacity-0 group-hover:opacity-100"
                            title="Eliminar bloque"
                          >
                            {deletingSlotId === slot.id ? '...' : '🗑 Eliminar'}
                          </button>
                        </div>
                      </td>
                    )
                  }

                  // Slot normal — toggle activo/inactivo + botón eliminar (Fase 5)
                  return (
                    <td key={dayNum} className="px-2 py-2 text-center">
                      <div className="relative group">
                        <button
                          onClick={() => toggleSlot(dayNum, block.start)}
                          className={`w-full py-3 px-2 rounded-lg text-xs font-semibold transition-all border-2 ${
                            slot.is_active
                              ? 'bg-green-100 text-green-700 border-green-400 hover:bg-green-200 shadow-sm'
                              : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {slot.is_active ? '✓ Activo' : '✕ Inactivo'}
                        </button>
                        {/* Botón eliminar: aparece al hover, llama al servidor (Fase 5) */}
                        <button
                          onClick={() => handleDeleteSlot(slot.id)}
                          disabled={deletingSlotId === slot.id}
                          className="mt-1 w-full text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 rounded py-0.5 transition opacity-0 group-hover:opacity-100"
                          title="Eliminar bloque"
                        >
                          {deletingSlotId === slot.id ? '...' : '🗑 Eliminar'}
                        </button>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mensaje de estado */}
      {message && (
        <div className={`mt-4 px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Botón guardar */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className={`px-8 py-3 rounded-xl font-semibold text-sm transition-all ${
            hasChanges
              ? isGlobalMode
                ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-lg hover:shadow-xl'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg hover:shadow-xl'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saving
            ? 'Guardando...'
            : hasChanges
              ? isGlobalMode
                ? `🌐 Publicar en ${exhibitors.length} exhibidores`
                : '💾 Publicar horarios'
              : 'Sin cambios'}
        </button>
      </div>

      {/* ── Modal: Agregar bloque horario (Fase 5) ────────────────
          Se abre con el botón "+ Agregar bloque" o al hacer clic
          en una celda vacía (—). Permite elegir día, hora inicio,
          hora fin y opcionalmente una razón de bloqueo.         */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            {/* Encabezado del modal */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-800">+ Agregar Bloque Horario</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            {/* Formulario */}
            <div className="px-6 py-5 space-y-4">
              {/* Exhibidor (solo lectura — el seleccionado actualmente) */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Exhibidor</label>
                <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 border border-gray-200">
                  {exhibitors.find(e => e.id === selectedExhibitor)?.name || '—'}
                </div>
              </div>

              {/* Día de la semana */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Día de la semana</label>
                <select
                  value={addForm.day}
                  onChange={e => setAddForm(f => ({ ...f, day: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="1">Lunes</option>
                  <option value="2">Martes</option>
                  <option value="3">Miércoles</option>
                  <option value="4">Jueves</option>
                  <option value="5">Viernes</option>
                  <option value="6">Sábado</option>
                  <option value="0">Domingo</option>
                </select>
              </div>

              {/* Hora inicio y fin en la misma fila */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Hora inicio</label>
                  <input
                    type="time"
                    value={addForm.startTime}
                    onChange={e => setAddForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Hora fin</label>
                  <input
                    type="time"
                    value={addForm.endTime}
                    onChange={e => setAddForm(f => ({ ...f, endTime: e.target.value }))}
                    min={addForm.startTime}
                    className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                      addForm.endTime && addForm.startTime && addForm.endTime <= addForm.startTime
                        ? 'border-red-400 bg-red-50'
                        : 'border-gray-300'
                    }`}
                  />
                  {addForm.endTime && addForm.startTime && addForm.endTime <= addForm.startTime && (
                    <p className="text-[11px] text-red-500 mt-1">La hora fin debe ser mayor que la hora inicio.</p>
                  )}
                </div>
              </div>

              {/* Razón de bloqueo (opcional) */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Razón de bloqueo <span className="font-normal text-gray-400">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={addForm.blockReason}
                  onChange={e => setAddForm(f => ({ ...f, blockReason: e.target.value }))}
                  placeholder='Ej: "Reunión de congregación"'
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Si se llena, el bloque se crea como bloqueado (🔒) y no estará disponible para reservas.
                </p>
              </div>
            </div>

            {/* Botones del modal */}
            <div className="flex gap-3 px-6 pb-5">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddSlot}
                disabled={addingSaving}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-60"
              >
                {addingSaving ? 'Creando...' : '+ Crear bloque'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
