import { StatusBadge } from '../components/StatusBadge'
import type { Acceptance, UpgradeConfig } from '../types/schemas'
import { formatCad, NO_AFFORDABLE_MESSAGE, type ConfigRow } from './budgetMath'
import './ResultsTable.css'

interface ResultsTableProps {
  rows: ConfigRow[]
  acceptance: Acceptance
  testCount: number
  filterOn: boolean
  onFilterChange: (on: boolean) => void
  selectedKey: string
  recommendedKey: string | null
  onUse: (upgrades: UpgradeConfig) => void
}

const fmt = (value: number | null, digits = 2) => (value === null ? '—' : value.toFixed(digits))

export function ResultsTable({
  rows,
  acceptance,
  testCount,
  filterOn,
  onFilterChange,
  selectedKey,
  recommendedKey,
  onUse,
}: ResultsTableProps) {
  const shown = filterOn ? rows.filter((r) => r.feasible) : rows
  const hidden = rows.length - shown.length

  return (
    <div className="results-table">
      <div className="results-table__criteria">
        Acceptance, fixed before comparing: {acceptance.max_track_exits} track exits, lap completed, minimum
        clearance ≥ {acceptance.min_clearance_m.toFixed(2)} m, across all {testCount} tests.
      </div>

      <label className="results-table__filter">
        <input type="checkbox" checked={filterOn} onChange={(e) => onFilterChange(e.target.checked)} />
        Only show configurations that passed and fit the budget
        {filterOn && hidden > 0 ? ` (${hidden} of ${rows.length} hidden)` : ''}
      </label>

      {shown.length === 0 ? (
        <p className="results-table__none" role="status">
          <StatusBadge tone="danger" label="No result" /> {NO_AFFORDABLE_MESSAGE}
        </p>
      ) : (
        <div className="results-table__scroll">
          <table>
            <thead>
              <tr>
                <th>Configuration</th>
                <th>Cost</th>
                <th>Budget</th>
                <th>Tests</th>
                <th>Track exits</th>
                <th>Min clearance</th>
                <th>Min warning lead</th>
                <th>Outcome</th>
                <th>Left after upgrade</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ result, affordable, remaining }) => (
                <tr
                  key={result.key}
                  className={`${result.key === selectedKey ? 'results-table__selected' : ''} ${
                    result.key === recommendedKey ? 'results-table__recommended' : ''
                  }`}
                >
                  <td>
                    {result.label}
                    {result.key === recommendedKey && <em> · cheapest that passed</em>}
                  </td>
                  <td>{formatCad(result.cost_cad)}</td>
                  <td>{affordable ? 'Within budget' : 'Over budget'}</td>
                  <td>{result.test_count}</td>
                  <td>{result.track_exits}</td>
                  <td>{fmt(result.min_clearance_m)} m</td>
                  <td>{fmt(result.min_warning_lead_s)} s</td>
                  <td>
                    {result.passed ? (
                      <StatusBadge tone="info" label="Passed this test suite" />
                    ) : (
                      <StatusBadge tone="danger" label={`Failed ${result.failed_test_ids.length} of ${result.test_count}`} />
                    )}
                  </td>
                  <td>{affordable ? formatCad(remaining) : '—'}</td>
                  <td>
                    <button type="button" onClick={() => onUse(result.upgrades)} disabled={!affordable}>
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
