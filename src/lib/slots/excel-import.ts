/**
 * lib/slots/excel-import.ts
 * ────────────────────────────────────────────────────────────
 * Tipos, helpers y lógica compartida de validación para la
 * importación de Excel de reservas (Iteración 2 / 3).
 *
 * Tanto el endpoint POST como el preview usan estas funciones.
 * ────────────────────────────────────────────────────────────
 */
import * as XLSX from 'xlsx'
import { hasTimeConflict, calculateEndTime, shortTime } from './conflict-detection'

// ─── Tipos compartidos ───────────────────────────────────────

export type SlotLookupRow = {
  id: string
  exhibitor_id: string
  day_of_week: number
  start_time: string
  end_time?: string
  is_active: boolean
  block_reason: string | null
}

export type UserLookupRow = {
  id: string
  name: string
}

export type ExhibitorLookupRow = {
  id: string
  name: string
}

export type ImportAssignment = {
  time_slot_id: string
  user_id: string
  week_start: string
  status: 'confirmed'
  slot_position: number
  congregation_id: string
}

export type SlotAction = {
  rowNum: number
  exhibitor_name: string
  day: string
  hour: string
  action: 'CREADO' | 'ACTUALIZADO' | 'EXISTENTE' | 'ERROR' | 'WARNING'
  message?: string
  slot_id?: string
}

export type SlotUpdatePatch = {
  is_active: boolean
  block_reason: string | null
}

export type SlotToCreate = {
  exhibitor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  congregation_id: string
}

export type PreviewResult = {
  errors: string[]
  assignments: ImportAssignment[]
  skipped: number
  slotActions: SlotAction[]
  slotUpdates: Map<string, SlotUpdatePatch>
  slotsToCreate: SlotToCreate[]
  targetWeek: string
  totalRows: number
}

// ─── Helpers ─────────────────────────────────────────────────

export const DAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miercoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sabado',
}

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export function normalizeColumn(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .trim()
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export function parseWeekDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0]
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    const d = new Date(excelEpoch.getTime() + Math.round(value) * 86400000)
    if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().split('T')[0]
}

export function parseDayOfWeek(value: unknown): number | null {
  const day = normalizeText(value).replace('.', '')
  if (!day) return null
  if (/^[0-6]$/.test(day)) return parseInt(day, 10)
  const map: Record<string, number> = {
    domingo: 0, dom: 0,
    lunes: 1, lun: 1,
    martes: 2, mar: 2,
    miercoles: 3, mier: 3, mierc: 3,
    jueves: 4, jue: 4,
    viernes: 5, vie: 5,
    sabado: 6, sab: 6,
  }
  return map[day] ?? null
}

export function parseStartTime(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const firstPart = raw.split(/-|–|—/)[0].trim()
  const ampm = firstPart.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i)
  if (ampm) {
    let hours = parseInt(ampm[1], 10)
    const mins = ampm[2]
    const suffix = ampm[3].toLowerCase()
    if (suffix === 'pm' && hours < 12) hours += 12
    if (suffix === 'am' && hours === 12) hours = 0
    if (hours < 0 || hours > 23) return null
    return `${String(hours).padStart(2, '0')}:${mins}:00`
  }
  const hhmm = firstPart.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!hhmm) return null
  const hours = parseInt(hhmm[1], 10)
  const mins = hhmm[2]
  if (hours < 0 || hours > 23) return null
  return `${String(hours).padStart(2, '0')}:${mins}:00`
}

export function parseAssigneeCell(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const normalized = normalizeText(raw)
  if (['no disponible', 'no-disponible', 'n/a', 'na', 'nd', 'bloqueado'].includes(normalized)) {
    return ''
  }
  return raw
}

export function parseBlockedInstruction(
  blockedRaw: unknown,
  estadoRaw: unknown,
): { value: boolean | null; error?: string } {
  const blocked = normalizeText(blockedRaw)
  if (blocked) {
    if (['si', 'yes', 'true', '1', 'bloqueado', 'no disponible', 'no-disponible', 'inactivo'].includes(blocked)) {
      return { value: true }
    }
    if (['no', 'false', '0', 'libre', 'parcial', 'completo', 'disponible', 'activo'].includes(blocked)) {
      return { value: false }
    }
    return { value: null, error: 'valor inválido. Usa No Disponible/Bloqueado o Disponible/No.' }
  }
  const estado = normalizeText(estadoRaw)
  if (estado === 'bloqueado') return { value: true }
  if (['libre', 'parcial', 'completo'].includes(estado)) return { value: false }
  // Celda vacía → Disponible (no bloqueado)
  return { value: false }
}

// ─── Lectora de Excel ────────────────────────────────────────

export type ParsedExcel = {
  rows: Record<string, unknown>[]
  rawRows: Record<string, unknown>[]
}

export function readExcelFile(arrayBuffer: ArrayBuffer): ParsedExcel {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) {
    throw new Error('El archivo no contiene hojas.')
  }
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]
  if (rawRows.length === 0) {
    throw new Error('El Excel está vacío.')
  }
  const rows = rawRows.map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeColumn(key)] = value
    }
    return normalized
  })
  return { rows, rawRows }
}

// ─── Resolución de referencias ───────────────────────────────

export function resolveExhibitor(
  name: string,
  exhibitorsByName: Map<string, ExhibitorLookupRow[]>,
  addCellError: (rowNum: number, column: string, detail: string) => void,
  rowNum: number,
): ExhibitorLookupRow | null {
  const normalized = normalizeText(name)
  const found = exhibitorsByName.get(normalized) ?? []
  if (found.length === 0) {
    addCellError(rowNum, 'exhibidor', `"${name}" no existe en esta congregación.`)
    return null
  }
  if (found.length > 1) {
    addCellError(rowNum, 'exhibidor', `valor ambiguo "${name}". Usa un nombre único.`)
    return null
  }
  return found[0]
}

export function resolveUser(
  name: string,
  usersByName: Map<string, UserLookupRow[]>,
  addCellError: (rowNum: number, column: string, detail: string) => void,
  rowNum: number,
  label: 'publicador_a' | 'publicador_b',
): UserLookupRow | null {
  const normalized = normalizeText(name)
  const found = usersByName.get(normalized) ?? []
  if (found.length === 0) {
    addCellError(rowNum, label, `"${name}" no existe o está inactivo.`)
    return null
  }
  if (found.length > 1) {
    addCellError(rowNum, label, `valor ambiguo "${name}". Se requieren nombres únicos.`)
    return null
  }
  return found[0]
}
