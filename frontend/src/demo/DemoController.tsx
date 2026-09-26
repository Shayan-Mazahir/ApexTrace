import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../api/config'
import { useActiveSession } from '../app/ActiveSessionContext'
import { DEMO_TOTAL_SECONDS, useDemo } from '../app/DemoContext'
import { useGarage } from '../app/GarageContext'
import { useScreen } from '../app/ScreenContext'
import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import { useEngineerSession } from '../engineer/useEngineerSession'
import { classifyConfigs, recommend } from '../garage/budgetMath'
import { NO_UPGRADES, type UpgradeConfig } from '../types/schemas'
import { DEMO_STEPS, stepStart } from './steps'
import { preflightVerdict, runPreflight, type Check, type CheckStatus } from './preflight'
import './DemoController.css'

const BAR_HEIGHT = '116px'
const TONE: Record<CheckStatus, StatusTone> = { ok: 'success', warn: 'warning', fail: 'danger' }
const LABEL: Record<CheckStatus, string> = { ok: 'OK', warn: 'Check', fail: 'Failed' }
const SCENARIO_FOR = { monza: 'monza_high_speed_braking', baku: 'baku_stale_telemetry' } as const

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.json()
}

// Scripts the brief's three-minute experience: switches screens on a timer,
// auto-starts the drive, plays the hidden engineer (joins the driver's
// session and launches the saved scenario), picks the cheapest passing
// upgrade and reruns the suite. Everything it triggers is the real app.
export function DemoController() {
  const demo = useDemo()
  const garage = useGarage()
  const { setScreen } = useScreen()
  const { driverSession } = useActiveSession()
  const engineer = useEngineerSession()

  const [panelOpen, setPanelOpen] = useState(false)
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [checking, setChecking] = useState(false)

  const garageRef = useRef(garage)
  garageRef.current = garage
  const timers = useRef<number[]>([])
  const launched = useRef(false)

  const demoUpgrade = (): UpgradeConfig => {
    const g = garageRef.current
    if (!g.evaluation) return { ...NO_UPGRADES, local_fallback: true }
    return recommend(classifyConfigs(g.evaluation.configs, g.budget))?.result.upgrades ?? { ...NO_UPGRADES, local_fallback: true }
  }

  useEffect(() => {
    document.documentElement.style.setProperty('--demo-bar-height', demo.active ? BAR_HEIGHT : '0px')
  }, [demo.active])

  useEffect(() => {
    if (!demo.active) return
    const g = garageRef.current
    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
    setScreen(demo.step.screen)

    switch (demo.step.id) {
      case 'brief':
        g.setSelection(NO_UPGRADES)
        if (!g.evaluation && !g.evaluating) void g.evaluate()
        break
      case 'drive':
        launched.current = false
        break
      case 'inspect':
        g.setSelection(demoUpgrade())
        break
      case 'choose':
        g.setSelection(NO_UPGRADES)
        later(4000, () => garageRef.current.setSelection(demoUpgrade()))
        break
      case 'retest':
        void g.evaluate()
        later(18000, () => setScreen('compare'))
        break
      case 'decide':
        later(300, () => document.getElementById('garage-verdict')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        break
    }
    return () => {
      timers.current.forEach(window.clearTimeout)
      timers.current = []
    }
    // re-run only when the step changes or the demo starts/stops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.active, demo.step.id])

  // Evaluation may finish after 'inspect' began: pick the upgrade once it's there.
  useEffect(() => {
    if (demo.active && demo.step.id === 'inspect' && garage.evaluation) garage.setSelection(demoUpgrade())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garage.evaluation])

  // Hidden engineer for the drive step.
  useEffect(() => {
    if (!demo.active || demo.step.id !== 'drive' || !driverSession) return
    if (!engineer.joined && !engineer.joining) void engineer.join(driverSession.id)
  }, [demo.active, demo.step.id, driverSession, engineer])

  useEffect(() => {
    if (!demo.active || demo.step.id !== 'drive' || !driverSession || launched.current) return
    if (engineer.connection === 'connected') {
      launched.current = engineer.send({ type: 'launch_scenario', scenario_id: SCENARIO_FOR[driverSession.track] })
    }
  }, [demo.active, demo.step.id, driverSession, engineer, engineer.connection])

  useEffect(() => {
    if (!demo.active && engineer.joined) engineer.leave()
  }, [demo.active, engineer])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && demo.active) demo.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demo])

  const runChecks = async () => {
    setChecking(true)
    setChecks(
      await runPreflight({
        apiBase: API_BASE_URL,
        fetchJson,
        openSocket: (url) => new WebSocket(url),
        gamepads: () => Array.from(navigator.getGamepads?.() ?? []),
      }),
    )
    setChecking(false)
  }

  if (!demo.active) {
    return (
      <>
        <button type="button" className="demo-launch" onClick={() => setPanelOpen((o) => !o)}>
          Demo mode
        </button>
        {panelOpen && (
          <div className="demo-panel" role="dialog" aria-label="Three-minute demo">
            <h2>Three-minute demo</h2>
            <p>
              Brief → Drive → Inspect → Choose → Retest → Decide, on a timer. Press Esc to stop at any time.
              Run the checklist first on a fresh launch.
            </p>
            <div className="demo-panel__actions">
              <button type="button" onClick={runChecks} disabled={checking}>
                {checking ? 'Checking…' : 'Run fresh-launch checklist'}
              </button>
              <button
                type="button"
                className="demo-panel__go"
                onClick={() => {
                  setPanelOpen(false)
                  demo.start()
                }}
              >
                Start 3-minute demo
              </button>
              <button type="button" onClick={() => setPanelOpen(false)}>
                Close
              </button>
            </div>
            {checks && (
              <>
                <ul className="demo-panel__checks">
                  {checks.map((c) => (
                    <li key={c.id}>
                      <StatusBadge tone={TONE[c.status]} label={LABEL[c.status]} />
                      <span>
                        <strong>{c.label}</strong>
                        <small>{c.detail}</small>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="demo-panel__verdict">
                  {preflightVerdict(checks) === 'ok' && 'Ready.'}
                  {preflightVerdict(checks) === 'warn' && 'Ready, with warnings above.'}
                  {preflightVerdict(checks) === 'fail' && 'Not ready — fix the failed checks (start the backend, then re-run).'}
                </p>
              </>
            )}
          </div>
        )}
      </>
    )
  }

  const stepElapsed = demo.elapsed - stepStart(demo.stepIndex)
  return (
    <div className="demo-bar" role="region" aria-label="Demo progress">
      <div className="demo-bar__text">
        <strong>{demo.step.title}</strong>
        <span>{demo.step.caption}</span>
      </div>
      <div className="demo-bar__progress" aria-hidden="true">
        {DEMO_STEPS.map((s, i) => (
          <div key={s.id} className="demo-bar__segment" style={{ flexGrow: s.seconds }}>
            <div
              className="demo-bar__fill"
              style={{
                width: i < demo.stepIndex ? '100%' : i === demo.stepIndex ? `${(stepElapsed / s.seconds) * 100}%` : '0%',
              }}
            />
          </div>
        ))}
      </div>
      <div className="demo-bar__controls">
        <span>
          {Math.floor(demo.elapsed)} / {DEMO_TOTAL_SECONDS} s
        </span>
        <button type="button" onClick={demo.prev}>Back</button>
        <button type="button" onClick={demo.togglePause}>{demo.paused ? 'Resume' : 'Pause'}</button>
        <button type="button" onClick={demo.next}>Skip</button>
        <button type="button" onClick={demo.stop}>Stop (Esc)</button>
      </div>
    </div>
  )
}
