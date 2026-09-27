import { Canvas } from '@react-three/fiber'
import { useEffect, useState, type ReactNode } from 'react'
import { getFaultCatalog, listScenarios } from '../api/session'
import { useActiveSession } from '../app/ActiveSessionContext'
import { useScreen } from '../app/ScreenContext'
import { useErrorContext } from '../app/ErrorContext'
import { SimulatedFaultLabel } from '../components/SimulatedFaultLabel'
import { StatusBadge } from '../components/StatusBadge'
import { ActiveFaults } from '../engineer/ActiveFaults'
import { EventLog } from '../engineer/EventLog'
import { FaultBuilder } from '../engineer/FaultBuilder'
import { FaultTimeline } from '../engineer/FaultTimeline'
import { LinkIndicators } from '../engineer/LinkIndicators'
import { RunInfo } from '../engineer/RunInfo'
import { ScenarioPanel } from '../engineer/ScenarioPanel'
import { TcnPanel } from '../engineer/TcnPanel'
import { HelpNote } from '../components/HelpNote'
import { useEngineerSession } from '../engineer/useEngineerSession'
import { Scene } from '../scene/Scene'
import type { FaultType, StressScenario } from '../types/schemas'
import './EngineerScreen.css'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="engineer-screen__section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function EngineerScreen() {
  const { driverSession } = useActiveSession()
  const { reportError } = useErrorContext()
  const engineer = useEngineerSession()
  const { send } = engineer
  const { setScreen } = useScreen()
  const [mode, setMode] = useState<'scenario' | 'fault'>('scenario')

  const [sessionIdInput, setSessionIdInput] = useState(driverSession?.id ?? '')
  const [scenarios, setScenarios] = useState<StressScenario[]>([])
  const [catalog, setCatalog] = useState<FaultType[]>([])

  // Coming back from another tab: the driver's session (and whatever is armed on
  // it) still lives on the server, so rejoin it instead of asking for the code again.
  const { join: rejoin, joined } = engineer
  useEffect(() => {
    if (!joined && driverSession) void rejoin(driverSession.id)
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

  const connected = engineer.connection === 'connected'
  const v = engineer.vehicleState
  const w = engineer.warning

  return (
    <div className="engineer-screen">
      <div className="engineer-screen__view">
        <Canvas camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 8000 }}>
          <Scene
            trackProfile={engineer.trackProfile}
            vehicleState={v ? { x: v.x, y: v.y, heading: v.heading, speed: v.speed, drsOpen: v.drs_open, t: v.t } : null}
            trail={engineer.trail}
            previousLapTrail={engineer.previousLapTrail}
          />
        </Canvas>
      </div>

      <aside className="engineer-screen__panel">
        <Section title="Engineer station">
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
              <button type="button" onClick={engineer.leave}>
                Leave
              </button>
            ) : (
              <button type="submit" disabled={engineer.joining || !sessionIdInput.trim()}>
                Join
              </button>
            )}
          </form>
          <div className="engineer-screen__warning">
            <StatusBadge
              tone={connected ? 'success' : engineer.joined ? 'warning' : 'neutral'}
              label={connected ? 'Connected' : engineer.joined ? 'Connecting…' : 'Not joined'}
            />
            {engineer.joined && <StatusBadge tone="neutral" label={`Session ${engineer.joined.id}`} />}
            {engineer.joined && (
              <StatusBadge tone={engineer.sessionInfo?.driver_connected ? 'success' : 'warning'}
                label={engineer.sessionInfo?.driver_connected ? 'Driver online' : 'Driver offline'} />
            )}
          </div>
          <SimulatedFaultLabel delayMs={v?.injected_delay_ms ?? 0} />
          <div className="engineer-screen__warning">
            {w.active && <StatusBadge tone="danger" label={`Driver sees BRAKE — ${w.hazardZone} (${w.source})`} />}
            {w.stale && <StatusBadge tone="warning" label={`Driver sees STALE — ${w.reason ?? ''}`} />}
            {!w.active && !w.stale && <StatusBadge tone="neutral" label="Driver sees: clear" />}
          </div>
        </Section>

        <Section title="1 · What do you want to break?">
          <HelpNote title="How this screen works (30 seconds)" open={false}>
            <p>
              You are the pit-wall <b>engineer</b>. The driver drives on the <b>Drive</b> tab. You inject failures and see whether the
              car&apos;s brake-warning system still keeps the car on track.
            </p>
            <ol>
              <li><b>Scenario</b> = a saved bundle of faults with a short story (recommended).</li>
              <li><b>Single fault</b> = build one fault yourself (what breaks, how much, when).</li>
              <li>Press <b>Arm &amp; go drive</b>. The lap restarts, you land on the Drive tab, and the fault switches on when you reach its trigger zone. Nothing else changes.</li>
              <li>Come back here to see the fault turn <i>waiting</i>, <i>active</i>, <i>completed</i>, and watch the event log.</li>
            </ol>
            <p>Want to watch live? Open a second browser tab on <b>/#engineer</b> and join with the code shown on the Drive screen.</p>
          </HelpNote>
          <div className="engineer-screen__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'scenario'} className={mode === 'scenario' ? 'on' : ''} onClick={() => setMode('scenario')}>
              Saved scenario
            </button>
            <button type="button" role="tab" aria-selected={mode === 'fault'} className={mode === 'fault' ? 'on' : ''} onClick={() => setMode('fault')}>
              Single fault
            </button>
          </div>
          {mode === 'scenario' ? (
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
          ) : (
            <FaultBuilder catalog={catalog} profile={engineer.trackProfile} disabled={!connected}
              onAdd={(fault) => send({ type: 'add_fault', fault })} />
          )}
        </Section>

        <Section title="2 · What is happening now">
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

        <Section title="3 · Evidence (what actually happened)">
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
