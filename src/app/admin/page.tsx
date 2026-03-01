/**
 * app/admin/page.tsx - Panel de Administración (Fase 4)
 * ─────────────────────────────────────────────────────────────
 * Página exclusiva para administradores.
 *
 * Tiene 3 pestañas:
 *   1. “Gestionar Horarios” → AdminScheduleGrid
 *   2. “Gestionar Usuarios” → AdminUserManager (Fase 2)
 *   3. “Configuración”       → AdminConfigPanel (Fase 4)
 *      Permite cambiar el modo de conteo (semanal/mensual).
 *
 * Protección:
 *   Si el usuario no está logueado O no es admin,
 *   se redirige al login (/).
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useUser } from '@/context/UserContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import AdminScheduleGrid from '@/components/AdminScheduleGrid'
import AdminUserManager from '@/components/AdminUserManager'
import AdminConfigPanel from '@/components/AdminConfigPanel'
import AdminWeekReport from '@/components/AdminWeekReport'
import AdminAbsencePanel from '@/components/AdminAbsencePanel'
import AdminExhibitorManager from '@/components/AdminExhibitorManager'
import AdminResetPanel from '@/components/AdminResetPanel'

export default function AdminPage() {
  const { user, isLoading, logout } = useUser()
  const router = useRouter()
  // Pestaña activa: 'horarios', 'usuarios' o 'config'
  const [activeTab, setActiveTab] = useState<'horarios' | 'usuarios' | 'config' | 'reporte' | 'ausentes' | 'exhibidores' | 'reset'>('horarios')

  // Protección de ruta: solo admins pueden ver esta página
  useEffect(() => {
    if (!isLoading && (!user || !user.is_admin)) {
      router.push('/')
    }
  }, [user, isLoading, router])

  // Spinner mientras se carga la sesión
  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header del panel admin con degradado */}
      <header className="bg-gradient-to-r from-indigo-800 to-purple-800 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span>⚙️</span> Panel de Administracion
            </h1>
            <p className="text-indigo-200 text-sm mt-0.5">
              {user.name} · Administrador
            </p>
          </div>
          {/* Botón para cerrar sesión */}
          <button
            onClick={() => { logout(); router.push('/') }}
            className="bg-indigo-900/50 hover:bg-indigo-900 px-4 py-2 rounded-lg text-sm transition"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Sistema de pestañas (tabs) */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {/* Pestaña: Exhibidores (Fase 10C) */}
          <button
            onClick={() => setActiveTab('exhibidores')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'exhibidores'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📍 Exhibidores
          </button>
          {/* Pestaña: Gestionar Horarios */}
          <button
            onClick={() => setActiveTab('horarios')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'horarios'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📅 Gestionar Horarios
          </button>
          {/* Pestaña: Gestionar Usuarios */}
          <button
            onClick={() => setActiveTab('usuarios')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'usuarios'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            👥 Gestionar Usuarios
          </button>
          {/* Pestaña: Configuración (Fase 4) */}
          <button
            onClick={() => setActiveTab('config')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'config'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            ⚙️ Configuración
          </button>
          {/* Pestaña: Reporte semanal (Fase 8) */}
          <button
            onClick={() => setActiveTab('reporte')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'reporte'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📋 Reporte
          </button>
          {/* Pestaña: Ausentes (Fase 9B) */}
          <button
            onClick={() => setActiveTab('ausentes')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'ausentes'
                ? 'bg-white text-red-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            🚫 Ausentes
          </button>
          {/* Pestaña: Reset de demo — solo para administradores */}
          <button
            onClick={() => setActiveTab('reset')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'reset'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-red-400 hover:text-red-600'
            }`}
          >
            🗑️ Reset Demo
          </button>
        </div>
      </div>

      {/* Contenido según pestaña activa */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Pestaña de exhibidores: CRUD de puntos de exhibición (Fase 10C) */}
        {activeTab === 'exhibidores' && <AdminExhibitorManager />}
        {/* Pestaña de horarios: muestra la grilla de administración */}
        {activeTab === 'horarios' && <AdminScheduleGrid />}
        {/* Pestaña de usuarios: componente CRUD completo (Fase 2) */}
        {activeTab === 'usuarios' && <AdminUserManager />}
        {/* Pestaña de configuración: modo de conteo y límites (Fase 4) */}
        {activeTab === 'config' && <AdminConfigPanel />}
        {/* Pestaña de reporte semanal (Fase 8) */}
        {activeTab === 'reporte' && <AdminWeekReport />}
        {/* Pestaña de ausencias (Fase 9B) */}
        {activeTab === 'ausentes' && <AdminAbsencePanel />}
        {/* Pestaña de reset para demostración */}
        {activeTab === 'reset' && <AdminResetPanel />}
      </main>
    </div>
  )
}
