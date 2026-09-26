import type { UpgradeSpec } from '../types/schemas'
import { formatCad } from './budgetMath'
import './UpgradeCard.css'

interface UpgradeCardProps {
  spec: UpgradeSpec
  selected: boolean
  blocked: boolean
  onToggle: () => void
}

export function UpgradeCard({ spec, selected, blocked, onToggle }: UpgradeCardProps) {
  const stateLabel = selected ? 'Selected' : blocked ? 'Exceeds available budget' : 'Not selected'
  return (
    <article className={`upgrade-card ${selected ? 'upgrade-card--selected' : ''} ${blocked ? 'upgrade-card--blocked' : ''}`}>
      <header>
        <h3>{spec.name}</h3>
        <strong className="upgrade-card__price">{formatCad(spec.price_cad)}</strong>
      </header>
      <dl>
        <dt>Changes</dt>
        <dd>{spec.parameter}</dd>
        <dt>Simulated effect</dt>
        <dd>{spec.change}</dd>
      </dl>
      <footer>
        <span className="upgrade-card__state">
          <span aria-hidden="true">{selected ? '●' : blocked ? '✕' : '○'}</span> {stateLabel}
        </span>
        <button type="button" onClick={onToggle} disabled={blocked} aria-pressed={selected}>
          {selected ? 'Remove' : 'Select'}
        </button>
      </footer>
    </article>
  )
}
