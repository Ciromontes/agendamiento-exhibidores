/**
 * types/index.ts — V4 (Multi-Tenant)
 * ─────────────────────────────────────────────────────────────
 * Definiciones de tipos TypeScript para toda la aplicación.
 * Estos tipos coinciden con las tablas de Supabase después de
 * ejecutar los scripts 01-27.
 *
 * V2: 3 tipos de usuario, 2 personas por turno, domingos,
 *     configuración global (app_config).
 * V3: Fase 3 (parejas) + Fase 4 (límites semanal/mensual).
 * V4: Multi-tenant (script 26-27): congregation_id en todas las
 *     tablas + tipo Congregation + is_super_admin en User.
 * ─────────────────────────────────────────────────────────────
 */

// ─── Tipo: Congregación (V4 Multi-Tenant) ────────────────────
// Una unidad de negocio independiente con sus propios datos.
export type Congregation = {
  id: string          // UUID de la congregación
  name: string        // Nombre legible (ej: 'Congregación Torres del Río')
  slug: string        // Identificador URL (ej: 'torres-rio')
  is_active: boolean  // Si está habilitada
  created_at: string  // Fecha de creación
}

// ─── Tipo: Usuario ───────────────────────────────────────────
// Representa un publicador o administrador del sistema.
// Corresponde a la tabla "users" en Supabase (V2).
export type User = {
  id: string                   // UUID generado automáticamente
  name: string                 // Nombre completo del publicador
  access_key: string           // Clave de acceso para login (única)
  user_type: 'publicador' | 'precursor_regular' | 'precursor_auxiliar'
  // publicador          → máx 1 turno/semana
  // precursor_regular   → máx 2 turnos/semana
  // precursor_auxiliar  → máx 6 turnos/mes (Fase 4)
  gender: 'M' | 'F' | null    // Género: Masculino, Femenino, o sin definir
  marital_status: string | null // Estado civil (opcional)
  phone: string | null         // Teléfono WhatsApp con código de país (ej: 573001234567)
  is_active: boolean           // Si puede acceder al sistema
  is_admin: boolean            // Si tiene privilegios de administrador
  is_super_admin: boolean      // V4: Super admin global (todas las congregaciones)
  spouse_id: string | null     // UUID del cónyuge vinculado (Fase 3)
  congregation_id: string      // V4: A qué congregación pertenece
  created_at: string           // Fecha de creación (ISO string)
}

// ─── Tipo: Exhibidor ─────────────────────────────────────────
// Un punto de exhibición (ej: "Torres de San Juan").
export type Exhibitor = {
  id: string                   // UUID del exhibidor
  name: string                 // Nombre del punto de exhibición
  is_active: boolean           // Si está habilitado para reservas
  congregation_id: string      // V4: A qué congregación pertenece
  created_at: string           // Fecha de creación
  deleted_at: string | null    // Soft delete: fecha de eliminación, null si existe
}

// ─── Tipo: Bloque Horario ────────────────────────────────────
// Un bloque de 2 horas para un exhibidor en un día específico.
// day_of_week: 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb
export type TimeSlot = {
  id: string                   // UUID del bloque
  exhibitor_id: string         // A qué exhibidor pertenece
  day_of_week: number          // 0=Dom, 1=Lun, ..., 6=Sáb
  start_time: string           // Hora de inicio (formato 'HH:mm:ss')
  end_time: string             // Hora de fin (formato 'HH:mm:ss')
  is_active: boolean           // Si está disponible para reservar
  block_reason: string | null  // Razón de bloqueo ('Reunión', etc.) o null
  congregation_id: string      // V4: A qué congregación pertenece
  created_at: string           // Fecha de creación
}

// ─── Tipo: Reserva (V2) ─────────────────────────────────────
// Una reserva de un usuario para un bloque horario en una semana.
// Ahora incluye slot_position para soportar 2 personas por turno.
export type Reservation = {
  id: string                   // UUID de la reserva
  time_slot_id: string         // Qué bloque horario se reservó
  user_id: string              // Quién hizo la reserva
  week_start: string           // Lunes de la semana (formato 'YYYY-MM-DD')
  status: 'confirmed' | 'pending' | 'cancelled'  // Estado actual
  slot_position: number        // 1 = primera persona, 2 = segunda persona
  congregation_id: string      // V4: A qué congregación pertenece
  created_at: string           // Cuándo se creó la reserva
  // Joins opcionales (con .select('*, user:users(...)'))
  user?: Pick<User, 'id' | 'name' | 'gender'>    // Datos del usuario
  time_slot?: TimeSlot         // Datos del bloque horario
}

