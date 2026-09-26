import type { LogEntry } from '../stream/useSessionStream'
import './EventLog.css'

function describe(e: LogEntry): { kind: string; text: string; tone: string } {
  if (e.type === 'fault_event') {
    const verb = e.event === 'fault_activated' ? 'ON' : e.event === 'fault_deactivated' ? 'off' : 'cancelled'
    return { kind: `fault ${verb}`, text: `${e.fault_id} [${e.target}, ${e.source}] @ ${e.distance.toFixed(0)} m`, tone: e.event === 'fault_activated' ? 'danger' : 'neutral' }
  }
  if (e.type === 'warning_event') {
    const what = e.active ? `BRAKE — ${e.hazard_zone}` : e.state === 'stale' || e.state === 'no_data' ? 'STALE — no fresh data' : 'clear'
    const age = e.data_age_ms !== null ? ` · data ${e.data_age_ms.toFixed(0)} ms old` : ''
    return { kind: `warning (${e.source ?? '—'})`, text: `${what}${age}`, tone: e.active ? 'warn' : e.state === 'stale' ? 'warn' : 'neutral' }
  }
  return { kind: e.event.replace(/_/g, ' '), text: `${e.location ?? ''} @ ${e.t.toFixed(1)} s`, tone: 'danger' }
}

export function EventLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return <p className="event-log__empty">No events yet.</p>
  return (
    <ol className="event-log" aria-live="polite">
      {[...entries].reverse().slice(0, 40).map((e, i) => {
        const d = describe(e)
        const t = 't' in e ? e.t : (e as { displayed_t: number }).displayed_t
        return (
          <li key={i} className={`event-log__row event-log__row--${d.tone}`}>
            <span className="event-log__t">{typeof t === 'number' ? t.toFixed(1) : ''}s</span>
            <span className="event-log__kind">{d.kind}</span>
            <span>{d.text}</span>
          </li>
        )
      })}
    </ol>
  )
}
