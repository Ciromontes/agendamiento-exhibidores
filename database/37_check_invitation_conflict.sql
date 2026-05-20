-- ═══════════════════════════════════════════════════════════════
-- 37 — check_invitation_accept_conflict
-- ═══════════════════════════════════════════════════════════════
-- Antes de aceptar una invitación, el cliente llamaba esta función
-- para saber si hacerlo liberaría un turno "huérfano" del usuario.
--
-- Con límites de turnos desactivados, ya no hay conflicto y
-- esta función siempre retorna has_conflict = false.
--
-- Retorna:
--   { has_conflict: false }
--     → El usuario puede aceptar sin consecuencias (tiene cupo).
--
--   { has_conflict: true, exhibitor_name, day_of_week,
--     start_time, end_time, reservation_id, slot_id }
--     → El usuario está en su límite de turnos pero tiene un huérfano;
--       si acepta, ese turno quedará libre para otros.
--
-- El frontend usa esto para mostrar un modal de confirmación.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_invitation_accept_conflict(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object('has_conflict', false);
END;
$$;

GRANT EXECUTE ON FUNCTION check_invitation_accept_conflict(UUID) TO anon, authenticated;
