// Live keyboard -> WebSocket -> simulator -> renderer wall-impact check.
// Requires scripts/start.sh. Run: node e2e/barriers.mjs
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
mkdirSync('e2e/shots', { recursive: true })
try {
  for (const track of ['Monza', 'Baku City']) {
    const page = await browser.newPage()
    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    let latest
    let firstImpact
    let predictionSeen = false
    cdp.on('Network.webSocketFrameReceived', ({ response }) => {
      const message = JSON.parse(response.payloadData)
      if (message.type === 'vehicle_state') {
        if (!firstImpact && message.barrier_contacts > 0) firstImpact = message
        latest = message
        predictionSeen ||= message.tcn_risk !== null
      }
    })
    await page.goto(`${process.env.BASE ?? 'http://localhost:5173'}/#drive`)
    await page.waitForFunction((name) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(name)), {}, track)
    const click = (name) => page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text)).click(), name)
    await click(track)
    await click('Start session')
    await page.waitForSelector('.drive-screen[data-connection="connected"]')
    await page.keyboard.down('w')
    await sleep(4500)
    await page.keyboard.down('d')
    const deadline = Date.now() + 25000
    while (!latest?.barrier_contacts && Date.now() < deadline) await sleep(100)
    await page.keyboard.up('d')
    assert(latest?.barrier_contacts > 0, `${track}: no wall contact`)
    assert.equal(firstImpact.speed, 0, `${track}: car did not stop on impact`)
    // Let the steering-release packet arrive and the tiny collision skin
    // settle; steering was still turning while we detected the first hit.
    await sleep(1000)
    const impact = latest
    await sleep(2000) // throttle still held against the wall
    assert.equal(latest.speed, 0, `${track}: throttle pushed through the wall`)
    assert(Math.hypot(latest.x - impact.x, latest.y - impact.y) < 0.02)
    assert(predictionSeen, `${track}: trained observer never supplied live risk`)
    await page.keyboard.up('w')
    await page.screenshot({ path: `e2e/shots/barrier-${track.toLowerCase().replaceAll(' ', '-')}.png` })
    console.log(`PASS ${track}: wall impact stops car, held throttle stays blocked, live TCN predicts`)
    await page.close()
  }
} finally {
  await browser.close()
}
