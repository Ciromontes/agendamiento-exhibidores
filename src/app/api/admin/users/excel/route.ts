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
 *   - Se ignoran filas sin nombre ni clave_acceso
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

  // Cargar IDs existentes de esta congregación para saber si es update
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('congregation_id', admin.congregation_id)

  const existingIds = new Set((existing ?? []).map(u => u.id))

  // Procesar cada fila
  const results = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as string[],
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // +2 porque fila 1 es encabezado, i es 0-indexed

    const rowId       = String(row.id ?? '').trim()
    const name        = String(row.nombre ?? '').trim()
    const accessKey   = String(row.clave_acceso ?? '').trim()
    const rawType     = String(row.tipo ?? 'publicador').toLowerCase().trim()
    const rawGender   = String(row.genero ?? '').toLowerCase().trim()
    const phone       = String(row.telefono ?? '').replace(/\D/g, '') || null
    const isAdmin     = BOOL_REVERSE(row.es_admin as string)
    const isActive    = row.activo !== undefined && row.activo !== '' 
      ? BOOL_REVERSE(row.activo as string) 
      : true // por defecto activo para nuevos

    // Validar campos obligatorios
    if (!name && !accessKey) {
      results.skipped++
      continue
    }

    if (!name) {
      results.errors.push(`Fila ${rowNum}: falta el nombre.`)
      continue
    }

    if (!accessKey) {
      results.errors.push(`Fila ${rowNum}: falta la clave de acceso.`)
      continue
    }

    if (accessKey.length < 6) {
      results.errors.push(`Fila ${rowNum} (${name}): la clave debe tener mínimo 6 caracteres.`)
      continue
    }

    // Resolver tipo de usuario
    const userType = TYPE_REVERSE[rawType] ?? 'publicador'
    if (!['publicador', 'precursor_regular', 'precursor_auxiliar'].includes(userType)) {
      results.errors.push(`Fila ${rowNum} (${name}): tipo de usuario inválido "${rawType}".`)
      continue
    }

    // Resolver género
    const gender = rawGender ? (GENDER_REVERSE[rawGender] ?? null) : null

    // ¿Es update o insert?
    const isUpdate = rowId && existingIds.has(rowId)

    if (isUpdate) {
      // ────── UPDATE ──────
      const { error } = await supabase
        .from('users')
        .update({
          name,
          access_key: accessKey,
          user_type:  userType,
          gender,
          phone,
          is_admin:   isAdmin,
          is_active:  isActive,
        })
        .eq('id', rowId)
        .eq('congregation_id', admin.congregation_id)

      if (error) {
        const msg = error.code === '23505'
          ? `clave de acceso duplicada`
          : error.message
        results.errors.push(`Fila ${rowNum} (${name}): ${msg}`)
      } else {
        results.updated++
      }
    } else {
      // ────── INSERT ──────
      const { error } = await supabase
        .from('users')
        .insert({
          name,
          access_key: accessKey,
          user_type:  userType,
          gender,
          phone,
          is_admin:   isAdmin,
          is_active:  isActive,
          congregation_id: admin.congregation_id,
        })

      if (error) {
        const msg = error.code === '23505'
          ? `clave de acceso duplicada`
          : error.message
        results.errors.push(`Fila ${rowNum} (${name}): ${msg}`)
      } else {
        results.created++
      }
    }
  }

  return NextResponse.json({
    ok: true,
    totalRows: rows.length,
    ...results,
  })
}
