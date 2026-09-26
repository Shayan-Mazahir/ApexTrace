import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getUpgradeCatalog, runEvaluation } from '../api/evaluation'
import { useErrorContext } from './ErrorContext'
import { NO_UPGRADES, type EvaluationResponse, type UpgradeCatalog, type UpgradeConfig, type UpgradeId } from '../types/schemas'
import { availableUpgradeMoney, canAdd, configCost, type BudgetInputs } from '../garage/budgetMath'

interface GarageContextValue {
  catalog: UpgradeCatalog | null
  budget: BudgetInputs
  setBudget: (budget: BudgetInputs) => void
  selection: UpgradeConfig
  toggleUpgrade: (id: UpgradeId) => void
  setSelection: (selection: UpgradeConfig) => void
  evaluation: EvaluationResponse | null
  evaluating: boolean
  evaluate: () => Promise<void>
  available: number
  selectedCost: number
  suiteGroup: string
  setSuiteGroup: (group: string) => void
}

const GarageContext = createContext<GarageContextValue | null>(null)

const FALLBACK_BUDGET: BudgetInputs = { cash: 12000, commitments: 6000, reserve: 2000 }

// Garage state lives above the screens so the Compare screen, the Drive
// screen (drive-the-upgraded-car) and demo mode all see the same selection,
// budget and evaluation results.
export function GarageProvider({ children }: { children: ReactNode }) {
  const { reportError } = useErrorContext()
  const [catalog, setCatalog] = useState<UpgradeCatalog | null>(null)
  const [budget, setBudget] = useState<BudgetInputs>(FALLBACK_BUDGET)
  const [selection, setSelection] = useState<UpgradeConfig>(NO_UPGRADES)
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [suiteGroup, setSuiteGroup] = useState('telemetry')

  useEffect(() => {
    getUpgradeCatalog()
      .then((c) => {
        setCatalog(c)
        setBudget({
          cash: c.budget_defaults.cash_on_hand,
          commitments: c.budget_defaults.remaining_commitments,
          reserve: c.budget_defaults.reserve,
        })
      })
      .catch((err) => reportError(err instanceof Error ? err.message : 'Failed to load upgrades'))
  }, [reportError])

  const available = availableUpgradeMoney(budget)
  const specs = catalog?.upgrades ?? []

  const toggleUpgrade = useCallback(
    (id: UpgradeId) => {
      setSelection((prev) => (canAdd(id, prev, specs, available) ? { ...prev, [id]: !prev[id] } : prev))
    },
    [specs, available],
  )

  const evaluate = useCallback(async () => {
    setEvaluating(true)
    try {
      setEvaluation(await runEvaluation())
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Evaluation failed')
    } finally {
      setEvaluating(false)
    }
  }, [reportError])

  return (
    <GarageContext.Provider
      value={{
        catalog,
        budget,
        setBudget,
        selection,
        toggleUpgrade,
        setSelection,
        evaluation,
        evaluating,
        evaluate,
        available,
        selectedCost: configCost(selection, specs),
        suiteGroup,
        setSuiteGroup,
      }}
    >
      {children}
    </GarageContext.Provider>
  )
}

export function useGarage() {
  const ctx = useContext(GarageContext)
  if (!ctx) throw new Error('useGarage must be used within GarageProvider')
  return ctx
}
