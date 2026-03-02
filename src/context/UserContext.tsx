/**
 * context/UserContext.tsx — V4 Multi-Tenant
 * ─────────────────────────────────────────────────────────────
 * Contexto global de usuario para toda la aplicación.
 *
 * Maneja el estado de autenticación usando localStorage
 * (no usamos Supabase Auth, solo access_key).
 *
 * Provee:
 *   - user: datos del usuario logueado (o null)
 *   - congregationSlug: slug de la congregación activa (ej: 'principal')
 *   - setUser: guardar/actualizar usuario en estado + localStorage
 *   - setSession: guardar usuario + slug en estado + localStorage (V4)
 *   - isLoading: true mientras se carga el usuario desde localStorage
 *   - logout: limpiar sesión y redirigir al login
 *
 * Se envuelve toda la app en <UserProvider> desde layout.tsx.
 * Los componentes acceden al usuario con el hook useUser().
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@/types'

// Tipo del contexto: lo que provee el UserProvider
type UserContextType = {
  user: User | null                              // Usuario logueado (null = no logueado)
  congregationSlug: string | null               // V4: slug de la congregación activa
  setUser: (user: User | null) => void           // Función para guardar usuario (legacy)
  setSession: (user: User, slug: string) => void // V4: guardar usuario + slug
  isLoading: boolean                             // ¿Está cargando desde localStorage?
  logout: () => void                             // Cerrar sesión
}

// Crear el contexto con valor inicial undefined
const UserContext = createContext<UserContextType | undefined>(undefined)

/**
 * UserProvider - Componente que envuelve toda la app.
 * Se usa en layout.tsx: <UserProvider>{children}</UserProvider>
 * Al montar, intenta restaurar la sesión desde localStorage.
 */
export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [congregationSlug, setCongregationSlug] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true) // Empieza cargando

  // Al montar: intentar restaurar sesión guardada en localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem('exhibidor-user')
    if (storedUser) {
      try {
        // Parsear los datos guardados del usuario
        setUser(JSON.parse(storedUser))
        const storedSlug = localStorage.getItem('exhibidor-congregation-slug')
        if (storedSlug) setCongregationSlug(storedSlug)
      } catch {
        // Si el JSON está corrupto, limpiar localStorage
        localStorage.removeItem('exhibidor-user')
        localStorage.removeItem('exhibidor-congregation-slug')
      }
    }
    setIsLoading(false) // Ya terminó de cargar
  }, [])

  /**
   * handleSetUser - Guarda el usuario en estado y localStorage.
   * Si newUser es null, limpia localStorage (logout).
   * @deprecated Usar setSession(user, slug) en V4 para que el slug quede guardado.
   */
  const handleSetUser = (newUser: User | null) => {
    setUser(newUser)
    if (newUser) {
      localStorage.setItem('exhibidor-user', JSON.stringify(newUser))
    } else {
      localStorage.removeItem('exhibidor-user')
      localStorage.removeItem('exhibidor-congregation-slug')
      setCongregationSlug(null)
    }
  }

  /**
   * setSession - V4: Guarda usuario + slug de congregación.
   * Usar esto en lugar de setUser cuando se hace login con slug.
   */
  const handleSetSession = (newUser: User, slug: string) => {
    setUser(newUser)
    setCongregationSlug(slug)
    localStorage.setItem('exhibidor-user', JSON.stringify(newUser))
    localStorage.setItem('exhibidor-congregation-slug', slug)
  }

  /**
   * logout - Cierra la sesión del usuario.
   * Limpia el estado y localStorage.
   */
  const logout = () => {
    setUser(null)
    setCongregationSlug(null)
    localStorage.removeItem('exhibidor-user')
    localStorage.removeItem('exhibidor-congregation-slug')
  }

  // Proveer el contexto a todos los componentes hijos
  return (
    <UserContext.Provider value={{
      user,
      congregationSlug,
      setUser: handleSetUser,
      setSession: handleSetSession,
      isLoading,
      logout,
    }}>
      {children}
    </UserContext.Provider>
  )
}

/**
 * useUser - Hook personalizado para acceder al contexto de usuario.
 * Debe usarse dentro de un <UserProvider>.
 *
 * Ejemplo de uso:
 *   const { user, congregationSlug, logout } = useUser()
 *   if (user?.is_admin) { ... }
 */
export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}