import type { Screen } from '../app/ScreenContext'

export type DemoAction = 'brief' | 'drive' | 'inspect' | 'choose' | 'retest' | 'decide'

export interface DemoStep {
  id: DemoAction
  title: string
  caption: string
  seconds: number
  screen: Screen
}

// The judge experience, in order. Durations follow the brief: 15 + 30 + 30
// + 30 + 45 + 30 = 180 s.
export const DEMO_STEPS: DemoStep[] = [
  {
    id: 'brief',
    title: '1 · Brief',
    caption: 'Four events left. Can you improve this car’s warning system without spending money already committed to the season?',
    seconds: 15,
    screen: 'garage',
  },
  {
    id: 'drive',
    title: '2 · Drive',
    caption: 'Drive with the wheel or keyboard. The engineer station launches a saved bounded stress scenario; the outcome is whatever really happens.',
    seconds: 30,
    screen: 'drive',
  },
  {
    id: 'inspect',
    title: '3 · Inspect',
    caption: 'Replay the run: fault onset, warning, braking and clearance. This is an automated scripted driver on a recorded failure, not the judge.',
    seconds: 30,
    screen: 'compare',
  },
  {
    id: 'choose',
    title: '4 · Choose',
    caption: 'Open the garage and pick an upgrade. Watch the available budget change as you choose.',
    seconds: 30,
    screen: 'garage',
  },
  {
    id: 'retest',
    title: '5 · Retest',
    caption: 'Every combination runs on the same saved suite. The same scripted controller responds to the warnings in both replays.',
    seconds: 45,
    screen: 'garage',
  },
  {
    id: 'decide',
    title: '6 · Decide',
    caption: 'The measured suite outcome, and the cash left after commitments, reserve and upgrade spending.',
    seconds: 30,
    screen: 'garage',
  },
]

export const DEMO_TOTAL_SECONDS = DEMO_STEPS.reduce((sum, s) => sum + s.seconds, 0)

export function stepStart(index: number): number {
  return DEMO_STEPS.slice(0, index).reduce((sum, s) => sum + s.seconds, 0)
}

export function locate(elapsed: number): { index: number; into: number; done: boolean } {
  let start = 0
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const end = start + DEMO_STEPS[i].seconds
    if (elapsed < end) return { index: i, into: elapsed - start, done: false }
    start = end
  }
  const last = DEMO_STEPS.length - 1
  return { index: last, into: DEMO_STEPS[last].seconds, done: true }
}
