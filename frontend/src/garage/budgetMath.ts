import type { ConfigResult, UpgradeConfig, UpgradeId, UpgradeSpec } from '../types/schemas'
import { UPGRADE_IDS } from '../types/schemas'

export const NO_AFFORDABLE_MESSAGE = 'No affordable configuration passed the selected suite.'

export interface BudgetInputs {
  cash: number
  commitments: number
  reserve: number
}

// available upgrade money = cash on hand - remaining committed event costs - chosen reserve
export function availableUpgradeMoney(budget: BudgetInputs): number {
  return budget.cash - budget.commitments - budget.reserve
}

export function selectedIds(config: UpgradeConfig): UpgradeId[] {
  return UPGRADE_IDS.filter((id) => config[id])
}

export function configCost(config: UpgradeConfig, specs: UpgradeSpec[]): number {
  return specs.filter((s) => config[s.id]).reduce((sum, s) => sum + s.price_cad, 0)
}

// Doing nothing is always allowed; spending must fit inside available money.
export function isAffordable(cost: number, available: number): boolean {
  return cost === 0 || cost <= available
}

// Whether the driver may add this upgrade to the current selection.
export function canAdd(id: UpgradeId, selection: UpgradeConfig, specs: UpgradeSpec[], available: number) {
  if (selection[id]) return true
  return isAffordable(configCost({ ...selection, [id]: true }, specs), available)
}

// Spendable money left after this upgrade spend (commitments and reserve stay untouched).
export function remainingAfter(budget: BudgetInputs, cost: number): number {
  return availableUpgradeMoney(budget) - cost
}

// Total cash left through the final event: cash minus commitments and upgrades
// (the reserve is still inside this number).
export function cashLeftThroughSeason(budget: BudgetInputs, cost: number): number {
  return budget.cash - budget.commitments - cost
}

export interface ConfigRow {
  result: ConfigResult
  affordable: boolean
  feasible: boolean // affordable AND passed this test suite
  remaining: number
}

export function classifyConfigs(configs: ConfigResult[], budget: BudgetInputs): ConfigRow[] {
  const available = availableUpgradeMoney(budget)
  return [...configs]
    .sort((a, b) => a.cost_cad - b.cost_cad)
    .map((result) => {
      const affordable = isAffordable(result.cost_cad, available)
      return {
        result,
        affordable,
        feasible: affordable && result.passed,
        remaining: available - result.cost_cad,
      }
    })
}

// Cheapest feasible configuration (ties keep the earlier, i.e. fewer upgrades).
export function recommend(rows: ConfigRow[]): ConfigRow | null {
  return rows.find((r) => r.feasible) ?? null
}

export const formatCad = (value: number): string =>
  `${value < 0 ? '-' : ''}CAD ${Math.abs(Math.round(value)).toLocaleString('en-CA')}`

// Same canonical key the backend uses for a combination.
export function configKey(config: UpgradeConfig): string {
  const ids = selectedIds(config)
  return ids.length ? ids.join('+') : 'baseline'
}
