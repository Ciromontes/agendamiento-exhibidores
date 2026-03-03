/**
 * app/api/admin/users/excel/route.ts
 * ─────────────────────────────────────────────────────────────
 * GET  /api/admin/users/excel  → Descargar Excel con todos los usuarios
 * POST /api/admin/users/excel  → Subir Excel para crear/actualizar usuarios
 *
 * Requiere header: x-access-key: <admin_access_key>
 *
 * El Excel usa columnas en español que el admin entiende:
 *   id | nombre | clave_acceso | tipo | genero | telefono | es_admin | activo
 *
 * Al importar:
 *   - Si la fila tiene "id" válido → UPDATE
 *   - Si "id" está vacío          → INSERT (usuario nuevo)
 *   - Campos obligatorios: nombre, tipo, genero, es_admin
 *   - clave_acceso se auto-genera si no se proporciona
 *   - Se ignoran filas completamente vacías
 * ─────────────────────────────────────────────────────────────
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyAdmin } from '@/lib/supabase/admin-auth'
import * as XLSX from 'xlsx'

// ─── Valores legibles para el Excel ──────────────────────────
const TYPE_DISPLAY: Record<string, string> = {
  publicador:        'Publicador',
  precursor_regular: 'Precursor Regular',
  precursor_auxiliar: 'Precursor Auxiliar',
}

const TYPE_REVERSE: Record<string, string> = {
  publicador:           'publicador',
  'precursor regular':  'precursor_regular',
  'precursor auxiliar': 'precursor_auxiliar',
  // también aceptar las claves directas
  precursor_regular:    'precursor_regular',
  precursor_auxiliar:   'precursor_auxiliar',
}

const GENDER_DISPLAY: Record<string, string> = {
  M: 'Masculino',
  F: 'Femenino',
}

const GENDER_REVERSE: Record<string, string> = {
  masculino: 'M',
  femenino:  'F',
  m:         'M',
  f:         'F',
}

const BOOL_DISPLAY = (v: boolean) => (v ? 'Sí' : 'No')

const BOOL_REVERSE = (v: string | boolean | number | null | undefined): boolean => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1
  if (!v) return false
  const s = String(v).toLowerCase().trim()
  return ['sí', 'si', 'yes', 'true', '1'].includes(s)
}

/**
 * Genera una clave de acceso única y legible.
 * Formato: XXXX-NNNN (4 letras + 4 dígitos) = 8 chars → cumple mín 6.
 */
function generateAccessKey(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // sin I, O para evitar confusión
  const digits  = '0123456789'
  let key = ''
  for (let i = 0; i < 4; i++) key += letters[Math.floor(Math.random() * letters.length)]
  key += '-'
  for (let i = 0; i < 4; i++) key += digits[Math.floor(Math.random() * digits.length)]
  return key
}

// =============================================================
// GET — Descargar Excel
// =============================================================
export async function GET(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, access_key, user_type, gender, phone, is_admin, is_active')
    .eq('congregation_id', admin.congregation_id)
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Construir filas con nombres legibles
  const rows = (users ?? []).map(u => ({
    id:            u.id,
    nombre:        u.name,
    clave_acceso:  u.access_key,
    tipo:          TYPE_DISPLAY[u.user_type] ?? u.user_type,
    genero:        u.gender ? GENDER_DISPLAY[u.gender] ?? u.gender : '',
    telefono:      u.phone ?? '',
    es_admin:      BOOL_DISPLAY(u.is_admin),
    activo:        BOOL_DISPLAY(u.is_active),
  }))

  // Crear libro Excel
  const ws = XLSX.utils.json_to_sheet(rows)

  // Anchos de columna razonables
  ws['!cols'] = [
    { wch: 38 }, // id (UUID)
    { wch: 30 }, // nombre
    { wch: 20 }, // clave_acceso
    { wch: 20 }, // tipo
    { wch: 12 }, // genero
    { wch: 16 }, // telefono
    { wch: 10 }, // es_admin
    { wch: 10 }, // activo
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Usuarios')

  // Generar buffer
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="usuarios.xlsx"',
    },
  })
}

