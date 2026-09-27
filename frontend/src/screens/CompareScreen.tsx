import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { getReplay, loadBackupReplay } from '../api/evaluation'
import { getTrack } from '../api/session'
import { useDemo } from '../app/DemoContext'
import { useErrorContext } from '../app/ErrorContext'
import { useGarage } from '../app/GarageContext'
import { useScreen } from '../app/ScreenContext'
import { LoadingIndicator } from '../components/LoadingIndicator'
import { pickDefaultTest } from '../compare/compareLogic'
import { ModelsPanel } from '../compare/ModelsPanel'
import { firstTime, poseAt, runDuration } from '../compare/replayMath'
import { SpeedChart } from '../compare/SpeedChart'
import { usePlayback } from '../compare/usePlayback'
import { SCENARIO_GUIDE } from '../engineer/scenarioGuide'
import { configKey, selectedIds } from '../garage/budgetMath'
import { Scene, type SceneView } from '../scene/Scene'
import { NO_UPGRADES, type ReplayResponse, type ReplayRun, type TestResult, type TrackProfile } from '../types/schemas'
import './CompareScreen.css'

function headline(r: TestResult): { icon: string; text: string; tone: 'good' | 'bad' | 'warn' } {
  if (r.passed) return { icon: '✓', text: 'Finished the lap safely', tone: 'good' }
  if (r.track_exit) {
    const what = r.exit_reason === 'hit the barrier' ? 'Hit the wall' : 'Went off the track'
    return { icon: '✕', text: `${what} at ${r.exit_location ?? 'a corner'}`, tone: 'bad' }
  }
  return { icon: '!', text: `Too close: ${r.min_clearance_m.toFixed(2)} m from the edge`, tone: 'warn' }
}

function OutcomeCard({ run, who, tone }: { run: ReplayRun; who: string; tone: 'base' | 'mine' }) {
  const h = headline(run.result)
  const warned = firstTime(run.frames, (f) => f.warning_active)
  const end = run.frames.at(-1)?.t ?? 0
  const c = run.result.min_clearance_m
  return (
    <article className={`cmp-card cmp-card--${tone} cmp-card--${h.tone}`}>
      <p className="cmp-card__who">
        <i className={`cmp-dot cmp-dot--${tone}`} /> {who}
      </p>
      <h2>
        <span>{h.icon}</span> {h.text}
      </h2>
      <dl>
        <div>
          <dt>{run.result.passed ? 'Lap time' : 'Ended after'}</dt>
          <dd>{(run.result.lap_time_s ?? end).toFixed(1)} s</dd>
        </div>
        <div>
          <dt>Closest to the edge</dt>
          <dd>{c >= 0 ? `${c.toFixed(1)} m inside` : `${Math.abs(c).toFixed(1)} m outside`}</dd>
        </div>
        <div>
          <dt>First BRAKE warning</dt>
          <dd>{warned === null ? 'never' : `${warned.toFixed(1)} s`}</dd>
        </div>
      </dl>
    </article>
  )
}

