import { Canvas } from '@react-three/fiber'
import { useEffect, useState, type ReactNode } from 'react'
import { listScenarios } from '../api/session'
import { useActiveSession } from '../app/ActiveSessionContext'
import { useErrorContext } from '../app/ErrorContext'
import { SimulatedFaultLabel } from '../components/SimulatedFaultLabel'
import { StatusBadge } from '../components/StatusBadge'
import { FaultControls } from '../engineer/FaultControls'
import { FaultTimeline } from '../engineer/FaultTimeline'
import { LinkIndicators } from '../engineer/LinkIndicators'
import { RunInfo } from '../engineer/RunInfo'
import { ScenarioPanel } from '../engineer/ScenarioPanel'
import { useEngineerSession } from '../engineer/useEngineerSession'
import { Scene } from '../scene/Scene'
import { NO_FAULTS, type FaultState, type ScenarioConfig } from '../types/schemas'
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
  const [scenarios, setScenarios] = useState<ScenarioConfig[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [draft, setDraft] = useState<FaultState>(NO_FAULTS)

  useEffect(() => {
    listScenarios()
      .then(setScenarios)
      .catch((err) => reportError(err instanceof Error ? err.message : 'Failed to load scenarios'))
  }, [reportError])

  const track = engineer.trackProfile?.id ?? null
  const connected = engineer.connection === 'connected'
  const activeScenarioId = engineer.sessionInfo?.scenario_id ?? null
  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) ?? null

  const selectScenario = (id: string) => {
    setSelectedScenarioId(id)
    const scenario = scenarios.find((s) => s.id === id)
    if (scenario) setDraft(scenario.faults)
  }

  return (
    <div className="engineer-screen">
      <div className="engineer-screen__view">
        <Canvas camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 6000 }}>
          <Scene
            trackProfile={engineer.trackProfile}
            vehicleState={engineer.vehicleState}
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
              placeholder="Session ID from the driver screen"
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
          <SimulatedFaultLabel delayMs={engineer.vehicleState?.injected_delay_ms ?? 0} />
        </Section>

        <Section title="Link">
          <LinkIndicators
            connection={engineer.connection}
            vehicleState={engineer.vehicleState}
            lastMessageAt={engineer.lastMessageAt}
          />
        </Section>

        <Section title="Run">
          <RunInfo info={engineer.sessionInfo} />
          <div className="engineer-screen__warning">
            <StatusBadge
              tone={engineer.warning.active ? 'danger' : 'neutral'}
              label={engineer.warning.active ? `Warning: ${engineer.warning.hazardZone}` : 'Warning inactive'}
            />
          </div>
          <div className="engineer-screen__actions">
            <button type="button" disabled={!connected} onClick={() => send({ type: 'pause' })}>
              Pause
            </button>
            <button type="button" disabled={!connected} onClick={() => send({ type: 'resume' })}>
              Resume
            </button>
            <button type="button" disabled={!connected} onClick={() => send({ type: 'reset' })}>
              Reset run
            </button>
          </div>
        </Section>

        <Section title="Fault injection">
          <FaultControls
            value={draft}
            applied={engineer.faultState?.manual ?? null}
            disabled={!connected}
            onChange={setDraft}
            onApply={(faults) => send({ type: 'set_faults', faults })}
          />
        </Section>

        <Section title="Scenarios">
          <ScenarioPanel
            scenarios={scenarios}
            track={track}
            selectedId={selectedScenarioId}
            activeScenarioId={activeScenarioId}
            disabled={!connected}
            onSelect={selectScenario}
            onLaunch={(id) => send({ type: 'launch_scenario', scenario_id: id })}
            onClear={() => send({ type: 'clear_scenario' })}
          />
        </Section>

        <Section title="Fault timeline">
          <FaultTimeline
            profile={engineer.trackProfile}
            scenario={activeScenario}
            events={engineer.faultEvents}
            carDistance={engineer.vehicleState?.distance_along_lap ?? 0}
          />
        </Section>
      </aside>
    </div>
  )
}
