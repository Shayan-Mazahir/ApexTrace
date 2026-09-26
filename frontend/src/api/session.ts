import type {
  FaultType,
  StressScenario,
  SessionCreateResponse,
  SessionJoinResponse,
  SessionRole,
  TrackId,
  TrackProfile,
  TrackProfileSummary,
  UpgradeConfig,
} from '../types/schemas'
import { API_BASE_URL } from './config'

export async function listTracks(): Promise<TrackProfileSummary[]> {
  const response = await fetch(`${API_BASE_URL}/tracks`)
  if (!response.ok) {
    throw new Error(`Failed to list tracks: ${response.status}`)
  }
  return response.json()
}

export async function createSession(
  track: TrackId,
  role: SessionRole = 'driver',
  seed?: number,
  upgrades?: UpgradeConfig,
): Promise<SessionCreateResponse> {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track, role, seed, upgrades }),
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

// true/false when the server answered, null when it could not be reached.
export async function sessionExists(sessionId: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'engineer' }),
    })
    if (response.status === 404) return false
    return response.ok ? true : null
  } catch {
    return null
  }
}

export async function listScenarios(): Promise<StressScenario[]> {
  const response = await fetch(`${API_BASE_URL}/scenarios`)
  if (!response.ok) {
    throw new Error(`Failed to list scenarios: ${response.status}`)
  }
  return response.json()
}

export function sessionWebSocketUrl(role: SessionRole, sessionId: string): string {
  const base = API_BASE_URL.replace(/^http/, 'ws')
  return `${base}/ws/${role}/${sessionId}`
}

export async function getTrack(track: TrackId): Promise<TrackProfile> {
  const response = await fetch(`${API_BASE_URL}/tracks/${track}`)
  if (!response.ok) {
    throw new Error(`Failed to load track: ${response.status}`)
  }
  return response.json()
}

export async function getFaultCatalog(): Promise<FaultType[]> {
  const response = await fetch(`${API_BASE_URL}/faults/catalog`)
  if (!response.ok) throw new Error(`Failed to load fault catalog: ${response.status}`)
  return response.json()
}
