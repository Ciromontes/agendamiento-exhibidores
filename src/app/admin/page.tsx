/**
 * app/admin/page.tsx — REDIRIGIDO
 * Esta ruta ya no se usa. Redirige a la ruta con slug.
 */
'use client'

import { useUser } from '@/context/UserContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function AdminRedirectPage() {
  const { user, congregationSlug, isLoading } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (!user || !congregationSlug) {
      router.replace('/')
    } else {
      router.replace(`/${congregationSlug}/admin`)
    }
  }, [user, congregationSlug, isLoading, router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-500">Redirigiendo...</p>
    </div>
  )
}
