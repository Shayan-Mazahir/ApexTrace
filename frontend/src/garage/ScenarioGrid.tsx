import type { ConfigResult, EvaluationResponse, SuiteGroup } from '../types/schemas'
import { formatCad } from './budgetMath'
import './ScenarioGrid.css'

const SHORT: Record<string, string> = {
  baseline: 'Nothing',
  local_fallback: 'Fallback',
  brake_servicing: 'Brakes',
  comms_improvement: 'Comms',
  'brake_servicing+local_fallback': 'Brakes + Fallback',
  'comms_improvement+local_fallback': 'Comms + Fallback',
  'brake_servicing+comms_improvement': 'Brakes + Comms',
  'brake_servicing+comms_improvement+local_fallback': 'All three',
}

interface Props {
  evaluation: EvaluationResponse
  group: SuiteGroup
  available: number
  selectedKey: string
  recommendedKey: string | null
  onPick: (config: ConfigResult) => void
}

// Rows = stress scenarios, columns = every upgrade combination. Each cell: how
// many of that scenario's runs (different seeds) stayed safely on track.
export function ScenarioGrid({ evaluation, group, available, selectedKey, recommendedKey, onPick }: Props) {
  const info = new Map(evaluation.suite.tests.map((t) => [t.id, t]))
  const unsolved = new Set(group.unsolved_test_ids ?? [])
  const families: { id: string; name: string; testIds: string[] }[] = []
  for (const tid of group.test_ids) {
    const t = info.get(tid)
    if (!t) continue
    let f = families.find((x) => x.id === t.scenario_id)
    if (!f) families.push((f = { id: t.scenario_id, name: t.name, testIds: [] }))
    f.testIds.push(tid)
  }
  const configs = [...group.configs].sort((a, b) => a.cost_cad - b.cost_cad)

  return (
    <div className="sgrid" role="table" aria-label="Scenario results for every upgrade combination">
      <div className="sgrid__row sgrid__row--head" role="row">
        <div className="sgrid__name" role="columnheader">Scenario</div>
        {configs.map((c) => {
          const over = c.cost_cad > 0 && c.cost_cad > available
          return (
            <button
              key={c.key}
              type="button"
              role="columnheader"
              className={`sgrid__col ${c.key === selectedKey ? 'is-selected' : ''} ${c.key === recommendedKey ? 'is-best' : ''} ${over ? 'is-over' : ''}`}
              onClick={() => onPick(c)}
              title={over ? 'Over your budget' : 'Select this combination'}
            >
              <b>{SHORT[c.key] ?? c.label}</b>
              <small>{c.cost_cad ? formatCad(c.cost_cad) : 'CAD 0'}</small>
            </button>
          )
        })}
      </div>
      {families.map((f) => {
        const hopeless = f.testIds.every((t) => unsolved.has(t))
        return (
          <div key={f.id} className={`sgrid__row ${hopeless ? 'is-hopeless' : ''}`} role="row">
            <div className="sgrid__name" role="rowheader">
              {f.name}
              {hopeless && <em>no upgrade fixes this</em>}
            </div>
            {configs.map((c) => {
              const runs = c.tests.filter((t) => f.testIds.includes(t.test_id))
              const ok = runs.filter((t) => t.passed).length
              const cls = ok === runs.length ? 'pass' : ok === 0 ? 'fail' : 'part'
              const why = runs.filter((t) => !t.passed).map((t) => (t.track_exit ? `${t.exit_reason ?? 'left the track'} at ${t.exit_location}` : `only ${t.min_clearance_m.toFixed(2)} m from the edge`))
              return (
                <div key={c.key} role="cell" className={`sgrid__cell sgrid__cell--${cls} ${c.key === selectedKey ? 'is-selected' : ''}`}
                  title={why.length ? why.join('\n') : 'All runs stayed safely on track'}>
                  {cls === 'pass' ? '✓' : cls === 'fail' ? '✕' : `${ok}/${runs.length}`}
                </div>
              )
            })}
          </div>
        )
      })}
      <p className="sgrid__key">
        ✓ safe in every run &nbsp; ✕ crashed or got too close to the edge &nbsp; 2/3 safe in some runs. Each scenario is run 3 times with
        different seeds. Hover a cell for what went wrong; click a column to select that combination.
      </p>
    </div>
  )
}
