import { useEffect, useMemo, useState } from 'react'
import type { FaultSpec, FaultType, TrackProfile, TriggerKind } from '../types/schemas'
import './FaultBuilder.css'

interface FaultBuilderProps {
  catalog: FaultType[]
  profile: TrackProfile | null
  disabled: boolean
  onAdd: (spec: FaultSpec) => void
}

let counter = 0

const LAYER: Record<string, string> = {
  world: 'Road',
  vehicle: 'Car (brakes, steering)',
  sensor: 'Sensors',
  uplink: 'Car to pit wall link',
  warning_service: 'Warning computer',
  downlink: 'Pit wall to driver link',
  driver: 'Driver',
}

// Survives leaving the Engineer screen and coming back (the screen unmounts).
const draft: { type: string; params: Record<string, number>; kind: TriggerKind; zone: string; pad: number; start: number; end: number | '' } = {
  type: '', params: {}, kind: 'always', zone: '', pad: 100, start: 0, end: '',
}

export function FaultBuilder({ catalog, profile, disabled, onAdd }: FaultBuilderProps) {
  const implemented = useMemo(() => catalog.filter((c) => c.status === 'implemented'), [catalog])
  const unavailable = useMemo(() => catalog.filter((c) => c.status !== 'implemented'), [catalog])
  const [type, setType] = useState(draft.type)
  const ft = implemented.find((c) => c.type === type)
  const [params, setParams] = useState<Record<string, number>>(draft.params)
  const [kind, setKind] = useState<TriggerKind>(draft.kind)
  const [zone, setZone] = useState(draft.zone)
  const [pad, setPad] = useState(draft.pad)
  const [start, setStart] = useState(draft.start)
  const [end, setEnd] = useState<number | ''>(draft.end)
  useEffect(() => {
    Object.assign(draft, { type, params, kind, zone, pad, start, end })
  }, [type, params, kind, zone, pad, start, end])

  const choose = (t: string) => {
    setType(t)
    const spec = implemented.find((c) => c.type === t)
    setParams(Object.fromEntries((spec?.params ?? []).map((p) => [p.name, p.default])))
  }

  const add = () => {
    if (!ft) return
    counter += 1
    const trigger =
      kind === 'zone'
        ? { kind, zone_id: zone || profile?.hazard_zones[0]?.id, pad_m: pad }
        : kind === 'always'
          ? { kind }
          : { kind, start, end: end === '' ? null : Number(end) }
    onAdd({ id: `m${counter}-${ft.type}`, type: ft.type, parameters: params, trigger, source: 'manual' })
  }

  return (
    <div className="fault-builder">
      <label className="fault-builder__field">
        <span>Fault type</span>
        <select value={type} disabled={disabled} onChange={(e) => choose(e.target.value)}>
          <option value="">— choose —</option>
          {['world', 'vehicle', 'sensor', 'uplink', 'warning_service', 'downlink', 'driver'].map((target) => (
            <optgroup key={target} label={LAYER[target] ?? target}>
              {implemented
                .filter((c) => c.target === target)
                .map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      {ft && (
        <>
          <p className="fault-builder__desc">{ft.description}</p>
          {ft.params.map((p) => (
            <label key={p.name} className="fault-builder__param">
              <span>
                {p.name} <strong>{params[p.name]?.toFixed(p.max - p.min > 10 ? 0 : 2)}</strong> {p.unit}
              </span>
              <input type="range" min={p.min} max={p.max} step={(p.max - p.min) / 100} value={params[p.name] ?? p.default}
                disabled={disabled} onChange={(e) => setParams({ ...params, [p.name]: Number(e.target.value) })} />
            </label>
          ))}
          <div className="fault-builder__trigger">
            <label>
              <span>Trigger</span>
              <select value={kind} disabled={disabled} onChange={(e) => setKind(e.target.value as TriggerKind)}>
                <option value="always">Whole run</option>
                <option value="zone">Track zone</option>
                <option value="distance">Distance range (m)</option>
                <option value="time">Time range (s)</option>
              </select>
            </label>
            {kind === 'zone' && (
              <>
                <label>
                  <span>Zone</span>
                  <select value={zone} disabled={disabled} onChange={(e) => setZone(e.target.value)}>
                    {profile?.hazard_zones.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Start {pad} m before</span>
                  <input type="range" min={0} max={600} step={10} value={pad} disabled={disabled} onChange={(e) => setPad(Number(e.target.value))} />
                </label>
              </>
            )}
            {(kind === 'distance' || kind === 'time') && (
              <>
                <label>
                  <span>From</span>
                  <input type="number" value={start} disabled={disabled} onChange={(e) => setStart(Number(e.target.value))} />
                </label>
                <label>
                  <span>To</span>
                  <input type="number" value={end} placeholder="end" disabled={disabled}
                    onChange={(e) => setEnd(e.target.value === '' ? '' : Number(e.target.value))} />
                </label>
              </>
            )}
          </div>
          <button type="button" disabled={disabled} onClick={add}>
            Add fault
          </button>
        </>
      )}

      <details className="fault-builder__unavailable">
        <summary>Not available ({unavailable.length}) — need model extensions</summary>
        <ul>
          {unavailable.map((c) => (
            <li key={c.type}>
              <strong>{c.label}</strong>: {c.description}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
