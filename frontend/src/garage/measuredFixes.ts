import type { EvaluationResponse, SuiteGroup, UpgradeId } from '../types/schemas'

export interface MeasuredFix {
  fixed: string[] // scenarios the car without upgrades fails but this upgrade alone passes (every run)
  problems: number // scenarios the car without upgrades fails (that some combination can fix)
}

// What each upgrade ON ITS OWN actually changed in the tests, per scenario.
export function measuredFixes(evaluation: EvaluationResponse, group: SuiteGroup): Record<UpgradeId, MeasuredFix> | null {
  const base = group.configs.find((c) => c.key === 'baseline')
  if (!base) return null
  const names = new Map(evaluation.suite.tests.map((t) => [t.id, t]))
  const unsolved = new Set(group.unsolved_test_ids ?? [])
  const families = new Map<string, { name: string; ids: string[] }>()
  for (const id of group.test_ids) {
    const t = names.get(id)
    if (!t || unsolved.has(id)) continue
    const f = families.get(t.scenario_id) ?? { name: t.name, ids: [] }
    f.ids.push(id)
    families.set(t.scenario_id, f)
  }
  const allPass = (key: string, ids: string[]) => {
    const c = group.configs.find((x) => x.key === key)
    return !!c && ids.every((id) => c.tests.find((t) => t.test_id === id)?.passed)
  }
  const problems = [...families.values()].filter((f) => !allPass('baseline', f.ids))
  const out = {} as Record<UpgradeId, MeasuredFix>
  for (const id of ['brake_servicing', 'comms_improvement', 'local_fallback'] as UpgradeId[]) {
    out[id] = { fixed: problems.filter((f) => allPass(id, f.ids)).map((f) => f.name), problems: problems.length }
  }
  return out
}
