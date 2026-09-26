import { describe, expect, it } from 'vitest'
import { openSessionConnection, type SocketLike, type StreamConnection } from './connection'

class FakeSocket implements SocketLike {
  readyState = 0
  onopen: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent<string>) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  sent: string[] = []
  closed = false
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true; this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.(new Event('open')) }
  drop() { this.readyState = 3; this.onclose?.({} as CloseEvent) }
}

function harness(existsAnswer: boolean | null | (() => boolean | null) = true) {
  const sockets: FakeSocket[] = []
  const statuses: StreamConnection[] = []
  const messages: string[] = []
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = []
  const conn = openSessionConnection({
    url: 'ws://x/ws/driver/s1',
    sessionId: 's1',
    createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s },
    sessionExists: async () => (typeof existsAnswer === 'function' ? existsAnswer() : existsAnswer),
    onStatus: (s) => statuses.push(s),
    onMessage: (m) => messages.push(m),
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t },
    clearTimer: (h) => { (h as { cleared: boolean }).cleared = true },
  })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const fireTimer = () => { const t = timers.filter((x) => !x.cleared).pop(); t?.fn() }
  return { conn, sockets, statuses, messages, timers, flush, fireTimer }
}

describe('session connection recovery', () => {
  it('connects, forwards messages, and can send while open', () => {
    const h = harness()
    expect(h.statuses).toEqual(['connecting'])
    expect(h.conn.send('early')).toBe(false)
    h.sockets[0].open()
    h.sockets[0].onmessage?.({ data: 'hello' } as MessageEvent<string>)
    expect(h.statuses).toEqual(['connecting', 'connected'])
    expect(h.messages).toEqual(['hello'])
    expect(h.conn.send('cmd')).toBe(true)
    expect(h.sockets[0].sent).toEqual(['cmd'])
  })

  it('reconnects after a drop and resets the backoff once reconnected', async () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].drop()
    await h.flush()
    expect(h.statuses.at(-1)).toBe('reconnecting')
    expect(h.timers.at(-1)?.ms).toBe(500)

    h.fireTimer()
    expect(h.sockets).toHaveLength(2)
    h.sockets[1].open()
    expect(h.statuses.at(-1)).toBe('connected')

    h.sockets[1].drop()
    await h.flush()
    expect(h.timers.at(-1)?.ms).toBe(500) // backoff was reset by the successful reconnect
  })

  it('backs off exponentially while the server keeps refusing', async () => {
    const h = harness()
    h.sockets[0].drop()
    for (let i = 1; i <= 3; i++) {
      await h.flush()
      h.fireTimer()
      h.sockets[i].drop()
    }
    await h.flush()
    expect(h.timers.map((t) => t.ms)).toEqual([500, 1000, 2000, 4000])
  })

  it('stops for good when the session no longer exists', async () => {
    const h = harness(false)
    h.sockets[0].open()
    h.sockets[0].drop()
    await h.flush()
    expect(h.statuses.at(-1)).toBe('closed')
    expect(h.timers).toHaveLength(0)
    expect(h.sockets).toHaveLength(1)
  })

  it('keeps retrying when the server is merely unreachable', async () => {
    const h = harness(null)
    h.sockets[0].drop()
    await h.flush()
    expect(h.statuses.at(-1)).toBe('reconnecting')
    expect(h.timers).toHaveLength(1)
  })

  it('recovers across a server outage: unreachable, then back with the session intact', async () => {
    let up = false
    const h = harness(() => (up ? true : null))
    h.sockets[0].open()
    h.sockets[0].drop()
    await h.flush()
    h.fireTimer()
    h.sockets[1].drop() // still down
    await h.flush()
    up = true
    h.fireTimer()
    h.sockets[2].open()
    expect(h.statuses.at(-1)).toBe('connected')
  })

  it('close() cancels a pending retry and ignores late events', async () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].drop()
    await h.flush()
    h.conn.close()
    expect(h.timers.at(-1)?.cleared).toBe(true)
    h.sockets[0].onmessage?.({ data: 'late' } as MessageEvent<string>)
    expect(h.messages).toEqual([])
    expect(h.conn.send('x')).toBe(false)
  })

  it('ignores events from a socket it has already replaced', async () => {
    const h = harness()
    h.sockets[0].open()
    h.sockets[0].drop()
    await h.flush()
    h.fireTimer()
    h.sockets[0].drop() // stale duplicate close from the old socket
    await h.flush()
    expect(h.sockets).toHaveLength(2)
  })
})
