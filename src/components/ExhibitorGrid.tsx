/**
 * components/ExhibitorGrid.tsx — V3 - Grilla de Horarios para Usuarios
 * ─────────────────────────────────────────────────────────────
 * Componente principal de la grilla semanal de horarios.
 * Permite a los usuarios normales:
 *   - Ver horarios disponibles de cada exhibidor
 *   - Reservar turnos (2 personas por celda, slot_position 1 y 2)
 *   - Completar turnos a medio llenar ("Completar turno")
 *   - Cancelar sus propias reservas
 *
 * V3 (Fase 3): Sistema de parejas.
 *   - Si el usuario tiene cónyuge, al reservar un turno vacío (0/2)
 *     se reserva automáticamente para ambos (pos 1 + pos 2).
 *   - Al cancelar, si el otro ocupante es el cónyuge, se cancelan ambos.
 *   - Se muestra indicador 💑 en turnos reservados en pareja.
 *
 * Código de colores:
 *   • Verde  = tu reserva propia
 *   • Rosa   = reserva de tu cónyuge (pareja)
 *   • Naranja = ocupado por otra persona
 *   • Azul   = turno completo (2/2) ✓
 *   • Gris   = bloque bloqueado (ej: Reunión)
 *
 * Límites semanales (Fase 1):
 *   • Publicador       = 1 turno/semana
 *   • Precursor Regular = 2 turnos/semana
 *   • Precursor Auxiliar = 2 turnos/semana (será 6/mes en Fase 4)
 * ─────────────────────────────────────────────────────────────
 */
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/context/UserContext'
import {
  Exhibitor, TimeSlot, Reservation, User,
  DAYS_OF_WEEK, DAY_ORDER, WEEKLY_LIMITS, MONTHLY_LIMITS,
  USER_TYPE_LABELS, formatTimeLabel, getMonthStart,
} from '@/types'

// Sin props externas en esta fase

/**
 * getWeekStart - Calcula la fecha del lunes de la semana actual.
 * Se usa como identificador de semana para filtrar reservaciones.
 * Retorna formato ISO 'YYYY-MM-DD'.
 */
function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()                                    // 0=Dom, 1=Lun, ..., 6=Sáb
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)    // Retroceder al lunes
  const monday = new Date(now.getFullYear(), now.getMonth(), diff)
  return monday.toISOString().split('T')[0]                   // Solo la fecha
}

/**
 * isWithinCancelWindow - Retorna true si la reserva se creó dentro de la ventana
 * de cancelación configurada por el admin (en milisegundos).
 */
function isWithinCancelWindow(createdAt: string, windowMs: number): boolean {
  return Date.now() - new Date(createdAt).getTime() < windowMs
}

/**
 * getSlotDatetime - Combina weekStart + day_of_week + start_time en un Date.
 * Usado para calcular cuánto falta para el inicio del turno.
 */
