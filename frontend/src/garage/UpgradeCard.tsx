import type { UpgradeSpec } from '../types/schemas'
import type { MeasuredFix } from './measuredFixes'
import { formatCad } from './budgetMath'
import { UPGRADE_COPY } from './upgradeCopy'
import './UpgradeCard.css'

interface UpgradeCardProps {
  spec: UpgradeSpec
  selected: boolean
  blocked: boolean
  onToggle: () => void
  measured?: MeasuredFix | null
}

export function UpgradeCard({ spec, selected, blocked, onToggle, measured }: UpgradeCardProps) {
  const copy = UPGRADE_COPY[spec.id]
  return (
    <article className={`upgrade-card ${selected ? 'upgrade-card--selected' : ''} ${blocked ? 'upgrade-card--blocked' : ''}`}>
      <header>
        <h3>{spec.name}</h3>
        <strong className="upgrade-card__price">{formatCad(spec.price_cad)}</strong>
      </header>
      <p className="upgrade-card__line upgrade-card__line--yes">
        <b>Fixes</b> {copy?.fixes ?? spec.change}
      </p>
      <p className="upgrade-card__line upgrade-card__line--no">
        <b>Won&apos;t fix</b> {copy?.not ?? ''}
      </p>
      {measured && (
        <div className={`upgrade-card__measured ${measured.fixed.length ? '' : 'is-zero'}`}>
          <b>Tested on its own: fixes {measured.fixed.length} of {measured.problems} problem scenarios</b>
          {measured.fixed.length > 0 && <span>{measured.fixed.join(' · ')}</span>}
        </div>
      )}
      <small className="upgrade-card__exact" title="Exact change in the simulator">{spec.change}</small>
      <footer>
        <span className="upgrade-card__state">{selected ? 'In your car' : blocked ? 'Over budget' : ''}</span>
        <button type="button" onClick={onToggle} disabled={blocked} aria-pressed={selected}>
          {selected ? 'Remove' : 'Select'}
        </button>
      </footer>
    </article>
  )
}
