import { useState } from 'react'
import { useGarage } from '../app/GarageContext'
import { useScreen } from '../app/ScreenContext'
import { LoadingIndicator } from '../components/LoadingIndicator'
import { BudgetPanel } from '../garage/BudgetPanel'
import {
  canAdd,
  cashLeftThroughSeason,
  classifyConfigs,
  configKey,
  formatCad,
  recommend,
  remainingAfter,
  selectedIds,
} from '../garage/budgetMath'
import { GarageCar } from '../garage/GarageCar'
import { ResultsTable } from '../garage/ResultsTable'
import { UpgradeCard } from '../garage/UpgradeCard'
import { UPGRADE_IDS } from '../types/schemas'
import './GarageScreen.css'

export function GarageScreen() {
  const garage = useGarage()
  const { setScreen } = useScreen()
  const [filterOn, setFilterOn] = useState(true)

  const { catalog, budget, selection, evaluation, available, selectedCost } = garage
  const specs = catalog?.upgrades ?? []
  const rows = evaluation ? classifyConfigs(evaluation.configs, budget) : []
  const recommended = recommend(rows)
  const selectedKey = configKey(selection)
  const selectedResult = evaluation?.configs.find((c) => c.key === selectedKey)
  const anySelected = selectedIds(selection).length > 0

  return (
    <div className="garage-screen">
      <header className="garage-screen__header">
        <h1>Upgrade garage</h1>
        <p>
          Four events left. Can you improve this car&apos;s warning system without spending money already
          committed to the season? All figures are editable demo assumptions for a fictional team.
        </p>
      </header>

      <BudgetPanel budget={budget} onChange={garage.setBudget} />

      <div className="garage-screen__main">
        <div className="garage-screen__car" aria-label="Car with selected upgrades highlighted">
          <GarageCar selection={selection} />
        </div>
        <div className="garage-screen__cards">
          {!catalog && <LoadingIndicator label="Loading upgrades" />}
          {UPGRADE_IDS.map((id) => {
            const spec = specs.find((s) => s.id === id)
            if (!spec) return null
            return (
              <UpgradeCard
                key={id}
                spec={spec}
                selected={selection[id]}
                blocked={!canAdd(id, selection, specs, available)}
                onToggle={() => garage.toggleUpgrade(id)}
              />
            )
          })}
        </div>
      </div>

      <section className="garage-screen__summary" aria-live="polite">
        <div>
          <span>Selected spend</span>
          <strong>{formatCad(selectedCost)}</strong>
        </div>
        <div>
          <span>Remaining after commitments, reserve and upgrades</span>
          <strong className="garage-screen__orange">{formatCad(remainingAfter(budget, selectedCost))}</strong>
        </div>
        <div>
          <span>Cash left through the final event (reserve included)</span>
          <strong>{formatCad(cashLeftThroughSeason(budget, selectedCost))}</strong>
        </div>
      </section>

      <section className="garage-screen__evaluate">
        <div className="garage-screen__actions">
          <button type="button" className="garage-screen__primary" onClick={garage.evaluate} disabled={garage.evaluating}>
            {evaluation ? 'Re-run fixed evaluation suite' : 'Run fixed evaluation suite'}
          </button>
          {garage.evaluating && <LoadingIndicator label="Running every combination on the same suite" />}
          {recommended && (
            <button type="button" onClick={() => garage.setSelection(recommended.result.upgrades)}>
              Select cheapest passing
            </button>
          )}
          <button type="button" onClick={() => setScreen('compare')} disabled={!anySelected || !evaluation}>
            Compare baseline vs selected
          </button>
          <button type="button" onClick={() => setScreen('drive')} disabled={!anySelected}>
            Drive this configuration
          </button>
        </div>

        {evaluation && (
          <>
            <p id="garage-verdict" className="garage-screen__verdict" role="status">
              {recommended ? (
                <>
                  <strong>{recommended.result.label}</strong> is the cheapest configuration that passed this
                  simulation suite and fits the budget: {formatCad(recommended.result.cost_cad)}, leaving{' '}
                  {formatCad(recommended.remaining)} after commitments and reserve.
                </>
              ) : (
                <strong>No affordable configuration passed the selected suite.</strong>
              )}
            </p>
            <ResultsTable
              rows={rows}
              acceptance={evaluation.suite.acceptance}
              testCount={evaluation.suite.tests.length}
              filterOn={filterOn}
              onFilterChange={setFilterOn}
              selectedKey={selectedKey}
              recommendedKey={recommended?.result.key ?? null}
              onUse={garage.setSelection}
            />
            {selectedResult && !selectedResult.passed && (
              <details className="garage-screen__failures" open>
                <summary>
                  Why {selectedResult.label} did not pass ({selectedResult.failed_test_ids.length} tests)
                </summary>
                <ul>
                  {selectedResult.tests
                    .filter((t) => !t.passed)
                    .map((t) => (
                      <li key={t.test_id}>
                        {t.test_id}: {t.track_exit ? 'left the track' : `min clearance ${t.min_clearance_m.toFixed(2)} m`}
                        {!t.completed && !t.track_exit ? ', lap not completed' : ''}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </>
        )}

        <p className="garage-screen__scope">
          &ldquo;Passed this test suite&rdquo; means these simulated runs met the criteria above — not
          certification, and not a prediction of real crash risk or money saved. The vehicle is a toy model with
          a scripted driver; passing margins can be a few centimetres, so treat small differences between
          configurations as noise.
        </p>
      </section>
    </div>
  )
}
