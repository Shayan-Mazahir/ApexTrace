import { useEffect, useMemo, useState } from 'react'
import { getReplay, loadBackupReplay } from '../api/evaluation'
import { getTrack } from '../api/session'
import { useDemo } from '../app/DemoContext'
import { useErrorContext } from '../app/ErrorContext'
import { useGarage } from '../app/GarageContext'
import { useScreen } from '../app/ScreenContext'
import { LoadingIndicator } from '../components/LoadingIndicator'
import { StatusBadge } from '../components/StatusBadge'
import { describeOutcome, pickDefaultTest } from '../compare/compareLogic'
import { ModelsPanel } from '../compare/ModelsPanel'
import { ReplayPanel } from '../compare/ReplayPanel'
import { runDuration } from '../compare/replayMath'
import { usePlayback } from '../compare/usePlayback'
import { configKey, selectedIds } from '../garage/budgetMath'
import { NO_UPGRADES, type ReplayResponse, type TrackProfile } from '../types/schemas'
import './CompareScreen.css'

export function CompareScreen() {
  const { evaluation, selection } = useGarage()
  const { setScreen } = useScreen()
  const { reportError } = useErrorContext()
  const demo = useDemo()

  const upgradedKey = configKey(selection)
  const baselineResult = evaluation?.configs.find((c) => c.key === 'baseline')
  const upgradedResult = evaluation?.configs.find((c) => c.key === upgradedKey)
  const tests = evaluation?.suite.tests ?? []
  const anySelected = selectedIds(selection).length > 0

  const defaultTest = useMemo(
    () => pickDefaultTest(baselineResult?.tests ?? [], upgradedResult?.tests),
    [baselineResult, upgradedResult],
  )
  const [chosenTest, setChosenTest] = useState<string | null>(null)
  const testId = chosenTest && tests.some((t) => t.id === chosenTest) ? chosenTest : defaultTest

  const [replay, setReplay] = useState<ReplayResponse | null>(null)
  const [profile, setProfile] = useState<TrackProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [backup, setBackup] = useState(false)

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
    if (!replay || backup) return // a backup recording carries its own track
    let cancelled = false
    getTrack(replay.test.track)
      .then((p) => !cancelled && setProfile(p))
      .catch(() => {
        if (!cancelled) reportError('Could not load the track for the replay.')
      })
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

  if (!evaluation || !anySelected) {
    return (
      <div className="compare-screen compare-screen--empty">
        <h1>Compare</h1>
        <p>
          {!evaluation
            ? 'Run the fixed evaluation suite in the garage first.'
            : 'Select at least one upgrade in the garage to compare against the baseline.'}
        </p>
        <button type="button" onClick={() => setScreen('garage')}>
          Go to the garage
        </button>
      </div>
    )
  }

  return (
    <div className="compare-screen">
      <header className="compare-screen__header">
        <div>
          <h1>Compare</h1>
          <p>
            <StatusBadge tone="neutral" label="Automated replay" /> The same scripted controller responds to the
            warnings in both runs; it may produce different braking commands. It is not a human driver.
            {backup && ' Showing a backup recording — the backend was unreachable.'}
          </p>
        </div>
        <label className="compare-screen__select">
          <span>Test</span>
          <select value={testId ?? ''} onChange={(e) => setChosenTest(e.target.value)}>
            {tests.map((t) => {
              const base = baselineResult?.tests.find((r) => r.test_id === t.id)
              const up = upgradedResult?.tests.find((r) => r.test_id === t.id)
              return (
                <option key={t.id} value={t.id}>
                  {t.id} — baseline {describeOutcome(base)}, upgraded {describeOutcome(up)}
                </option>
              )
            })}
          </select>
        </label>
      </header>

      {loading && <LoadingIndicator label="Running both configurations on this test" />}

      {replay && profile && (
        <>
          <div className="compare-screen__controls">
            <button type="button" onClick={playback.playing ? playback.pause : playback.play}>
              {playback.playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" onClick={playback.restart}>
              Restart
            </button>
            <label>
              Speed{' '}
              <select value={playback.rate} onChange={(e) => playback.setRate(Number(e.target.value))}>
                {[0.5, 1, 2, 4, 8].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
            <input
              type="range"
              min={0}
              max={maxT}
              step={0.1}
              value={playback.t}
              onChange={(e) => playback.seek(Number(e.target.value))}
              aria-label="Replay position"
            />
            <span className="compare-screen__time">
              {playback.t.toFixed(1)} / {maxT.toFixed(1)} s
            </span>
          </div>

          <div className="compare-screen__panels">
            <ReplayPanel run={replay.baseline} profile={profile} t={playback.t} maxT={maxT} />
            <ReplayPanel run={replay.upgraded} profile={profile} t={playback.t} maxT={maxT} />
          </div>

          <p className="compare-screen__note">
            {replay.test.name} · seed {replay.test.seed} · faults: {replay.test.faults.length ? replay.test.faults.join('; ') : 'none'}.
            One test is an illustration; the garage table has the whole suite.
          </p>
        </>
      )}
      <ModelsPanel />
    </div>
  )
}
