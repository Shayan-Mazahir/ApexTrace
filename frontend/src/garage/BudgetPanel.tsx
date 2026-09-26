import { availableUpgradeMoney, formatCad, type BudgetInputs } from './budgetMath'
import './BudgetPanel.css'

interface BudgetPanelProps {
  budget: BudgetInputs
  onChange: (budget: BudgetInputs) => void
}

const FIELDS: { key: keyof BudgetInputs; label: string; hint: string }[] = [
  { key: 'cash', label: 'Cash on hand', hint: 'editable demo assumption' },
  { key: 'commitments', label: 'Remaining event commitments', hint: 'four events left' },
  { key: 'reserve', label: 'Chosen reserve', hint: 'kept untouched' },
]

export function BudgetPanel({ budget, onChange }: BudgetPanelProps) {
  const available = availableUpgradeMoney(budget)
  return (
    <section className="budget-panel">
      <div className="budget-panel__inputs">
        {FIELDS.map(({ key, label, hint }) => (
          <label key={key} className="budget-panel__field">
            <span>{label}</span>
            <div className="budget-panel__input">
              <span aria-hidden="true">CAD</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={100}
                value={Number.isFinite(budget[key]) ? budget[key] : 0}
                onChange={(e) => onChange({ ...budget, [key]: Number(e.target.value) || 0 })}
              />
            </div>
            <small>{hint}</small>
          </label>
        ))}
      </div>
      <div className="budget-panel__available" aria-live="polite">
        <span className="budget-panel__available-label">Available for upgrades</span>
        <strong className={available < 0 ? 'budget-panel__negative' : ''}>{formatCad(available)}</strong>
        <small>
          {formatCad(budget.cash)} − {formatCad(budget.commitments)} commitments − {formatCad(budget.reserve)}{' '}
          reserve{available < 0 ? ' · shortfall: no purchase possible' : ''}
        </small>
      </div>
    </section>
  )
}
