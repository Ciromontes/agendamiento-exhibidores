/**
 * app/page.tsx - Página de Login
 * ─────────────────────────────────────────────────────────────
 * Página principal de la app. Muestra el formulario de login.
 *
 * Flujo de autenticación:
 *   1. El usuario ingresa su clave de acceso (access_key)
 *   2. Se busca en la tabla "users" por access_key + is_active=true
 *   3. Si se encuentra, se guarda en el contexto (UserContext)
 *   4. Se redirige según el rol:
 *      - Admin (is_admin=true) → /admin
 *      - Usuario normal → /dashboard
 *
 * Si el usuario ya está logueado (sesión en localStorage),
 * se redirige automáticamente sin mostrar el formulario.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

export default function HomePage() {
  // --- Estado local del formulario ---
  const [accessKey, setAccessKey] = useState('')     // Clave ingresada por el usuario
  const [loading, setLoading] = useState(false)      // Indicador de carga durante verificación
  const [error, setError] = useState('')             // Mensaje de error a mostrar
  const router = useRouter()                          // Router para redirección
  const { user, setUser } = useUser()                 // Contexto global de usuario

  // --- Redirección automática si ya está logueado ---
  // Si hay usuario en el contexto (restaurado de localStorage),
  // redirigir sin mostrar el login.
  useEffect(() => {
    if (user) {
      router.push(user.is_admin ? '/admin' : '/dashboard')
    }
  }, [user, router])

  // --- Magic link: si la URL trae ?k=CLAVE, hacer login automático ---
  // El admin envía por WhatsApp un enlace con la clave del usuario.
  // Al abrirlo, se inicia sesión sin que el usuario tenga que escribir nada.
  useEffect(() => {
    if (user) return // si ya está logueado, ignorar
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
          body: JSON.stringify({ access_key: magicKey }),
        })
        const json = await res.json()

        if (res.status === 429) {
          setError(json.error || 'Demasiados intentos. Espera unos minutos e intenta de nuevo.')
          setLoading(false)
          return
        }
        if (!res.ok || !json.user) {
          setError('El enlace de acceso no es válido o ya no está activo.')
          setLoading(false)
          return
        }
        // Login exitoso: limpiar ?k= de la URL por seguridad y redirigir
        window.history.replaceState({}, '', '/')
        setUser(json.user)
        router.push(json.user.is_admin ? '/admin' : '/dashboard')
      } catch {
        setError('Error al conectar con el servidor.')
        setLoading(false)
      }
    }

    autoLogin()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * handleSubmit - Procesa el formulario de login.
   * Busca el usuario en Supabase por su access_key.
   * Si lo encuentra y está activo, guarda la sesión y redirige.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!accessKey.trim()) return  // No enviar si está vacío

    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_key: accessKey.trim() }),
      })
      const json = await res.json()

      if (res.status === 429) {
        setError(json.error || 'Demasiados intentos. Espera unos minutos e intenta de nuevo.')
        setLoading(false)
        return
      }
      if (!res.ok || !json.user) {
        setError(json.error || 'Clave inválida o usuario inactivo')
        setLoading(false)
        return
      }

      // Login exitoso: guardar usuario en contexto + localStorage
      setUser(json.user)
      // Redirigir según rol
      router.push(json.user.is_admin ? '/admin' : '/dashboard')
    } catch {
      setError('Error al conectar con el servidor')
    } finally {
      setLoading(false)
    }
  }

  // --- Interfaz de login ---
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* Logo y título de la app */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">📋</div>
          <h1 className="text-3xl font-bold text-indigo-700">Exhibidores</h1>
          <p className="text-gray-500 mt-2">Sistema de Agendamiento</p>
        </div>

        {/* Formulario de login */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ingresa tu clave
            </label>
            {/* Campo de clave (tipo password para ocultar texto) */}
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

          {/* Mensaje de error (solo visible si hay error) */}
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Botón de enviar */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}