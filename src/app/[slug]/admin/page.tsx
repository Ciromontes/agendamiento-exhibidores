/**
 * app/[slug]/admin/page.tsx — Panel Admin V4 Multi-Tenant
 * ─────────────────────────────────────────────────────────────
 * Página exclusiva para administradores.
 * URL: /{slug}/admin
 *
 * Reemplaza: app/admin/page.tsx
 * El slug se usa para construir rutas de regreso al login.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { use } from 'react'
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
import AdminExcelPanel from '@/components/AdminExcelPanel'

type Props = {
  params: Promise<{ slug: string }>
}

export default function AdminPage({ params }: Props) {
  const { slug } = use(params)

  const { user, congregationSlug, isLoading, logout } = useUser()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<
    'horarios' | 'usuarios' | 'config' | 'reporte' | 'ausentes' | 'exhibidores' | 'excel' | 'reset'
  >('horarios')

  // Protección de ruta: solo admins
  useEffect(() => {
    if (isLoading) return

    // Redirigir si no hay usuario, no es admin, o intenta acceder a admin de otra congregación
    if (!user || !user.is_admin || (slug && congregationSlug && slug !== congregationSlug)) {
      if (slug && congregationSlug && slug !== congregationSlug) {
        logout() // Limpiar sesión si intenta cruzar congregaciones
      }
      router.push(`/${slug}`)
    }
  }, [user, congregationSlug, isLoading, router, slug])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-indigo-800 to-purple-800 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span>⚙️</span> Panel de Administración
            </h1>
            <p className="text-indigo-200 text-sm mt-0.5">
              {user.name} · Administrador
            </p>
          </div>
          <button
            onClick={() => { logout(); router.push(`/${slug}`) }}
            className="bg-indigo-900/50 hover:bg-indigo-900 px-4 py-2 rounded-lg text-sm transition"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Sistema de pestañas */}
      <div className="max-w-7xl mx-auto px-4 pt-4 overflow-x-auto">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('exhibidores')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'exhibidores'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📍 Exhibidores
          </button>
          <button
            onClick={() => setActiveTab('horarios')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'horarios'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📅 Gestionar Horarios
          </button>
          <button
            onClick={() => setActiveTab('usuarios')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'usuarios'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            👥 Gestionar Usuarios
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'config'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            ⚙️ Configuración
          </button>
          <button
            onClick={() => setActiveTab('reporte')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'reporte'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📋 Reporte
          </button>
          <button
            onClick={() => setActiveTab('ausentes')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'ausentes'
                ? 'bg-white text-red-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            🚫 Ausentes
          </button>
          <button
            onClick={() => setActiveTab('excel')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'excel'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📊 Excel
          </button>
          <button
            onClick={() => setActiveTab('reset')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'reset'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-red-400 hover:text-red-600'
            }`}
          >
            🗑️ Reset Demo
          </button>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'exhibidores' && <AdminExhibitorManager />}
        {activeTab === 'horarios'   && <AdminScheduleGrid />}
        {activeTab === 'usuarios'   && <AdminUserManager />}
        {activeTab === 'config'     && <AdminConfigPanel />}
        {activeTab === 'reporte'    && <AdminWeekReport />}
        {activeTab === 'ausentes'   && <AdminAbsencePanel />}
        {activeTab === 'excel'      && <AdminExcelPanel />}
        {activeTab === 'reset'      && <AdminResetPanel />}
      </main>
    </div>
  )
}
