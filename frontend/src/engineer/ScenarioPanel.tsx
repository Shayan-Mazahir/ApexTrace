import type { ScenarioConfig, TrackId } from '../types/schemas'
import './ScenarioPanel.css'

// The two named presets from the brief; their definitions live in the saved
// scenario JSON files, so these buttons only select one.
const PRESET_IDS = ['monza_high_speed_braking', 'baku_stale_telemetry']

interface ScenarioPanelProps {
  scenarios: ScenarioConfig[]
  track: TrackId | null
  selectedId: string
  activeScenarioId: string | null
  disabled: boolean
  onSelect: (id: string) => void
  onLaunch: (id: string) => void
  onClear: () => void
}

export function ScenarioPanel({
  scenarios,
  track,
  selectedId,
  activeScenarioId,
  disabled,
  onSelect,
  onLaunch,
  onClear,
}: ScenarioPanelProps) {
  const forTrack = scenarios.filter((s) => s.track === track)
  const selected = scenarios.find((s) => s.id === selectedId)
  const presets = PRESET_IDS.map((id) => scenarios.find((s) => s.id === id)).filter(
    (s): s is ScenarioConfig => s !== undefined,
  )

  return (
    <div className="scenario-panel">
      <div className="scenario-panel__presets">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={disabled || preset.track !== track}
            title={preset.track !== track ? `Needs a ${preset.track} session` : preset.description}
            className={preset.id === selectedId ? 'scenario-panel__preset--selected' : ''}
            onClick={() => onSelect(preset.id)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <label className="scenario-panel__select">
        <span>Saved scenario</span>
        <select
          value={selectedId}
          disabled={disabled || forTrack.length === 0}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">— choose —</option>
          {forTrack.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <p className="scenario-panel__description">
          {selected.description} Active {selected.onset_distance}–{selected.end_distance} m, seed{' '}
          {selected.seed}.
        </p>
      )}

      <div className="scenario-panel__actions">
        <button type="button" disabled={disabled || !selected} onClick={() => onLaunch(selectedId)}>
          Launch scenario
        </button>
        <button type="button" disabled={disabled || !activeScenarioId} onClick={onClear}>
          Clear scenario
        </button>
      </div>
      <div className="scenario-panel__active">Running: {activeScenarioId ?? 'none'}</div>
    </div>
  )
}
