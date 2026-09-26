export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface Check {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export interface PreflightDeps {
  apiBase: string
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>
  openSocket: (url: string) => WebSocket
  gamepads: () => (Gamepad | null)[]
  timeoutMs?: number
}

async function attempt(id: string, label: string, run: () => Promise<{ status?: CheckStatus; detail: string }>): Promise<Check> {
  try {
    const { status = 'ok', detail } = await run()
    return { id, label, status, detail }
  } catch (err) {
    return { id, label, status: 'fail', detail: err instanceof Error ? err.message : String(err) }
  }
}

// One live socket check: create a session, connect as driver, wait for a
// vehicle_state frame. This is what "fresh launch is healthy" really means.
function socketCheck(deps: PreflightDeps, sessionId: string): Promise<void> {
  const timeout = deps.timeoutMs ?? 4000
  return new Promise((resolve, reject) => {
    const ws = deps.openSocket(`${deps.apiBase.replace(/^http/, 'ws')}/ws/driver/${sessionId}`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`no telemetry within ${timeout} ms`))
    }, timeout)
    ws.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).type === 'vehicle_state') {
          clearTimeout(timer)
          ws.close()
          resolve()
        }
      } catch {
        /* ignore non-JSON frames */
      }
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('WebSocket error'))
    }
  })
}

export async function runPreflight(deps: PreflightDeps): Promise<Check[]> {
  const get = (path: string) => deps.fetchJson(`${deps.apiBase}${path}`)
  const post = (path: string, body?: unknown) =>
    deps.fetchJson(`${deps.apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const checks: Check[] = []
  checks.push(
    await attempt('backend', 'Backend reachable', async () => {
      const body = (await get('/health')) as { status?: string }
      if (body.status !== 'ok') throw new Error('health check did not report ok')
      return { detail: 'GET /health ok' }
    }),
  )
  checks.push(
    await attempt('scenarios', 'Saved scenarios loaded', async () => {
      const list = (await get('/scenarios')) as { id: string }[]
      const need = ['monza_wet_braking', 'monza_fade_stale_speed', 'baku_sensor_freeze', 'baku_late_warning_delivery']
      const missing = need.filter((id) => !list.some((s) => s.id === id))
      if (missing.length) throw new Error(`missing presets: ${missing.join(', ')}`)
      return { detail: `${list.length} scenarios, the four required presets present` }
    }),
  )
  checks.push(
    await attempt('upgrades', 'Upgrade catalog and 8 combinations', async () => {
      const catalog = (await get('/upgrades')) as { upgrades: unknown[]; configs: unknown[] }
      if (catalog.upgrades.length !== 3 || catalog.configs.length !== 8) {
        throw new Error(`expected 3 upgrades / 8 configs, got ${catalog.upgrades.length} / ${catalog.configs.length}`)
      }
      return { detail: '3 upgrades, 8 combinations' }
    }),
  )
  checks.push(
    await attempt('evaluation', 'Fixed evaluation suite ready', async () => {
      const started = Date.now()
      const result = (await post('/evaluation/run')) as { configs: unknown[]; suite: { tests: unknown[] } }
      if (result.configs.length !== 8) throw new Error('evaluation did not return 8 configurations')
      return { detail: `${result.suite.tests.length} held-out tests × 8 configs in ${Date.now() - started} ms` }
    }),
  )
  checks.push(
    await attempt('live', 'Live session streams telemetry', async () => {
      for (const track of ['monza', 'baku']) {
        const created = (await post('/sessions', { track })) as { session_id: string }
        await socketCheck(deps, created.session_id)
      }
      return { detail: 'Monza and Baku sessions each streamed vehicle_state' }
    }),
  )
  checks.push(
    await attempt('input', 'Steering input', async () => {
      const pad = deps.gamepads().find((p) => p)
      return pad
        ? { detail: `Gamepad/wheel detected: ${pad.id}` }
        : { status: 'warn', detail: 'No wheel detected — keyboard fallback (W/S/A/D or arrows) will be used' }
    }),
  )
  checks.push(
    await attempt('backup', 'Backup replay recording present', async () => {
      const replay = (await deps.fetchJson('/backup-replay.json')) as { baseline?: { frames?: unknown[] } }
      if (!replay.baseline?.frames?.length) throw new Error('backup file has no frames')
      return { detail: `${replay.baseline.frames.length} frames recorded` }
    }),
  )
  return checks
}

export function preflightVerdict(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  return checks.some((c) => c.status === 'warn') ? 'warn' : 'ok'
}