// ─── Tipo: Configuración Global (V3 — Fase 6) ──────────────────
// Una sola fila en la tabla app_config.
// El admin la modifica desde el panel de configuración.
export type AppConfig = {
  id: string
  counting_mode: 'weekly' | 'monthly'      // Modo de conteo de turnos
  precursor_priority_hours: number          // (legacy) horas de ventaja
  booking_opens_day: number                 // Día que abren reservas (0=Dom)
  booking_opens_time: string                // Hora de apertura (formato 'HH:mm:ss')
  global_blocked_slots: GlobalBlock[]       // Bloqueos globales (3 exhibidores)
  service_year_start_month: number          // Mes inicio año de servicio (9=Sep)
  max_per_slot: number                      // Máx personas por turno (normalmente 2)
  // ── Fase 6: Sistema de prioridad de agendamiento ────────────────
  priority_enabled: boolean                 // Activa/desactiva el sistema
  priority_mode: 'none' | 'precursor_first' | 'tiered'
  // 'none'            → todos reservan a la misma hora
  // 'precursor_first' → Regular+Auxiliar primero, Publicador después
  // 'tiered'          → Regular → Auxiliar (+ N horas) → Publicador (+ M horas)
  priority_hours_auxiliar: number           // Horas de espera del Auxiliar (tiered)
  priority_hours_publicador: number         // Horas de espera del Publicador
  updated_at: string
}

// Estructura de un bloqueo global (aplica a todos los exhibidores)
export type GlobalBlock = {
  day_of_week: number          // 0-6
  start_time: string           // 'HH:mm:ss'
  reason: string               // Motivo del bloqueo (ej: 'Reunión')
}

// ─── Tipo: Invitación (Fase 7b) ─────────────────────────────
// Permite invitar a otro publicador a compartir un turno (pos 2).
// El invitante ocupa la pos 1; el invitado acepta o rechaza.
// Fase 7b: agrega expires_at para control de expiración.
export type Invitation = {
  id: string
  slot_id: string                                        // Bloque horario invitado
  week_start: string                                     // Semana de la invitación (YYYY-MM-DD)
  from_user_id: string                                   // Quién envía la invitación
  to_user_id: string                                     // Quién recibe la invitación
  status: 'pending' | 'accepted' | 'declined'            // Estado actual
  expires_at: string                                     // Cuándo expira (ISO string)
  congregation_id: string                                // V4: A qué congregación pertenece
  created_at: string                                     // Cuándo se creó
  // Joins opcionales
  from_user?: Pick<User, 'id' | 'name'>
  slot?: Pick<TimeSlot, 'id' | 'day_of_week' | 'start_time' | 'end_time'>
}

// ─── Tipo: Solicitud de Relevo (Fase 9A) ────────────────────
// Cuando un usuario quiere cancelar un turno 2/2 (fuera de la
// ventana de 1h), debe pedir que alguien lo releve.
// to_user_id = null → relevo abierto (cualquier hermano compatible)
// to_user_id = UUID → relevo personalizado (hermano específico)
export type ReliefRequest = {
  id: string
  reservation_id: string                               // Reserva a transferir
  slot_id: string                                      // Bloque horario
  week_start: string                                   // Semana (YYYY-MM-DD)
  from_user_id: string                                 // Quien pide el relevo
  to_user_id: string | null                            // null = abierto
  status: 'pending' | 'accepted' | 'cancelled'
  expires_at: string                                   // Cuándo expira
  congregation_id: string                              // V4: A qué congregación pertenece
  created_at: string
  // Joins opcionales
  from_user?: Pick<User, 'id' | 'name' | 'gender'>
  reservation?: Pick<Reservation, 'id' | 'time_slot_id' | 'week_start'>
  slot?: Pick<TimeSlot, 'id' | 'day_of_week' | 'start_time' | 'end_time'>
}

// ─── Tipo: Ausencia (Fase 9B) ───────────────────────────────
// Registra que un usuario no estará disponible una semana.
// Al marcar ausencia el cliente crea relevos abiertos para
// cada reserva activa del usuario en esa semana.
export type Absence = {
  id: string
  user_id: string                              // Quién está ausente
  week_start: string                           // Semana (YYYY-MM-DD)
  reason: string | null                        // Motivo opcional
  congregation_id: string                      // V4: A qué congregación pertenece
  created_at: string
  // Join opcional
  user?: Pick<User, 'id' | 'name' | 'user_type'>
}

