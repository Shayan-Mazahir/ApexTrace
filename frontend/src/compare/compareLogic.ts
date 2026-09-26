import type { TestResult } from '../types/schemas'

// The most informative test to open first: one the baseline failed and the
// selected configuration passed; else any baseline failure; else the test the
// baseline handled with the least clearance.
export function pickDefaultTest(baseline: TestResult[], upgraded: TestResult[] | undefined): string | null {
  if (baseline.length === 0) return null
  const byClearance = (a: TestResult, b: TestResult) => a.min_clearance_m - b.min_clearance_m
  const upgradedById = new Map((upgraded ?? []).map((t) => [t.test_id, t]))

  const fixed = baseline.filter((t) => !t.passed && upgradedById.get(t.test_id)?.passed).sort(byClearance)
  if (fixed.length) return fixed[0].test_id
  const failed = baseline.filter((t) => !t.passed).sort(byClearance)
  if (failed.length) return failed[0].test_id
  return [...baseline].sort(byClearance)[0].test_id
}

export function describeOutcome(result: TestResult | undefined): string {
  if (!result) return '—'
  if (result.passed) return 'pass'
  return result.track_exit ? 'exit' : 'fail'
}
