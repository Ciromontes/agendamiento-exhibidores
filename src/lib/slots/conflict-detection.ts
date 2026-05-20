/**
 * lib/slots/conflict-detection.ts
 * ────────────────────────────────────────────────────────
 * Funciones para detectar conflictos de horarios entre slots
 * 
 * Lógica: Dos slots se cruzan si sus rangos de tiempo se superponen
 * Fórmula: !((endA <= startB) || (endB <= startA)) = conflicto
 */

/**
 * Convierte formato HH:mm:ss o HH:mm a minutos desde medianoche
 * Ej: "09:30:00" → 570 minutos
 * Ej: "14:45" → 885 minutos
 */
export function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  return hours * 60 + minutes;
}

/**
 * Detecta si dos rangos de tiempo se cruzan
 * 
 * @param startA Hora inicio slot A (formato HH:mm:ss)
 * @param endA Hora fin slot A
 * @param startB Hora inicio slot B
 * @param endB Hora fin slot B
 * @returns true si hay conflicto, false si no hay
 * 
 * Ejemplos:
 * - 06:00-08:00 + 09:00-11:00 → false (sin conflicto)
 * - 06:00-08:00 + 07:00-09:00 → true (conflicto en 07:00-08:00)
 * - 06:00-08:00 + 08:00-10:00 → false (sin conflicto, exacto límite)
 */
export function hasTimeConflict(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const aStart = timeToMinutes(startA);
  const aEnd = timeToMinutes(endA);
  const bStart = timeToMinutes(startB);
  const bEnd = timeToMinutes(endB);

  // Si el final de A es <= inicio de B, no hay cruce
  // Si el final de B es <= inicio de A, no hay cruce
  // De lo contrario, hay cruce
  return !((aEnd <= bStart) || (bEnd <= aStart));
}

/**
 * Calcula la hora de fin dada una hora de inicio
 * Asume bloques de 2 horas
 * Ej: "06:00:00" → "08:00:00"
 */
export function calculateEndTime(startTime: string): string {
  const minutes = timeToMinutes(startTime);
  const endMinutes = minutes + 120; // 2 horas = 120 minutos

  const hours = Math.floor(endMinutes / 60);
  const mins = endMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

/**
 * Acorta tiempo a formato HH:mm (sin segundos)
 * Ej: "06:00:00" → "06:00"
 */
export function shortTime(timeStr: string): string {
  return timeStr.substring(0, 5);
}

/**
 * Verifica si hay conflicto entre un nuevo slot y una lista existente
 * del mismo exhibidor y día
 * 
 * @param newStart Hora inicio del nuevo slot
 * @param newEnd Hora fin del nuevo slot
 * @param existingSlots Array de slots existentes
 * @returns Slot conflictivo si existe, null si no hay conflicto
 */
export function findConflictingSlot(
  newStart: string,
  newEnd: string,
  existingSlots: Array<{ start_time: string; end_time: string; id?: string }>
): { start_time: string; end_time: string; id?: string } | null {
  for (const slot of existingSlots) {
    if (hasTimeConflict(newStart, newEnd, slot.start_time, slot.end_time)) {
      return slot;
    }
  }
  return null;
}
