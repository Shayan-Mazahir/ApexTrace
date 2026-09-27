import { useState } from 'react'
import { useGarage } from '../app/GarageContext'
import { useScreen } from '../app/ScreenContext'
import { LoadingIndicator } from '../components/LoadingIndicator'
import { BudgetPanel } from '../garage/BudgetPanel'
import { canAdd, classifyConfigs, configKey, formatCad, recommend, remainingAfter, selectedIds } from '../garage/budgetMath'
import { GarageCar } from '../garage/GarageCar'
import { PairedPanel } from '../garage/PairedPanel'
import { ResultsTable } from '../garage/ResultsTable'
import { ScenarioGrid } from '../garage/ScenarioGrid'
import { measuredFixes } from '../garage/measuredFixes'
import { UpgradeCard } from '../garage/UpgradeCard'
import { UPGRADE_IDS } from '../types/schemas'
import './GarageScreen.css'

const GROUP_LABEL: Record<string, string> = {
  full: 'Everything',
  telemetry: 'Data & warnings',
  sensors: 'Sensors',
  grip_brakes: 'Grip & brakes',
}

function Step({ n, title, children, note }: { n: number; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="gstep">
      <header className="gstep__head">
        <span className="gstep__n">{n}</span>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </header>
      {children}
    </section>
  )
}

