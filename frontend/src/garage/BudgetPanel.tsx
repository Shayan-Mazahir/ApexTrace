import { availableUpgradeMoney, formatCad, type BudgetInputs } from './budgetMath'
import './BudgetPanel.css'

interface BudgetPanelProps {
  budget: BudgetInputs
  onChange: (budget: BudgetInputs) => void
}

const FIELDS: { key: keyof BudgetInputs; label: string; hint: string }[] = [
  { key: 'cash', label: 'Cash in the bank', hint: '' },
  { key: 'commitments', label: 'Already owed (4 races left)', hint: '' },
  { key: 'reserve', label: 'Emergency reserve', hint: '' },
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
            {hint && <small>{hint}</small>}
          </label>
        ))}
      </div>
      <div className="budget-panel__available" aria-live="polite">
        <span className="budget-panel__available-label">You can spend</span>
        <strong className={available < 0 ? 'budget-panel__negative' : ''}>{formatCad(available)}</strong>
        <small>
          bank − owed − reserve{available < 0 ? ' · short of money: nothing can be bought' : ''}
        </small>
      </div>
    </section>
  )
}