// ─── Helper: tiempo restante legible ────────────────────────
// Dado un ISO string de expiración, retorna texto como "1h 30m"
// o null si ya expiró.
export function timeUntilExpiry(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return null
  const totalMinutes = Math.floor(ms / 60_000)
  const hours   = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// ─── Constante: Días de la semana ────────────────────────────
// Mapeo número → nombre en español.
// Incluye domingo (0) para la grilla V2.
export const DAYS_OF_WEEK: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
}

// ─── Constante: Orden de días para la grilla ─────────────────
// Lunes a Sábado + Domingo al final (convención hispana).
// Las grillas iteran en este orden para las columnas.
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

// ─── Constante: Bloques horarios por defecto ─────────────────
// Los 6 bloques de 2 horas del día (06:00 a 18:00).
// Se usa como referencia para crear slots. Las grillas derivan
// sus filas dinámicamente de los time_slots cargados de la BD.
export const DEFAULT_TIME_BLOCKS = [
  { start: '06:00:00', end: '08:00:00', label: '6:00 - 8:00 AM' },
  { start: '08:00:00', end: '10:00:00', label: '8:00 - 10:00 AM' },
  { start: '10:00:00', end: '12:00:00', label: '10:00 - 12:00 PM' },
  { start: '12:00:00', end: '14:00:00', label: '12:00 - 2:00 PM' },
  { start: '14:00:00', end: '16:00:00', label: '2:00 - 4:00 PM' },
  { start: '16:00:00', end: '18:00:00', label: '4:00 - 6:00 PM' },
]

// ─── Constante: Etiquetas legibles de tipo de usuario ────────
// Se muestra en el dashboard y panel de admin.
export const USER_TYPE_LABELS: Record<string, string> = {
  publicador: 'Publicador',
  precursor_regular: 'Precursor Regular',
  precursor_auxiliar: 'Precursor Auxiliar',
}

// ─── Constante: Límites SEMANALES por tipo de usuario ────────
// Usados cuando counting_mode = 'weekly' en app_config.
// Publicador = 1/semana, Precursor Regular = 2/semana.
// Precursor Auxiliar: su modo natural es mensual (6/mes),
// pero en modo semanal se permite ~2/semana como fallback.
export const WEEKLY_LIMITS: Record<string, number> = {
  publicador: 1,
  precursor_regular: 2,
  precursor_auxiliar: 2,
}

// ─── Constante: Límites MENSUALES por tipo de usuario ────────
// Usados cuando counting_mode = 'monthly' en app_config.
// Publicador = 4/mes, Precursor Regular = 8/mes,
// Precursor Auxiliar = 6/mes (su modo natural).
export const MONTHLY_LIMITS: Record<string, number> = {
  publicador: 4,
  precursor_regular: 8,
  precursor_auxiliar: 6,
}

// ─── Helper: Obtener inicio del mes actual ──────────────────
// Retorna la fecha del primer día del mes actual en formato
// 'YYYY-MM-DD'. Se usa para contar reservas en modo mensual.
export function getMonthStart(): string {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  return firstDay.toISOString().split('T')[0]
}

// ─── Helper: Inicio del mes de una semana dada ───────────────
// Retorna 'YYYY-MM-01' para el mes que contiene weekStart.
// Más robusto que getMonthStart() cuando la semana activa
// cruza un cambio de mes (ej.: semana del 30 Mar → Apr 5).
export function getMonthStartFromWeek(weekStart: string): string {
  const d = new Date(weekStart + 'T12:00:00')
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}

// ─── Helper: ¿Es la última semana del mes? ───────────────────
// Retorna true si el próximo lunes (weekStart + 7 días) cae en
// un mes diferente al weekStart. Ejemplo: semana del 30 Mar,
// siguiente lunes = 6 Apr → true (última semana de marzo).
export function isLastWeekOfMonth(weekStart: string): boolean {
  const monday    = new Date(weekStart + 'T12:00:00')
  const nextMon   = new Date(monday)
  nextMon.setDate(monday.getDate() + 7)
  return nextMon.getMonth() !== monday.getMonth()
}

// ─── Helper: Formatear hora para mostrar en la grilla ────────
// Convierte 'HH:mm:ss' a formato legible (ej: '6:00 AM')
export function formatHour(time: string): string {
  const hour = parseInt(time.split(':')[0], 10)
  if (hour === 0) return '12:00 AM'
  if (hour === 12) return '12:00 PM'
  if (hour > 12) return `${hour - 12}:00 PM`
  return `${hour}:00 AM`
}

// ─── Helper: Etiqueta de bloque horario ──────────────────────
// Genera "6:00 AM - 8:00 AM" a partir de start_time y end_time
export function formatTimeLabel(startTime: string, endTime: string): string {
  return `${formatHour(startTime)} - ${formatHour(endTime)}`
}