export type ConnectionLevel = 'good' | 'degraded' | 'poor' | 'offline'

export interface ConnectionQuality {
  level: ConnectionLevel
  label: string
}

export const DEGRADED_AGE_MS = 100
export const POOR_AGE_MS = 300
export const SILENCE_MS = 2500

// Uses the *measured* signals only (link silence and server-measured packet
// age). Injected delay is deliberately excluded: it is a test condition, not
// a property of the link, and is displayed separately.
export function classifyConnection(input: {
  connected: boolean
  msSinceLastMessage: number | null
  packetAgeMs: number | null
}): ConnectionQuality {
  const { connected, msSinceLastMessage, packetAgeMs } = input
  if (!connected) return { level: 'offline', label: 'Offline' }
  if (msSinceLastMessage === null || msSinceLastMessage > SILENCE_MS) {
    return { level: 'poor', label: 'Poor (no data)' }
  }
  const age = packetAgeMs ?? 0
  if (age >= POOR_AGE_MS) return { level: 'poor', label: 'Poor' }
  if (age >= DEGRADED_AGE_MS) return { level: 'degraded', label: 'Degraded' }
  return { level: 'good', label: 'Good' }
}
