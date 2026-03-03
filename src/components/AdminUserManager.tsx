/**
 * components/AdminUserManager.tsx — Fase 2-3
 * ─────────────────────────────────────────────────────────────
 * Componente CRUD completo para la gestión de usuarios.
 *
 * Funcionalidades:
 *   • Listar todos los usuarios en una tabla con paginación
 *   • Crear nuevos usuarios con validación de clave de acceso
 *   • Editar datos de usuarios existentes
 *   • Activar/Desactivar usuarios (borrado lógico)
 *   • Buscar por nombre y filtrar por tipo de usuario
 *   • Mostrar badges de color según tipo de usuario
 *   • Vincular/desvincular cónyuges (Fase 3)
 *
 * Reglas de negocio:
 *   - access_key debe tener mínimo 6 caracteres
 *   - access_key debe ser única (validación en BD)
 *   - No se puede desactivar al admin logueado actualmente
 *   - Solo admins pueden acceder (protegido por RLS + página padre)
 *   - Al vincular cónyuges, ambos se actualizan atómicamente (RPC)
 *
 * Usa el cliente de Supabase del navegador (createBrowserClient).
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/context/UserContext'
import { User, USER_TYPE_LABELS } from '@/types'

// ─── Tipos internos del componente ───────────────────────────

/** Datos del formulario para crear/editar usuario */
type UserFormData = {
  name: string
  access_key: string
  user_type: 'publicador' | 'precursor_regular' | 'precursor_auxiliar'
  gender: 'M' | 'F' | null
  is_admin: boolean
  phone: string   // Número de WhatsApp con código de país
}

/** Valores iniciales del formulario (vacío) */
const EMPTY_FORM: UserFormData = {
  name: '',
  access_key: '',
  user_type: 'publicador',
  gender: null,
  is_admin: false,
  phone: '',
}

/** Filtro activo para la lista de usuarios */
type FilterType = 'todos' | 'publicador' | 'precursor_regular' | 'precursor_auxiliar' | 'admin' | 'inactivos'

// ─── Colores de badge por tipo de usuario ────────────────────
const TYPE_BADGE_COLORS: Record<string, string> = {
  publicador: 'bg-blue-100 text-blue-800',
  precursor_regular: 'bg-green-100 text-green-800',
  precursor_auxiliar: 'bg-purple-100 text-purple-800',
}

