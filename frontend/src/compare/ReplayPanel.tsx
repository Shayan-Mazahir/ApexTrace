import { Canvas } from '@react-three/fiber'
import { StatusBadge } from '../components/StatusBadge'
import { Scene } from '../scene/Scene'
import type { ReplayRun, TrackProfile } from '../types/schemas'
import { firstTime, poseAt, trailUpTo } from './replayMath'
import { ReplayTimeline } from './ReplayTimeline'
import './ReplayPanel.css'

interface ReplayPanelProps {
  run: ReplayRun
  profile: TrackProfile
  t: number
  maxT: number
}

const seconds = (v: number | null) => (v === null ? 'never' : `${v.toFixed(1)} s`)

export function ReplayPanel({ run, profile, t, maxT }: ReplayPanelProps) {
  const pose = poseAt(run.frames, t)
  const { result } = run
  const warnedAt = firstTime(run.frames, (f) => f.warning_active)
  const brakedAt = firstTime(run.frames, (f) => f.brake > 0.5)
  const over = t >= (run.frames.at(-1)?.t ?? 0)

  return (
    <section className="replay-panel">
      <header>
        <h2>{run.label}</h2>
        {result.passed ? (
          <StatusBadge tone="info" label="Passed this test" />
        ) : (
          <StatusBadge tone="danger" label={result.track_exit ? 'Track exit' : 'Failed this test'} />
        )}
      </header>

      <div className="replay-panel__view">
        <Canvas camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 6000 }}>
          <Scene
            trackProfile={profile}
            vehicleState={pose ? { x: pose.x, y: pose.y, heading: pose.heading } : null}
            trail={trailUpTo(run.frames, t)}
            previousLapTrail={[]}
          />
        </Canvas>
        <div className="replay-panel__hud">
          <span>{(pose?.speed ?? 0).toFixed(1)} m/s</span>
          {pose?.frame.warning_active && !over && <span className="replay-panel__warn">▲ BRAKE warning</span>}
          {pose?.frame.warning_state === 'stale' && !over && <span className="replay-panel__warn">▲ data stale</span>}
          {pose && pose.frame.active_faults.length > 0 && !over && (
            <span className="replay-panel__faults">faults: {pose.frame.active_faults.join(', ')}</span>
          )}
          {pose?.frame.tcn_risk != null && !over && (
            <span className="replay-panel__risk">TCN risk {Math.round(pose.frame.tcn_risk * 100)}%</span>
          )}
          {pose && pose.frame.brake > 0.5 && !over && <span className="replay-panel__brake">■ braking</span>}
          {over && (
            <span className={result.track_exit ? 'replay-panel__brake' : ''}>
              {result.track_exit ? '✕ run ended: track exit' : '● run ended: lap complete'}
            </span>
          )}
        </div>
      </div>

      <ReplayTimeline frames={run.frames} maxT={maxT} t={t} />

      <dl className="replay-panel__stats">
        <dt>Min clearance</dt>
        <dd>{result.min_clearance_m.toFixed(2)} m</dd>
        <dt>First warning</dt>
        <dd>{seconds(warnedAt)}</dd>
        <dt>Braking began</dt>
        <dd>{seconds(brakedAt)}</dd>
        <dt>Worst warning margin</dt>
        <dd>{result.min_warning_margin_m === null ? '—' : `${result.min_warning_margin_m.toFixed(1)} m`}</dd>
        <dt>Stale / blackout</dt>
        <dd>{result.stale_time_s.toFixed(1)} s / {result.blackout_time_s.toFixed(1)} s</dd>
        <dt>Fallback first used</dt>
        <dd>{result.fallback_first_t === null ? 'never' : `${result.fallback_first_t.toFixed(1)} s`}</dd>
        <dt>Exit location</dt>
        <dd>{result.exit_location ?? '—'}</dd>
        <dt>Lap time</dt>
        <dd>{result.lap_time_s === null ? 'not completed' : `${result.lap_time_s.toFixed(1)} s`}</dd>
      </dl>
    </section>
  )
}
