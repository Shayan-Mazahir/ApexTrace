import type { SessionCreateResponse, SessionJoinResponse, SessionRole, TrackId } from '../types/schemas'
import { API_BASE_URL } from './config'

export async function createSession(track: TrackId): Promise<SessionCreateResponse> {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track }),
  })
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`)
  }
  return response.json()
}

export async function joinSession(
  sessionId: string,
  role: SessionRole = 'driver',
): Promise<SessionJoinResponse> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  if (!response.ok) {
    throw new Error(`Failed to join session: ${response.status}`)
  }
  return response.json()
}

export function driverWebSocketUrl(sessionId: string): string {
  const base = API_BASE_URL.replace(/^http/, 'ws')
  return `${base}/ws/driver/${sessionId}`
}