// =============================================================
// POST — Subir Excel (crear / actualizar usuarios)
// =============================================================
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  // Leer el archivo del body (FormData)
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Se esperaba un FormData con un archivo Excel.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No se encontró el archivo. Envía un campo "file".' }, { status: 400 })
  }

  // Leer contenido del archivo
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) {
    return NextResponse.json({ error: 'El archivo no contiene hojas.' }, { status: 400 })
  }

  // Convertir a JSON (columnas en minúsculas para tolerancia)
  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'El Excel está vacío.' }, { status: 400 })
  }

  // Normalizar claves de columna (tolerar mayúsculas, espacios, tildes)
  const normalize = (s: string) =>
    s.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_')
      .trim()

  const rows = rawRows.map(row => {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(row)) {
      out[normalize(key)] = val
    }
    return out
  })

  const supabase = createServiceClient()

  // Cargar IDs y claves existentes de esta congregación
  const { data: existing } = await supabase
    .from('users')
    .select('id, access_key')
    .eq('congregation_id', admin.congregation_id)

  const existingIds = new Set((existing ?? []).map(u => u.id))
  const existingKeys = new Set((existing ?? []).map(u => u.access_key))

  // También cargar todas las claves globales para evitar colisiones
  const { data: allKeys } = await supabase
    .from('users')
    .select('access_key')

  const globalKeys = new Set((allKeys ?? []).map(u => u.access_key))

  /** Genera una clave que no colisione con existentes ni con las generadas en este lote */
  const usedKeysThisBatch = new Set<string>()
  const getUniqueKey = (): string => {
    let key: string
    let attempts = 0
    do {
      key = generateAccessKey()
      attempts++
    } while ((globalKeys.has(key) || existingKeys.has(key) || usedKeysThisBatch.has(key)) && attempts < 100)
    usedKeysThisBatch.add(key)
    return key
  }

  // ═══════════════════════════════════════════════════════════
  // FASE 1: Validar TODAS las filas antes de tocar la BD
  // ═══════════════════════════════════════════════════════════
  type ValidatedRow = {
    action: 'insert' | 'update'
    rowNum: number
    name: string
    accessKey: string        // '' = no cambiar (solo updates)
    userType: string
    gender: string
    phone: string | null
    isAdmin: boolean
    isActive: boolean
    rowId?: string           // solo para updates
  }

  const validated: ValidatedRow[] = []
  const errors: string[] = []
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // +2 porque fila 1 es encabezado, i es 0-indexed

    const rowId       = String(row.id ?? '').trim()
    const name        = String(row.nombre ?? '').trim()
    const rawKey      = String(row.clave_acceso ?? '').trim()
    const rawType     = String(row.tipo ?? '').toLowerCase().trim()
    const rawGender   = String(row.genero ?? '').toLowerCase().trim()
    const phone       = String(row.telefono ?? '').replace(/\D/g, '') || null
    const rawAdmin    = row.es_admin
    const isActive    = row.activo !== undefined && row.activo !== '' 
      ? BOOL_REVERSE(row.activo as string) 
      : true // por defecto activo para nuevos

    // Fila completamente vacía → omitir silenciosamente
    if (!name && !rawKey && !rawType && !rawGender) {
      skipped++
      continue
    }

    // ── Validar campos obligatorios ──────────────────────────
    const missingFields: string[] = []
    if (!name)      missingFields.push('nombre')
    if (!rawType)   missingFields.push('tipo')
    if (!rawGender) missingFields.push('genero')
    if (rawAdmin === undefined || rawAdmin === null || rawAdmin === '') missingFields.push('es_admin')

    if (missingFields.length > 0) {
      errors.push(`Fila ${rowNum}${name ? ` (${name})` : ''}: faltan campos obligatorios: ${missingFields.join(', ')}.`)
      continue
    }

    // Resolver tipo de usuario
    const userType = TYPE_REVERSE[rawType] ?? null
    if (!userType || !['publicador', 'precursor_regular', 'precursor_auxiliar'].includes(userType)) {
      errors.push(`Fila ${rowNum} (${name}): tipo de usuario inválido "${rawType}". Usa: Publicador, Precursor Regular o Precursor Auxiliar.`)
      continue
    }

    // Resolver género (obligatorio)
    const gender = GENDER_REVERSE[rawGender] ?? null
    if (!gender) {
      errors.push(`Fila ${rowNum} (${name}): género inválido "${rawGender}". Usa: Masculino o Femenino.`)
      continue
    }

    const isAdmin = BOOL_REVERSE(rawAdmin as string)

    // Clave de acceso: usar la proporcionada o auto-generar
    const isUpdate = rowId && existingIds.has(rowId)
    let accessKey = rawKey
    if (!accessKey && !isUpdate) {
      accessKey = getUniqueKey()
    } else if (!accessKey && isUpdate) {
      accessKey = '' // marcador para omitir en update
    } else if (accessKey && accessKey.length < 6) {
      errors.push(`Fila ${rowNum} (${name}): la clave de acceso debe tener mínimo 6 caracteres.`)
      continue
    }

    validated.push({
      action: isUpdate ? 'update' : 'insert',
      rowNum,
      name,
      accessKey,
      userType,
      gender,
      phone,
      isAdmin,
      isActive,
      ...(isUpdate ? { rowId } : {}),
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Si HAY errores de validación → rechazar TODO el archivo
  // ═══════════════════════════════════════════════════════════
  if (errors.length > 0) {
    return NextResponse.json({
      ok: false,
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped,
      errors,
      rejected: true,
      message: 'El archivo tiene errores. No se guardó ningún cambio. Corrige los errores y vuelve a intentarlo.',
    }, { status: 422 })
  }

  // ═══════════════════════════════════════════════════════════
  // FASE 2: Sin errores → aplicar todos los cambios
  // ═══════════════════════════════════════════════════════════
  const results = { created: 0, updated: 0 }
  const dbErrors: string[] = []

  for (const v of validated) {
    if (v.action === 'update') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatePayload: Record<string, any> = {
        name:       v.name,
        user_type:  v.userType,
        gender:     v.gender,
        phone:      v.phone,
        is_admin:   v.isAdmin,
        is_active:  v.isActive,
      }
      if (v.accessKey) updatePayload.access_key = v.accessKey

      const { error } = await supabase
        .from('users')
        .update(updatePayload)
        .eq('id', v.rowId!)
        .eq('congregation_id', admin.congregation_id)

      if (error) {
        dbErrors.push(`Fila ${v.rowNum} (${v.name}): ${error.code === '23505' ? 'clave de acceso duplicada' : error.message}`)
      } else {
        results.updated++
      }
    } else {
      const { error } = await supabase
        .from('users')
        .insert({
          name:             v.name,
          access_key:       v.accessKey,
          user_type:        v.userType,
          gender:           v.gender,
          phone:            v.phone,
          is_admin:         v.isAdmin,
          is_active:        v.isActive,
          congregation_id:  admin.congregation_id,
        })

      if (error) {
        dbErrors.push(`Fila ${v.rowNum} (${v.name}): ${error.code === '23505' ? 'clave de acceso duplicada' : error.message}`)
      } else {
        results.created++
      }
    }
  }

  return NextResponse.json({
    ok: dbErrors.length === 0,
    totalRows: rows.length,
    ...results,
    skipped,
    errors: dbErrors,
  })
}