function getSlotDatetime(weekStart: string, dayOfWeek: number, startTime: string): Date {
  const monday = new Date(weekStart + 'T00:00:00')
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1          // 0=Dom → 6 días desde lunes
  const d = new Date(monday)
  d.setDate(d.getDate() + offset)
  const [h, m] = startTime.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

export default function ExhibitorGrid() {
  // --- Estado del componente ---
  const [exhibitors, setExhibitors] = useState<Exhibitor[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [selectedExhibitor, setSelectedExhibitor] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const { user } = useUser()
  const congregationId = user?.congregation_id ?? ''

  // ─── Estado de configuración global (Fase 4 + 6) ────────────
  // Modo de conteo: 'weekly' (semanal) o 'monthly' (mensual).
  const [countingMode, setCountingMode] = useState<'weekly' | 'monthly'>('weekly')
  const [monthlyReservations, setMonthlyReservations] = useState<Reservation[]>([])
  // Ventana de cancelación en ms (configurable por admin, defecto 5 min)
  const [cancelWindowMs, setCancelWindowMs] = useState(5 * 60_000)

  // ─── Estado de prioridad de agendamiento (Fase 6) ──────────
  // Estos valores definen cuándo puede empezar a reservar
  // cada tipo de usuario según lo configurado por el admin.
  const [priorityConfig, setPriorityConfig] = useState({
    enabled: false,
    mode: 'none' as 'none' | 'precursor_first' | 'tiered',
    hoursAuxiliar: 1,
    hoursPublicador: 2,
    bookingOpensDow: 1,       // 1=Lunes (day of week)
    bookingOpensTime: '08:00:00',
  })

  // ─── Estado de cónyuge (Fase 3) ─────────────────────────
  // Datos del cónyuge para auto-reserva y auto-cancelación.
  const [spouse, setSpouse] = useState<Pick<User, 'id' | 'name' | 'user_type'> | null>(null)
  // ─── Estado de invitaciones (Fase 7) ───────────────────
  // sentInvitations: invitaciones que el usuario ya envió esta semana
  // (para mostrar 'Invitación enviada' en lugar de volver a invitar).
  // inviteModalSlot: id del slot cuyo modal de invitación está abierto.
  // inviteUsers: lista de usuarios disponibles para invitar.
  const [sentInvitations, setSentInvitations] = useState<{slot_id: string; to_user_id: string}[]>([])
  // Invitaciones ya aceptadas esta semana (to block direct cancel — Feature 1)
  const [acceptedInvitationSlots, setAcceptedInvitationSlots] = useState<
    { slot_id: string; from_user_id: string; to_user_id: string }[]
  >([])
  const [inviteModalSlot, setInviteModalSlot] = useState<string | null>(null)
  const [inviteUsers, setInviteUsers] = useState<Pick<User, 'id' | 'name' | 'user_type'>[]>([])
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSending, setInviteSending] = useState<string | null>(null)

  // Invitaciones pendientes en slots de esta semana (para mostrar ⏳ en celdas 1/2)
  const [slotPendingInvitations, setSlotPendingInvitations] = useState<
    { slot_id: string; to_user_id: string; expires_at: string }[]
  >([])
  // Mis invitaciones recibidas pendientes (para alertar antes de reservar nuevo turno)
  const [myPendingInvitations, setMyPendingInvitations] = useState<
    { id: string; slot_id: string; expires_at: string;
      from_user?: { name: string };
      slot?: { day_of_week: number; start_time: string; end_time: string } }[]
  >([])
  // ─── Estado de relevos (Fase 9A) ──────────────────────────
  // myPendingReliefs: relevos que YO solicité esta semana (pendientes)
  //   → permite mostrar '⏳ Relevo pendiente' en lugar de 'Cancelar'
  // openReliefBySlot: relevos abiertos de OTROS usuarios en esta semana
  //   → permite mostrar indicador visual en la grilla para compatibles
  // reliefModal: datos del modal de tipo de relevo (open/personal)
  // reliefType/reliefUsers/reliefPersonalId: selección dentro del modal
  const [myPendingReliefs, setMyPendingReliefs] = useState<
    { id: string; reservation_id: string; slot_id: string }[]
  >([])
  // openReliefBySlot: relevos abiertos de OTROS en esta semana (Feature 2: incluye nombre)
  const [openReliefBySlot, setOpenReliefBySlot] = useState<
    Record<string, { id: string; from_user_id: string; name: string }>
  >({})
  // coupleModal: cuando el usuario casado reserva un turno vacío, guardamos
  // el slotId aquí y mostramos el modal para elegir si agrega al cónyuge
  const [coupleModal, setCoupleModal] = useState<string | null>(null)
  const [reliefModal, setReliefModal] = useState<{
    reservationId: string; slotId: string; isUrgent: boolean
  } | null>(null)
  const [reliefType, setReliefType] = useState<'open' | 'personal'>('open')
  const [reliefUsers, setReliefUsers] = useState<Pick<User, 'id' | 'name' | 'user_type'>[]>([])
  const [reliefSending, setReliefSending] = useState(false)
  const [reliefPersonalId, setReliefPersonalId] = useState<string | null>(null)
  const supabase = createClient()
  const [weekStart, setWeekStart] = useState(getWeekStart())
  const monthStart = getMonthStart()

  // ─── Cargar configuración global (Fase 4 + 6) ───────────────
  // Lee counting_mode y campos de prioridad de app_config.
  useEffect(() => {
    const fetchConfig = async () => {
      const { data } = await supabase
        .from('app_config')
        .select('counting_mode, active_week_start, priority_enabled, priority_mode, priority_hours_auxiliar, priority_hours_publicador, booking_opens_day, booking_opens_time, cancel_window_minutes')
        .eq('congregation_id', congregationId)
        .limit(1)
        .single()
      if (data) {
        if (data.active_week_start) setWeekStart(data.active_week_start as string)
        if (data.counting_mode) setCountingMode(data.counting_mode as 'weekly' | 'monthly')
        if (data.cancel_window_minutes) setCancelWindowMs((data.cancel_window_minutes as number) * 60_000)
        setPriorityConfig({
          enabled:          data.priority_enabled   ?? false,
          mode:             (data.priority_mode     ?? 'none') as 'none' | 'precursor_first' | 'tiered',
          hoursAuxiliar:    data.priority_hours_auxiliar   ?? 1,
          hoursPublicador:  data.priority_hours_publicador ?? 2,
          bookingOpensDow:  data.booking_opens_day  ?? 1,
          bookingOpensTime: data.booking_opens_time ?? '08:00:00',
        })
      }
    }
    fetchConfig()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Derivar bloques horarios dinámicamente de los time_slots ───
  // En lugar de usar TIME_BLOCKS hardcoded, extraemos las combinaciones
  // únicas de (start_time, end_time) del exhibidor seleccionado.
  // Así, si un exhibidor tiene bloques impares (7-9, 9-11), aparecen.
  const dynamicBlocks = useMemo(() => {
    const slotsForExhibitor = timeSlots.filter(s => s.exhibitor_id === selectedExhibitor)
    const blockMap = new Map<string, { start: string; end: string; label: string }>()

    slotsForExhibitor.forEach(s => {
      if (!blockMap.has(s.start_time)) {
        blockMap.set(s.start_time, {
          start: s.start_time,
          end: s.end_time,
          label: formatTimeLabel(s.start_time, s.end_time),
        })
      }
    })

    // Ordenar por hora de inicio
    return Array.from(blockMap.values()).sort((a, b) => a.start.localeCompare(b.start))
  }, [timeSlots, selectedExhibitor])

  /**
   * loadData - Carga exhibidores, time_slots, reservaciones e invitaciones.
   * Fase 7b: carga invitaciones pendientes del slot (para ⏳) y propias recibidas.
   */
  const loadData = useCallback(async () => {
    if (!congregationId) return
    const [exhibitorsRes, slotsRes, reservationsRes] = await Promise.all([
      supabase.from('exhibitors').select('*').eq('is_active', true).eq('congregation_id', congregationId).order('name'),
      supabase.from('time_slots').select('*').eq('congregation_id', congregationId),
      supabase
        .from('reservations')
        .select('*, user:users(id, name, gender)')
        .eq('week_start', weekStart)
        .eq('congregation_id', congregationId)
        .neq('status', 'cancelled'),
    ])

    if (exhibitorsRes.data) {
      setExhibitors(exhibitorsRes.data)
      // Forma funcional: solo asigna si todavía no hay un exhibidor seleccionado
      // (evita resetear la selección del usuario al recargar datos tras agendar)
      setSelectedExhibitor(prev => prev || (exhibitorsRes.data![0]?.id ?? ''))
    }
    if (slotsRes.data) setTimeSlots(slotsRes.data)
    if (reservationsRes.data) setReservations(reservationsRes.data as Reservation[])

    const nowIso = new Date().toISOString()

    // Invitaciones pendientes y no expiradas para slots de esta semana
    // (permite mostrar ⏳ en la celda 1/2 cuando hay invitación activa)
    const { data: slotInvData } = await supabase
      .from('invitations')
      .select('slot_id, to_user_id, expires_at')
      .eq('week_start', weekStart)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
    if (slotInvData) setSlotPendingInvitations(
      slotInvData as { slot_id: string; to_user_id: string; expires_at: string }[]
    )

    if (user?.id) {
      // Invitaciones enviadas por mí esta semana (para mostrar '✓ Enviada')
      const { data: invData } = await supabase
        .from('invitations')
        .select('slot_id, to_user_id')
        .eq('from_user_id', user.id)
        .eq('week_start', weekStart)
        .eq('status', 'pending')
      if (invData) setSentInvitations(invData as {slot_id: string; to_user_id: string}[])

      // Mis invitaciones recibidas pendientes y no expiradas (para verificar antes de reservar)
      const { data: myInvData } = await supabase
        .from('invitations')
        .select('id, slot_id, expires_at, from_user:users!invitations_from_user_id_fkey(name), slot:time_slots!invitations_slot_id_fkey(day_of_week, start_time, end_time)')
        .eq('to_user_id', user.id)
        .eq('week_start', weekStart)
        .eq('status', 'pending')
        .gt('expires_at', nowIso)
      if (myInvData) setMyPendingInvitations(myInvData as unknown as typeof myPendingInvitations)

      // Fase 9A: Cargar mis solicitudes de relevo pendientes y no expiradas
      // (para mostrar ⏳ en celdas 2/2 en lugar del botón Cancelar)
      const { data: reliefData } = await supabase
        .from('relief_requests')
        .select('id, reservation_id, slot_id')
        .eq('from_user_id', user.id)
        .eq('week_start', weekStart)
        .eq('status', 'pending')
        .gt('expires_at', nowIso)
      if (reliefData) setMyPendingReliefs(
        reliefData as { id: string; reservation_id: string; slot_id: string }[]
      )

      // Invitaciones aceptadas esta semana (Feature 1: bloquear cancelación directa)
      const { data: accInvData } = await supabase
        .from('invitations')
        .select('slot_id, from_user_id, to_user_id')
        .eq('week_start', weekStart)
        .eq('status', 'accepted')
      if (accInvData) setAcceptedInvitationSlots(
        accInvData as { slot_id: string; from_user_id: string; to_user_id: string }[]
      )

      // Relevos abiertos de otros usuarios esta semana, del mismo género
      // Feature 2: también cargamos id + name del solicitante
      const { data: openRelData } = await supabase
        .from('relief_requests')
        .select('id, slot_id, from_user:users!relief_requests_from_user_id_fkey(id, name, gender)')
        .neq('from_user_id', user.id)
        .eq('week_start', weekStart)
        .eq('status', 'pending')
        .is('to_user_id', null)
        .gt('expires_at', nowIso)
      if (openRelData) {
        const map: Record<string, { id: string; from_user_id: string; name: string }> = {}
        for (const r of openRelData as unknown as { id: string; slot_id: string; from_user: { id: string; name: string; gender: string } | null }[]) {
          if (r.from_user?.gender === user.gender) {
            map[r.slot_id] = { id: r.id, from_user_id: r.from_user.id, name: r.from_user.name }
          }
        }
        setOpenReliefBySlot(map)
      }
    }

    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, user?.id, congregationId])

  // ─── Cargar reservas del mes completo (Fase 4) ────────────
  // Solo se ejecuta cuando countingMode es 'monthly'.
  // Consulta todas las reservas del mes actual para el conteo.
  const loadMonthlyReservations = useCallback(async () => {
    if (countingMode !== 'monthly') {
      setMonthlyReservations([])
      return
    }
    const { data } = await supabase
      .from('reservations')
      .select('id, user_id, status')
      .gte('week_start', monthStart)
      .eq('congregation_id', congregationId)
      .neq('status', 'cancelled')
    if (data) setMonthlyReservations(data as Reservation[])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countingMode, monthStart])

  // Recargar reservas mensuales cuando cambia el modo o al montar
  useEffect(() => {
    loadMonthlyReservations()
  }, [loadMonthlyReservations])

  // Cargar datos del cónyuge si el usuario tiene uno (Fase 3)
  useEffect(() => {
    if (!user?.spouse_id) {
      setSpouse(null)
      return
    }
    const fetchSpouse = async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, user_type')
        .eq('id', user.spouse_id!)
        .single()
      if (data) setSpouse(data as Pick<User, 'id' | 'name' | 'user_type'>)
    }
    fetchSpouse()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.spouse_id])

  // Carga inicial + suscripción Realtime (Feature 3: escuchar reservas, invitaciones y relevos)
  useEffect(() => {
    loadData()

    const reload = () => {
      loadData()
      loadMonthlyReservations()
    }

    const channel = supabase
      .channel('grid-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invitations' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'relief_requests' }, reload)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Helpers de búsqueda ───────────────────────────────────

  // Filtrar slots del exhibidor seleccionado
  const filteredSlots = timeSlots.filter(s => s.exhibitor_id === selectedExhibitor)

  // Buscar slot por día y hora de inicio
  const getSlot = (dayNum: number, startTime: string) =>
    filteredSlots.find(s => s.day_of_week === dayNum && s.start_time === startTime)

  // Obtener las reservaciones activas de un slot (0, 1 o 2)
  const getSlotReservations = (slotId: string) =>
    reservations.filter(r => r.time_slot_id === slotId && r.status !== 'cancelled')

  // ─── Contadores y límites (Fase 4: semanal o mensual) ───────
  // Fuente de reservas para el conteo según el modo:
  //   - weekly:  reservations (ya filtradas por weekStart en loadData)
  //   - monthly: monthlyReservations (todas las del mes)
  const countSource = countingMode === 'monthly' ? monthlyReservations : reservations
  const limitsTable = countingMode === 'monthly' ? MONTHLY_LIMITS : WEEKLY_LIMITS
  const periodLabel = countingMode === 'monthly' ? 'este mes' : 'esta semana'

  const userReservationCount = countSource.filter(
    r => r.user_id === user?.id && r.status !== 'cancelled'
  ).length
  const maxTurnos = limitsTable[user?.user_type ?? 'publicador'] ?? 1
  const canReserve = userReservationCount < maxTurnos
  // Conteo de reservas del cónyuge (Fase 3 + Fase 4)
  const spouseReservationCount = spouse
    ? countSource.filter(r => r.user_id === spouse.id && r.status !== 'cancelled').length
    : 0
  const spouseMaxTurnos = spouse ? (limitsTable[spouse.user_type] ?? 1) : 0
  const spouseCanReserve = spouse ? spouseReservationCount < spouseMaxTurnos : false

  // ─── Fase 6: Helpers de ventana de prioridad ───────────────────

  /**
   * getUserDelayHours - Retorna las horas de retraso para un tipo de usuario
   * según el modo de prioridad configurado.
   *   none            → todos acceden inmediatamente
   *   precursor_first → solo publicadores tienen retraso
   *   tiered           → auxiliares tienen retraso menor, publicadores mayor
   */
  const getUserDelayHours = (userType: string): number => {
    if (!priorityConfig.enabled || priorityConfig.mode === 'none') return 0
    if (priorityConfig.mode === 'precursor_first') {
      return userType === 'publicador' ? priorityConfig.hoursPublicador : 0
    }
    if (priorityConfig.mode === 'tiered') {
      if (userType === 'publicador')       return priorityConfig.hoursPublicador
      if (userType === 'precursor_auxiliar') return priorityConfig.hoursAuxiliar
      return 0 // precursor_regular: acceso inmediato
    }
    return 0
  }

  /**
   * computeBookingWindow - Determina si el usuario actual puede reservar ahora
   * según la ventana de prioridad configurada.
   *
   * Retorna { canBook, opensAt }
   *   canBook  → true si el usuario puede reservar en este momento
   *   opensAt  → fecha/hora en que abrirá su ventana (null si ya está abierta)
   */
  const computeBookingWindow = (): { canBook: boolean; opensAt: Date | null } => {
    if (!priorityConfig.enabled || priorityConfig.mode === 'none') {
      return { canBook: true, opensAt: null }
    }
    const now = new Date()
    const dow = now.getDay() // 0=Dom...6=Sáb
    // Cuántos días han pasado desde el día de apertura configurado
    const diffDays = (dow - priorityConfig.bookingOpensDow + 7) % 7
    const openingDate = new Date(now)
    openingDate.setDate(now.getDate() - diffDays)
    // Aplicar la hora de apertura del día
    const [hh, mm] = priorityConfig.bookingOpensTime.split(':')
    openingDate.setHours(parseInt(hh), parseInt(mm), 0, 0)
    // Si la fecha calculada es futura, retroceder una semana
    if (now < openingDate) {
      openingDate.setDate(openingDate.getDate() - 7)
    }
    // Sumar las horas de retraso del tipo de usuario
    const delayHours = getUserDelayHours(user?.user_type ?? 'publicador')
    const userOpensAt = new Date(openingDate.getTime() + delayHours * 3_600_000)
    return {
      canBook:  now >= userOpensAt,
      opensAt: now < userOpensAt ? userOpensAt : null,
    }
  }

  // Ventana de reserva para el usuario actual (calculada una vez por render).
  const bookingWindow = computeBookingWindow()

  /**
   * isViaAcceptedInvitation (Feature 1) — Retorna true si el slot tiene
   * una invitación aceptada donde el usuario indicado es el invitante o el invitado.
   * Cuando es true, no se permite cancelación directa: se debe pedir relevo.
   */
  const isViaAcceptedInvitation = (slotId: string, userId: string): boolean =>
    acceptedInvitationSlots.some(
      inv => inv.slot_id === slotId &&
             (inv.from_user_id === userId || inv.to_user_id === userId)
    )

  // ─── Fase 7: Compatibilidad de género para compartir turno ─────

  /**
   * isCompatiblePartner - Verifica si el usuario actual puede unirse
   * al mismo turno que ya ocupa otra persona.
   *
   * Reglas:
   *   1. El cónyuge vinculado siempre es compatible (pareja)
   *   2. Si alguno no tiene género definido → permitir (dato incompleto)
   *   3. Hombres solo con hombres, mujeres solo con mujeres
   */
  const isCompatiblePartner = (res: Reservation): boolean => {
    if (spouse && res.user_id === spouse.id) return true          // Cónyuge: siempre OK
    if (!user?.gender || !res.user?.gender) return true           // Sin dato de género: permisivo
    return user.gender === res.user.gender                        // Mismo género
  }

  /**
   * handleOpenInviteModal - Carga candidatos para invitar.
   * Fase 7b: excluye usuarios que ya tienen su límite de turnos lleno.
   */
  const handleOpenInviteModal = async (slotId: string) => {
    setInviteModalSlot(slotId)
    setInviteLoading(true)

    // IDs ya ocupados en este slot (tienen reserva activa → no pueden recibir otra)
    const slotRes = reservations.filter(
      r => r.time_slot_id === slotId && r.status !== 'cancelled'
    )
    const occupiedIds = new Set(slotRes.map(r => r.user_id))
    occupiedIds.add(user!.id)       // No invitarse a uno mismo
    if (spouse) occupiedIds.add(spouse.id) // Cónyuge ya auto-asignado
    // Nota Fase 7b: NO excluimos a quienes ya tienen invitación pendiente.
    // Un usuario puede recibir varias invitaciones y decide cuál acepta.
    // El RPC accept_invitation verifica capacidad del slot y límites al momento de aceptar.

    // Cargar usuarios del mismo género + conteo de reservas activas
    const { data: candidates } = await supabase
      .from('users')
      .select('id, name, user_type')
      .eq('is_active', true)
      .eq('gender', user?.gender ?? 'M')
      .order('name')

    const candidateIds = (candidates ?? [])
      .map(u => u.id)
      .filter(id => !occupiedIds.has(id))

    // Contar reservas activas de esos candidatos en el período actual
    const reservationCounts = new Map<string, number>()
    if (candidateIds.length > 0) {
      const { data: resCounts } = await supabase
        .from('reservations')
        .select('user_id')
        .in('user_id', candidateIds)
        .eq('week_start', weekStart)
        .neq('status', 'cancelled')
      resCounts?.forEach(r => {
        reservationCounts.set(r.user_id, (reservationCounts.get(r.user_id) ?? 0) + 1)
      })
    }

    // Excluir los que ya tienen su límite lleno
    const available = (candidates ?? []).filter(u => {
      if (occupiedIds.has(u.id)) return false
      const count = reservationCounts.get(u.id) ?? 0
      const max   = limitsTable[u.user_type] ?? 1
      return count < max
    })

    setInviteUsers(available as Pick<User, 'id' | 'name' | 'user_type'>[])
    setInviteLoading(false)
  }

  /**
   * handleSendInvitation - Envía una invitación al usuario seleccionado.
   * La invitación expira en 2 horas sin importar el día.
   * Si en ese tiempo nadie acepta, el turno queda libre.
   */
  const handleSendInvitation = async (toUserId: string) => {
    if (!user || !inviteModalSlot) return
    setInviteSending(toUserId)

    // 2 horas fijas — tiempo suficiente para responder sin bloquear el turno
    const expiresAt = new Date(Date.now() + 2 * 3_600_000).toISOString()

    const { error } = await supabase.from('invitations').insert({
      slot_id:          inviteModalSlot,
      week_start:       weekStart,
      from_user_id:     user.id,
      to_user_id:       toUserId,
      status:           'pending',
      expires_at:       expiresAt,
      congregation_id:  user.congregation_id,
    })
    if (error) {
      alert('Error al enviar invitación: ' + error.message)
    } else {
      setSentInvitations(prev => [...prev, { slot_id: inviteModalSlot, to_user_id: toUserId }])
      // Registrar en slotPendingInvitations para que la celda muestre ⏳ inmediatamente
      setSlotPendingInvitations(prev => [
        ...prev,
        { slot_id: inviteModalSlot, to_user_id: toUserId, expires_at: expiresAt }
      ])
    }
    setInviteSending(null)
  }

  /**
   * handleOpenReliefModal - Abre el modal de relevo o, si hay urgencia (<24h),
   * envía de forma directa un relevo abierto sin preguntar el tipo.
   *
   * Fase 9A: Si el turno ocurre en < 24 h → relevo abierto automático.
   * Si faltan ≥ 24 h el usuario puede elegir:
   *   • Abierto  → notifica a todos los del mismo género con cupo
   *   • Personal → elige un compañero específico
   */
  const handleOpenReliefModal = async (reservation: Reservation) => {
    const slot = timeSlots.find(s => s.id === reservation.time_slot_id)
    if (!slot) return
    const slotDatetime = getSlotDatetime(weekStart, slot.day_of_week, slot.start_time)
    const hoursLeft = (slotDatetime.getTime() - Date.now()) / 3_600_000
    const isUrgent = hoursLeft < 24

    if (isUrgent) {
      // Turno inminente: enviar relevo abierto directo sin modal
      await handleSendRelief(reservation.id, reservation.time_slot_id, 'open', null)
      return
    }

    // Cargar usuarios disponibles del mismo género para relevo personal
    const { data } = await supabase
      .from('users')
      .select('id, name, user_type')
      .eq('is_active', true)
      .eq('gender', user?.gender ?? 'M')
      .neq('id', user?.id)
      .order('name')
    setReliefUsers((data ?? []) as Pick<User, 'id' | 'name' | 'user_type'>[])
    setReliefModal({ reservationId: reservation.id, slotId: reservation.time_slot_id, isUrgent: false })
    setReliefType('open')
    setReliefPersonalId(null)
  }

  /**
   * handleSendRelief - Inserta una solicitud de relevo en la BD.
   *
   * type 'open'     → to_user_id = null  (cualquiera del mismo género)
   * type 'personal' → to_user_id = UUID  (usuario específico)
   *
   * expires_at = mínimo entre: inicio del turno y ahora+2h.
   * (si el turno es en 30 min, expira en 30 min; si es mañana, expira en 2h)
   */
  const handleSendRelief = async (
    reservationId: string,
    slotId: string,
    type: 'open' | 'personal',
    toUserId: string | null,
  ) => {
    if (!user) return
    setReliefSending(true)
    const slot = timeSlots.find(s => s.id === slotId)
    const slotDatetime = slot
      ? getSlotDatetime(weekStart, slot.day_of_week, slot.start_time)
      : null
    const expiresAt = slotDatetime
      ? new Date(Math.min(slotDatetime.getTime(), Date.now() + 2 * 3_600_000)).toISOString()
      : new Date(Date.now() + 2 * 3_600_000).toISOString()

    const { error } = await supabase.from('relief_requests').insert({
      reservation_id:  reservationId,
      slot_id:         slotId,
      week_start:      weekStart,
      from_user_id:    user.id,
      to_user_id:      type === 'personal' ? toUserId : null,
      status:          'pending',
      expires_at:      expiresAt,
      congregation_id: user.congregation_id,
    })

    if (error) {
      alert('Error al enviar solicitud de relevo: ' + error.message)
    } else {
      setMyPendingReliefs(prev => [
        ...prev,
        { id: 'temp-' + Date.now(), reservation_id: reservationId, slot_id: slotId },
      ])
      alert(
        type === 'open'
          ? '✅ Solicitud de relevo enviada a todos los usuarios compatibles.'
          : '✅ Solicitud de relevo enviada al hermano seleccionado.'
      )
    }
    setReliefSending(false)
    setReliefModal(null)
  }

  /**
   * handleReserve - Reservar un turno (posición 1 o 2).
   *
   * withSpouse (opcional):
   *   undefined → si el slot está vacío y hay cónyuge disponible, muestra
   *               el modal de elección antes de insertar nada.
   *   true      → reservar usuario + cónyuge (confirmación del modal).
   *   false     → reservar solo el usuario (confirmación del modal).
   */
  const handleReserve = async (slotId: string, withSpouse?: boolean) => {
    if (!user) return
    setActionLoading(slotId)

    // ─ Fase 6: Verificar ventana de prioridad ─────────────────────
    // Si la prioridad está activa y la ventana del usuario aún no abre,
    // informamos la hora exacta de apertura y bloqueamos la acción.
    const { canBook: priorityCanBook, opensAt: priorityOpensAt } = computeBookingWindow()
    if (!priorityCanBook && priorityOpensAt) {
      const NOMBRES_DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
      const nombreDia = NOMBRES_DIAS[priorityOpensAt.getDay()]
      const hora = priorityOpensAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
      alert(`Tu ventana de agendamiento abre el ${nombreDia} a las ${hora}. Por favor, espera tu turno.`)
      setActionLoading(null)
      return
    }

    // ─ Fase 7b: Verificar invitaciones pendientes recibidas ────────────
    // Si el usuario tiene invitaciones pendientes y reservar aquí
    // lo dejaría sin cupo para aceptarlas, se le pregunta si quiere declinarlas.
    const now = new Date()
    const activeInvitations = myPendingInvitations.filter(
      inv => new Date(inv.expires_at) > now
    )
    const currentCount = countSource.filter(
      r => r.user_id === user.id && r.status !== 'cancelled'
    ).length

    if (activeInvitations.length > 0 && currentCount + 1 >= maxTurnos) {
      const inv = activeInvitations[0]
      const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
      const diaInv  = inv.slot ? DIAS[inv.slot.day_of_week] : 'otro día'
      const horaInv = inv.slot
        ? inv.slot.start_time.slice(0, 5)
        : ''
      const confirmar = window.confirm(
        `Tienes una invitación pendiente de ${inv.from_user?.name ?? 'alguien'} para el ${diaInv} a las ${horaInv}.\n\n¿Deseas rechazarla para poder agendar este turno?`
      )
      if (!confirmar) {
        setActionLoading(null)
        return
      }
      // Declinar la invitación y continuar con la reserva
      await supabase.from('invitations').update({ status: 'declined' }).eq('id', inv.id)
      setMyPendingInvitations(prev => prev.filter(i => i.id !== inv.id))
    }

    // Validar límite de turnos del período actual (Fase 4)
    if (currentCount >= maxTurnos) {
      alert(`Ya tienes ${maxTurnos} turno(s) reservado(s) ${periodLabel}.`)
      setActionLoading(null)
      return
    }

    // Verificar ocupación actual del slot
    const slotRes = getSlotReservations(slotId)
    if (slotRes.length >= 2) {
      alert('Este turno ya está completo (2/2).')
      setActionLoading(null)
      return
    }

    const slotIsEmpty = slotRes.length === 0
    const position = slotIsEmpty ? 1 : 2

    // Si el turno está vacío y hay cónyuge vinculado, mostrar elección
    // (aunque el cónyuge esté sin cupo, el modal lo indica claramente)
    if (slotIsEmpty && spouse && withSpouse === undefined) {
      setCoupleModal(slotId)
      setActionLoading(null)
      return
    }

    // Insertar reserva del usuario
    const { error } = await supabase.from('reservations').insert({
      time_slot_id:    slotId,
      user_id:         user.id,
      week_start:      weekStart,
      status:          'confirmed',
      slot_position:   position,
      congregation_id: user.congregation_id,
    })

    if (error) {
      if (error.code === '23505') {
        // Condición de carrera: intentar la otra posición
        const otherPosition = position === 1 ? 2 : 1
        const { error: retryError } = await supabase.from('reservations').insert({
          time_slot_id:    slotId,
          user_id:         user.id,
          week_start:      weekStart,
          status:          'confirmed',
          slot_position:   otherPosition,
          congregation_id: user.congregation_id,
        })
        if (retryError) {
          alert('Este turno acaba de ser completado por otra persona.')
          await loadData()
          setActionLoading(null)
          return
        }
      } else {
        alert('Error al reservar: ' + error.message)
        await loadData()
        setActionLoading(null)
        return
      }
    }

    // ─── Fase 3: Reservar cónyuge si el usuario eligió hacerlo ───
    if (slotIsEmpty && withSpouse === true && spouse) {
      const { error: spouseError } = await supabase.from('reservations').insert({
        time_slot_id:    slotId,
        user_id:         spouse.id,
        week_start:      weekStart,
        status:          'confirmed',
        slot_position:   2,
        congregation_id: user.congregation_id,
      })
      // Si falla la reserva del cónyuge, no es crítico.
      // El usuario ya quedó reservado; el cónyuge puede hacerlo después.
      if (spouseError && spouseError.code !== '23505') {
        console.warn('No se pudo auto-reservar al cónyuge:', spouseError.message)
      }
    }

    await loadData()
    await loadMonthlyReservations()  // Fase 4: recargar conteo mensual
    setActionLoading(null)
  }

  /**
   * handleCancel - Cancelar una reserva propia (soft delete).
   *
   * Fase 3: Si el otro ocupante del mismo turno es el cónyuge,
   * se cancelan ambas reservas automáticamente.
   */
  const handleCancel = async (reservationId: string) => {
    // Buscar la reserva que se quiere cancelar
    const myReservation = reservations.find(r => r.id === reservationId)
    if (!myReservation) return

    // Fase 3: verificar si el otro ocupante es el cónyuge
    const slotRes = getSlotReservations(myReservation.time_slot_id)
    const otherReservation = slotRes.find(r => r.id !== reservationId)
    const otherIsSpouse = spouse && otherReservation?.user_id === spouse.id

    // Feature 1: Si la reserva vino de una invitación aceptada → siempre relevo
    if (isViaAcceptedInvitation(myReservation.time_slot_id, user!.id)) {
      await handleOpenReliefModal(myReservation)
      return
    }

    // Fase 9A: Si el slot está lleno (2/2), el otro ocupante no es el cónyuge,
    // y pasó la ventana de 1h → forzar flujo de relevo en lugar de cancelar.
    const activeInSlot = slotRes.length
    if (activeInSlot === 2 && !otherIsSpouse && !isWithinCancelWindow(myReservation.created_at, cancelWindowMs)) {
      await handleOpenReliefModal(myReservation)
      return
    }

    // Mensaje de confirmación adaptado según si hay cónyuge
    const confirmMsg = otherIsSpouse
      ? `¿Cancelar esta reserva? También se cancelará la de tu cónyuge (${spouse?.name}).`
      : '¿Cancelar esta reserva?'
    if (!confirm(confirmMsg)) return

    // Cancelar la reserva del usuario
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', reservationId)

    if (error) {
      alert('Error al cancelar: ' + error.message)
      return
    }

    // Fase 3: Si el otro es el cónyuge, cancelar también su reserva
    if (otherIsSpouse && otherReservation) {
      await supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', otherReservation.id)
    }

    await loadData()
    await loadMonthlyReservations()  // Fase 4: recargar conteo mensual
  }

  // ─── Spinner de carga ──────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Cargando horarios...</p>
        </div>
      </div>
    )
  }

  return (
    <div>

      {/* Barra informativa: turnos usados, tipo de usuario, cónyuge y leyenda */}
      <div className="mb-4 bg-indigo-50 rounded-xl px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-indigo-700">
            Turnos {periodLabel}: <strong>{userReservationCount}/{maxTurnos}</strong>
          </span>
          {user && (
            <span className="text-xs bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded-full font-medium">
              {USER_TYPE_LABELS[user.user_type] || user.user_type}
            </span>
          )}
          {/* Indicador de cónyuge vinculado (Fase 3) */}
          {spouse && (
            <span className="text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full font-medium">
              💑 Pareja: {spouse.name}
            </span>
          )}
        </div>
        <div className="flex gap-3 text-xs flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-green-200 border border-green-400 inline-block"></span> Tu reserva
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-pink-200 border border-pink-400 inline-block"></span> Pareja
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-orange-200 border border-orange-400 inline-block"></span> Ocupado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-blue-200 border border-blue-400 inline-block"></span> Completo
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-gray-200 border border-gray-400 inline-block"></span> Reunión
          </span>
        </div>
      </div>

      {/* Pestañas para seleccionar exhibidor */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
        {exhibitors.map((ex) => (
          <button
            key={ex.id}
            onClick={() => setSelectedExhibitor(ex.id)}
            className={`px-5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              selectedExhibitor === ex.id
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {ex.name}
          </button>
        ))}
      </div>

      {/* ── Tabla principal de horarios ──
          Filas = bloques dinámicos (derivados de time_slots)
          Columnas = días (Lun-Sáb, Dom) vía DAY_ORDER
          Cada celda muestra 0, 1 o 2 personas */}
      <div className="bg-white rounded-xl shadow-md overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-indigo-600 text-white">
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider border-r border-indigo-500">
                Horario
              </th>
              {DAY_ORDER.map((dayNum) => (
                <th key={dayNum} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider border-r border-indigo-500 last:border-r-0">
                  {DAYS_OF_WEEK[dayNum]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dynamicBlocks.map((block) => (
              <tr key={block.start} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="px-3 py-2 text-xs font-semibold text-gray-600 whitespace-nowrap bg-gray-50 border-r border-gray-200">
                  {block.label}
                </td>
                {/* Renderizar cada celda por día */}
                {DAY_ORDER.map((dayNum) => {
                  const slot = getSlot(dayNum, block.start)

                  // ── Sin slot: vacío o bloqueado ──
                  if (!slot) {
                    // Buscar si hay slot bloqueado (inactivo con razón)
                    const blockedSlot = timeSlots.find(
                      s =>
                        s.exhibitor_id === selectedExhibitor &&
                        s.day_of_week === dayNum &&
                        s.start_time === block.start &&
                        s.block_reason
                    )
                    if (blockedSlot) {
                      return (
                        <td key={dayNum} className="px-2 py-2 text-center">
                          <div className="bg-gray-200 text-gray-500 rounded-lg px-2 py-3 text-xs font-medium">
                            {blockedSlot.block_reason}
                          </div>
                        </td>
                      )
                    }
                    return (
                      <td key={dayNum} className="px-2 py-2 text-center text-gray-300 text-xs">
                        —
                      </td>
                    )
                  }

                  // ── Slot inactivo ──
                  if (!slot.is_active) {
                    if (slot.block_reason) {
                      return (
                        <td key={dayNum} className="px-2 py-2 text-center">
                          <div className="bg-gray-200 text-gray-500 rounded-lg px-2 py-3 text-xs font-medium">
                            {slot.block_reason}
                          </div>
                        </td>
                      )
                    }
                    return (
                      <td key={dayNum} className="px-2 py-2 text-center text-gray-300 text-xs">
                        —
                      </td>
                    )
                  }

                  // ── Slot activo: obtener reservaciones (0, 1 o 2) ──
                  const slotRes = getSlotReservations(slot.id)
                  const pos1 = slotRes.find(r => r.slot_position === 1)
                  const pos2 = slotRes.find(r => r.slot_position === 2)
                  const count = slotRes.length
                  const isOwn1 = pos1?.user_id === user?.id
                  const isOwn2 = pos2?.user_id === user?.id
                  const hasOwnReservation = isOwn1 || isOwn2

                  // Fase 3: detectar si es reserva de pareja (usuario + cónyuge)
                  const isSpouse1 = spouse && pos1?.user_id === spouse.id
                  const isSpouse2 = spouse && pos2?.user_id === spouse.id
                  const isCoupleSlot = (isOwn1 && isSpouse2) || (isOwn2 && isSpouse1)
                  const hasSpouseReservation = isSpouse1 || isSpouse2

                  // ── CELDA VACÍA (0/2) ───────────────────────────────
                  // Fase 6: si la ventana de prioridad del usuario no ha abierto,
                  // mostrar candado con horario de apertura en lugar del botón.
                  if (count === 0) {
                    // Cuando la prioridad bloquea y podemos indicar hora de apertura
                    if (!bookingWindow.canBook && bookingWindow.opensAt) {
                      const NOMBRES_DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
                      const diaStr  = NOMBRES_DIAS[bookingWindow.opensAt.getDay()]
                      const horaStr = bookingWindow.opensAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
                      return (
                        <td key={dayNum} className="px-2 py-2 text-center">
                          <div
                            title={`Tu ventana abre el ${diaStr} a las ${horaStr}`}
                            className="w-full py-3 px-1 text-xs rounded-lg bg-yellow-50 text-yellow-700 border border-yellow-200 cursor-not-allowed select-none"
                          >
                            🔒 {diaStr} {horaStr}
                          </div>
                        </td>
                      )
                    }

                    return (
                      <td key={dayNum} className="px-2 py-2 text-center">
                        <button
                          onClick={() => handleReserve(slot.id)}
                          disabled={!canReserve || actionLoading === slot.id}
                          className={`w-full py-3 px-1 text-xs rounded-lg transition-all ${
                            canReserve
                              ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:shadow-sm cursor-pointer'
                              : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          {actionLoading === slot.id
                            ? '...'
                            : spouse && spouseCanReserve
                            ? '💑 Disponible'
                            : 'Disponible'}
                        </button>
                      </td>
                    )
                  }

                  // ── CELDA PARCIAL (1/2): Una persona + "Completar turno" ──
                  if (count === 1) {
                    const reservation = pos1 || pos2
                    const isOwn = reservation?.user_id === user?.id
                    const isSpouse = spouse && reservation?.user_id === spouse.id

                    return (
                      <td key={dayNum} className="px-2 py-2 text-center">
                        <div className={`rounded-lg px-2 py-1.5 text-xs transition-all ${
                          isOwn
                            ? 'bg-green-100 text-green-800 border border-green-300'
                            : isSpouse
                            ? 'bg-pink-50 text-pink-700 border border-pink-200'
                            : 'bg-orange-50 text-orange-700 border border-orange-200'
                        }`}>
                          {/* Persona 1 */}
                          <p className="font-semibold truncate text-[11px]">
                            {isSpouse && '💑 '}{reservation?.user?.name || 'Reservado'}
                          </p>
                          {isOwn && (
                            <button
                              onClick={() => handleCancel(reservation!.id)}
                              className="text-red-500 hover:text-red-700 text-[10px] underline"
                            >
                              Cancelar
                            </button>
                          )}
                          {/* Separador + espacio para persona 2 */}
                          <div className="border-t border-dashed mt-1 pt-1">
                            {hasOwnReservation ? (
                              // Yo tengo el único turno: ofrecer invitar a alguien
                              sentInvitations.some(i => i.slot_id === slot.id) ? (
                                <span className="text-[10px] text-indigo-400 font-medium">✉️ Invitación enviada</span>
                              ) : (
                                <button
                                  onClick={() => handleOpenInviteModal(slot.id)}
                                  className="w-full py-1 text-[10px] rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition"
                                >
                                  ✉️ Invitar
                                </button>
                              )
                            ) : hasSpouseReservation && canReserve ? (
                              // Mi cónyuge ya está en el turno: puedo unirme aunque tenga cupo lleno
                              // (el matrimonio comparte turnos sin restricción de posición)
                              <button
                                onClick={() => handleReserve(slot.id)}
                                disabled={actionLoading === slot.id}
                                className="w-full py-1 text-[10px] rounded bg-pink-50 text-pink-700 hover:bg-pink-100 transition"
                              >
                                {actionLoading === slot.id ? '...' : '💑 Unirme a mi cónyuge'}
                              </button>
                            ) : !hasSpouseReservation && canReserve ? (
                              // Alguien más tiene el turno: verificar compatibilidad de género
                              isCompatiblePartner(reservation!) ? (() => {
                                // Hay invitación pendiente no expirada para este slot?
                                const pendingInv = slotPendingInvitations.find(
                                  i => i.slot_id === slot.id &&
                                       new Date(i.expires_at) > new Date()
                                )
                                if (pendingInv) {
                                  // Calcular tiempo restante para mostrar
                                  const msLeft = new Date(pendingInv.expires_at).getTime() - Date.now()
                                  const totalMin = Math.floor(msLeft / 60_000)
                                  const hh = Math.floor(totalMin / 60)
                                  const mm = totalMin % 60
                                  const remaining = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`
                                  return (
                                    <span
                                      title={`Invitación activa, espera ${remaining} o hasta que sea rechazada`}
                                      className="text-[10px] text-amber-600 font-medium cursor-help"
                                    >
                                      ⏳ Inv. pendiente·{remaining}
                                    </span>
                                  )
                                }
                                // Si el ocupante tiene relevo abierto, mostrar indicador
                                // Feature 2: mostrar nombre del que pide relevo
                                if (openReliefBySlot[slot.id]) {
                                  return (
                                    <span className="text-[10px] text-orange-600 font-medium">
                                      🔄 {openReliefBySlot[slot.id].name} pide relevo
                                    </span>
                                  )
                                }
                                return (
                                  <button
                                    onClick={() => handleReserve(slot.id)}
                                    disabled={actionLoading === slot.id}
                                    className="w-full py-1 text-[10px] rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition"
                                  >
                                    {actionLoading === slot.id ? '...' : '+ Completar turno'}
                                  </button>
                                )
                              })() : (
                                // Género incompatible
                                <span className="text-[10px] text-amber-600 font-medium">
                                  ⚠️ Solo {reservation?.user?.gender === 'M' ? 'hombres' : 'mujeres'}
                                </span>
                              )
                            ) : (
                              <span className="text-[10px] text-gray-400">1/2</span>
                            )}
                          </div>
                        </div>
                      </td>
                    )
                  }

                  // ── CELDA COMPLETA (2/2): Dos personas ──
                  // Si hay relevo abierto compatible, el borde cambia a ámbar para destacarlo
                  const hasOpenRelief = !hasOwnReservation && !!openReliefBySlot[slot.id]
                  return (
                    <td key={dayNum} className="px-2 py-2 text-center">
                      <div className={`rounded-lg px-2 py-1.5 text-xs transition-all ${
                        isCoupleSlot
                          ? 'bg-pink-50 text-pink-800 border border-pink-300'
                          : hasOwnReservation
                          ? 'bg-green-100 text-green-800 border border-green-300'
                          : hasOpenRelief
                          ? 'bg-amber-50 text-amber-800 border border-amber-300'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}>
                        {/* Indicador de pareja si es turno de cónyuges (Fase 3) */}
                        {isCoupleSlot && (
                          <p className="text-[10px] text-pink-500 font-bold mb-0.5">💑 Pareja</p>
                        )}
                        {/* Persona en posición 1 */}
                        <p className={`font-semibold truncate text-[11px] ${isOwn1 ? 'underline' : ''}`}>
                          {pos1?.user?.name || 'Reservado'}
                        </p>
                        {/* Feature 2: indicador inline de relevo para pos1 */}
                        {!isOwn1 && openReliefBySlot[slot.id]?.from_user_id === pos1?.user_id && (
                          <p className="text-[10px] text-orange-600 font-medium">🔄 pide relevo</p>
                        )}
                        {isOwn1 && (() => {
                          // Feature 1: reserva por invitación aceptada → siempre relevo
                          if (isViaAcceptedInvitation(slot.id, user!.id)) {
                            const hasPendingRelief1 = myPendingReliefs.some(
                              r => r.reservation_id === pos1!.id
                            )
                            if (hasPendingRelief1) {
                              return <span className="text-[10px] text-amber-500 font-medium">⏳ Relevo pendiente</span>
                            }
                            return (
                              <button
                                onClick={() => handleOpenReliefModal(pos1!)}
                                className="text-orange-500 hover:text-orange-700 text-[10px] underline"
                              >
                                🔄 Pedir relevo
                              </button>
                            )
                          }
                          // Dentro de ventana configurable o turno de pareja → Cancelar directo
                          if (isCoupleSlot || isWithinCancelWindow(pos1!.created_at, cancelWindowMs)) {
                            return (
                              <button
                                onClick={() => handleCancel(pos1!.id)}
                                className="text-red-500 hover:text-red-700 text-[10px] underline"
                              >
                                Cancelar{isCoupleSlot ? ' ambos' : ''}
                              </button>
                            )
                          }
                          // ¿Tengo relevo abierto para este turno?
                          const hasPendingRelief1 = myPendingReliefs.some(
                            r => r.reservation_id === pos1!.id
                          )
                          if (hasPendingRelief1) {
                            return <span className="text-[10px] text-amber-500 font-medium">⏳ Relevo pendiente</span>
                          }
                          // Pasó la ventana → usar botón global 'Pedir Relevo' en la parte superior
                          return null
                        })()}
                        {/* Separador visual */}
                        <div className="border-t border-dashed my-0.5"></div>
                        {/* Persona en posición 2 */}
                        <p className={`font-semibold truncate text-[11px] ${isOwn2 ? 'underline' : ''}`}>
                          {pos2?.user?.name || 'Reservado'}
                        </p>
                        {/* Feature 2: indicador inline de relevo para pos2 */}
                        {!isOwn2 && openReliefBySlot[slot.id]?.from_user_id === pos2?.user_id && (
                          <p className="text-[10px] text-orange-600 font-medium">🔄 pide relevo</p>
                        )}
                        {isOwn2 && (() => {
                          // Feature 1: reserva por invitación aceptada → siempre relevo
                          if (isViaAcceptedInvitation(slot.id, user!.id)) {
                            const hasPendingRelief2 = myPendingReliefs.some(
                              r => r.reservation_id === pos2!.id
                            )
                            if (hasPendingRelief2) {
                              return <span className="text-[10px] text-amber-500 font-medium">⏳ Relevo pendiente</span>
                            }
                            return (
                              <button
                                onClick={() => handleOpenReliefModal(pos2!)}
                                className="text-orange-500 hover:text-orange-700 text-[10px] underline"
                              >
                                🔄 Pedir relevo
                              </button>
                            )
                          }
                          // Dentro de ventana configurable o turno de pareja → Cancelar directo
                          if (isCoupleSlot || isWithinCancelWindow(pos2!.created_at, cancelWindowMs)) {
                            return (
                              <button
                                onClick={() => handleCancel(pos2!.id)}
                                className="text-red-500 hover:text-red-700 text-[10px] underline"
                              >
                                Cancelar{isCoupleSlot ? ' ambos' : ''}
                              </button>
                            )
                          }
                          // ¿Tengo relevo abierto para este turno?
                          const hasPendingRelief2 = myPendingReliefs.some(
                            r => r.reservation_id === pos2!.id
                          )
                          if (hasPendingRelief2) {
                            return <span className="text-[10px] text-amber-500 font-medium">⏳ Relevo pendiente</span>
                          }
                          // Pasó la ventana → usar botón global 'Pedir Relevo' en la parte superior
                          return null
                        })()}
                        {/* Feature 2: indicador de relevo con nombre: solo si no hay indicador inline */}
                        {!hasOwnReservation && openReliefBySlot[slot.id] &&
                          openReliefBySlot[slot.id].from_user_id !== pos1?.user_id &&
                          openReliefBySlot[slot.id].from_user_id !== pos2?.user_id && (
                          <p className="text-[10px] text-orange-600 font-semibold mt-0.5">
                            🔄 {openReliefBySlot[slot.id].name} pide relevo
                          </p>
                        )}
                        {/* Indicador completo */}
                        <p className="text-[10px] text-green-600 font-bold mt-0.5">2/2 ✓</p>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {filteredSlots.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            No hay horarios configurados para este exhibidor.
          </div>
        )}
      </div>

      {/* ─── Modal de invitación (Fase 7) ───────────────────────────── */}
      {/* Aparece cuando el usuario hace clic en "✉️ Invitar" en un turno 1/2 */}
      {inviteModalSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            {/* Cabecera */}
            <div className="flex justify-between items-center px-5 py-4 border-b">
              <h2 className="text-base font-semibold text-gray-800">✉️ Invitar a compartir turno</h2>
              <button
                onClick={() => setInviteModalSlot(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            {/* Cuerpo */}
            <div className="p-4">
              {inviteLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : inviteUsers.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">
                  No hay usuarios disponibles para invitar.<br/>
                  <span className="text-xs text-gray-400">(mismo género, sin turno en este slot)</span>
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {inviteUsers.map(u => {
                    const alreadySent = sentInvitations.some(
                      i => i.slot_id === inviteModalSlot && i.to_user_id === u.id
                    )
                    return (
                      <li key={u.id} className="flex items-center justify-between py-3 px-1">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{u.name}</p>
                          <p className="text-[11px] text-gray-500">{USER_TYPE_LABELS[u.user_type]}</p>
                        </div>
                        {alreadySent ? (
                          <span className="text-xs text-indigo-400 font-medium">✓ Enviada</span>
                        ) : (
                          <button
                            onClick={() => handleSendInvitation(u.id)}
                            disabled={inviteSending === u.id}
                            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                          >
                            {inviteSending === u.id ? '...' : 'Invitar'}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal de relevo (Fase 9A) ─────────────────────────────── */}
      {/* Aparece cuando el usuario elige '🔄 Pedir relevo' en un turno 2/2 */}
      {/* Si isUrgent, se envió de forma directa y este modal no se muestra.  */}
      {reliefModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            {/* Cabecera */}
            <div className="flex justify-between items-center px-5 py-4 border-b">
              <h2 className="text-base font-semibold text-gray-800">🔄 Solicitar relevo de turno</h2>
              <button
                onClick={() => setReliefModal(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            {/* Cuerpo */}
            <div className="p-4">
              <p className="text-sm text-gray-600 mb-4">
                No puedes cancelar directamente. Puedes pedir a un hermano que tome tu turno.
              </p>

              {/* Selector de tipo */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setReliefType('open')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    reliefType === 'open'
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  📢 Relevo abierto
                </button>
                <button
                  onClick={() => setReliefType('personal')}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    reliefType === 'personal'
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  👤 Personal
                </button>
              </div>

              {reliefType === 'open' ? (
                <p className="text-xs text-gray-500 bg-orange-50 p-3 rounded-lg">
                  Se notificará a todos los hermanos del mismo género con cupo disponible.
                  El primero en aceptar tomará tu turno.
                </p>
              ) : (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Selecciona un hermano:</p>
                  {reliefUsers.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">
                      No hay hermanos disponibles.
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 max-h-48 overflow-y-auto rounded-lg border border-gray-100">
                      {reliefUsers.map(u => (
                        <li
                          key={u.id}
                          onClick={() => setReliefPersonalId(u.id)}
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-all ${
                            reliefPersonalId === u.id
                              ? 'bg-orange-50 text-orange-700'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                            reliefPersonalId === u.id
                              ? 'border-orange-500 bg-orange-500'
                              : 'border-gray-300'
                          }`} />
                          <div>
                            <p className="text-sm font-medium">{u.name}</p>
                            <p className="text-[11px] text-gray-400">{USER_TYPE_LABELS[u.user_type]}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            {/* Pie del modal */}
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setReliefModal(null)}
                className="flex-1 py-2 text-sm rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSendRelief(
                  reliefModal.reservationId,
                  reliefModal.slotId,
                  reliefType,
                  reliefType === 'personal' ? reliefPersonalId : null,
                )}
                disabled={
                  reliefSending ||
                  (reliefType === 'personal' && !reliefPersonalId)
                }
                className="flex-1 py-2 text-sm rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 transition font-medium"
              >
                {reliefSending ? '...' : '✅ Enviar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal elección: agendar solo o con cónyuge (Fase 3+) ─── */}
      {coupleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">💑 ¿Cómo deseas agendar?</h2>
              <button
                onClick={() => setCoupleModal(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500 mb-1">
                ¿Cómo deseas agendar este turno?
              </p>
              {/* Opción: solo el usuario */}
              <button
                onClick={() => { const s = coupleModal; setCoupleModal(null); handleReserve(s, false) }}
                className="w-full py-2.5 text-sm rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition text-left px-3"
              >
                <span className="font-medium">👤 Solo yo</span>
                <p className="text-[11px] text-indigo-400 mt-0.5">{spouse?.name} puede agendar por separado si hay cupo.</p>
              </button>
              {/* Opción: ambos — deshabilitada si el cónyuge no tiene cupo */}
              {spouseCanReserve ? (
                <button
                  onClick={() => { const s = coupleModal; setCoupleModal(null); handleReserve(s, true) }}
                  className="w-full py-2.5 text-sm rounded-xl bg-pink-50 text-pink-700 hover:bg-pink-100 transition text-left px-3"
                >
                  <span className="font-medium">💑 Agendar con {spouse?.name}</span>
                  <p className="text-[11px] text-pink-400 mt-0.5">Reservar los dos lugares del turno juntos automáticamente.</p>
                </button>
              ) : (
                <div className="w-full py-2.5 text-sm rounded-xl bg-gray-50 border border-gray-200 text-left px-3 opacity-60 cursor-not-allowed">
                  <span className="font-medium text-gray-400">💑 Agendar con {spouse?.name}</span>
                  <p className="text-[11px] text-red-400 mt-0.5">
                    {spouse?.name} ya alcanzó su límite de turnos {periodLabel}. No puede ser agendado/a.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
