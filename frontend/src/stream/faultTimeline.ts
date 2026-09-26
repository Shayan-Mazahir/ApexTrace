import type { FaultEventMessage, FaultSummary } from '../types/schemas'

export const MAX_FAULT_EVENTS = 60

export function appendFaultEvent(events: FaultEventMessage[], event: FaultEventMessage): FaultEventMessage[] {
  const next = [...events, event]
  return next.length > MAX_FAULT_EVENTS ? next.slice(next.length - MAX_FAULT_EVENTS) : next
}

export function describeFault(f: Pick<FaultSummary, 'type' | 'parameters'>): string {
  const params = Object.entries(f.parameters ?? {})
    .map(([k, v]) => `${k}=${Number.isInteger(v) ? v : v.toFixed(2)}`)
    .join(', ')
  return params ? `${f.type} (${params})` : f.type
}

// Distance-ordered active windows (activation -> deactivation) per fault id,
// for drawing on a lap-distance axis.
export function faultWindows(events: FaultEventMessage[], lapLength: number) {
  const open = new Map<string, FaultEventMessage>()
  const out: { id: string; target: string; start: number; end: number | null }[] = []
  for (const e of events) {
    if (e.event === 'fault_activated') open.set(e.fault_id, e)
    else {
      const a = open.get(e.fault_id)
      if (a) {
        out.push({ id: e.fault_id, target: e.target, start: a.distance % lapLength, end: e.distance % lapLength })
        open.delete(e.fault_id)
      }
    }
  }
  for (const [id, a] of open) out.push({ id, target: a.target, start: a.distance % lapLength, end: null })
  return out
}
