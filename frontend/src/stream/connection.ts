import { nextBackoffMs } from './reconnect'

export type StreamConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

export interface SocketLike {
  readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  send(data: string): void
  close(): void
}

export interface ConnectionOptions {
  url: string
  sessionId: string
  createSocket: (url: string) => SocketLike
  // true/false when the server answered, null when it could not be reached
  sessionExists: (sessionId: string) => Promise<boolean | null>
  onStatus: (status: StreamConnection) => void
  onMessage: (data: string) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

const OPEN = 1

// A session outlives its sockets on the server, so a dropped socket is
// retried with backoff. A rejected handshake looks like any other drop to the
// browser, so before each retry we ask whether the session still exists: if
// it is gone we stop ('closed'); if the server is merely unreachable we keep
// trying.
export function openSessionConnection(opts: ConnectionOptions) {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let socket: SocketLike | null = null
  let attempt = 0
  let disposed = false
  let timer: unknown

  const connect = () => {
    opts.onStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = opts.createSocket(opts.url)
    socket = ws
    ws.onopen = () => {
      if (disposed || socket !== ws) return
      attempt = 0
      opts.onStatus('connected')
    }
    ws.onmessage = (event) => {
      if (!disposed && socket === ws) opts.onMessage(event.data)
    }
    ws.onclose = () => {
      if (disposed || socket !== ws) return
      opts.onStatus('reconnecting')
      void opts.sessionExists(opts.sessionId).then((exists) => {
        if (disposed) return
        if (exists === false) {
          opts.onStatus('closed')
          return
        }
        timer = setTimer(connect, nextBackoffMs(attempt++))
      })
    }
  }

  connect()

  return {
    send(text: string): boolean {
      if (!socket || socket.readyState !== OPEN) return false
      socket.send(text)
      return true
    },
    close() {
      disposed = true
      clearTimer(timer)
      socket?.close()
      socket = null
    },
  }
}