export function CompareScreen() {
  const { evaluation, selection } = useGarage()
  const { setScreen } = useScreen()
  const { reportError } = useErrorContext()
  const demo = useDemo()

  const upgradedKey = configKey(selection)
  const baselineResult = evaluation?.configs.find((c) => c.key === 'baseline')
  const upgradedResult = evaluation?.configs.find((c) => c.key === upgradedKey)
  const tests = useMemo(() => evaluation?.suite.tests ?? [], [evaluation])
  const anySelected = selectedIds(selection).length > 0

  const defaultTest = useMemo(() => pickDefaultTest(baselineResult?.tests ?? [], upgradedResult?.tests), [baselineResult, upgradedResult])
  const [chosenTest, setChosenTest] = useState<string | null>(null)
  const testId = chosenTest && tests.some((t) => t.id === chosenTest) ? chosenTest : defaultTest

  const [replay, setReplay] = useState<ReplayResponse | null>(null)
  const [profile, setProfile] = useState<TrackProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [backup, setBackup] = useState(false)
  const [view, setView] = useState<SceneView>('follow')

  useEffect(() => {
    if (!testId || !anySelected) return
    let cancelled = false
    setLoading(true)
    setBackup(false)
    getReplay(testId, NO_UPGRADES, selection)
      .then((r) => !cancelled && setReplay(r))
      .catch(async () => {
        try {
          const recorded = await loadBackupReplay()
          if (!cancelled) {
            setReplay(recorded)
            setProfile(recorded.track_profile)
            setBackup(true)
          }
        } catch {
          if (!cancelled) reportError('Could not load a replay (backend unreachable and no backup recording).')
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [testId, selection, anySelected, reportError])

  useEffect(() => {
    if (!replay || backup) return
    let cancelled = false
    getTrack(replay.test.track)
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && reportError('Could not load the track for the replay.'))
    return () => {
      cancelled = true
    }
  }, [replay, backup, reportError])

  const maxT = replay ? Math.max(runDuration(replay.baseline.frames), runDuration(replay.upgraded.frames)) : 0
  const playback = usePlayback(maxT)
  const { play } = playback
  useEffect(() => {
    if (demo.active && replay && profile) play()
  }, [demo.active, replay, profile, play])

  // scenario picker: one entry per scenario run, named in words
  const options = useMemo(() => {
    const count = new Map<string, number>()
    return tests.map((t) => {
      const n = (count.get(t.scenario_id) ?? 0) + 1
      count.set(t.scenario_id, n)
      const b = baselineResult?.tests.find((r) => r.test_id === t.id)
      const u = upgradedResult?.tests.find((r) => r.test_id === t.id)
      const diff = b && u && b.passed !== u.passed ? (u.passed ? '  ← your upgrade saves it' : '  ← your upgrade makes it worse') : ''
      return { id: t.id, label: `${t.name} · run ${n}${diff}` }
    })
  }, [tests, baselineResult, upgradedResult])

  if (!evaluation || !anySelected) {
    return (
      <div className="compare-screen compare-screen--empty">
        <h1>Replay</h1>
        <p>{!evaluation ? 'Run the tests in the garage first.' : 'Pick at least one upgrade in the garage, then come back.'}</p>
        <button type="button" onClick={() => setScreen('garage')}>Go to the garage</button>
      </div>
    )
  }

  const base = replay?.baseline
  const mine = replay?.upgraded
  const bp = base ? poseAt(base.frames, playback.t) : null
  const mp = mine ? poseAt(mine.frames, playback.t) : null
  const story = replay ? SCENARIO_GUIDE[replay.test.scenario_id]?.story ?? replay.test.description : ''
  const summary =
    base && mine
      ? !base.result.passed && mine.result.passed
        ? 'Your upgrade made the difference in this scenario.'
        : base.result.passed && mine.result.passed
          ? 'Both cars got through. This scenario does not need the upgrade.'
          : !base.result.passed && !mine.result.passed
            ? 'Neither car got through. Your upgrade does not fix this scenario.'
            : 'The car without upgrades did better here.'
      : ''

  return (
    <div className="compare-screen">
      <header className="cmp-head">
        <div>
          <h1>Replay</h1>
          <p>The same scenario, driven twice by the same computer driver: once without upgrades, once with yours.</p>
        </div>
        <label className="cmp-pick">
          <span>Scenario</span>
          <select value={testId ?? ''} onChange={(e) => setChosenTest(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
      </header>

      {backup && <p className="cmp-backup">Backend unreachable: showing a backup recording.</p>}
      {loading && <LoadingIndicator label="Driving both cars through this scenario" />}

      {replay && base && mine && profile && (
        <>
          {story && <p className="cmp-story"><b>What happens:</b> {story}</p>}

          <div className="cmp-cards">
            <OutcomeCard run={base} who="No upgrades" tone="base" />
            <OutcomeCard run={mine} who={`Your car: ${mine.label.replace(/^Upgraded: /, '')}`} tone="mine" />
          </div>
          <p className="cmp-summary">{summary}</p>

          <section className="cmp-stage">
            <div className="cmp-view">
              <Canvas camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 8000 }} dpr={[1, 1.5]}>
                <Scene
                  view={view}
                  trackProfile={profile}
                  vehicleState={mp ? { x: mp.x, y: mp.y, heading: mp.heading, speed: mp.speed } : null}
                  ghost={bp ? { x: bp.x, y: bp.y, heading: bp.heading, speed: bp.speed } : null}
                  trail={[]}
                  previousLapTrail={[]}
                />
              </Canvas>
              <div className="cmp-view__tags">
                <span className="cmp-tag cmp-tag--mine">
                  <i className="cmp-dot cmp-dot--mine" /> Your car {Math.round((mp?.speed ?? 0) * 3.6)} km/h
                  {mp?.frame.warning_active && <b> · BRAKE</b>}
                </span>
                <span className="cmp-tag">
                  <i className="cmp-dot cmp-dot--base" /> No upgrades {Math.round((bp?.speed ?? 0) * 3.6)} km/h
                  {bp?.frame.warning_active && <b> · BRAKE</b>}
                  {base.result.track_exit && playback.t >= runDuration(base.frames) && <b className="cmp-crash"> · crashed</b>}
                </span>
              </div>
              <div className="cmp-view__cams" role="group" aria-label="Camera">
                {(['follow', 'overview'] as SceneView[]).map((v) => (
                  <button key={v} type="button" className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                    {v === 'follow' ? 'Behind your car' : 'Whole track'}
                  </button>
                ))}
              </div>
            </div>

            <div className="cmp-controls">
              <button type="button" className="cmp-play" onClick={playback.playing ? playback.pause : playback.play} aria-label={playback.playing ? 'Pause' : 'Play'}>
                {playback.playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" onClick={playback.restart}>Restart</button>
              <input type="range" min={0} max={maxT} step={0.1} value={playback.t} onChange={(e) => playback.seek(Number(e.target.value))} aria-label="Replay position" />
              <span className="cmp-time">{playback.t.toFixed(1)} / {maxT.toFixed(1)} s</span>
              <select value={playback.rate} onChange={(e) => playback.setRate(Number(e.target.value))} aria-label="Playback speed">
                {[0.5, 1, 2, 4, 8].map((r) => (
                  <option key={r} value={r}>{r}×</option>
                ))}
              </select>
            </div>

            <SpeedChart base={base} mine={mine} t={playback.t} maxT={maxT} onSeek={playback.seek} />
          </section>
        </>
      )}

      <section className="cmp-ai">
        <h2>The AI models behind this</h2>
        <ModelsPanel />
      </section>
    </div>
  )
}
