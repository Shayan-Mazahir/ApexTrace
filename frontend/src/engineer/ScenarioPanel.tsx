import { useEffect, useState } from 'react'
import type { ScenarioOverrides, StressScenario, TrackProfile } from '../types/schemas'
import './ScenarioPanel.css'

interface ScenarioPanelProps {
  scenarios: StressScenario[]
  profile: TrackProfile | null
  activeScenarioId: string | null
  disabled: boolean
  onArm: (id: string, overrides: ScenarioOverrides) => void
  onCancel: () => void
  onReset: () => void
}

const SOURCE_LABEL: Record<string, string> = { preset: 'Presets', sac: 'Discovered by SAC', random: 'Random search', manual: 'Manual' }

export function ScenarioPanel({ scenarios, profile, activeScenarioId, disabled, onArm, onCancel, onReset }: ScenarioPanelProps) {
  const forTrack = scenarios.filter((s) => s.track === profile?.id)
  const [selectedId, setSelectedId] = useState('')
  const selected = forTrack.find((s) => s.id === selectedId)
  const [zone, setZone] = useState('')
  const [severity, setSeverity] = useState(1)
  const [duration, setDuration] = useState('')
  const [seed, setSeed] = useState('')

  useEffect(() => {
    setZone('')
    setSeverity(1)
    setDuration('')
    setSeed(selected ? String(selected.seed) : '')
  }, [selectedId, selected])

  const hasZoneFaults = selected?.faults.some((f) => f.trigger?.kind === 'zone') ?? false
  const groups = Object.entries(
    forTrack.reduce<Record<string, StressScenario[]>>((acc, s) => {
      ;(acc[s.source] ??= []).push(s)
      return acc
    }, {}),
  )

  const arm = () => {
    if (!selected) return
    const overrides: ScenarioOverrides = { severity }
    if (zone) overrides.zone_id = zone
    if (duration) overrides.duration_s = Number(duration)
    if (seed) overrides.seed = Number(seed)
    onArm(selected.id, overrides)
  }

  return (
    <div className="scenario-panel">
      <label className="scenario-panel__field">
        <span>Scenario ({profile?.name ?? 'join a session'})</span>
        <select value={selectedId} disabled={disabled || forTrack.length === 0} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">— choose —</option>
          {groups.map(([source, list]) => (
            <optgroup key={source} label={SOURCE_LABEL[source] ?? source}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {selected && (
        <>
          <p className="scenario-panel__description">{selected.description}</p>
          <ul className="scenario-panel__faults">
            {selected.faults.map((f) => (
              <li key={f.id}>
                <code>{f.type}</code> [{f.target}] {Object.entries(f.parameters ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}
                {' — '}
                {f.trigger?.kind === 'zone' ? `zone ${f.trigger.zone_id}` : f.trigger?.kind ?? 'always'}
              </li>
            ))}
          </ul>
          <div className="scenario-panel__grid">
            <label>
              <span>Trigger zone</span>
              <select value={zone} disabled={disabled || !hasZoneFaults} onChange={(e) => setZone(e.target.value)}>
                <option value="">as defined</option>
                {profile?.hazard_zones.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Severity ×{severity.toFixed(2)}</span>
              <input type="range" min={0.25} max={1.5} step={0.05} value={severity} disabled={disabled}
                onChange={(e) => setSeverity(Number(e.target.value))} />
            </label>
            <label>
              <span>Duration cap (s)</span>
              <input type="number" min={0.5} step={0.5} placeholder="none" value={duration} disabled={disabled}
                onChange={(e) => setDuration(e.target.value)} />
            </label>
            <label>
              <span>Seed</span>
              <input type="number" value={seed} disabled={disabled} onChange={(e) => setSeed(e.target.value)} />
            </label>
          </div>
        </>
      )}

      <div className="scenario-panel__actions">
        <button type="button" disabled={disabled || !selected} onClick={arm}>
          Arm scenario
        </button>
        <button type="button" disabled={disabled || !activeScenarioId} onClick={onCancel}>
          Cancel scenario
        </button>
        <button type="button" disabled={disabled} onClick={onReset}>
          Reset experiment
        </button>
      </div>
      <p className="scenario-panel__note">
        Arming restarts the run from the scenario&apos;s start with its seed. Faults then wait for their own triggers —
        arming does not switch them all on.
      </p>
    </div>
  )
}
