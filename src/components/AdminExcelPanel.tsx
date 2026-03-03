/**
 * components/AdminExcelPanel.tsx
 * ─────────────────────────────────────────────────────────────
 * Panel para importar y exportar usuarios vía Excel.
 *
 * Funcionalidades:
 *   • Descargar Excel con todos los usuarios de la congregación
 *   • Subir Excel para crear nuevos o actualizar existentes
 *   • Vista previa del resultado de importación (creados,
 *     actualizados, errores)
 *   • Instrucciones claras sobre el formato esperado
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useState, useRef } from 'react'
import { useUser } from '@/context/UserContext'

// ─── Tipo del resultado de importación ───────────────────────
type ImportResult = {
  ok: boolean
  totalRows: number
  created: number
  updated: number
  skipped: number
  errors: string[]
} | null

export default function AdminExcelPanel() {
  const { user } = useUser()

  const [downloading, setDownloading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const accessKey = user?.access_key ?? ''

  // =============================================================
  // Descargar Excel
  // =============================================================
  const handleDownload = async () => {
    setDownloading(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/admin/users/excel', {
        headers: { 'x-access-key': accessKey },
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? `Error ${res.status}`)
        return
      }

      // Descargar el blob como archivo
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'usuarios.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Error de conexión al descargar.')
    } finally {
      setDownloading(false)
    }
  }

  // =============================================================
  // Subir Excel
  // =============================================================
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/users/excel', {
        method: 'POST',
        headers: { 'x-access-key': accessKey },
        body: formData,
      })

      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? `Error ${res.status}`)
      } else {
        setResult(json as ImportResult)
      }
    } catch {
      setError('Error de conexión al subir el archivo.')
    } finally {
      setUploading(false)
      // Limpiar el input para permitir re-subir el mismo archivo
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // =============================================================
  // Render
  // =============================================================
  return (
    <div className="space-y-6">
      {/* ─── Título ─────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-800">
          📊 Importar / Exportar Usuarios (Excel)
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Descarga el listado actual o sube un archivo Excel para crear y actualizar usuarios en lote.
          Solo necesitas: <strong>nombre</strong>, <strong>tipo</strong>, <strong>género</strong> y <strong>es_admin</strong>.
          La clave de acceso se genera automáticamente.
        </p>
      </div>

      {/* ─── Acciones principales ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Descargar */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-2">⬇️ Descargar Excel</h3>
          <p className="text-sm text-gray-500 mb-4">
            Exporta todos los usuarios de tu congregación con sus datos actuales.
          </p>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium
                       hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-wait
                       transition-colors"
          >
            {downloading ? 'Descargando...' : 'Descargar usuarios.xlsx'}
          </button>
        </div>

        {/* Subir */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-2">⬆️ Subir Excel</h3>
          <p className="text-sm text-gray-500 mb-4">
            Sube un archivo para crear usuarios nuevos o actualizar existentes.
          </p>
          <label
            className={`block w-full text-center px-4 py-2.5 rounded-lg font-medium
                        transition-colors cursor-pointer
                        ${uploading
                          ? 'bg-gray-300 text-gray-500 cursor-wait'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
          >
            {uploading ? 'Procesando...' : 'Seleccionar archivo .xlsx'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* ─── Error global ──────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          ❌ {error}
        </div>
      )}

      {/* ─── Resultado de importación ─────────────────────── */}
      {result && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="font-semibold text-gray-700">📋 Resultado de la importación</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-gray-700">{result.totalRows}</div>
              <div className="text-xs text-gray-500">Filas leídas</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-700">{result.created}</div>
              <div className="text-xs text-green-600">Creados</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-700">{result.updated}</div>
              <div className="text-xs text-blue-600">Actualizados</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-yellow-700">{result.skipped}</div>
              <div className="text-xs text-yellow-600">Omitidos</div>
            </div>
          </div>

          {/* Errores por fila */}
          {result.errors.length > 0 && (
            <div className="mt-3">
              <h4 className="text-sm font-medium text-red-700 mb-1">
                ⚠️ Errores ({result.errors.length}):
              </h4>
              <ul className="bg-red-50 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto text-sm text-red-700">
                {result.errors.map((err, i) => (
                  <li key={i}>• {err}</li>
                ))}
              </ul>
            </div>
          )}

          {result.errors.length === 0 && (
            <p className="text-sm text-green-600 font-medium">
              ✅ Todas las filas se procesaron correctamente.
            </p>
          )}
        </div>
      )}

      {/* ─── Instrucciones ─────────────────────────────────── */}
      <details className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <summary className="cursor-pointer font-semibold text-gray-700 select-none">
          📖 Instrucciones y formato del Excel
        </summary>

        <div className="mt-4 space-y-4 text-sm text-gray-600">
          <div>
            <h4 className="font-medium text-gray-700 mb-1">Columnas del Excel:</h4>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="py-1 pr-3 font-medium">Columna</th>
                  <th className="py-1 pr-3 font-medium">Obligatoria</th>
                  <th className="py-1 font-medium">Descripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">id</td>
                  <td className="py-1 pr-3">No</td>
                  <td className="py-1">UUID del usuario. Si existe → actualizar. Si vacío → crear nuevo. <strong>No lo llenes para usuarios nuevos.</strong></td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">nombre</td>
                  <td className="py-1 pr-3 text-red-600">Sí</td>
                  <td className="py-1">Nombre completo del publicador.</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">clave_acceso</td>
                  <td className="py-1 pr-3">No</td>
                  <td className="py-1">Se genera automáticamente si no se proporciona. Mín. 6 caracteres si se llena.</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">tipo</td>
                  <td className="py-1 pr-3 text-red-600">Sí</td>
                  <td className="py-1">Publicador, Precursor Regular o Precursor Auxiliar</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">genero</td>
                  <td className="py-1 pr-3 text-red-600">Sí</td>
                  <td className="py-1">Masculino o Femenino</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">telefono</td>
                  <td className="py-1 pr-3">No</td>
                  <td className="py-1">Número con código de país (ej: 573001234567)</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">es_admin</td>
                  <td className="py-1 pr-3 text-red-600">Sí</td>
                  <td className="py-1">Sí o No</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-mono text-xs">activo</td>
                  <td className="py-1 pr-3">No</td>
                  <td className="py-1">Sí o No (por defecto: Sí)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="font-medium text-gray-700 mb-1">Flujo recomendado:</h4>
            <ol className="list-decimal list-inside space-y-1">
              <li>Prepara un Excel con las columnas: <strong>nombre</strong>, <strong>tipo</strong>, <strong>genero</strong>, <strong>es_admin</strong> (mínimo).</li>
              <li>No te preocupes por el <strong>id</strong> ni la <strong>clave_acceso</strong> — se generan automáticamente.</li>
              <li>Sube el archivo y revisa el resultado.</li>
              <li>Después puedes descargar el Excel para ver las claves generadas y compartirlas.</li>
            </ol>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <strong>⚠️ Importante:</strong> Las filas con <strong>id</strong> existente se actualizarán
            con los datos del Excel. Para usuarios nuevos, solo llena nombre, tipo, género y es_admin.
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <strong>💡 Tip:</strong> Después de subir usuarios nuevos, descarga el Excel
            para obtener las <strong>claves de acceso</strong> generadas y compartirlas con los publicadores.
          </div>
        </div>
      </details>
    </div>
  )
}
