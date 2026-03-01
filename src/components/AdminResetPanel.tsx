/**
 * components/AdminResetPanel.tsx — Reinicio de demostración
 * ─────────────────────────────────────────────────────────────
 * Panel exclusivo para administradores que permite borrar todos
 * los datos operativos de la aplicación:
 *   🗑️  reservas, invitaciones, relevos, ausencias
 *
 * NO borra la estructura:
 *   ✅  usuarios, exhibidores, bloques horarios, configuración
 *
 * Flujo de seguridad de tres pasos:
 *   1. El admin lee el aviso y marca el checkbox de confirmación.
 *   2. Escribe exactamente "REINICIAR" en el campo de texto.
 *   3. Pulsa el botón rojo y confirma una vez más en el alert.
 *
 * La acción llama a la función RPC `reset_app_data` definida en
 * 19_reset_demo.sql, que verifica la identidad del admin en el
 * servidor antes de borrar nada.
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'

// Palabra exacta que el admin debe escribir para habilitar el botón
const CONFIRMATION_WORD = 'REINICIAR'

type ResetResult = {
  reservations:    number
  invitations:     number
  relief_requests: number
  absences:        number
}

export default function AdminResetPanel() {
  const { user } = useUser()
  const supabase  = createClient()

  // ─── Estado del flujo ────────────────────────────────────
  const [acknowledged, setAcknowledged] = useState(false) // Checkbox
  const [typed,        setTyped]        = useState('')     // Campo de texto
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState<ResetResult | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  // ─── Condiciones para habilitar el botón ─────────────────
  const wordOk   = typed.trim() === CONFIRMATION_WORD
  const canReset = acknowledged && wordOk && !loading

  // ─── Ejecutar el reset ────────────────────────────────────
  const handleReset = async () => {
    if (!user || !canReset) return

    const finalConfirm = window.confirm(
      '⚠️ ÚLTIMA ADVERTENCIA\n\n' +
      'Estás a punto de borrar TODAS las reservas, invitaciones, relevos y ausencias.\n\n' +
      '¿Continuar?'
    )
    if (!finalConfirm) return

    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('reset_app_data', {
      p_admin_id: user.id,
    })

    if (rpcError) {
      setError('Error del servidor: ' + rpcError.message)
      setLoading(false)
      return
    }

    const res = data as { success: boolean; message: string; deleted?: ResetResult }

    if (!res.success) {
      setError(res.message)
      setLoading(false)
      return
    }

    setResult(res.deleted!)
    setAcknowledged(false)
    setTyped('')
    setLoading(false)
  }

  // ─── Pantalla de éxito ────────────────────────────────────
  if (result) {
    const total = result.reservations + result.invitations + result.relief_requests + result.absences
    return (
      <div className="max-w-lg mx-auto mt-8 rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
        <div className="text-5xl mb-3">✅</div>
        <h2 className="text-lg font-bold text-green-800 mb-1">Reset completado</h2>
        <p className="text-sm text-green-700 mb-4">
          La aplicación queda limpia y lista para una nueva demostración.
        </p>

        {/* Resumen de registros borrados */}
        <div className="bg-white border border-green-200 rounded-xl p-4 text-left space-y-1 text-sm mb-4">
          <p className="font-semibold text-gray-700 mb-2">Datos eliminados:</p>
          <div className="flex justify-between text-gray-600">
            <span>📅 Reservas</span>
            <span className="font-mono font-bold">{result.reservations}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>✉️ Invitaciones</span>
            <span className="font-mono font-bold">{result.invitations}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>🔄 Solicitudes de relevo</span>
            <span className="font-mono font-bold">{result.relief_requests}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>🚫 Ausencias</span>
            <span className="font-mono font-bold">{result.absences}</span>
          </div>
          <div className="border-t pt-2 mt-1 flex justify-between font-bold text-gray-800">
            <span>Total</span>
            <span className="font-mono">{total}</span>
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-4">
          Usuarios, exhibidores, horarios y configuración se mantienen intactos.
        </p>

        <button
          onClick={() => setResult(null)}
          className="px-5 py-2 bg-green-600 text-white rounded-xl text-sm hover:bg-green-700 transition"
        >
          Volver al panel
        </button>
      </div>
    )
  }

  // ─── Panel principal ──────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto mt-4 space-y-4">

      {/* ── Encabezado de advertencia ── */}
      <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
        <div className="flex items-start gap-3">
          <span className="text-3xl flex-shrink-0">⚠️</span>
          <div>
            <h2 className="text-base font-bold text-red-800 mb-1">
              Reinicio de datos — Solo para demostración
            </h2>
            <p className="text-sm text-red-700">
              Esta acción borra <strong>permanentemente</strong> todos los datos
              operativos. No se puede deshacer.
            </p>
          </div>
        </div>
      </div>

      {/* ── Qué se borra vs qué se conserva ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-red-200 bg-white p-3">
          <p className="text-xs font-bold text-red-600 uppercase mb-2">🗑️ Se borrará</p>
          <ul className="space-y-1 text-xs text-gray-700">
            <li>📅 Todas las reservas</li>
            <li>✉️ Todas las invitaciones</li>
            <li>🔄 Todos los relevos</li>
            <li>🚫 Todos los registros de ausencia</li>
          </ul>
        </div>
        <div className="rounded-xl border border-green-200 bg-white p-3">
          <p className="text-xs font-bold text-green-600 uppercase mb-2">✅ Se conservará</p>
          <ul className="space-y-1 text-xs text-gray-700">
            <li>👥 Usuarios y contraseñas</li>
            <li>📍 Exhibidores</li>
            <li>🕐 Bloques horarios</li>
            <li>⚙️ Configuración global</li>
          </ul>
        </div>
      </div>

      {/* ── Paso 1: Checkbox de reconocimiento ── */}
      <div className="rounded-xl bg-white border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-500 uppercase mb-3">Paso 1 — Confirmar entendimiento</p>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-red-500 flex-shrink-0"
          />
          <span className="text-sm text-gray-700">
            Entiendo que esta acción es <strong>irreversible</strong> y borrará
            todos los datos de reservas, invitaciones, relevos y ausencias.
          </span>
        </label>
      </div>

      {/* ── Paso 2: Escribir la palabra de confirmación ── */}
      <div className={`rounded-xl bg-white border p-4 transition ${acknowledged ? 'border-gray-200' : 'border-gray-100 opacity-40 pointer-events-none'}`}>
        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Paso 2 — Escribe la palabra de confirmación</p>
        <p className="text-xs text-gray-400 mb-3">
          Escribe exactamente: <span className="font-mono font-bold text-gray-700">{CONFIRMATION_WORD}</span>
        </p>
        <input
          type="text"
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder={CONFIRMATION_WORD}
          autoComplete="off"
          className={`w-full border rounded-lg px-3 py-2 text-sm font-mono transition outline-none ${
            typed && !wordOk
              ? 'border-red-300 bg-red-50 text-red-700'
              : wordOk
              ? 'border-green-300 bg-green-50 text-green-700'
              : 'border-gray-200 text-gray-800'
          }`}
        />
        {typed && !wordOk && (
          <p className="text-xs text-red-500 mt-1">La palabra no coincide exactamente.</p>
        )}
        {wordOk && (
          <p className="text-xs text-green-600 mt-1">✓ Confirmación aceptada.</p>
        )}
      </div>

      {/* ── Error del servidor ── */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ❌ {error}
        </div>
      )}

      {/* ── Botón de ejecución ── */}
      <button
        onClick={handleReset}
        disabled={!canReset}
        className={`w-full py-3 rounded-xl text-sm font-bold transition ${
          canReset
            ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
        }`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block"></span>
            Reiniciando…
          </span>
        ) : (
          '🗑️ Ejecutar reinicio'
        )}
      </button>

      <p className="text-center text-xs text-gray-400">
        Solo los administradores pueden realizar esta acción.
        El servidor verificará tu identidad antes de proceder.
      </p>
    </div>
  )
}
