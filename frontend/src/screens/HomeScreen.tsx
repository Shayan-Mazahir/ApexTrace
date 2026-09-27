import { useEffect, useMemo, useRef, useState } from 'react'
import { getLeaderboard, type LeaderboardResponse } from '../api/leaderboard'
import { getTrack } from '../api/session'
import { DEMO_TOTAL_SECONDS, useDemo } from '../app/DemoContext'
import { useGarage } from '../app/GarageContext'
import { useScreen } from '../app/ScreenContext'
import { ASSUMED_REACTION_S } from '../drive/driverReport'
import type { ConfigResult, EvaluationResponse, TrackId, TrackProfile } from '../types/schemas'
import './HomeScreen.css'

// The front page for anyone new (judges first): what LimitLab is, how a run
// works, which challenge tracks each part answers, and the live leaderboard.

const STEPS = [
  { n: '01', title: 'Drive', body: 'Real laps of Monza or Baku with a keyboard, a gamepad, or our ESP32 steering wheel — its servos rumble on kerbs and hits, its screen shows the BRAKE warning.' },
  { n: '02', title: 'Break it', body: 'An engineer on a second device injects bounded faults mid-lap: delayed telemetry, packet loss, frozen sensors, fading brakes, wet grip.' },
  { n: '03', title: 'Measure', body: 'Every lap is scored: did the corner-entry BRAKE warning arrive in time? A trained AI predicts track-exit risk live, and we time the human’s reaction.' },
  { n: '04', title: 'Fund the fix', body: 'Each upgrade is re-run on the same held-out stress suite (42 tests). The garage shows what it fixes and what the season budget can afford.' },
]

const TRACKS: { tag: string; title: string; body: string; primary?: boolean }[] = [
  { tag: 'Track 2', title: 'Safety Testing', body: 'A fault-injection harness that stress-tests a warning system on a fixed, seeded suite — same laps, same faults, only the upgrade changes.', primary: true },
  { tag: 'Track 1', title: 'Safety Diagnosis', body: 'Live track-exit risk from a TCN ensemble, and each driver’s reaction to every warning measured and compared with what the suite assumes.' },
  { tag: 'Track 3', title: 'Safety Fixing', body: 'Upgrades (serviced brakes, faster comms, a local warning fallback) proven on replays: baseline vs fixed, side by side.' },
  { tag: 'Tangerine', title: 'Orange Flag', body: 'Every fix is priced against a season budget with commitments and a reserve, so the team finishes the year with money in the bank.' },
  { tag: 'Ollon', title: 'Data-driven safety', body: 'Thousands of simulated laps train the risk model; real drivers’ reaction times are collected on the leaderboard.' },
  { tag: 'TELUS', title: 'Best connected', body: 'Driver laptop, engineer phone and ESP32 wheel share one live session over Wi-Fi and WebSockets: the wheel feels what the car does.' },
  { tag: 'Ampere', title: 'AI for safety', body: 'A TCN ensemble forecasts 1-second exit risk from 2.5 s of telemetry; a SAC agent hunts for the scenarios that break the warnings.' },
]

function TrackHero({ profile }: { profile: TrackProfile | null }) {
  const path = useMemo(() => {
    if (!profile) return null
    const xs = profile.centerline.map((p) => p[0])
    const ys = profile.centerline.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1
    return (
      profile.centerline
        .filter((_, i) => i % 3 === 0)
        .map(([x, y], i) => `${i ? 'L' : 'M'}${(((x - minX) / span) * 180 + 10).toFixed(1)},${(((y - minY) / span) * 180 + 10).toFixed(1)}`)
        .join(' ') + ' Z'
    )
  }, [profile])
  if (!path) return <div className="home__hero-track" />
  return (
    <svg className="home__hero-track" viewBox="0 0 200 200" aria-hidden="true">
      <path d={path} className="home__track-glow" />
      <path d={path} className="home__track-line" />
      <path d={path} id="home-lap" className="home__track-dash" />
      <circle r="4" className="home__car">
        <animateMotion dur="9s" repeatCount="indefinite" rotate="auto">
          <mpath href="#home-lap" />
        </animateMotion>
      </circle>
    </svg>
  )
}

// The result in one line: the car with no upgrades, and the cheapest set of
// upgrades within the season budget that passes the most tests.
function headline(evaluation: EvaluationResponse, budget: number) {
  const passed = (c: ConfigResult) => c.tests.filter((t) => t.passed).length
  const base = evaluation.configs.find((c) => !Object.values(c.upgrades).some(Boolean))
  const affordable = evaluation.configs.filter((c) => c.cost_cad <= budget)
  const best = [...affordable].sort((a, b) => passed(b) - passed(a) || a.cost_cad - b.cost_cad)[0]
  const full = evaluation.groups.full
  const solvable = full?.solvable_count ?? null
  if (!base || !best) return null
  return { total: base.tests.length, base: passed(base), best, bestPassed: passed(best), solvable, unsolved: full?.unsolved_test_ids?.length ?? 0 }
}

