/**
 * app/[slug]/page.tsx — Login de Congregación Específica (V4 Multi-Tenant)
 * ─────────────────────────────────────────────────────────────
 * Página de login para una congregación identificada por su slug.
 * URL: /{slug}  → ej: /principal, /torres-rio
 *
 * Flujo:
 *   1. Se muestra el formulario de login CON el nombre de la congregación
 *   2. El usuario ingresa su clave de acceso
 *   3. Se llama a POST /api/auth/login con { access_key, slug }
 *   4. Si es válido → setSession(user, slug) → redirigir a /{slug}/dashboard
 *
 * También maneja magic links: /{slug}?k=CLAVE
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

type Props = {
  params: Promise<{ slug: string }>
}

export default function CongregationLoginPage({ params }: Props) {
  const { slug } = use(params)

  const [accessKey, setAccessKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [congregationName, setCongregationName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const router = useRouter()
  const { user, congregationSlug, setSession } = useUser()

  // Si ya está logueado en ESTA congregación, redirigir directamente
  useEffect(() => {
    if (user && user.congregation_id) {
      if (congregationSlug && congregationSlug !== slug) {
        // Redirigir a su propia congregación, Opcional: cerrar sesión
        router.push(user.is_admin ? `/${congregationSlug}/admin` : `/${congregationSlug}/dashboard`)
      } else {
        router.push(user.is_admin ? `/${slug}/admin` : `/${slug}/dashboard`)
      }
    }
  }, [user, congregationSlug, slug, router])

  // Cargar nombre de la congregación para mostrarlo en el título
  useEffect(() => {
    const fetchCongregation = async () => {
      try {
        const res = await fetch(`/api/congregations/${slug}`)
        if (!res.ok) {
          setNotFound(true)
          return
        }
        const data = await res.json()
        setCongregationName(data.name)
      } catch {
        setNotFound(true)
      }
    }
    fetchCongregation()
  }, [slug])

  // Magic link: /{slug}?k=CLAVE  →  login automático
  useEffect(() => {
    if (user) return
    const params = new URLSearchParams(window.location.search)
    const magicKey = params.get('k')
    if (!magicKey) return

    const autoLogin = async () => {
      setLoading(true)
      setAccessKey(magicKey)
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_key: magicKey, slug }),
        })
        const json = await res.json()

        if (res.status === 429) {
          setError(json.error || 'Demasiados intentos. Espera unos minutos.')
          setLoading(false)
          return
        }
        if (!res.ok || !json.user) {
          setError('El enlace de acceso no es válido o ya no está activo.')
          setLoading(false)
          return
        }
        window.history.replaceState({}, '', `/${slug}`)
        setSession(json.user, json.congregationSlug ?? slug)
        router.push(json.user.is_admin ? `/${slug}/admin` : `/${slug}/dashboard`)
      } catch {
        setError('Error al conectar con el servidor.')
        setLoading(false)
      }
    }
    autoLogin()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accessKey.trim()) return

    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_key: accessKey.trim(), slug }),
      })
      const json = await res.json()

      if (res.status === 429) {
        setError(json.error || 'Demasiados intentos. Espera unos minutos.')
        setLoading(false)
        return
      }
      if (res.status === 404) {
        setNotFound(true)
        setLoading(false)
        return
      }
      if (!res.ok || !json.user) {
        setError(json.error || 'Clave inválida o usuario inactivo')
        setLoading(false)
        return
      }

      setSession(json.user, json.congregationSlug ?? slug)
      router.push(json.user.is_admin ? `/${slug}/admin` : `/${slug}/dashboard`)
    } catch {
      setError('Error al conectar con el servidor')
    } finally {
      setLoading(false)
    }
  }

  // Congregación no encontrada
  if (notFound) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Congregación no encontrada</h1>
          <p className="text-gray-500 mb-6">
            No existe una congregación con el identificador <code className="bg-gray-100 px-2 py-1 rounded text-indigo-700">{slug}</code>
          </p>
          <button
            onClick={() => router.push('/')}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition"
          >
            Ir al inicio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* Logo y título */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">📋</div>
          <h1 className="text-3xl font-bold text-indigo-700">Exhibidores</h1>
          {congregationName ? (
            <p className="text-indigo-500 font-medium mt-1">{congregationName}</p>
          ) : (
            <p className="text-gray-400 mt-1 text-sm">Cargando...</p>
          )}
          <p className="text-gray-500 text-sm mt-1">Sistema de Agendamiento</p>
        </div>

        {/* Formulario de login */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ingresa tu clave
            </label>
            <input
              type="password"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="Tu clave personal"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition text-gray-900"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !congregationName}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>

        {/* Enlace al inicio */}
        <p className="text-center text-gray-400 text-xs mt-6">
          <button onClick={() => router.push('/')} className="hover:text-indigo-500 transition">
            ← Volver al inicio
          </button>
        </p>
      </div>
    </div>
  )
}