export function GarageScreen() {
  const garage = useGarage()
  const { setScreen } = useScreen()
  const [filterOn, setFilterOn] = useState(true)

  const { catalog, budget, selection, evaluation, available, selectedCost } = garage
  const specs = catalog?.upgrades ?? []
  const group = evaluation?.groups[garage.suiteGroup] ?? null
  const rows = group ? classifyConfigs(group.configs, budget) : []
  const recommended = recommend(rows)
  const selectedKey = configKey(selection)
  const selectedResult = group?.configs.find((c) => c.key === selectedKey)
  const anySelected = selectedIds(selection).length > 0
  const unsolved = group?.unsolved_test_ids ?? []
  const unsolvedFamilies = evaluation
    ? [...new Set(unsolved.map((id) => evaluation.suite.tests.find((t) => t.id === id)?.name ?? id))]
    : []
  const baseline = group?.configs.find((c) => c.key === 'baseline')
  const measured = evaluation && group ? measuredFixes(evaluation, group) : null
  const nothingToBuy = recommended?.result.key === 'baseline' && (baseline?.passed_solvable ?? baseline?.passed)

  return (
    <div className="garage-screen">
      <header className="garage-screen__header">
        <h1>Garage</h1>
        <p>Pick the cheapest upgrade that keeps the car on track in the stress tests, without touching money you need for the season.</p>
      </header>

      <Step n={1} title="Your budget" note="Made-up numbers for a fictional team. Edit them.">
        <BudgetPanel budget={budget} onChange={garage.setBudget} />
      </Step>

      <Step n={2} title="Upgrades for the warning system">
        <div className="garage-screen__main">
          <div className="garage-screen__cards">
            {!catalog && <LoadingIndicator label="Loading upgrades" />}
            {UPGRADE_IDS.map((id) => {
              const spec = specs.find((s) => s.id === id)
              if (!spec) return null
              return (
                <UpgradeCard key={id} spec={spec} selected={selection[id]} blocked={!canAdd(id, selection, specs, available)}
                  onToggle={() => garage.toggleUpgrade(id)} measured={measured?.[id] ?? null} groupLabel={group?.label} />
              )
            })}
          </div>
          <div className="garage-screen__car" aria-label="Car with selected upgrades highlighted">
            <GarageCar selection={selection} />
          </div>
        </div>
        <section className="garage-screen__summary" aria-live="polite">
          <div>
            <span>Your car</span>
            <strong>{anySelected ? selectedResult?.label ?? selectedIds(selection).join(' + ') : 'No upgrades'}</strong>
          </div>
          <div>
            <span>Cost</span>
            <strong>{formatCad(selectedCost)}</strong>
          </div>
          <div>
            <span>Left to spend</span>
            <strong className="garage-screen__orange">{formatCad(remainingAfter(budget, selectedCost))}</strong>
          </div>
        </section>
      </Step>

      <Step n={3} title="Test every combination" note="Every mix of upgrades (8 in total) drives the same stress scenarios with the same seeds.">
        <div className="garage-screen__actions">
          <button type="button" className="garage-screen__primary" onClick={garage.evaluate} disabled={garage.evaluating}>
            {evaluation ? 'Run the tests again' : 'Run the tests'}
          </button>
          {garage.evaluating && <LoadingIndicator label="Driving every combination through every scenario" />}
        </div>
      </Step>

      {evaluation && group && (
        <Step n={4} title="Results">
          <div className="garage-screen__suites" role="tablist" aria-label="Which scenarios to judge on">
            {Object.entries(evaluation.groups).map(([id, g]) => (
              <button key={id} type="button" role="tab" aria-selected={garage.suiteGroup === id}
                className={garage.suiteGroup === id ? 'garage-screen__suite--on' : ''} onClick={() => garage.setSuiteGroup(id)}>
                {GROUP_LABEL[id] ?? g.label}
              </button>
            ))}
          </div>

          <div id="garage-verdict" className={`garage-verdict ${recommended ? 'is-good' : 'is-bad'}`} role="status">
            {nothingToBuy ? (
              <p><b>Nothing to buy for these scenarios.</b> The car without upgrades already passes everything an upgrade could change.</p>
            ) : recommended ? (
              <>
                <p>
                  <b>Buy: {recommended.result.label}</b> for {formatCad(recommended.result.cost_cad)}. It&apos;s the cheapest mix that
                  keeps the car safe in every scenario an upgrade can fix. You&apos;d have {formatCad(recommended.remaining)} left.
                </p>
                {selectedKey !== recommended.result.key && (
                  <button type="button" className="garage-screen__primary" onClick={() => garage.setSelection(recommended.result.upgrades)}>Select it</button>
                )}
              </>
            ) : (
              <p><b>No affordable configuration passed the selected test suite.</b> Raise the budget or judge on a different group of scenarios.</p>
            )}
            {unsolvedFamilies.length > 0 && (
              <p className="garage-verdict__limits">
                No upgrade on sale fixes: {unsolvedFamilies.join(', ')}. These fail with every combination: they need a
                different kind of fix (a second, independent sensor, or a better grip estimate), not one of these upgrades.
              </p>
            )}
          </div>

          <ScenarioGrid evaluation={evaluation} group={group} available={available} selectedKey={selectedKey}
            recommendedKey={recommended?.result.key ?? null} onPick={(c) => garage.setSelection(c.upgrades)} />

          <div className="garage-screen__actions">
            <button type="button" onClick={() => setScreen('compare')} disabled={!anySelected}>
              Watch a replay: no upgrades vs your car
            </button>
            <button type="button" onClick={() => setScreen('drive')} disabled={!anySelected}>
              Drive your car
            </button>
          </div>

          <details className="garage-screen__details">
            <summary>Details: full numbers, controlled comparison, fine print</summary>
            <p className="garage-screen__suite-note">
              Held-out suite ({evaluation.suite.version}), never used for tuning. A run passes with no crash, the lap completed, and the
              car&apos;s centre never closer than {evaluation.suite.acceptance.min_clearance_m} m to the edge.
            </p>
            <ResultsTable rows={rows} acceptance={evaluation.suite.acceptance} testCount={group.test_ids.length} filterOn={filterOn}
              onFilterChange={setFilterOn} selectedKey={selectedKey} recommendedKey={recommended?.result.key ?? null} onUse={garage.setSelection} />
            <h3 className="garage-screen__h2">Controlled comparison</h3>
            <PairedPanel upgrade={selection} />
            <p className="garage-screen__scope">
              &ldquo;Passed&rdquo; means these simulated runs met the criteria, not certification or a real-world crash prediction. Toy
              vehicle model and a scripted driver: treat small differences as noise.
            </p>
          </details>
        </Step>
      )}
    </div>
  )
}
