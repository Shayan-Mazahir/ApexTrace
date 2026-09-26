// End-to-end check of the real app in real Chrome against the live backend.
//   Prereq: backend on :8000 and `npm run dev` on :5173 (scripts/start.sh).
//   Run:    node e2e/smoke.mjs        (E2E_OUTAGE=1 also kills/restarts the backend)
import { execSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE ?? 'http://localhost:5173'
const API = process.env.API ?? 'http://localhost:8000'
const SHOTS = process.env.SHOT_DIR ?? path.join(process.cwd(), 'e2e', 'shots')
mkdirSync(SHOTS, { recursive: true })

const results = []
const pageErrors = []
let failed = 0

async function step(name, fn) {
  const started = Date.now()
  try {
    await fn()
    results.push(`PASS  ${name} (${Date.now() - started} ms)`)
  } catch (err) {
    failed++
    results.push(`FAIL  ${name}: ${err.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bodyText = (page) => page.evaluate(() => document.body.innerText)

async function waitText(page, text, timeout = 15000) {
  try {
    await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout, polling: 250 }, text)
  } catch {
    const seen = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400)
    throw new Error(`timed out waiting for text "${text}". Page says: ${seen}`)
  }
}

async function clickButton(page, label, { exact = false } = {}) {
  const ok = await page.evaluate(
    (l, ex) => {
      const buttons = [...document.querySelectorAll('button')].filter((b) => !b.disabled)
      const b = buttons.find((x) => (ex ? x.textContent.trim() === l : x.textContent.trim().includes(l)))
      if (!b) return false
      b.click()
      return true
    },
    label,
    exact,
  )
  assert(ok, `no enabled button "${label}"`)
}

async function setInput(page, selector, index, value) {
  await page.evaluate(
    (sel, i, v) => {
      const el = document.querySelectorAll(sel)[i]
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, String(v))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    selector,
    index,
    value,
  )
}

// Selects the cheapest passing configuration if the evaluation found one;
// otherwise (a legitimate result) picks the Local warning fallback card by hand.
async function selectSomeUpgrade(page) {
  const passing = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => !b.disabled && b.textContent.includes('Select cheapest passing')))
  if (passing) return clickButton(page, 'Select cheapest passing')
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.upgrade-card')].find((c) => c.innerText.includes('Local warning fallback'))
    card.querySelector('footer button').click()
  })
}

function restartBackend() {
  spawn('bash', ['-c', 'cd ../backend && source venv/bin/activate && exec uvicorn app.main:app --host 0.0.0.0 --port 8000'], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}

async function waitBackend(timeout = 30000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try {
      if ((await fetch('http://localhost:8000/health')).ok) return
    } catch {
      /* not up yet */
    }
    await sleep(300)
  }
  throw new Error('backend did not come back')
}

// How many distinct (quantised) colours an element shows on screen. A blank
// 3D view is one or two flat colours; a rendered track is dozens.
async function colourCount(page, selector) {
  const el = await page.$(selector)
  assert(el, `no element ${selector}`)
  // Hide every overlay (HUD text, badges, panels) so only WebGL pixels count.
  const style = await page.addStyleTag({
    content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }',
  })
  let png
  try {
    png = await el.screenshot({ encoding: 'base64' })
  } finally {
    await page.evaluate((s) => s.remove(), style)
  }
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, c.width, c.height).data
    const seen = new Set()
    for (let i = 0; i < px.length; i += 4 * 7) seen.add(`${px[i] >> 4},${px[i + 1] >> 4},${px[i + 2] >> 4}`)
    return seen.size
  }, png)
}

const MIN_COLOURS = Number(process.env.MIN_COLOURS ?? 8)
const colourLog = []

async function assertRendered(page, selector, label) {
  let colours = 0
  for (let i = 0; i < 20; i++) {
    colours = await colourCount(page, selector)
    if (colours >= MIN_COLOURS) break
    await sleep(250)
  }
  colourLog.push(`${label}: ${colours}`)
  if (colours < MIN_COLOURS) throw new Error(`${label} looks blank (${colours} distinct colours)`)
}

const waitConnected = (page, timeout = 15000) =>
  page.waitForSelector('.drive-screen[data-connection="connected"] .drive-screen__brand', { timeout })
const sessionCode = (page) => page.$eval('.drive-screen__brand code', (e) => e.textContent)

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run'],
})

async function newPage(name) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`${name} console: ${m.text()}`)
  })
  return page
}

try {
  // ---------------------------------------------------------------- Garage
  const garage = await newPage('garage')
  await garage.goto(`${BASE}/#garage`)

  await step('garage: sample budget shows CAD 4,000 available', async () => {
    await waitText(garage, 'Upgrade garage')
    await garage.waitForSelector('.upgrade-card')
    const available = await garage.$eval('.budget-panel__available strong', (e) => e.textContent)
    assert(available.includes('4,000'), `available was "${available}"`)
    assert((await garage.$$('.upgrade-card')).length === 3, 'expected three upgrade cards')
  })

  await step('garage: cards show price and exact parameter effect', async () => {
    const text = await bodyText(garage)
    for (const needle of ['CAD 1,500', 'CAD 2,500', 'CAD 1,000', '0.75 -> 1.00', 'x 0.40', '150 ms']) {
      assert(text.includes(needle), `missing "${needle}"`)
    }
  })

  await step('garage: purchases beyond available money are blocked', async () => {
    const cards = () => garage.$$eval('.upgrade-card', (els) => els.map((e) => ({ name: e.querySelector('h3').textContent, disabled: e.querySelector('footer button').disabled })))
    await garage.$$eval('.upgrade-card', (els) => els.find((e) => e.textContent.includes('Communication')).querySelector('footer button').click())
    await garage.$$eval('.upgrade-card', (els) => els.find((e) => e.textContent.includes('Brake')).querySelector('footer button').click())
    const spend = await garage.$eval('.garage-screen__summary', (e) => e.innerText)
    assert(spend.includes('CAD 4,000'), `summary: ${spend}`)
    const state = await cards()
    assert(state.find((c) => c.name.includes('Local')).disabled, 'local fallback should be blocked at 4,000 spent')
    assert(!state.find((c) => c.name.includes('Communication')).disabled, 'selected card must stay removable')
    await garage.$$eval('.upgrade-card', (els) => els.find((e) => e.textContent.includes('Communication')).querySelector('footer button').click())
    const after = await cards()
    assert(!after.find((c) => c.name.includes('Local')).disabled, 'local fallback should unblock after removal')
    await garage.$$eval('.upgrade-card', (els) => els.find((e) => e.textContent.includes('Brake')).querySelector('footer button').click())
  })

  await step('garage: editing the budget recalculates available money', async () => {
    await setInput(garage, '.budget-panel__input input', 0, 5000)
    const strong = await garage.$eval('.budget-panel__available strong', (e) => ({ text: e.textContent, negative: e.classList.contains('budget-panel__negative') }))
    assert(strong.text.includes('3,000') && strong.negative, `shortfall not shown: ${JSON.stringify(strong)}`)
    const allBlocked = await garage.$$eval('.upgrade-card footer button', (bs) => bs.every((b) => b.disabled))
    assert(allBlocked, 'no purchase should be possible in a shortfall')
    await setInput(garage, '.budget-panel__input input', 0, 12000)
  })

  await step('garage: fixed evaluation suite runs all 8 configurations', async () => {
    await clickButton(garage, 'Run fixed evaluation suite')
    await garage.waitForSelector('.results-table', { timeout: 90000 })
    await waitText(garage, 'cheapest configuration that passed', 5000).catch(async () => {
      await waitText(garage, 'No affordable configuration passed', 5000)
    })
    const criteria = await garage.$eval('.results-table__criteria', (e) => e.textContent)
    const suite = await (await fetch(`${API}/evaluation/suite?kind=heldout`)).json()
    assert(new RegExp(`\\b\\d+ tests`).test(criteria) && suite.tests.length > 0, `criteria text: ${criteria}`)
    await waitText(garage, 'of 8 configurations pass') // full-suite summary alongside the selected group
    await garage.$eval('.results-table__filter input', (e) => e.click())
    const rows = (await garage.$$('.results-table tbody tr')).length
    assert(rows === 8, `expected 8 rows with the filter off, got ${rows}`)
    await garage.$eval('.results-table__filter input', (e) => e.click())
  })

  await step('garage: never shows a generic SAFE verdict', async () => {
    const text = await bodyText(garage)
    assert(!/\bSAFE\b/.test(text), 'found a bare SAFE')
    assert(text.includes('Passed this test suite') || text.includes('No affordable configuration'), 'no scoped verdict wording')
  })

  await step('garage: shows "No affordable configuration passed" when nothing feasible', async () => {
    await setInput(garage, '.budget-panel__input input', 0, 7000) // available = -1,000: only "do nothing" is affordable
    await waitText(garage, 'No affordable configuration passed the selected test suite.')
    await setInput(garage, '.budget-panel__input input', 0, 12000)
  })

  await step('garage: cost and money remaining are shown for the recommendation', async () => {
    const verdict = await garage.$eval('#garage-verdict', (e) => e.textContent)
    assert(/CAD [\d,]+/.test(verdict) || verdict.includes('No affordable configuration passed'), `verdict: ${verdict}`)
    await selectSomeUpgrade(garage)
    const summary = await garage.$eval('.garage-screen__summary', (e) => e.innerText)
    assert(summary.includes('Remaining after commitments, reserve and upgrades'), summary)
  })
  await shot(garage, '1-garage-results')

  // --------------------------------------------------------------- Compare
  await step('compare: synchronized baseline and upgraded replays', async () => {
    await clickButton(garage, 'Compare baseline vs selected')
    await garage.waitForSelector('.replay-panel canvas', { timeout: 60000 })
    await waitText(garage, 'Automated replay')
    assert((await garage.$$('.replay-panel')).length === 2, 'expected two replay panels')
    const labels = await garage.$$eval('.replay-panel h2', (els) => els.map((e) => e.textContent))
    assert(labels[0].startsWith('Baseline') && labels[1].startsWith('Upgraded'), `labels: ${labels}`)
    assert((await garage.$$('.replay-timeline')).length === 2, 'expected two timelines')
    await assertRendered(garage, '.replay-panel:nth-child(1) canvas', 'baseline replay view')
    await assertRendered(garage, '.replay-panel:nth-child(2) canvas', 'upgraded replay view')
    const before = await garage.$eval('.compare-screen__time', (e) => e.textContent)
    await clickButton(garage, 'Play', { exact: true })
    await sleep(1500)
    const after = await garage.$eval('.compare-screen__time', (e) => e.textContent)
    assert(before !== after, `playback did not advance (${before} -> ${after})`)
    await sleep(800)
    await shot(garage, '2-compare-playing')
  })

  await step('compare: scrubber moves both replays together', async () => {
    await clickButton(garage, 'Pause', { exact: true })
    await setInput(garage, '.compare-screen__controls input[type=range]', 0, 20)
    await sleep(300)
    const t = await garage.$eval('.compare-screen__time', (e) => e.textContent)
    assert(t.startsWith('20.0'), `time label: ${t}`)
  })
  await garage.close()

  // ----------------------------------------------------- Drive + Engineer
  const drive = await newPage('drive')
  const cdp = await drive.createCDPSession()
  await cdp.send('Network.enable')
  const frames = []
  cdp.on('Network.webSocketFrameReceived', (e) => frames.push(e.response.payloadData))

  // Track every WebSocket the page opens so a test can drop one on purpose.
  await drive.evaluateOnNewDocument(() => {
    const Native = window.WebSocket
    window.__sockets = []
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args)
        window.__sockets.push(this)
      }
    }
  })
  await drive.goto(`${BASE}/#drive`)
  let sessionId = ''

  await step('drive: start creates a session and streams telemetry', async () => {
    await clickButton(drive, 'Start session')
    await waitConnected(drive)
    sessionId = await sessionCode(drive)
    assert(/^[0-9a-f]{8}$/.test(sessionId), `session id "${sessionId}"`)
    await drive.keyboard.down('w')
    await sleep(2500)
    const speed = await drive.$eval('.f1-dash__speed strong', (e) => parseFloat(e.textContent))
    await drive.keyboard.up('w')
    assert(speed > 7, `speed (km/h) after holding W: ${speed}`)
    const hud = await drive.$eval('.f1-hud', (e) => e.innerText)
    assert(/lap/i.test(hud) && /S1/.test(hud) && /Next/.test(hud) && /km\/h/.test(hud), `hud: ${hud}`)
  })

  await step('drive: renders track, HUD and controls (screenshot)', async () => {
    await shot(drive, '3-drive')
    await assertRendered(drive, '.drive-screen canvas', 'drive 3D view')
  })

  const engineer = await newPage('engineer')
  await engineer.goto(`${BASE}/#engineer`)

  await step('engineer: joins the driver session', async () => {
    await engineer.type('input[aria-label="Session ID"]', sessionId)
    await clickButton(engineer, 'Join', { exact: true })
    await waitText(engineer, 'Connected')
    await waitText(engineer, sessionId)
    const info = await engineer.$eval('.run-info', (e) => e.innerText)
    assert(/Seed/.test(info) && /Run ID/.test(info), `run info: ${info}`)
    await waitText(drive, 'Engineer connected')
  })

  await step('engineer: a manual uplink-delay fault reaches the driver and is labelled simulated', async () => {
    await engineer.select('.fault-builder select', 'uplink_delay')
    await setInput(engineer, '.fault-builder input[type=range]', 0, 300)
    await clickButton(engineer, 'Add fault', { exact: true })
    await waitText(drive, 'Simulated connection fault')
    await waitText(engineer, 'Simulated connection fault')
    const link = await engineer.$eval('.link-indicators', (e) => e.innerText)
    assert(link.includes('Sim: injected uplink delay') && link.includes('+300 ms'), `link: ${link}`)
    assert(link.includes('Real: driver control age'), 'the real link must be shown separately')
    await engineer.waitForSelector('.active-faults__row', { timeout: 5000 })
  })

  await step('engineer: arming a stress scenario restarts the run; name and faults shown', async () => {
    const before = await engineer.$eval('.run-info', (e) => e.innerText)
    await engineer.select('.scenario-panel select', 'monza_high_speed_blackout')
    await clickButton(engineer, 'Arm scenario')
    // The preset name is already visible in the selector before the server
    // responds. Wait for the run update, not that existing option text.
    await engineer.waitForFunction(
      (previous) => document.querySelector('.run-info')?.innerText !== previous,
      { timeout: 10000 }, before,
    )
    const after = await engineer.$eval('.run-info', (e) => e.innerText)
    assert(before !== after, 'run info did not change')
    assert(frames.some((f) => f.includes('"scenario_id":"monza_high_speed_blackout"')), 'driver never received the scenario')
    const rows = await engineer.$$eval('.active-faults__row', (els) => els.map((e) => e.innerText))
    assert(rows.length >= 1 && rows.every((r) => !/uplink delay.*manual/i.test(r)), `faults after arming: ${rows}`)
  })

  await step('engineer: fault timeline and 3D view render', async () => {
    await assertRendered(engineer, '.engineer-screen__view canvas', 'engineer 3D view')
    await shot(engineer, '4-engineer')
  })

  await step('drive: shows engineer disconnected after the engineer leaves', async () => {
    await engineer.close()
    await waitText(drive, 'Engineer disconnected', 8000)
  })

  await step('recovery: a dropped socket resumes the same session (server stayed up)', async () => {
    const runBefore = await sessionCode(drive)
    const before = await drive.evaluate(() => window.__sockets.length)
    await drive.evaluate(() => window.__sockets.at(-1).close())
    await drive.waitForFunction((n) => window.__sockets.length > n && window.__sockets.at(-1).readyState === 1, { timeout: 10000, polling: 250 }, before)
    await waitConnected(drive)
    const runAfter = await sessionCode(drive)
    assert(runBefore.includes(sessionId) && runAfter.includes(sessionId), 'session id changed across the reconnect')
    // telemetry flows again on the new socket
    const seen = await drive.evaluate(() => new Promise((resolve) => {
      const ws = window.__sockets.at(-1)
      const t = setTimeout(() => resolve(false), 4000)
      ws.addEventListener('message', (e) => { if (e.data.includes('"vehicle_state"')) { clearTimeout(t); resolve(true) } })
    }))
    assert(seen, 'no telemetry after reconnect')
  })

  // ------------------------------------------------------------ Baku (track 2)
  const bakuFrames = []
  cdp.on('Network.webSocketFrameReceived', (e) => bakuFrames.push(e.response.payloadData))
  let bakuSession = ''

  await step('baku: a second track loads and drives through the same simulator', async () => {
    await clickButton(drive, 'End session')
    await clickButton(drive, 'Baku City Circuit')
    await clickButton(drive, 'Start session')
    await waitConnected(drive)
    bakuSession = await sessionCode(drive)
    assert(bakuSession !== sessionId, 'expected a new session id')
    await drive.keyboard.down('w')
    await sleep(2000)
    await drive.keyboard.up('w')
    assert(bakuFrames.some((f) => f.includes('"type":"vehicle_state"')), 'no telemetry on baku')
    await shot(drive, '8-drive-baku')
  })

  const engineer2 = await newPage('engineer-baku')
  await engineer2.goto(`${BASE}/#engineer`)

  await step('baku: engineer sees the Baku track and only Baku scenarios are offered', async () => {
    await engineer2.type('input[aria-label="Session ID"]', bakuSession)
    await clickButton(engineer2, 'Join', { exact: true })
    await waitText(engineer2, 'baku')
    const ids = await engineer2.$$eval('.scenario-panel select option', (els) => els.map((o) => o.value).filter(Boolean))
    assert(ids.includes('baku_late_warning_delivery'), `baku scenarios missing: ${ids}`)
    assert(!ids.some((id) => id.startsWith('monza_')), `monza scenarios offered on baku: ${ids}`)
  })

  await step('baku: late-warning-delivery scenario arms and reaches the driver', async () => {
    await engineer2.select('.scenario-panel select', 'baku_late_warning_delivery')
    await clickButton(engineer2, 'Arm scenario')
    for (let i = 0; i < 40 && !bakuFrames.some((f) => f.includes('"scenario_id":"baku_late_warning_delivery"')); i++) await sleep(250)
    assert(bakuFrames.some((f) => f.includes('"scenario_id":"baku_late_warning_delivery"')), 'driver never received the baku scenario')
    await shot(engineer2, '9-engineer-baku')
  })
  await engineer2.close()

  // --------------------------------------------------------------- Outage
  if (process.env.E2E_OUTAGE) {
    await step('recovery: backend outage shows reconnecting, restart ends the lost session', async () => {
      execSync('lsof -ti tcp:8000 -sTCP:LISTEN | xargs kill -9')
      await waitText(drive, 'Reconnecting', 10000)
      restartBackend()
      await waitText(drive, 'Session lost', 20000) // in-memory sessions don't survive a restart
      await waitText(drive, 'Choose your circuit') // and Start is offered again
    })

    await step('recovery: with the backend down, Compare still plays the backup recording', async () => {
      await waitBackend()
      const p = await newPage('backup')
      try {
        await p.goto(`${BASE}/#garage`)
        await clickButton(p, 'Run fixed evaluation suite')
        await p.waitForSelector('.results-table', { timeout: 90000 })
        await selectSomeUpgrade(p)
        execSync('lsof -ti tcp:8000 -sTCP:LISTEN | xargs kill -9')
        await clickButton(p, 'Compare baseline vs selected')
        await waitText(p, 'backup recording', 20000)
        await p.waitForSelector('.replay-panel canvas', { timeout: 20000 })
        assert((await p.$$('.replay-panel')).length === 2, 'expected two replay panels from the backup')
        await assertRendered(p, '.replay-panel:nth-child(1) canvas', 'backup baseline view')
        await assertRendered(p, '.replay-panel:nth-child(2) canvas', 'backup upgraded view')
        await waitText(p, 'Backend unreachable', 8000)
        await shot(p, '10-compare-backup')
      } finally {
        await p.close()
        restartBackend() // never leave the backend dead for later steps
        await waitBackend()
      }
    })
  }
  await drive.close()

  // ------------------------------------------------------------------ Demo
  const demo = await newPage('demo')
  const demoCdp = await demo.createCDPSession()
  await demoCdp.send('Network.enable')
  const demoFrames = []
  demoCdp.on('Network.webSocketFrameReceived', (e) => demoFrames.push(e.response.payloadData))
  await demo.goto(`${BASE}/#garage`)

  await step('demo: fresh-launch checklist passes (a missing wheel is only a warning)', async () => {
    await clickButton(demo, 'Demo mode')
    await clickButton(demo, 'Run fresh-launch checklist')
    await demo.waitForSelector('.demo-panel__verdict', { timeout: 60000 })
    const checks = await demo.$$eval('.demo-panel__checks li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
    assert(checks.length === 7, `expected 7 checks, got ${checks.length}`)
    assert(!checks.some((c) => c.includes('Failed')), `failed checks: ${checks.filter((c) => c.includes('Failed'))}`)
    await shot(demo, '5-demo-checklist')
  })

  await step('demo: scripted screen transitions through all six steps', async () => {
    await clickButton(demo, 'Start 3-minute demo')
    const location = () => demo.evaluate(() => window.location.hash)
    const expected = [['1 · Brief', '#garage'], ['2 · Drive', '#drive'], ['3 · Inspect', '#compare'], ['4 · Choose', '#garage'], ['5 · Retest', '#garage'], ['6 · Decide', '#garage']]
    for (let i = 0; i < expected.length; i++) {
      await waitText(demo, expected[i][0])
      await sleep(400)
      assert((await location()) === expected[i][1], `${expected[i][0]} landed on ${await location()}`)
      if (i === 1) {
        await waitConnected(demo)
        await sleep(3000) // hidden engineer joins and launches the saved scenario
        assert(demoFrames.some((f) => f.includes('"scenario_id":"monza_high_speed_blackout"')), 'demo engineer never launched the scenario')
      }
      if (i === 2) {
        await demo.waitForSelector('.replay-panel canvas', { timeout: 60000 })
        await shot(demo, '6-demo-inspect')
      }
      if (i === 3) {
        await sleep(4600)
        const spend = await bodyText(demo)
        assert(!/Selected spend\s*CAD 0\b/.test(spend), 'demo should have selected an upgrade in the choose step')
      }
      if (i < expected.length - 1) await clickButton(demo, 'Skip', { exact: true })
    }
    await shot(demo, '7-demo-decide')
    await demo.keyboard.press('Escape')
    await sleep(500)
    assert(!(await bodyText(demo)).includes('Stop (Esc)'), 'Esc did not stop the demo')
  })
  await demo.close()
} finally {
  await browser.close()
}

console.log('\n' + results.join('\n'))
if (colourLog.length) console.log(`\nRendered colours (min ${MIN_COLOURS}): ${colourLog.join(' | ')}`)
const relevant = pageErrors.filter((e) => !/Failed to load resource|WebSocket connection|net::ERR/i.test(e))
if (relevant.length) {
  console.log('\nBrowser console/page errors:')
  for (const e of [...new Set(relevant)]) console.log('  ' + e)
}
console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${SHOTS}`)
process.exit(failed || relevant.length ? 1 : 0)
