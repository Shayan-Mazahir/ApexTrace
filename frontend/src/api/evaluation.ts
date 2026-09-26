import type {
  EvaluationResponse,
  PairedResponse,
  ReplayResponse,
  TrackProfile,
  UpgradeCatalog,
  UpgradeConfig,
} from '../types/schemas'
import { API_BASE_URL } from './config'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init)
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`)
  return response.json()
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const getUpgradeCatalog = () => request<UpgradeCatalog>('/upgrades')

export const runEvaluation = () => request<EvaluationResponse>('/evaluation/run', { method: 'POST' })

export const getPaired = (scenarioId: string, upgrade: UpgradeConfig) =>
  request<PairedResponse>('/evaluation/paired', post({ scenario_id: scenarioId, upgrade }))

export interface MlStatus {
  tcn: import('../types/schemas').TcnStatus & { metrics?: Record<string, unknown> }
  sac: Record<string, unknown> | null
}

export const getMlStatus = () => request<MlStatus>('/ml/status')

export const getReplay = (testId: string, baseline: UpgradeConfig, upgraded: UpgradeConfig) =>
  request<ReplayResponse>('/evaluation/replay', post({ test_id: testId, baseline, upgraded }))

// A recording of real backend runs, shipped with the frontend so the demo can
// still show a replay if the backend is down.
export type BackupReplay = ReplayResponse & { track_profile: TrackProfile }

export async function loadBackupReplay(): Promise<BackupReplay> {
  const response = await fetch('/backup-replay.json')
  if (!response.ok) throw new Error('No backup replay available')
  return response.json()
}
