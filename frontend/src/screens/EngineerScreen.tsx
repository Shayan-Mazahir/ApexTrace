import { Canvas } from '@react-three/fiber'
import { useEffect, useState, type ReactNode } from 'react'
import { getFaultCatalog, listScenarios } from '../api/session'
import { useActiveSession } from '../app/ActiveSessionContext'
import { useScreen } from '../app/ScreenContext'
import { useErrorContext } from '../app/ErrorContext'
import { SimulatedFaultLabel } from '../components/SimulatedFaultLabel'
import { ActiveFaults } from '../engineer/ActiveFaults'
import { EventLog } from '../engineer/EventLog'
import { FaultBuilder } from '../engineer/FaultBuilder'
import { FaultTimeline } from '../engineer/FaultTimeline'
import { LinkIndicators } from '../engineer/LinkIndicators'
import { RunInfo } from '../engineer/RunInfo'
import { ScenarioPanel } from '../engineer/ScenarioPanel'
import { TcnPanel } from '../engineer/TcnPanel'
import { useEngineerSession } from '../engineer/useEngineerSession'
import { Scene } from '../scene/Scene'
import type { FaultType, StressScenario } from '../types/schemas'
import './EngineerScreen.css'
import { useGraphicsMode } from '../app/graphics'

function Section({ title, children, tone }: { title: string; children: ReactNode; tone?: string }) {
  return (
    <section className={`engineer-screen__section ${tone ? `eng-tone--${tone}` : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

let lastMode: 'scenario' | 'fault' = 'scenario'
let lastJoinedId: string | null = null

export function EngineerScreen() {
  const lowGraphics = useGraphicsMode() === 'performance'
  const { driverSession } = useActiveSession()
  const { reportError } = useErrorContext()
  const engineer = useEngineerSession()
  const { send } = engineer
  const { setScreen } = useScreen()
  const [mode, setModeState] = useState<'scenario' | 'fault'>(lastMode)
  const setMode = (m: 'scenario' | 'fault') => {
    lastMode = m
    setModeState(m)
  }

  const [sessionIdInput, setSessionIdInput] = useState(driverSession?.id ?? '')
  const [scenarios, setScenarios] = useState<StressScenario[]>([])
  const [catalog, setCatalog] = useState<FaultType[]>([])

  // Coming back from another tab: the driver's session (and whatever is armed on
  // it) still lives on the server, so rejoin it instead of asking for the code again.
  const { join: rejoin, joined } = engineer
  useEffect(() => {
    const id = driverSession?.id ?? lastJoinedId
    if (!joined && id) void rejoin(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    listScenarios()
      .then(setScenarios)
      .catch((err) => reportError(err instanceof Error ? err.message : 'Failed to load scenarios'))
    getFaultCatalog()
      .then(setCatalog)
      .catch((err) => reportError(err instanceof Error ? err.message : 'Failed to load fault catalog'))
  }, [reportError])

  useEffect(() => {
    lastJoinedId = joined?.id ?? lastJoinedId
  }, [joined])

  const connected = engineer.connection === 'connected'
  const v = engineer.vehicleState
  const w = engineer.warning

  return (
    <div className="engineer-screen">
      <div className="engineer-screen__view">
        <Canvas shadows={lowGraphics ? false : 'percentage'} camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 8000 }} dpr={lowGraphics ? 1 : [1, 2]}>
          <Scene
            effects={!lowGraphics}
            trackProfile={engineer.trackProfile}
            vehicleState={v ? { x: v.x, y: v.y, heading: v.heading, speed: v.speed, drsOpen: v.drs_open, t: v.t } : null}
            trail={engineer.trail}
            previousLapTrail={engineer.previousLapTrail}
          />
        </Canvas>
      </div>

      <aside className="engineer-screen__panel">
        <Section title="Engineer station" tone="orange">
          <form
            className="engineer-screen__join"
            onSubmit={(e) => {
              e.preventDefault()
              void engineer.join(sessionIdInput)
            }}
          >
            <input
              value={sessionIdInput}
              placeholder="Engineer code from the driver screen"
              onChange={(e) => setSessionIdInput(e.target.value)}
              disabled={engineer.joined !== null}
              aria-label="Session ID"
            />
            {engineer.joined ? (
              <button type="button" onClick={() => { lastJoinedId = null; engineer.leave() }}>
                Leave
              </button>
            ) : (
              <button type="submit" disabled={engineer.joining || !sessionIdInput.trim()}>
                Join
              </button>
            )}
          </form>
          <p className={`eng-status ${connected ? 'is-live' : ''}`}>
            <i />
            {connected ? `Connected to ${engineer.joined?.id}` : engineer.joined ? 'Connecting…' : 'Not joined: enter the code from the Drive screen'}
            {connected && (engineer.sessionInfo?.driver_connected ? ' · driver on track' : ' · driver not driving')}
            {w.active && <b className="eng-status__brake"> · driver sees BRAKE</b>}
            {w.stale && <b className="eng-status__stale"> · driver sees STALE</b>}
          </p>
          <SimulatedFaultLabel delayMs={v?.injected_delay_ms ?? 0} />
        </Section>

        <Section title="1 · Pick what to break" tone="blue">
          <div className="engineer-screen__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'scenario'} className={mode === 'scenario' ? 'on' : ''} onClick={() => setMode('scenario')}>
              Saved scenario
            </button>
            <button type="button" role="tab" aria-selected={mode === 'fault'} className={mode === 'fault' ? 'on' : ''} onClick={() => setMode('fault')}>
              Single fault
            </button>
          </div>
          {/* both stay mounted so switching tabs keeps what you picked in each */}
          <div hidden={mode !== 'scenario'}>
            <ScenarioPanel
              scenarios={scenarios}
              profile={engineer.trackProfile}
              activeScenarioId={engineer.sessionInfo?.scenario_id ?? null}
              disabled={!connected}
              onArm={(id, overrides) => send({ type: 'arm_scenario', scenario_id: id, overrides })}
              onArmAndDrive={(id, overrides) => {
                send({ type: 'arm_scenario', scenario_id: id, overrides })
                setScreen('drive')
              }}
              onCancel={() => send({ type: 'cancel_scenario' })}
              onReset={() => send({ type: 'reset' })}
            />
          </div>
          <div hidden={mode !== 'fault'}>
            <FaultBuilder catalog={catalog} profile={engineer.trackProfile} disabled={!connected}
              onAdd={(fault) => send({ type: 'add_fault', fault })} />
          </div>
        </Section>

        <Section title="2 · Live faults" tone="red">
          <ActiveFaults
            faults={engineer.faultState?.faults ?? []}
            disabled={!connected}
            onCancel={(id) => send({ type: 'cancel_fault', fault_id: id })}
          />
          <FaultTimeline profile={engineer.trackProfile} events={engineer.faultEvents} carDistance={v?.distance_along_lap ?? 0} />
          <div className="engineer-screen__actions">
            <button type="button" disabled={!connected} onClick={() => send({ type: 'reset' })}>Reset run</button>
            <button type="button" disabled={!connected} onClick={() => send({ type: 'pause' })}>Pause</button>
            <button type="button" disabled={!connected} onClick={() => send({ type: 'resume' })}>Resume</button>
          </div>
        </Section>

        <Section title="3 · Event log" tone="green">
          <EventLog entries={engineer.eventLog} />
        </Section>

        <details className="engineer-screen__more">
          <summary>Connection, run details and AI risk model</summary>
          <Section title="Link">
            <LinkIndicators connection={engineer.connection} vehicleState={v} lastMessageAt={engineer.lastMessageAt}
              driverOffline={engineer.sessionInfo?.driver_connected === false} />
          </Section>
          <Section title="Run">
            <RunInfo info={engineer.sessionInfo} />
          </Section>
          <Section title="TCN risk observer (AI)">
            <p className="engineer-screen__key">
              A small neural network that watches only what the car reports (speed, inputs, warning state) and predicts, one
              second ahead, the chance the car leaves the track and how close to the edge it will get. It only observes: it
              never triggers warnings. &quot;Actual clearance&quot; is the ground truth from the simulator, for comparison.
            </p>
            <TcnPanel status={engineer.sessionInfo?.tcn ?? null} vehicleState={v} />
          </Section>
        </details>
      </aside>
    </div>
  )
}