export function HomeScreen() {
  const { setScreen } = useScreen()
  const demo = useDemo()
  const [monza, setMonza] = useState<TrackProfile | null>(null)
  const [boards, setBoards] = useState<Partial<Record<TrackId, LeaderboardResponse>>>({})
  const garage = useGarage()
  const { evaluation, evaluating, evaluate } = garage
  const tried = useRef(false)
  useEffect(() => {
    // the server keeps the stress-suite results cached: this is near-instant
    if (evaluation || evaluating || tried.current) return
    tried.current = true
    void evaluate()
  }, [evaluation, evaluating, evaluate])
  const result = evaluation ? headline(evaluation, garage.available) : null

  useEffect(() => {
    let live = true
    getTrack('monza').then((p) => live && setMonza(p)).catch(() => undefined)
    for (const t of ['monza', 'baku'] as TrackId[]) {
      getLeaderboard(t).then((b) => live && setBoards((prev) => ({ ...prev, [t]: b }))).catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [])

  const drivers = (boards.monza?.total ?? 0) + (boards.baku?.total ?? 0)
  const reactions = (['monza', 'baku'] as TrackId[])
    .map((t) => boards[t])
    .filter((b): b is LeaderboardResponse => !!b && b.reaction_avg_s !== null)
  const humanAvg = reactions.length ? reactions.reduce((a, b) => a + (b.reaction_avg_s as number) * b.total, 0) / reactions.reduce((a, b) => a + b.total, 0) : null

  return (
    <div className="home">
      <section className="home__hero">
        <div className="home__hero-text">
          <p className="home__kicker">Formula Tech Hacks 2026 · Safety in Motorsport</p>
          <h1>
            Test the limit.<br />
            <span>Fund the fix.</span>
          </h1>
          <p className="home__lede">
            LimitLab is a motorsport safety test bench. Drive a lap while an engineer breaks the car’s corner-entry BRAKE warning in
            real time — then prove, on a fixed stress suite, which upgrade actually fixes it and whether the budget can pay for it.
          </p>
          <div className="home__cta">
            <button type="button" className="home__primary" onClick={() => setScreen('drive')}>Start driving</button>
            <button
              type="button"
              onClick={() => {
                setScreen('drive')
                demo.start()
              }}
            >
              Watch the {Math.round(DEMO_TOTAL_SECONDS / 60)}-minute demo
            </button>
            <button type="button" onClick={() => setScreen('garage')}>Open the garage</button>
          </div>
        </div>
        <TrackHero profile={monza} />
      </section>

      <section className="home__stats" aria-label="At a glance">
        <div><strong>2</strong><span>real circuit layouts</span></div>
        <div><strong>42</strong><span>held-out stress tests</span></div>
        <div><strong>8</strong><span>upgrade combinations compared</span></div>
        <div><strong>{drivers}</strong><span>drivers on the leaderboard</span></div>
      </section>

      {result && (
        <section className="home__section home__result" aria-label="Headline result">
          <h2>The result</h2>
          <div className="home__result-row">
            <div>
              <span>No upgrades</span>
              <strong>{result.base}<small>/{result.total}</small></strong>
              <p>stress tests passed</p>
            </div>
            <div className="home__result-arrow" aria-hidden="true">→</div>
            <div className="home__result-best">
              <span>Best buy within budget</span>
              <strong>{result.bestPassed}<small>/{result.total}</small></strong>
              <p>{result.best.label} · CAD {result.best.cost_cad.toLocaleString()}</p>
            </div>
          </div>
          <p className="home__muted">
            {result.solvable !== null && result.bestPassed >= result.solvable
              ? `That is every test an upgrade can fix. `
              : ''}
            {result.unsolved > 0 &&
              `${result.unsolved} tests fail whatever is bought (sensor faults, wet braking): flagged as unsolved, not hidden. `}
            Same 42 held-out tests, same seeds and faults for every option; the season budget allows CAD {garage.available.toLocaleString()}.
          </p>
        </section>
      )}

      <section className="home__section">
        <h2>How a run works</h2>
        <div className="home__steps">
          {STEPS.map((s) => (
            <article key={s.n}>
              <span className="home__step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home__section home__human">
        <div>
          <h2>Humans vs the test suite</h2>
          <p>
            The stress suite’s scripted driver reacts to BRAKE in {ASSUMED_REACTION_S[0]}–{ASSUMED_REACTION_S[1]} s. Every lap driven here
            measures a real person instead. If people are slower, the warning margins the suite signs off are optimistic — a safety
            finding in its own right.
          </p>
        </div>
        <div className="home__versus">
          <div><span>Suite assumes</span><strong>{ASSUMED_REACTION_S[0]}–{ASSUMED_REACTION_S[1]} s</strong></div>
          <div className={humanAvg !== null && humanAvg > ASSUMED_REACTION_S[1] ? 'home__versus--slow' : ''}>
            <span>Real drivers here</span>
            <strong>{humanAvg === null ? 'drive to find out' : `${humanAvg.toFixed(2)} s`}</strong>
          </div>
        </div>
      </section>

      <section className="home__section">
        <h2>Built for every track</h2>
        <div className="home__tracks">
          {TRACKS.map((t) => (
            <article key={t.title} className={t.primary ? 'home__track--primary' : undefined}>
              <span className="home__tag">{t.tag}</span>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home__section">
        <h2>Leaderboard</h2>
        <div className="home__boards">
          {(['monza', 'baku'] as TrackId[]).map((t) => {
            const b = boards[t]
            return (
              <div key={t} className="home__board">
                <h3>{t === 'monza' ? 'Monza' : 'Baku'}</h3>
                {b && b.entries.length ? (
                  <ol>
                    {b.entries.slice(0, 5).map((e, i) => (
                      <li key={e.id}>
                        <span className="home__pos">{i + 1}</span>
                        <span className="home__name">{e.name}</span>
                        <span>{e.score}</span>
                        <span>{e.reaction_avg_s === null ? '—' : `${e.reaction_avg_s.toFixed(2)} s`}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="home__muted">No scores yet: drive a session and post yours from the safety report.</p>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <footer className="home__footer">
        An F1-inspired prototype: simplified vehicle model and scripted drivers, not F1 physics or certification; prices are demo
        assumptions for a fictional team.
      </footer>
    </div>
  )
}
