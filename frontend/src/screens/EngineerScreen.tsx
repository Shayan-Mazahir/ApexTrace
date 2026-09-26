import { Canvas } from '@react-three/fiber'
import { useEffect, useState, type ReactNode } from 'react'
import { getFaultCatalog, listScenarios } from '../api/session'
import { useActiveSession } from '../app/ActiveSessionContext'
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

  const [sessionIdInput, setSessionIdInput] = useState(driverSession?.id ?? '')
  const [scenarios, setScenarios] = useState<StressScenario[]>([])
  const [catalog, setCatalog] = useState<FaultType[]>([])

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
            vehicleState={v ? { x: v.x, y: v.y, heading: v.heading, speed: v.speed, drsOpen: v.drs_open } : null}
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
          <SimulatedFaultLabel delayMs={v?.injected_delay_ms ?? 0} />
          <div className="engineer-screen__warning">
            {w.active && <StatusBadge tone="danger" label={`Driver sees BRAKE — ${w.hazardZone} (${w.source})`} />}
            {w.stale && <StatusBadge tone="warning" label={`Driver sees STALE — ${w.reason ?? ''}`} />}
            {!w.active && !w.stale && <StatusBadge tone="neutral" label="Driver sees: clear" />}
          </div>
        </Section>

        <Section title="Link">
          <LinkIndicators connection={engineer.connection} vehicleState={v} lastMessageAt={engineer.lastMessageAt} />
        </Section>

        <Section title="Run">
          <RunInfo info={engineer.sessionInfo} />
          <div className="engineer-screen__actions">
            <button type="button" disabled={!connected} onClick={() => send({ type: 'pause' })}>
              Pause
            </button>
            <button type="button" disabled={!connected} onClick={() => send({ type: 'resume' })}>
              Resume
            </button>
          </div>
        </Section>

        <Section title="Stress scenario">
          <HelpNote title="What is this screen? Read this first" open>
            <p>
              You are the <b>engineer</b> at the pit wall. A driver is driving the car on the <b>Drive</b> tab (same session code).
              Here you break things on purpose and watch whether the car&apos;s <b>brake warning system</b> still keeps it on the track.
            </p>
            <ol>
              <li><b>Nothing runs automatically.</b> The car drives normally until you arm a scenario or add a fault.</li>
              <li><b>Scenario</b> (first dropdown) = a ready-made bundle of faults, e.g. &quot;wet braking zone&quot;. Pick one and press <b>Arm scenario</b>: the driver&apos;s lap restarts from the scenario start and the faults switch on by themselves when the car reaches their trigger zone.</li>
              <li><b>Add a fault</b> (second dropdown) = one single fault you build by hand (what breaks, how much, and where/when it starts). Use it to experiment on top of, or instead of, a scenario.</li>
              <li>Watch <b>Faults (actual state)</b>: each fault goes waiting, active, then completed. <b>Reset experiment</b> puts everything back to the start.</li>
            </ol>
          </HelpNote>
          <ScenarioPanel
            scenarios={scenarios}
            profile={engineer.trackProfile}
            activeScenarioId={engineer.sessionInfo?.scenario_id ?? null}
            disabled={!connected}
            onArm={(id, overrides) => send({ type: 'arm_scenario', scenario_id: id, overrides })}
            onCancel={() => send({ type: 'cancel_scenario' })}
            onReset={() => send({ type: 'reset' })}
          />
        </Section>

        <Section title="Faults (actual state)">
          <ActiveFaults
            faults={engineer.faultState?.faults ?? []}
            disabled={!connected}
            onCancel={(id) => send({ type: 'cancel_fault', fault_id: id })}
          />
        </Section>

        <Section title="Add a fault">
          <FaultBuilder catalog={catalog} profile={engineer.trackProfile} disabled={!connected}
            onAdd={(fault) => send({ type: 'add_fault', fault })} />
        </Section>

        <Section title="Fault timeline (this lap)">
          <FaultTimeline profile={engineer.trackProfile} events={engineer.faultEvents} carDistance={v?.distance_along_lap ?? 0} />
        </Section>

        <Section title="TCN risk observer">
          <TcnPanel status={engineer.sessionInfo?.tcn ?? null} vehicleState={v} />
        </Section>

        <Section title="Event log">
          <EventLog entries={engineer.eventLog} />
        </Section>
      </aside>
    </div>
  )
}
