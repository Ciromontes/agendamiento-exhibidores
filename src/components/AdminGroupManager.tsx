/**
 * components/AdminGroupManager.tsx — V5: Gestión de Grupos
 * ─────────────────────────────────────────────────────────────
 * Permite al admin crear, editar y eliminar grupos de publicadores
 * y gestionar sus miembros (usuarios).
 *
 * V5: Iteración 2 del sistema de Ranking por Grupos.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import type { User, UserGroup } from '@/types'

type GroupRow = UserGroup & {
  captain_name: string
  member_count: number
}

type MemberRow = Pick<User, 'id' | 'name' | 'user_type' | 'gender' | 'group_id'>

export default function AdminGroupManager() {
  const supabase = createClient()
  const { user } = useUser()
  const accessKey = user?.access_key ?? ''

  const [groups, setGroups] = useState<GroupRow[]>([])
  const [users, setUsers] = useState<Pick<User, 'id' | 'name' | 'group_id'>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ─── Estado del modal de crear/editar grupo ──────────────
  const [showModal, setShowModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupRow | null>(null)
  const [formName, setFormName] = useState('')
  const [saving, setSaving] = useState(false)

  // ─── Estado del panel de miembros ─────────────────────────
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [addingMember, setAddingMember] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())

  // ─── Estado para Excel ──────────────────────────────────────
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const [uploadingExcel, setUploadingExcel] = useState(false)
  const [excelResult, setExcelResult] = useState<{
    ok: boolean
    message?: string
    errors?: string[]
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Cargar datos ─────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/groups', {
      headers: { 'x-access-key': accessKey },
    })
    const json = await res.json()
    if (json.groups) setGroups(json.groups)
    else setError(json.error ?? 'Error al cargar grupos.')
    setLoading(false)
  }, [accessKey])

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users', {
      headers: { 'x-access-key': accessKey },
    })
    const json = await res.json()
    if (json.users) setUsers(json.users)
  }, [accessKey])

  const loadMembers = useCallback(async (groupId: string) => {
    const res = await fetch(`/api/admin/groups/${groupId}/members`, {
      headers: { 'x-access-key': accessKey },
    })
    const json = await res.json()
    if (json.members) setMembers(json.members)
  }, [accessKey])

  useEffect(() => {
    loadGroups()
    loadUsers()
  }, [loadGroups, loadUsers])

  // ─── Abrir modal para crear ────────────────────────────────
  const handleCreate = () => {
    setEditingGroup(null)
    setFormName('')
    setShowModal(true)
  }

  // ─── Abrir modal para editar ──────────────────────────────
  const handleEdit = (group: GroupRow) => {
    setEditingGroup(group)
    setFormName(group.name)
    setShowModal(true)
    // También expandir el panel de miembros y cargarlos
    setExpandedGroup(group.id)
    loadMembers(group.id)
  }

  // ─── Guardar (crear o actualizar) ─────────────────────────
  const handleSave = async () => {
    if (!formName.trim()) return
    setSaving(true)
    setError('')

    const body = JSON.stringify({
      name: formName.trim(),
    })

    let res: Response
    if (editingGroup) {
      res = await fetch(`/api/admin/groups/${editingGroup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
        body,
      })
    } else {
      res = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
        body,
      })
    }

    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Error al guardar.')
    } else {
      setShowModal(false)
      await loadGroups()
    }
    setSaving(false)
  }

  // ─── Descargar Excel de grupos ────────────────────────────
  const handleDownloadExcel = async () => {
    setDownloadingExcel(true)
    const res = await fetch('/api/admin/groups/excel', {
      headers: { 'x-access-key': accessKey },
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'grupos.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } else {
      const json = await res.json()
      alert(json.error ?? 'Error al descargar.')
    }
    setDownloadingExcel(false)
  }

  // ─── Subir Excel de grupos ─────────────────────────────────
  const handleUploadExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingExcel(true)
    setExcelResult(null)
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/admin/groups/excel', {
      method: 'POST',
      headers: { 'x-access-key': accessKey },
      body: formData,
    })
    const json = await res.json()
    setExcelResult(json)
    if (res.ok || res.status === 422) {
      await loadGroups()
      await loadUsers()
    }
    setUploadingExcel(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Eliminar grupo ────────────────────────────────────────
  const handleDelete = async (groupId: string) => {
    if (!confirm('¿Eliminar este grupo? Los miembros quedarán sin grupo.')) return
    const res = await fetch(`/api/admin/groups/${groupId}`, {
      method: 'DELETE',
      headers: { 'x-access-key': accessKey },
    })
    if (res.ok) await loadGroups()
  }

  // ─── Toggle panel de miembros ──────────────────────────────
  const handleToggleMembers = async (groupId: string) => {
    if (expandedGroup === groupId) {
      setExpandedGroup(null)
    } else {
      setExpandedGroup(groupId)
      setSelectedUserIds(new Set())
      await loadMembers(groupId)
    }
  }

  // ─── Agregar miembro(s) ─────────────────────────────────
  const handleAddSelectedMembers = async () => {
    if (selectedUserIds.size === 0 || !expandedGroup) return
    setAddingMember(true)
    let hasError = false
    for (const userId of selectedUserIds) {
      const res = await fetch(`/api/admin/groups/${expandedGroup}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
        body: JSON.stringify({ user_id: userId }),
      })
      if (!res.ok) {
        const json = await res.json()
        console.error(`Error al agregar usuario ${userId}:`, json.error)
        hasError = true
      }
    }
    setSelectedUserIds(new Set())
    await loadMembers(expandedGroup)
    await loadGroups()
    setAddingMember(false)
    if (hasError) alert('Algunos usuarios no pudieron ser agregados. Revisa la consola.')
  }

  // ─── Toggle selección de usuario ────────────────────────
  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  // ─── Quitar miembro ───────────────────────────────────────
  const handleRemoveMember = async (userId: string) => {
    if (!expandedGroup) return
    const res = await fetch(`/api/admin/groups/${expandedGroup}/members?user_id=${userId}`, {
      method: 'DELETE',
      headers: { 'x-access-key': accessKey },
    })
    if (res.ok) {
      await loadMembers(expandedGroup)
      await loadGroups()
    }
  }

  // ─── Calcular usuarios disponibles para agregar ────────────
  // Excluye: miembros del grupo actual + usuarios asignados a OTRO grupo
  const availableUsers = users.filter((u) => {
    // Ya es miembro del grupo actual
    if (members.some((m) => m.id === u.id)) return false
    // Ya está asignado a otro grupo (distinto del expandido)
    if (u.group_id && u.group_id !== expandedGroup) return false
    return true
  })

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ─── Título ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">
            👥 Grupos
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Gestiona los grupos de publicadores para el ranking mensual.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium
                     hover:bg-indigo-700 transition-colors"
        >
          + Nuevo Grupo
        </button>
      </div>

      {/* ─── Botones Excel ───────────────────────────────── */}
      <div className="flex gap-2">
        <button
          onClick={handleDownloadExcel}
          disabled={downloadingExcel}
          className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg font-medium
                     hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {downloadingExcel ? 'Descargando...' : '⬇️ Descargar grupos.xlsx'}
        </button>
        <label
          className={`px-4 py-2 text-sm rounded-lg font-medium cursor-pointer transition-colors ${
            uploadingExcel
              ? 'bg-gray-300 text-gray-500 cursor-wait'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {uploadingExcel ? 'Subiendo...' : '⬆️ Subir grupos.xlsx'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleUploadExcel}
            disabled={uploadingExcel}
            className="hidden"
          />
        </label>
      </div>

      {excelResult && (
        <div className={`rounded-lg p-4 text-sm ${
          excelResult.ok ? 'bg-green-50 border border-green-200 text-green-700' :
          'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {excelResult.ok ? '✅ ' : '❌ '}{excelResult.message}
          {excelResult.errors && excelResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {excelResult.errors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ❌ {error}
        </div>
      )}

      {/* ─── Lista de grupos ─────────────────────────────── */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando grupos...</div>
      ) : groups.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-500">No hay grupos creados aún.</p>
          <p className="text-sm text-gray-400 mt-1">
            Crea el primer grupo para empezar a organizar a los publicadores.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.id} className="bg-white border border-gray-200 rounded-xl shadow-sm">
              {/* Fila principal del grupo */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => handleToggleMembers(group.id)}
                    className="text-gray-400 hover:text-indigo-600 transition-colors"
                  >
                    <span className="text-lg">{expandedGroup === group.id ? '▼' : '▶'}</span>
                  </button>
                  <div>
                    <h3 className="font-semibold text-gray-800">{group.name}</h3>
                    <p className="text-sm text-gray-500">
                      <span className="text-indigo-600 font-medium">{group.member_count}</span> miembro(s)
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(group)}
                    className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    ✏️ Editar
                  </button>
                  <button
                    onClick={() => handleDelete(group.id)}
                    className="px-3 py-1.5 text-sm bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                  >
                    🗑️ Eliminar
                  </button>
                </div>
              </div>

              {/* Panel de miembros (expandible) */}
              {expandedGroup === group.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50 rounded-b-xl">
                  {/* Agregar miembro(s) — checkboxes múltiples */}
                  {availableUsers.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-600 mb-2">
                        Usuarios disponibles ({availableUsers.length})
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto mb-3">
                        {availableUsers.map((u) => (
                          <label
                            key={u.id}
                            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-indigo-50 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={selectedUserIds.has(u.id)}
                              onChange={() => toggleUserSelection(u.id)}
                              className="accent-indigo-600"
                            />
                            <span className="text-sm text-gray-700">{u.name}</span>
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={handleAddSelectedMembers}
                        disabled={selectedUserIds.size === 0 || addingMember}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium
                                   hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {addingMember
                          ? 'Agregando...'
                          : `Agregar seleccionados (${selectedUserIds.size})`}
                      </button>
                    </div>
                  )}

                  {availableUsers.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-2 mb-3">
                      Todos los usuarios ya están asignados a un grupo.
                    </p>
                  )}

                  {/* Lista de miembros actuales */}
                  <div className="border-t border-gray-200 pt-3 mt-2">
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      Miembros ({members.length})
                    </p>
                    {members.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">
                        Sin miembros en este grupo.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {members.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2"
                          >
                            <div>
                              <span className="text-sm font-medium text-gray-700">{m.name}</span>
                              <span className="text-xs text-gray-400 ml-2">
                                {m.user_type === 'precursor_regular' ? 'PR' : m.user_type === 'precursor_auxiliar' ? 'PA' : 'Pub'}
                              </span>
                              {group.captain_id === m.id && (
                                <span className="text-xs text-amber-600 ml-1">⭐</span>
                              )}
                            </div>
                            <button
                              onClick={() => handleRemoveMember(m.id)}
                              className="text-red-400 hover:text-red-600 text-sm transition-colors"
                              title="Quitar del grupo"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Modal crear/editar ───────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-800">
              {editingGroup ? 'Editar Grupo' : 'Nuevo Grupo'}
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nombre del grupo
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ej: Grupo Torres"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium
                           hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
