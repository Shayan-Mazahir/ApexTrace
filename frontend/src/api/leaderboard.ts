import type { TrackId } from '../types/schemas'
import { API_BASE_URL } from './config'

// Mirrors backend/app/leaderboard.py.
export interface LeaderboardSubmission {
  name: string
  track: TrackId
  score: number
  best_lap_s: number | null
  reaction_avg_s: number | null
  warnings: number
  heeded: number
  barrier_hits: number
}

export interface LeaderboardEntry extends LeaderboardSubmission {
  id: number
  created: number
}

export interface LeaderboardResponse {
  track: TrackId
  entries: LeaderboardEntry[]
  total: number
  reaction_avg_s: number | null
  rank: number | null
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Leaderboard request failed (${response.status})`)
  return (await response.json()) as T
}

export const getLeaderboard = (track: TrackId) =>
  fetch(`${API_BASE_URL}/leaderboard?track=${track}`).then((r) => json<LeaderboardResponse>(r))

export const submitScore = (entry: LeaderboardSubmission) =>
  fetch(`${API_BASE_URL}/leaderboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).then((r) => json<LeaderboardResponse>(r))
