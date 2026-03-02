/**
 * app/super-admin/page.tsx — Super Admin Panel (V4 Multi-Tenant)
 * ─────────────────────────────────────────────────────────────
 * Panel de administración global para gestionar todas las congregaciones.
 * URL: /super-admin
 *
 * Seguridad:
 *   - Requiere ingresar la SUPER_ADMIN_KEY (variable de entorno)
 *   - La clave se envía como header X-Super-Admin-Key en las peticiones
 *   - NUNCA se guarda la clave en localStorage (solo en estado React)
 *
 * Funcionalidades:
 *   - Ver todas las congregaciones (activas e inactivas)
 *   - Crear nueva congregación (name + slug)
 *   - Activar / Desactivar congregaciones
 *   - Copiar enlace directo a cada congregación
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useState, useCallback } from 'react'
import type { Congregation } from '@/types'

export default function SuperAdminPage() {
  const [superKey, setSuperKey] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [congregations, setCongregations] = useState<Congregation[]>([])
  const [loading, setLoading] = useState(false)

  // Formulario de nueva congregación
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Operaciones sobre congregaciones
  const [toggling, setToggling] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // ── Autenticación: verificar super key llamando a la API ──
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)

    try {
      const res = await fetch('/api/super-admin/congregations', {
        headers: { 'X-Super-Admin-Key': superKey },
      })
      if (!res.ok) {
        setAuthError('Clave incorrecta o no configurada')
        setAuthLoading(false)
        return
      }
      const data = await res.json()
      setCongregations(data)
      setAuthenticated(true)
    } catch {
      setAuthError('Error al conectar con el servidor')
    } finally {
      setAuthLoading(false)
    }
  }

  // ── Cargar congregaciones ───────────────────────────────────
  const loadCongregations = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/super-admin/congregations', {
        headers: { 'X-Super-Admin-Key': superKey },
      })
      const data = await res.json()
      setCongregations(data)
    } catch { /* ignorar */ }
    setLoading(false)
  }, [superKey])

  // ── Crear congregación ─────────────────────────────────────
  const handleCreate = async () => {
    const trimName = newName.trim()
    const trimSlug = newSlug.trim()

    if (!trimName || !trimSlug) {
      setCreateError('Nombre y slug son obligatorios')
      return
    }

    setCreating(true)
    setCreateError(null)

    const res = await fetch('/api/super-admin/congregations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Super-Admin-Key': superKey,
      },
      body: JSON.stringify({ name: trimName, slug: trimSlug }),
    })

    if (!res.ok) {
      const json = await res.json()
      setCreateError(json.error ?? 'Error al crear')
      setCreating(false)
      return
    }

    setNewName('')
    setNewSlug('')
    setShowForm(false)
    await loadCongregations()
    setCreating(false)
  }

  // ── Toggle active ──────────────────────────────────────────
  const handleToggle = async (cong: Congregation) => {
    if (!confirm(
      cong.is_active
        ? `¿Desactivar "${cong.name}"? Los usuarios no podrán acceder.`
        : `¿Activar "${cong.name}"?`
    )) return

    setToggling(cong.id)
    await fetch(`/api/super-admin/congregations/${cong.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Super-Admin-Key': superKey,
      },
      body: JSON.stringify({ is_active: !cong.is_active }),
    })
    await loadCongregations()
    setToggling(null)
  }

  // ── Copiar enlace ──────────────────────────────────────────
  const handleCopy = (slug: string) => {
    const url = `${window.location.origin}/${slug}`
    navigator.clipboard.writeText(url)
    setCopied(slug)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── Generar slug normalizado automáticamente ───────────────
  const handleNameChange = (name: string) => {
    setNewName(name)
    const generatedSlug = name
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quitar acentos
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 40)
    setNewSlug(generatedSlug)
  }

  // ── Pantalla de login ──────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🔐</div>
            <h1 className="text-2xl font-bold text-gray-800">Super Administrador</h1>
            <p className="text-gray-500 text-sm mt-1">Acceso restringido</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            <input
              type="password"
              value={superKey}
              onChange={e => setSuperKey(e.target.value)}
              placeholder="Clave de Super Admin"
              className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-gray-900"
              required
            />
            {authError && (
              <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
                {authError}
              </div>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-purple-700 text-white py-3 rounded-lg font-medium hover:bg-purple-800 transition disabled:opacity-50"
            >
              {authLoading ? 'Verificando...' : 'Acceder'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Panel principal ────────────────────────────────────────
  const activeCount   = congregations.filter(c => c.is_active).length
  const inactiveCount = congregations.length - activeCount

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-purple-800 to-indigo-800 text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              🌐 Super Admin — Congregaciones
            </h1>
            <p className="text-purple-200 text-sm mt-0.5">
              {activeCount} activas · {inactiveCount} inactivas
            </p>
          </div>
          <button
            onClick={() => { setAuthenticated(false); setSuperKey('') }}
            className="bg-purple-900/50 hover:bg-purple-900 px-4 py-2 rounded-lg text-sm transition"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* Botón para crear nueva congregación */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm(v => !v)}
            className="bg-indigo-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-indigo-700 transition"
          >
            {showForm ? '✕ Cancelar' : '+ Nueva congregación'}
          </button>
        </div>

        {/* Formulario de creación */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
            <h2 className="font-semibold text-gray-700">Nueva congregación</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Nombre
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="ej: Congregación Torres del Río"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Slug (URL)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">/</span>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="torres-del-rio"
                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  URL: /{newSlug || 'mi-congregacion'}
                </p>
              </div>
            </div>

            {createError && (
              <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
                {createError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowForm(false); setCreateError(null) }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim() || !newSlug.trim()}
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {creating ? 'Creando...' : 'Crear congregación'}
              </button>
            </div>
          </div>
        )}

        {/* Lista de congregaciones */}
        {loading ? (
          <div className="text-center py-8 text-gray-400">Cargando...</div>
        ) : congregations.length === 0 ? (
          <div className="text-center py-8 text-gray-400">No hay congregaciones aún.</div>
        ) : (
          <div className="space-y-3">
            {congregations.map(cong => (
              <div
                key={cong.id}
                className={`bg-white rounded-xl shadow-sm border p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                  !cong.is_active ? 'opacity-60' : ''
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800">{cong.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      cong.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {cong.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm mt-0.5">
                    /{cong.slug} · creada {new Date(cong.created_at).toLocaleDateString('es-CO')}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Copiar enlace */}
                  <button
                    onClick={() => handleCopy(cong.slug)}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                  >
                    {copied === cong.slug ? '✓ Copiado' : '🔗 Copiar enlace'}
                  </button>

                  {/* Ir al dashboard */}
                  <a
                    href={`/${cong.slug}/dashboard`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition"
                  >
                    Abrir →
                  </a>

                  {/* Activar / Desactivar */}
                  <button
                    onClick={() => handleToggle(cong)}
                    disabled={toggling === cong.id}
                    className={`px-3 py-1.5 text-sm rounded-lg transition disabled:opacity-50 ${
                      cong.is_active
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {toggling === cong.id
                      ? '...'
                      : cong.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
