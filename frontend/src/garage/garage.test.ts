import { describe, expect, it } from 'vitest'
import type { ConfigResult, UpgradeSpec } from '../types/schemas'
import { NO_UPGRADES } from '../types/schemas'
import {
  availableUpgradeMoney,
  canAdd,
  cashLeftThroughSeason,
  classifyConfigs,
  configCost,
  isAffordable,
  recommend,
  remainingAfter,
} from './budgetMath'

const specs: UpgradeSpec[] = [
  { id: 'brake_servicing', name: 'Brake servicing', price_cad: 1500, parameter: '', change: '', params: {} },
  { id: 'comms_improvement', name: 'Communication improvement', price_cad: 2500, parameter: '', change: '', params: {} },
  { id: 'local_fallback', name: 'Local warning fallback', price_cad: 1000, parameter: '', change: '', params: {} },
]
const sample = { cash: 12000, commitments: 6000, reserve: 2000 }

describe('budget math', () => {
  it('reproduces the brief\'s sample: 12,000 - 6,000 - 2,000 = 4,000', () => {
    expect(availableUpgradeMoney(sample)).toBe(4000)
  })

  it('prices selections from the catalog', () => {
    expect(configCost(NO_UPGRADES, specs)).toBe(0)
    expect(configCost({ ...NO_UPGRADES, brake_servicing: true, local_fallback: true }, specs)).toBe(2500)
  })

  it('blocks purchases that exceed available money, but always allows doing nothing', () => {
    expect(isAffordable(4000, 4000)).toBe(true)
    expect(isAffordable(4001, 4000)).toBe(false)
    expect(isAffordable(0, -500)).toBe(true)
  })

  it('blocks adding an upgrade that would overspend, but never blocks removing one', () => {
    const withComms = { ...NO_UPGRADES, comms_improvement: true }
    expect(canAdd('brake_servicing', withComms, specs, 4000)).toBe(true) // 2500 + 1500 = 4000
    const withCommsAndBrakes = { ...withComms, brake_servicing: true }
    expect(canAdd('local_fallback', withCommsAndBrakes, specs, 4000)).toBe(false) // 5000 > 4000
    expect(canAdd('brake_servicing', withCommsAndBrakes, specs, 100)).toBe(true) // already selected
  })

  it('reports remaining money with and without the reserve', () => {
    expect(remainingAfter(sample, 1000)).toBe(3000)
    expect(cashLeftThroughSeason(sample, 1000)).toBe(5000) // reserve still inside
  })
})

const result = (key: string, cost: number, passed: boolean): ConfigResult => ({
  key,
  label: key,
  upgrades: NO_UPGRADES,
  cost_cad: cost,
  test_count: 36,
  track_exits: 0,
  min_clearance_m: 0.6,
  min_warning_margin_m: 10,
  unnecessary_warnings: 0,
  passed,
  failed_test_ids: passed ? [] : ['x'],
  tests: [],
})

describe('classifyConfigs / recommend', () => {
  const configs = [result('big', 5000, true), result('none', 0, false), result('cheap', 1000, true), result('mid', 2500, false)]

  it('sorts by cost and marks affordability and feasibility', () => {
    const rows = classifyConfigs(configs, sample)
    expect(rows.map((r) => r.result.key)).toEqual(['none', 'cheap', 'mid', 'big'])
    expect(rows.map((r) => r.affordable)).toEqual([true, true, true, false])
    expect(rows.map((r) => r.feasible)).toEqual([false, true, false, false])
    expect(rows[1].remaining).toBe(3000)
  })

  it('recommends the cheapest configuration that both passed and is affordable', () => {
    expect(recommend(classifyConfigs(configs, sample))?.result.key).toBe('cheap')
  })

  it('does not recommend an unaffordable pass', () => {
    const onlyBigPasses = [result('none', 0, false), result('big', 5000, true)]
    expect(recommend(classifyConfigs(onlyBigPasses, sample))).toBeNull()
  })

  it('returns null when nothing passes', () => {
    expect(recommend(classifyConfigs([result('a', 0, false), result('b', 1000, false)], sample))).toBeNull()
  })

  it('changes with the editable budget', () => {
    const rich = { cash: 20000, commitments: 6000, reserve: 2000 }
    expect(recommend(classifyConfigs([result('big', 5000, true)], rich))?.result.key).toBe('big')
  })
})

import { pickDefaultTest, describeOutcome } from '../compare/compareLogic'
import type { TestResult } from '../types/schemas'

const tr = (id: string, passed: boolean, clr: number): TestResult => ({
  test_id: id, scenario_id: id, track: 'monza', passed, track_exit: false, completed: true, exit_location: null,
  min_clearance_m: clr, warnings: 3, unnecessary_warnings: 0, min_warning_margin_m: 10, stale_time_s: 0,
  blackout_time_s: 0, fallback_first_t: null, packets_rejected_old: 0, barrier_contacts: 0, lap_time_s: 80,
  driver_ignored: 0,
})

describe('pickDefaultTest', () => {
  const base = [tr('a', true, 1.2), tr('b', false, 0.3), tr('c', false, 0.1)]
  it('prefers a test the baseline failed and the upgrade fixed', () => {
    expect(pickDefaultTest(base, [tr('a', true, 1), tr('b', true, 0.9), tr('c', false, 0.2)])).toBe('b')
  })
  it('falls back to the worst baseline failure', () => {
    expect(pickDefaultTest(base, [tr('a', true, 1), tr('b', false, 0.2), tr('c', false, 0.2)])).toBe('c')
    expect(pickDefaultTest(base, undefined)).toBe('c')
  })
  it('falls back to the tightest pass when nothing failed', () => {
    expect(pickDefaultTest([tr('a', true, 1.2), tr('b', true, 0.6)], undefined)).toBe('b')
  })
  it('handles no data', () => {
    expect(pickDefaultTest([], undefined)).toBeNull()
  })
  it('labels outcomes in words', () => {
    expect(describeOutcome(tr('a', true, 1))).toBe('pass')
    expect(describeOutcome(tr('a', false, 0))).toBe('fail')
    expect(describeOutcome({ ...tr('a', false, -1), track_exit: true })).toBe('exit')
  })
})
