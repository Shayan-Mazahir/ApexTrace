import type { WarningEventMessage } from '../types/schemas'

export interface WarningState {
  lastSeq: number
  active: boolean
  reason: string | null
  hazardZone: string | null
  since: number | null
}

export const INITIAL_WARNING: WarningState = {
  lastSeq: 0,
  active: false,
  reason: null,
  hazardZone: null,
  since: null,
}

// Warning events can arrive late or out of order (delayed path, reconnects).
// Only a strictly newer sequence number may change what the driver sees.
export function applyWarningEvent(
  state: WarningState,
  event: WarningEventMessage,
  receivedAt: number,
): WarningState {
  if (event.seq <= state.lastSeq) return state
  if (!event.active) {
    return { lastSeq: event.seq, active: false, reason: null, hazardZone: null, since: null }
  }
  const sameHazard = state.active && state.hazardZone === event.hazard_zone
  return {
    lastSeq: event.seq,
    active: true,
    reason: event.reason,
    hazardZone: event.hazard_zone,
    since: sameHazard && state.since !== null ? state.since : receivedAt,
  }
}
