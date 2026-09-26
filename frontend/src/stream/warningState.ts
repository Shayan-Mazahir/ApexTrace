import type { WarningEventMessage } from '../types/schemas'

export interface WarningState {
  lastSeq: number
  active: boolean // BRAKE shown
  stale: boolean // the warning system has no fresh data: caution shown instead
  reason: string | null
  hazardZone: string | null
  source: 'remote' | 'local' | null
  dataAgeMs: number | null
  since: number | null
}

export const INITIAL_WARNING: WarningState = {
  lastSeq: 0,
  active: false,
  stale: false,
  reason: null,
  hazardZone: null,
  source: null,
  dataAgeMs: null,
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
  const stale = event.state === 'stale' || event.state === 'no_data'
  if (!event.active) {
    return {
      lastSeq: event.seq,
      active: false,
      stale,
      reason: stale ? event.reason : null,
      hazardZone: null,
      source: event.source,
      dataAgeMs: event.data_age_ms,
      since: stale ? (state.stale && state.since !== null ? state.since : receivedAt) : null,
    }
  }
  const sameHazard = state.active && state.hazardZone === event.hazard_zone
  return {
    lastSeq: event.seq,
    active: true,
    stale: false,
    reason: event.reason,
    hazardZone: event.hazard_zone,
    source: event.source,
    dataAgeMs: event.data_age_ms,
    since: sameHazard && state.since !== null ? state.since : receivedAt,
  }
}
