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
  rejected?: boolean
  message?: string
} | null

export default function AdminExcelPanel() {
  const { user } = useUser()

  const [downloading, setDownloading] = useState(false)
  const [downloadingReservations, setDownloadingReservations] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadingReservations, setUploadingReservations] = useState(false)
  const [result, setResult] = useState<ImportResult>(null)
  const [resultTitle, setResultTitle] = useState('📋 Resultado de la importación')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reservationsFileInputRef = useRef<HTMLInputElement>(null)

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
  // Descargar Excel de reservas actuales
  // =============================================================
  const handleDownloadReservations = async () => {
    setDownloadingReservations(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/admin/reservations/excel', {
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
      a.download = 'reservas-actuales.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Error de conexión al descargar reservas actuales.')
    } finally {
      setDownloadingReservations(false)
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

      if (!res.ok && res.status !== 422) {
        setError(json.error ?? `Error ${res.status}`)
      } else {
        setResultTitle('📋 Resultado de la importación de usuarios')
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
  // Subir Excel de reservas (se aplica a la semana indicada en el archivo)
  // =============================================================
  const handleUploadReservations = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingReservations(true)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/reservations/excel', {
        method: 'POST',
        headers: { 'x-access-key': accessKey },
        body: formData,
      })

      const json = await res.json()

      if (!res.ok && res.status !== 422) {
        setError(json.error ?? `Error ${res.status}`)
      } else {
        setResultTitle('📋 Resultado de la importación de reservas')
        setResult(json as ImportResult)
      }
    } catch {
      setError('Error de conexión al subir reservas.')
    } finally {
      setUploadingReservations(false)
      if (reservationsFileInputRef.current) reservationsFileInputRef.current.value = ''
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
          📊 Importar / Exportar (Excel)
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Descarga usuarios o reservas actuales, y sube Excel para usuarios o para aplicar reservas en la semana indicada en el archivo.
        </p>
      </div>

      {/* ─── Acciones principales ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Descargar usuarios */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-2">⬇️ Descargar usuarios</h3>
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

        {/* Subir reservas (semana del archivo) */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-2">⬆️ Subir reservas (semana del archivo)</h3>
          <p className="text-sm text-gray-500 mb-4">
            Sube el Excel modificado para aplicar usuarios/acompañantes a la semana indicada en la columna <strong>semana</strong>.
          </p>
          <label
            className={`block w-full text-center px-4 py-2.5 rounded-lg font-medium
                        transition-colors cursor-pointer
                        ${uploadingReservations
                          ? 'bg-gray-300 text-gray-500 cursor-wait'
                          : 'bg-cyan-600 text-white hover:bg-cyan-700'
                        }`}
          >
            {uploadingReservations ? 'Procesando...' : 'Subir reservas .xlsx'}
            <input
              ref={reservationsFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleUploadReservations}
              disabled={uploadingReservations}
              className="hidden"
            />
          </label>
        </div>

        {/* Descargar reservas actuales */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-2">📅 Descargar reservas actuales</h3>
          <p className="text-sm text-gray-500 mb-4">
            Exporta la semana activa con la configuración actual (usuario y acompañante por turno).
          </p>
          <button
            onClick={handleDownloadReservations}
            disabled={downloadingReservations}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-wait
                       transition-colors"
          >
            {downloadingReservations ? 'Descargando...' : 'Descargar reservas.xlsx'}
          </button>
        </div>

        {/* Subir usuarios */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-2">⬆️ Subir usuarios</h3>
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
          <h3 className="font-semibold text-gray-700">{resultTitle}</h3>

          {/* Banner de rechazo total */}
          {result.rejected && (
            <div className="bg-red-100 border border-red-300 rounded-lg p-4 text-red-800 text-sm font-medium">
              🚫 {result.message ?? 'El archivo fue rechazado. No se guardó ningún cambio.'}
              {result.errors.length > 0 && (
                <p className="mt-2 text-xs font-normal">
                  Primer error detectado: <strong>{result.errors[0]}</strong>
                </p>
              )}
            </div>
          )}

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

          <div className="border-t border-gray-200 pt-4">
            <h4 className="font-medium text-gray-700 mb-1">Flujo recomendado (reservas):</h4>
            <ol className="list-decimal list-inside space-y-1">
              <li>Descarga <strong>reservas actuales</strong>.</li>
              <li>Edita: <strong>usuario</strong>, <strong>acompanante</strong> y opcionalmente <strong>bloqueado</strong>.</li>
              <li>Deja usuario y acompañante vacíos para un turno libre.</li>
              <li>No necesitas escribir estados como Libre/Parcial/Completo; el sistema lo deduce automáticamente.</li>
              <li>Para bloquear usa <strong>No disponible</strong> (o Bloqueado). Para desbloquear usa <strong>Disponible</strong> (o No).</li>
              <li>En turnos bloqueados verás <strong>No disponible</strong> en usuario/acompañante.</li>
              <li>Sube el archivo con <strong>Subir reservas (semana del archivo)</strong>.</li>
              <li>El sistema validará nombres/horarios y aplicará el resultado a la semana indicada en la columna <strong>semana</strong>.</li>
            </ol>
            <p className="text-xs text-gray-500 mt-2">
              Los errores se reportan con formato: <strong>Fila X, columna Y</strong> para corregir rápido.
            </p>
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