// =============================================================
// Componente principal
// =============================================================
export default function AdminUserManager() {
  const { user: currentAdmin } = useUser()

  // ─── Estado principal ──────────────────────────────────────
  const [users, setUsers] = useState<User[]>([])            // Lista completa de usuarios
  const [loading, setLoading] = useState(true)               // Cargando datos iniciales
  const [saving, setSaving] = useState(false)                // Guardando (crear/editar)

  // ─── Estado del modal ──────────────────────────────────────
  const [showModal, setShowModal] = useState(false)          // ¿Mostrar modal?
  const [editingUser, setEditingUser] = useState<User | null>(null) // Usuario en edición (null = crear)
  const [formData, setFormData] = useState<UserFormData>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<string[]>([]) // Errores de validación

  // ─── Estado de búsqueda y filtros ──────────────────────────
  const [searchTerm, setSearchTerm] = useState('')           // Texto de búsqueda por nombre
  const [activeFilter, setActiveFilter] = useState<FilterType>('todos')

  // ─── Estado de mensajes ────────────────────────────────────
  const [successMsg, setSuccessMsg] = useState('')           // Mensaje de éxito temporal
  const [errorMsg, setErrorMsg] = useState('')               // Mensaje de error temporal

  // ─── Estado para vincular cónyuges (Fase 3) ───────────────
  const [showSpouseModal, setShowSpouseModal] = useState(false)  // ¿Mostrar modal de cónyuge?
  const [spouseTargetUser, setSpouseTargetUser] = useState<User | null>(null) // Usuario al que vincular
  const [spouseSearch, setSpouseSearch] = useState('')        // Búsqueda en el modal de cónyuge
  const [savingSpouse, setSavingSpouse] = useState(false)     // Guardando vinculación
  // ─── Estado de selección múltiple ──────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  // ─── Claves generadas en esta sesión (ephemeral, solo en memoria) ────────
  // Mapea userId → clave en texto plano recién generada.
  // Se borra al recargar la página para no exponer claves.
  const [generatedKeys, setGeneratedKeys] = useState<Map<string, string>>(new Map())
  // ─── Estado del modal de envío masivo por WhatsApp ────────
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkQueue, setBulkQueue] = useState<{ user: User; key: string }[]>([])
  const [bulkIndex, setBulkIndex] = useState(0)
  const [bulkStep, setBulkStep] = useState<'generating' | 'sending' | 'done'>('generating')
  // =============================================================
  // Cargar usuarios desde Supabase
  // =============================================================
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'x-access-key': currentAdmin?.access_key ?? '' },
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg('Error al cargar usuarios: ' + (json.error ?? 'Error desconocido'))
      } else {
        setUsers(json.users as User[])
      }
    } catch {
      setErrorMsg('Error al conectar con el servidor.')
    }
    setLoading(false)
  }, [currentAdmin?.access_key])

  // Cargar usuarios al montar el componente
  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Auto-limpiar mensajes después de 4 segundos
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(''), 4000)
      return () => clearTimeout(timer)
    }
  }, [successMsg])

  useEffect(() => {
    if (errorMsg) {
      const timer = setTimeout(() => setErrorMsg(''), 5000)
      return () => clearTimeout(timer)
    }
  }, [errorMsg])

  // =============================================================
  // Filtrado y búsqueda de usuarios
  // =============================================================
  const filteredUsers = users.filter(u => {
    // Filtro por búsqueda de nombre
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase())

    // Filtro por tipo/estado
    let matchesFilter = true
    switch (activeFilter) {
      case 'publicador':
      case 'precursor_regular':
      case 'precursor_auxiliar':
        matchesFilter = u.user_type === activeFilter
        break
      case 'admin':
        matchesFilter = u.is_admin
        break
      case 'inactivos':
        matchesFilter = !u.is_active
        break
      case 'todos':
      default:
        matchesFilter = true
    }

    return matchesSearch && matchesFilter
  })

  // =============================================================
  // Validar formulario antes de guardar
  // =============================================================
  const validateForm = (): string[] => {
    const errors: string[] = []

    // Nombre obligatorio
    if (!formData.name.trim()) {
      errors.push('El nombre es obligatorio.')
    }

    // access_key: mínimo 6 caracteres
    if (formData.access_key.length < 6) {
      errors.push('La clave de acceso debe tener al menos 6 caracteres.')
    }

    // access_key: no espacios
    if (/\s/.test(formData.access_key)) {
      errors.push('La clave de acceso no puede contener espacios.')
    }

    // access_key: verificar unicidad (excepto si se edita y no cambió)
    const existingUser = users.find(
      u => u.access_key === formData.access_key && u.id !== editingUser?.id
    )
    if (existingUser) {
      errors.push('Ya existe un usuario con esa clave de acceso.')
    }

    return errors
  }

  // =============================================================
  // Abrir modal para CREAR usuario
  // =============================================================
  const openCreateModal = () => {
    setEditingUser(null)
    setFormData(EMPTY_FORM)
    setFormErrors([])
    setShowModal(true)
  }

  // =============================================================
  // Abrir modal para EDITAR usuario
  // =============================================================
  const openEditModal = (user: User) => {
    setEditingUser(user)
    setFormData({
      name: user.name,
      access_key: user.access_key,
      user_type: user.user_type,
      gender: user.gender,
      is_admin: user.is_admin,
      phone: user.phone ?? '',
    })
    setFormErrors([])
    setShowModal(true)
  }

  // =============================================================
  // Cerrar modal y limpiar estado
  // =============================================================
  const closeModal = () => {
    setShowModal(false)
    setEditingUser(null)
    setFormData(EMPTY_FORM)
    setFormErrors([])
  }

  // =============================================================
  // Guardar usuario (crear o actualizar)
  // =============================================================
  const handleSave = async () => {
    // Validar formulario
    const errors = validateForm()
    if (errors.length > 0) {
      setFormErrors(errors)
      return
    }

    setSaving(true)
    setFormErrors([])

    if (editingUser) {
      // ─── ACTUALIZAR usuario existente ────────────────────
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-access-key': currentAdmin?.access_key ?? '',
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          access_key: formData.access_key,
          user_type: formData.user_type,
          gender: formData.gender,
          is_admin: formData.is_admin,
          phone: formData.phone,
        }),
      })
      const json = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          setFormErrors(['Esa clave de acceso ya está en uso por otro usuario.'])
        } else {
          setFormErrors(['Error al actualizar: ' + (json.error ?? 'Error desconocido')])
        }
        setSaving(false)
        return
      }

      setSuccessMsg(`Usuario "${formData.name.trim()}" actualizado correctamente.`)
    } else {
      // ─── CREAR usuario nuevo ─────────────────────────────
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-key': currentAdmin?.access_key ?? '',
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          access_key: formData.access_key,
          user_type: formData.user_type,
          gender: formData.gender,
          is_admin: formData.is_admin,
          phone: formData.phone,
        }),
      })
      const json2 = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          setFormErrors(['Esa clave de acceso ya está en uso.'])
        } else {
          setFormErrors(['Error al crear usuario: ' + (json2.error ?? 'Error desconocido')])
        }
        setSaving(false)
        return
      }

      setSuccessMsg(`Usuario "${formData.name.trim()}" creado exitosamente.`)
    }

    // Refrescar lista y cerrar modal
    setSaving(false)
    closeModal()
    await fetchUsers()
  }

  // =============================================================
  // Vincular cónyuge — Abrir modal (Fase 3)
  // =============================================================
  const openSpouseModal = (targetUser: User) => {
    setSpouseTargetUser(targetUser)
    setSpouseSearch('')
    setShowSpouseModal(true)
  }

  // =============================================================
  // Vincular cónyuge — Ejecutar vinculación via RPC (Fase 3)
  // =============================================================
  const linkSpouse = async (spouseUser: User) => {
    if (!spouseTargetUser) return
    setSavingSpouse(true)

    // Llamar a la API Route que ejecuta la función SQL vincular_conyuges
    const res = await fetch(`/api/admin/users/${spouseTargetUser.id}/spouse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': currentAdmin?.access_key ?? '',
      },
      body: JSON.stringify({ spouse_id: spouseUser.id }),
    })
    const json = await res.json()

    if (!res.ok) {
      setErrorMsg('Error al vincular cónyuges: ' + (json.error ?? 'Error desconocido'))
    } else {
      setSuccessMsg(`${spouseTargetUser.name} y ${spouseUser.name} vinculados como cónyuges.`)
    }

    setSavingSpouse(false)
    setShowSpouseModal(false)
    setSpouseTargetUser(null)
    await fetchUsers()
  }

  // =============================================================
  // Desvincular cónyuge via RPC (Fase 3)
  // =============================================================
  const unlinkSpouse = async (targetUser: User) => {
    const spouseName = users.find(u => u.id === targetUser.spouse_id)?.name || 'su cónyuge'
    if (!confirm(`¿Desvincular a ${targetUser.name} de ${spouseName}?`)) return

    const res2 = await fetch(`/api/admin/users/${targetUser.id}/spouse`, {
      method: 'DELETE',
      headers: { 'x-access-key': currentAdmin?.access_key ?? '' },
    })
    const json2 = await res2.json()

    if (!res2.ok) {
      setErrorMsg('Error al desvincular: ' + (json2.error ?? 'Error desconocido'))
    } else {
      setSuccessMsg(`${targetUser.name} y ${spouseName} desvinculados.`)
    }

    await fetchUsers()
  }

  // Helper: obtener nombre del cónyuge desde la lista de usuarios
  const getSpouseName = (spouseId: string | null): string | null => {
    if (!spouseId) return null
    return users.find(u => u.id === spouseId)?.name || null
  }

  // Usuarios disponibles para vincular (activos, sin cónyuge, no el mismo)
  const availableSpouses = users.filter(u =>
    u.is_active &&
    !u.spouse_id &&
    u.id !== spouseTargetUser?.id &&
    u.name.toLowerCase().includes(spouseSearch.toLowerCase())
  )

  // =============================================================
  // Generar clave segura + envío por WhatsApp
  // =============================================================

  /**
   * generateSecureKey — Genera una clave aleatoria de 12 caracteres.
   * Usa Web Crypto API (disponible en todos los navegadores modernos).
   * Excluye caracteres visualmente similares: 0/O, 1/l/I.
   */
  /**
   * generateSecureKey — Clave de 16 caracteres con ~96 bits de entropía.
   * Incluye mayúsculas, minúsculas, dígitos y caracteres especiales.
   * Excluye caracteres visualmente confusos: 0/O, 1/l/I.
   */
  const generateSecureKey = (): string => {
    // Charset: 63 chars → log2(63)^16 ≈ 95.7 bits de entropía
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789@#$%&*+!'
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    return Array.from(arr).map(b => chars[b % chars.length]).join('')
  }

  /**
   * handleGenerateKey — Genera y guarda una nueva clave para el usuario.
   * La clave se muestra una vez en memoria. Al recargar la página se pierde.
   */
  const handleGenerateKey = async (targetUser: User) => {
    const res = await fetch(`/api/admin/users/${targetUser.id}/key`, {
      method: 'POST',
      headers: { 'x-access-key': currentAdmin?.access_key ?? '' },
    })
    const json = await res.json()

    if (!res.ok) {
      setErrorMsg('Error al guardar la clave: ' + (json.error ?? 'Error desconocido'))
      return
    }

    const key = json.key as string
    // Guardar en memoria para poder mostrarla y usarla en WhatsApp
    setGeneratedKeys(prev => new Map(prev).set(targetUser.id, key))
    setSuccessMsg(`Nueva clave generada para "${targetUser.name}".`)
    await fetchUsers()
  }

  /**
   * buildWAMessage — Construye el texto del mensaje de WhatsApp.
   * Se reutiliza tanto para envío individual como masivo.
   */
  const buildWAMessage = (name: string, key: string): string => {
    const magicLink = `https://exhibidores-app.vercel.app/?k=${encodeURIComponent(key)}`
    return (
      `Hola ${name} 👋\n\n` +
      `Tu acceso a la *App de Exhibidores* ha sido actualizado.\n\n` +
      `👇 *Toca aquí para entrar directamente:*\n` +
      `${magicLink}\n\n` +
      `_(Si el enlace no abre, copia esta clave e ingrésala en la app)_\n` +
      `🔑 \`${key}\`\n\n` +
      `_No compartas este enlace con nadie._`
    )
  }

  /**
   * openWhatsApp — Abre WhatsApp con el mensaje pre-escrito vía ?text=.
   * También copia al portapapeles como respaldo por si WhatsApp no pre-rellena.
   * Para evitar duplicados: SIEMPRE genera una clave NUEVA antes de enviar.
   */
  const openWhatsApp = async (targetUser: User) => {
    const phone = (targetUser.phone ?? '').replace(/\D/g, '')
    if (!phone) {
      alert(`${targetUser.name} no tiene número de teléfono guardado.\nEdita el usuario y agrégalo primero.`)
      return
    }
    const key = generatedKeys.get(targetUser.id)
    if (!key) {
      alert('Primero genera una clave nueva con el botón 🔑 para este usuario.')
      return
    }
    const message = buildWAMessage(targetUser.name, key)
    // Copiar al portapapeles como respaldo
    try { await navigator.clipboard.writeText(message) } catch { /* ignorar */ }
    // Abrir WhatsApp con el mensaje pre-escrito
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank')
  }

  // =============================================================
  // Envío masivo de claves por WhatsApp
  // =============================================================

  /**
   * startBulkSend — genera claves nuevas para TODOS los usuarios
   * activos con teléfono registrado y abre el modal de envío secuencial.
   */
  const startBulkSend = async () => {
    const targets = users.filter(
      u => u.is_active && (u.phone ?? '').replace(/\D/g, '').length > 5
    )
    if (targets.length === 0) {
      alert(
        'No hay usuarios activos con número de teléfono registrado.\n\n' +
        'Edita los usuarios y agrega sus números primero.'
      )
      return
    }
    setShowBulkModal(true)
    setBulkStep('generating')
    setBulkIndex(0)
    setBulkQueue([])

    // Generar y guardar claves en paralelo (via API Route — servicio_role en servidor)
    const results = await Promise.all(
      targets.map(async u => {
        const res = await fetch(`/api/admin/users/${u.id}/key`, {
          method: 'POST',
          headers: { 'x-access-key': currentAdmin?.access_key ?? '' },
        })
        if (!res.ok) return null
        const json = await res.json()
        return { user: u, key: json.key as string }
      })
    )

    const queue = results.filter((r): r is { user: User; key: string } => r !== null)
    // Actualizar mapa de claves en memoria
    setGeneratedKeys(prev => {
      const next = new Map(prev)
      queue.forEach(({ user, key }) => next.set(user.id, key))
      return next
    })
    setBulkQueue(queue.sort((a, b) => a.user.name.localeCompare(b.user.name)))
    setBulkStep('sending')
    await fetchUsers()
  }

  /** Abre WhatsApp con el mensaje pre-escrito y copia al portapapeles como respaldo */
  const openBulkWhatsApp = async (item: { user: User; key: string }) => {
    const phone = (item.user.phone ?? '').replace(/\D/g, '')
    const message = buildWAMessage(item.user.name, item.key)
    try { await navigator.clipboard.writeText(message) } catch { /* ignorar */ }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank')
  }

  /** Avanza al siguiente usuario de la cola o marca como terminado */
  const advanceBulk = () => {
    if (bulkIndex + 1 >= bulkQueue.length) {
      setBulkStep('done')
    } else {
      setBulkIndex(i => i + 1)
    }
  }

  /** Cierra y reinicia el modal de envío masivo */
  const closeBulkModal = () => {
    setShowBulkModal(false)
    setBulkQueue([])
    setBulkIndex(0)
    setBulkStep('generating')
  }

  // =============================================================
  // Selección múltiple
  // =============================================================
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredUsers.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredUsers.map(u => u.id)))
    }
  }

  const clearSelection = () => setSelectedIds(new Set())

  // =============================================================
  // Acciones masivas
  // =============================================================
  const handleBulkAction = async (action: 'deactivate' | 'activate' | 'delete') => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    // Confirmar eliminación permanente
    if (action === 'delete') {
      const confirmed = confirm(
        `⚠️ ¿Estás seguro de ELIMINAR PERMANENTEMENTE ${ids.length} usuario(s)?\n\n` +
        `Esto no se puede deshacer. Se borrarán sus reservaciones, invitaciones y todos sus datos.`
      )
      if (!confirmed) return
    }

    if (action === 'deactivate') {
      const confirmed = confirm(`¿Desactivar ${ids.length} usuario(s)?`)
      if (!confirmed) return
    }

    setBulkActionLoading(true)
    try {
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-key': currentAdmin?.access_key ?? '',
        },
        body: JSON.stringify({ action, ids }),
      })
      const json = await res.json()

      if (!res.ok) {
        setErrorMsg(json.error ?? 'Error en acción masiva.')
      } else {
        const labels = { deactivate: 'desactivados', activate: 'activados', delete: 'eliminados' }
        setSuccessMsg(`${json.affected} usuario(s) ${labels[action]}.`)
        clearSelection()
        await fetchUsers()
      }
    } catch {
      setErrorMsg('Error de conexión al ejecutar acción masiva.')
    }
    setBulkActionLoading(false)
  }

  // =============================================================
  // Eliminar usuario permanentemente (individual)
  // =============================================================
  const handleDeleteUser = async (targetUser: User) => {
    if (targetUser.id === currentAdmin?.id) {
      setErrorMsg('No puedes eliminarte a ti mismo.')
      return
    }

    const confirmed = confirm(
      `⚠️ ¿ELIMINAR PERMANENTEMENTE a "${targetUser.name}"?\n\n` +
      `Esto borrará sus reservaciones, invitaciones y todos sus datos. No se puede deshacer.`
    )
    if (!confirmed) return

    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}`, {
        method: 'DELETE',
        headers: { 'x-access-key': currentAdmin?.access_key ?? '' },
      })
      const json = await res.json()

      if (!res.ok) {
        setErrorMsg(json.error ?? 'Error al eliminar usuario.')
      } else {
        setSuccessMsg(`Usuario "${targetUser.name}" eliminado permanentemente.`)
        await fetchUsers()
      }
    } catch {
      setErrorMsg('Error de conexión al eliminar.')
    }
  }

  // =============================================================
  // Activar / Desactivar usuario
  // =============================================================
  const toggleUserActive = async (targetUser: User) => {
    // No permitir que el admin se desactive a sí mismo
    if (targetUser.id === currentAdmin?.id) {
      setErrorMsg('No puedes desactivarte a ti mismo.')
      return
    }

    const newStatus = !targetUser.is_active
    const res = await fetch(`/api/admin/users/${targetUser.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': currentAdmin?.access_key ?? '',
      },
      body: JSON.stringify({ is_active: newStatus }),
    })
    const json = await res.json()

    if (!res.ok) {
      setErrorMsg('Error al cambiar estado: ' + (json.error ?? 'Error desconocido'))
      return
    }

    const action = newStatus ? 'activado' : 'desactivado'
    setSuccessMsg(`Usuario "${targetUser.name}" ${action}.`)
    await fetchUsers()
  }

  // =============================================================
  // Render: Spinner de carga
  // =============================================================
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-md p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  // =============================================================
  // Render principal
  // =============================================================
  return (
    <div className="space-y-4">
      {/* ─── Mensajes de éxito/error ─────────────────────── */}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>✅</span> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <span>❌</span> {errorMsg}
        </div>
      )}

      {/* ─── Barra de acciones masivas (cuando hay selección) ──── */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-indigo-700">
              ✓ {selectedIds.size} usuario(s) seleccionado(s)
            </span>
            <button
              onClick={clearSelection}
              className="text-xs text-indigo-500 hover:text-indigo-700 underline"
            >
              Deseleccionar
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => handleBulkAction('deactivate')}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-yellow-100 text-yellow-800 hover:bg-yellow-200 rounded-lg transition disabled:opacity-50"
            >
              🚫 Desactivar
            </button>
            <button
              onClick={() => handleBulkAction('activate')}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 rounded-lg transition disabled:opacity-50"
            >
              ✅ Activar
            </button>
            <button
              onClick={() => handleBulkAction('delete')}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 rounded-lg transition disabled:opacity-50"
            >
              🗑️ Eliminar permanentemente
            </button>
          </div>
        </div>
      )}

      {/* ─── Barra superior: búsqueda + botón crear ──────── */}
      <div className="bg-white rounded-xl shadow-md p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          {/* Campo de búsqueda por nombre */}
          <div className="relative flex-1 w-full sm:max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text"
              placeholder="Buscar por nombre..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          {/* Botones de acción */}
          <div className="flex gap-2">
            {/* Envío masivo de claves por WhatsApp */}
            <button
              onClick={startBulkSend}
              title="Genera claves seguras para todos los usuarios con teléfono y las envía por WhatsApp una a una"
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 whitespace-nowrap"
            >
              <span>📲</span>
              <span className="hidden sm:inline">Envío masivo</span>
            </button>
            {/* Crear nuevo usuario */}
            <button
              onClick={openCreateModal}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 whitespace-nowrap"
            >
              <span>➕</span> Nuevo Usuario
            </button>
          </div>
        </div>

        {/* ─── Filtros por tipo de usuario ────────────────── */}
        <div className="flex flex-wrap gap-2 mt-3">
          {(
            [
              { key: 'todos', label: 'Todos' },
              { key: 'publicador', label: 'Publicadores' },
              { key: 'precursor_regular', label: 'Precursores Regulares' },
              { key: 'precursor_auxiliar', label: 'Precursores Auxiliares' },
              { key: 'admin', label: 'Administradores' },
              { key: 'inactivos', label: 'Inactivos' },
            ] as { key: FilterType; label: string }[]
          ).map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                activeFilter === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
              {/* Mostrar conteo junto al filtro */}
              <span className="ml-1 opacity-70">
                ({f.key === 'todos'
                  ? users.length
                  : f.key === 'admin'
                  ? users.filter(u => u.is_admin).length
                  : f.key === 'inactivos'
                  ? users.filter(u => !u.is_active).length
                  : users.filter(u => u.user_type === f.key).length})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Tabla de usuarios ───────────────────────────── */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        {/* Versión desktop: tabla */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    title="Seleccionar todos"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Clave</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cónyuge</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Género</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Admin</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">WhatsApp</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                    No se encontraron usuarios.
                  </td>
                </tr>
              ) : (
                filteredUsers.map(u => (
                  <tr
                    key={u.id}
                    className={`hover:bg-gray-50 transition ${!u.is_active ? 'opacity-50' : ''} ${
                      selectedIds.has(u.id) ? 'bg-indigo-50/50' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </td>
                    {/* Nombre */}
                    <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                    {/* Clave de acceso: muestra texto plano si fue generada en esta sesión, si no parcialmente oculta */}
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {generatedKeys.has(u.id) ? (
                        <span className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-2 py-0.5 rounded font-mono text-[11px] select-all">
                          {generatedKeys.get(u.id)}
                        </span>
                      ) : (
                        <span>{u.access_key.slice(0, 3)}{'•'.repeat(Math.max(0, u.access_key.length - 3))}</span>
                      )}
                    </td>
                    {/* Tipo de usuario con badge de color */}
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE_COLORS[u.user_type] || 'bg-gray-100 text-gray-700'}`}>
                        {USER_TYPE_LABELS[u.user_type] || u.user_type}
                      </span>
                    </td>
                    {/* Cónyuge vinculado (Fase 3) */}
                    <td className="px-4 py-3">
                      {u.spouse_id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-pink-700 bg-pink-50 px-2 py-0.5 rounded-full font-medium">
                            💑 {getSpouseName(u.spouse_id)}
                          </span>
                          <button
                            onClick={() => unlinkSpouse(u)}
                            className="text-[10px] text-red-400 hover:text-red-600 transition"
                            title="Desvincular cónyuge"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => openSpouseModal(u)}
                          className="text-xs text-gray-400 hover:text-indigo-600 transition"
                          title="Vincular cónyuge"
                        >
                          + Vincular
                        </button>
                      )}
                    </td>
                    {/* Género */}
                    <td className="px-4 py-3 text-center text-gray-600">
                      {u.gender === 'M' ? '👨 Masc.' : u.gender === 'F' ? '👩 Fem.' : '—'}
                    </td>
                    {/* Estado activo/inactivo */}
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {u.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {/* ¿Es admin? */}
                    <td className="px-4 py-3 text-center">
                      {u.is_admin ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          Admin
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    {/* Columna WhatsApp: generar clave + enviar */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {/* Botón: generar nueva clave segura */}
                        <button
                          onClick={() => handleGenerateKey(u)}
                          title="Generar nueva clave segura y guardarla"
                          className="px-2 py-1 text-[11px] font-medium bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition"
                        >
                          🔑 Generar
                        </button>
                        {/* Botón: abrir WhatsApp con mensaje pre-escrito */}
                        <button
                          onClick={() => openWhatsApp(u)}
                          disabled={!generatedKeys.has(u.id)}
                          title={!generatedKeys.has(u.id) ? 'Primero genera una clave' : `Enviar clave a ${u.name} por WhatsApp`}
                          className={`px-2 py-1 text-[11px] font-medium rounded-lg transition ${
                            generatedKeys.has(u.id)
                              ? 'bg-green-50 hover:bg-green-100 text-green-700'
                              : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                          }`}
                        >
                          📲 Enviar
                        </button>
                      </div>
                      {/* Indicador: teléfono no registrado */}
                      {!u.phone && (
                        <p className="text-[10px] text-amber-500 mt-1">Sin teléfono</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {/* Botón editar */}
                        <button
                          onClick={() => openEditModal(u)}
                          className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 transition"
                          title="Editar usuario"
                        >
                          ✏️
                        </button>
                        {/* Botón vincular/desvincular cónyuge (Fase 3) */}
                        <button
                          onClick={() => u.spouse_id ? unlinkSpouse(u) : openSpouseModal(u)}
                          className={`p-1.5 rounded-lg transition ${
                            u.spouse_id
                              ? 'hover:bg-pink-50 text-pink-500'
                              : 'hover:bg-pink-50 text-gray-400'
                          }`}
                          title={u.spouse_id ? 'Desvincular cónyuge' : 'Vincular cónyuge'}
                        >
                          💑
                        </button>
                        {/* Botón activar/desactivar */}
                        <button
                          onClick={() => toggleUserActive(u)}
                          disabled={u.id === currentAdmin?.id}
                          className={`p-1.5 rounded-lg transition ${
                            u.id === currentAdmin?.id
                              ? 'opacity-30 cursor-not-allowed'
                              : u.is_active
                              ? 'hover:bg-red-50 text-red-500'
                              : 'hover:bg-green-50 text-green-600'
                          }`}
                          title={
                            u.id === currentAdmin?.id
                              ? 'No puedes desactivarte a ti mismo'
                              : u.is_active
                              ? 'Desactivar usuario'
                              : 'Activar usuario'
                          }
                        >
                          {u.is_active ? '🚫' : '✅'}
                        </button>
                        {/* Botón eliminar permanentemente */}
                        <button
                          onClick={() => handleDeleteUser(u)}
                          disabled={u.id === currentAdmin?.id}
                          className={`p-1.5 rounded-lg transition ${
                            u.id === currentAdmin?.id
                              ? 'opacity-30 cursor-not-allowed'
                              : 'hover:bg-red-50 text-red-600'
                          }`}
                          title={
                            u.id === currentAdmin?.id
                              ? 'No puedes eliminarte a ti mismo'
                              : 'Eliminar permanentemente'
                          }
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Versión mobile: tarjetas */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredUsers.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400">
              No se encontraron usuarios.
            </div>
          ) : (
            filteredUsers.map(u => (
              <div
                key={u.id}
                className={`p-4 ${!u.is_active ? 'opacity-50' : ''} ${
                  selectedIds.has(u.id) ? 'bg-indigo-50/50' : ''
                }`}
              >
                {/* Cabecera de la tarjeta: nombre + acciones */}
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                      className="h-4 w-4 mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                    <p className="font-medium text-gray-800">{u.name}</p>
                    {/* Clave: muestra plain text si se acaba de generar */}
                    <p className="text-xs text-gray-400 font-mono mt-0.5">
                      {generatedKeys.has(u.id) ? (
                        <span className="bg-yellow-50 text-yellow-800 px-1.5 py-0.5 rounded text-[11px] select-all">
                          {generatedKeys.get(u.id)}
                        </span>
                      ) : (
                        <>{u.access_key.slice(0, 3)}{'•'.repeat(Math.max(0, u.access_key.length - 3))}</>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditModal(u)}
                      className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => u.spouse_id ? unlinkSpouse(u) : openSpouseModal(u)}
                      className={`p-1.5 rounded-lg ${
                        u.spouse_id ? 'hover:bg-pink-50 text-pink-500' : 'hover:bg-pink-50 text-gray-400'
                      }`}
                    >
                      💑
                    </button>
                    <button
                      onClick={() => toggleUserActive(u)}
                      disabled={u.id === currentAdmin?.id}
                      className={`p-1.5 rounded-lg ${
                        u.id === currentAdmin?.id
                          ? 'opacity-30 cursor-not-allowed'
                          : u.is_active
                          ? 'hover:bg-red-50 text-red-500'
                          : 'hover:bg-green-50 text-green-600'
                      }`}
                    >
                      {u.is_active ? '🚫' : '✅'}
                    </button>
                    {/* Generar clave */}
                    <button
                      onClick={() => handleGenerateKey(u)}
                      title="Generar nueva clave segura"
                      className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600 font-bold text-base"
                    >
                      🔑
                    </button>
                    {/* Enviar por WhatsApp */}
                    <button
                      onClick={() => openWhatsApp(u)}
                      disabled={!generatedKeys.has(u.id)}
                      title={generatedKeys.has(u.id) ? 'Enviar por WhatsApp' : 'Genera primero una clave'}
                      className={`p-1.5 rounded-lg font-bold text-base ${
                        generatedKeys.has(u.id)
                          ? 'hover:bg-green-50 text-green-600'
                          : 'text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      📲
                    </button>
                    {/* Eliminar permanentemente */}
                    <button
                      onClick={() => handleDeleteUser(u)}
                      disabled={u.id === currentAdmin?.id}
                      className={`p-1.5 rounded-lg ${
                        u.id === currentAdmin?.id
                          ? 'opacity-30 cursor-not-allowed'
                          : 'hover:bg-red-50 text-red-600'
                      }`}
                      title="Eliminar permanentemente"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                </div>
                {/* Badges en la tarjeta */}
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE_COLORS[u.user_type]}`}>
                    {USER_TYPE_LABELS[u.user_type]}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {u.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                  {u.is_admin && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      Admin
                    </span>
                  )}
                  {u.gender && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {u.gender === 'M' ? '👨 Masc.' : '👩 Fem.'}
                    </span>
                  )}
                  {/* Cónyuge en tarjeta mobile (Fase 3) */}
                  {u.spouse_id && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-pink-50 text-pink-700">
                      💑 {getSpouseName(u.spouse_id)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ─── Pie de tabla: resumen ─────────────────────── */}
        <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
          <span>
            Mostrando {filteredUsers.length} de {users.length} usuarios
          </span>
          <span>
            {users.filter(u => u.is_active).length} activos · {users.filter(u => !u.is_active).length} inactivos
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          MODAL: Crear / Editar Usuario
          ═══════════════════════════════════════════════════════ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Fondo oscuro con click para cerrar */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />
          {/* Contenido del modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            {/* Encabezado del modal */}
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 rounded-t-2xl flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingUser ? '✏️ Editar Usuario' : '➕ Nuevo Usuario'}
              </h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 text-xl transition"
              >
                ✕
              </button>
            </div>

            {/* Cuerpo del formulario */}
            <div className="px-6 py-4 space-y-4">
              {/* Errores de validación */}
              {formErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  {formErrors.map((err, i) => (
                    <p key={i} className="text-sm text-red-600 flex items-start gap-1">
                      <span className="mt-0.5">⚠️</span> {err}
                    </p>
                  ))}
                </div>
              )}

              {/* Campo: Nombre completo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ej: Juan Pérez"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              {/* Campo: Clave de acceso */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Clave de acceso <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.access_key}
                  onChange={e => setFormData(prev => ({ ...prev, access_key: e.target.value }))}
                  placeholder="Mínimo 6 caracteres, sin espacios"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Esta clave es la que el usuario usará para iniciar sesión.
                </p>
              </div>

              {/* Campo: Tipo de usuario */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de usuario
                </label>
                <select
                  value={formData.user_type}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    user_type: e.target.value as UserFormData['user_type'],
                  }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                >
                  <option value="publicador">Publicador (máx 1 turno/semana)</option>
                  <option value="precursor_regular">Precursor Regular (máx 2 turnos/semana)</option>
                  <option value="precursor_auxiliar">Precursor Auxiliar (máx 2 turnos/semana)</option>
                </select>
              </div>

              {/* Campo: Género */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Género
                </label>
                <div className="flex gap-3">
                  {/* Opción: Masculino */}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, gender: 'M' }))}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition ${
                      formData.gender === 'M'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    👨 Masculino
                  </button>
                  {/* Opción: Femenino */}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, gender: 'F' }))}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition ${
                      formData.gender === 'F'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    👩 Femenino
                  </button>
                  {/* Opción: Sin definir */}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, gender: null }))}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition ${
                      formData.gender === null
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    Sin definir
                  </button>
                </div>
              </div>

              {/* Campo: Toggle de administrador */}
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Privilegios de administrador</p>
                  <p className="text-xs text-gray-400">Puede gestionar horarios y usuarios</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, is_admin: !prev.is_admin }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    formData.is_admin ? 'bg-indigo-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      formData.is_admin ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Campo: Teléfono WhatsApp */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Teléfono WhatsApp
                  <span className="ml-1 text-xs font-normal text-gray-400">(opcional)</span>
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="Ej: 573001234567 (con código de país)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Incluye el código de país sin el “+”.
                  Colombia: <span className="font-mono">57</span> + 10 dígitos. Ej: <span className="font-mono">573001234567</span>
                </p>
              </div>
            </div>

            {/* Pie del modal: botones de acción */}
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 rounded-b-2xl flex gap-3 justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <span className="animate-spin">⏳</span> Guardando...
                  </>
                ) : editingUser ? (
                  'Guardar Cambios'
                ) : (
                  'Crear Usuario'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          MODAL: Envío masivo de claves por WhatsApp
          ═══════════════════════════════════════════════════════ */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Cabecera */}
            <div className="bg-green-600 px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-lg">📲 Envío masivo — WhatsApp</h2>
              <button onClick={closeBulkModal} className="text-white/70 hover:text-white text-xl leading-none">✕</button>
            </div>

            {/* Paso: generando claves */}
            {bulkStep === 'generating' && (
              <div className="p-10 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-green-200 border-t-green-600 mx-auto mb-5" />
                <p className="font-medium text-gray-700">Generando claves seguras...</p>
                <p className="text-xs text-gray-400 mt-1">Espera unos segundos.</p>
              </div>
            )}

            {/* Paso: envío secuencial */}
            {bulkStep === 'sending' && bulkQueue.length > 0 && (
              <div className="p-6 space-y-4">
                {/* Progreso */}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Usuario {bulkIndex + 1} de {bulkQueue.length}</span>
                  <span className="font-mono bg-green-50 text-green-700 px-2 py-0.5 rounded">
                    {Math.round((bulkIndex / bulkQueue.length) * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${(bulkIndex / bulkQueue.length) * 100}%` }}
                  />
                </div>

                {/* Tarjeta del usuario actual */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="font-semibold text-gray-800 text-lg">{bulkQueue[bulkIndex].user.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">📱 {bulkQueue[bulkIndex].user.phone}</p>
                  <p className="text-[11px] font-mono mt-2 bg-white/70 px-2 py-1 rounded select-all text-gray-600">
                    🔗 Magic link incluido en el mensaje
                  </p>
                  <p className="text-[11px] font-mono text-gray-500 mt-0.5 select-all">
                    🔑 {bulkQueue[bulkIndex].key}
                  </p>
                </div>

                {/* Botones de acción */}
                <div className="flex gap-3">
                  <button
                    onClick={() => openBulkWhatsApp(bulkQueue[bulkIndex])}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl font-medium text-sm transition"
                  >
                    📲 Abrir WhatsApp
                  </button>
                  <button
                    onClick={advanceBulk}
                    className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 py-2.5 rounded-xl font-medium text-sm transition"
                  >
                    {bulkIndex + 1 < bulkQueue.length ? '✓ Enviado, siguiente →' : '✓ Terminar'}
                  </button>
                </div>
                <p className="text-xs text-center text-gray-400">
                  El mensaje se pre-rellena en WhatsApp. Solo revísalo y pulsa enviar.
                </p>
              </div>
            )}

            {/* Paso: completado */}
            {bulkStep === 'done' && (
              <div className="p-10 text-center">
                <div className="text-5xl mb-4">🎉</div>
                <h3 className="text-lg font-semibold text-gray-800 mb-1">¡Completado!</h3>
                <p className="text-sm text-gray-500">
                  Claves enviadas a <strong>{bulkQueue.length}</strong> usuarios.
                </p>
                <button
                  onClick={closeBulkModal}
                  className="mt-6 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl text-sm font-medium transition"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          MODAL: Vincular Cónyuge (Fase 3)
          ═══════════════════════════════════════════════════════ */}
      {showSpouseModal && spouseTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Fondo oscuro */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => { setShowSpouseModal(false); setSpouseTargetUser(null) }}
          />
          {/* Contenido del modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            {/* Encabezado */}
            <div className="border-b border-gray-100 px-6 py-4 rounded-t-2xl flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">💑 Vincular Cónyuge</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Selecciona el cónyuge de <strong>{spouseTargetUser.name}</strong>
                </p>
              </div>
              <button
                onClick={() => { setShowSpouseModal(false); setSpouseTargetUser(null) }}
                className="text-gray-400 hover:text-gray-600 text-xl transition"
              >
                ✕
              </button>
            </div>

            {/* Buscador dentro del modal */}
            <div className="px-6 pt-4">
              <input
                type="text"
                placeholder="Buscar usuario por nombre..."
                value={spouseSearch}
                onChange={e => setSpouseSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {/* Lista de usuarios disponibles para vincular */}
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {availableSpouses.length === 0 ? (
                <p className="text-center text-gray-400 py-6 text-sm">
                  No hay usuarios disponibles para vincular.
                </p>
              ) : (
                availableSpouses.map(u => (
                  <button
                    key={u.id}
                    onClick={() => linkSpouse(u)}
                    disabled={savingSpouse}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-pink-50 transition text-left disabled:opacity-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{u.name}</p>
                      <p className="text-xs text-gray-400">
                        {USER_TYPE_LABELS[u.user_type]} · {u.gender === 'M' ? '👨' : u.gender === 'F' ? '👩' : '—'}
                      </p>
                    </div>
                    <span className="text-pink-500 text-xs font-medium">
                      {savingSpouse ? '...' : 'Vincular →'}
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* Pie del modal */}
            <div className="border-t border-gray-100 px-6 py-3 rounded-b-2xl">
              <p className="text-xs text-gray-400 text-center">
                Solo se muestran usuarios activos sin cónyuge asignado.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
