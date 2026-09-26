// Mirrors backend/app/schemas.py — keep both in sync by hand until codegen is added.

export interface HealthStatus {
  status: string
  service: string
}

export type TrackId = 'monza' | 'baku'
export type SessionRole = 'driver' | 'engineer'
export type HazardKind = 'braking_zone' | 'chicane' | 'sweeper' | 'narrow'

export interface Sector {
  index: number
  name: string
  start_distance: number
  end_distance: number
  start_position: [number, number]
}

export interface HazardZone {
  id: string
  kind: HazardKind
  label: string
  start_distance: number
  end_distance: number
  position: [number, number]
  corner_speed: number
}

export interface TrackProfile {
  id: TrackId
  name: string
  seed: number
  track_width: number
  total_length: number
  start_finish: [number, number]
  centerline: [number, number][]
  left_edge: [number, number][]
  right_edge: [number, number][]
  sectors: Sector[]
  hazard_zones: HazardZone[]
}

export interface TrackProfileSummary {
  id: TrackId
  name: string
  total_length: number
  track_width: number
  sector_count: number
  hazard_zone_count: number
}

export interface SessionCreateResponse {
  session_id: string
  role: SessionRole
  run_id: string
  seed: number
  track_profile: TrackProfile
}

export interface SessionJoinResponse {
  session_id: string
  role: SessionRole
  run_id: string
  seed: number
  track_profile: TrackProfile
}

export interface ControlInputMessage {
  type: 'control_input'
  seq: number
  session_id: string
  track: TrackId
  seed: number
  t_client: number
  steering: number
  throttle: number
  brake: number
}

export interface VehicleStateMessage {
  type: 'vehicle_state'
  seq: number
  t: number
  x: number
  y: number
  heading: number
  speed: number
  lap_progress: number
  sector_index: number
  sector_name: string
  distance_along_lap: number
  next_hazard_zone: string | null
  next_hazard_distance: number | null
  signed_clearance: number
  packet_age_ms: number
  injected_delay_ms: number
  warning_path_delay_ms: number
  local_fallback_active: boolean
  warning_reason: string | null
  track_exit: boolean
  lap_complete: boolean
}

export interface FaultState {
  grip_multiplier: number
  telemetry_delay_ms: number
  brake_wear: number
}

// Hard limits, mirroring backend FaultState.
export const FAULT_LIMITS = {
  grip_multiplier: { min: 0.65, max: 1 },
  telemetry_delay_ms: { min: 0, max: 400 },
  brake_wear: { min: 0.75, max: 1 },
} as const

export const NO_FAULTS: FaultState = { grip_multiplier: 1, telemetry_delay_ms: 0, brake_wear: 1 }

export interface ScenarioConfig {
  id: string
  name: string
  description: string
  track: TrackId
  seed: number
  faults: FaultState
  onset_distance: number
  end_distance: number
}

export interface WarningEventMessage {
  type: 'warning_event'
  seq: number
  active: boolean
  reason: string | null
  hazard_zone: string | null
  hazard_id: string | null
  advised_speed: number | null
  source_t: number
}

export interface FaultStateMessage {
  type: 'fault_state'
  manual: FaultState
  effective: FaultState
  scenario_id: string | null
  scenario_active: boolean
  distance_along_lap: number
  t: number
}

export interface SessionInfoMessage {
  type: 'session_info'
  session_id: string
  run_id: string
  seed: number
  track: TrackId
  scenario_id: string | null
  upgrades: UpgradeConfig
  driver_connected: boolean
  engineer_connected: boolean
  engineer_ever_connected: boolean
}

export interface HeartbeatMessage {
  type: 'heartbeat'
  t: number
}

export interface ServerErrorMessage {
  type: 'error'
  code: string
  message: string
}

export type ServerMessage =
  | VehicleStateMessage
  | WarningEventMessage
  | FaultStateMessage
  | SessionInfoMessage
  | HeartbeatMessage
  | ServerErrorMessage

export type ClientCommand =
  | { type: 'pause' | 'resume' | 'reset' | 'pong' | 'clear_scenario' }
  | { type: 'set_faults'; faults: FaultState }
  | { type: 'launch_scenario'; scenario_id: string }
  | ControlInputMessage

export type UpgradeId = 'brake_servicing' | 'comms_improvement' | 'local_fallback'
export const UPGRADE_IDS: UpgradeId[] = ['brake_servicing', 'comms_improvement', 'local_fallback']

export type UpgradeConfig = Record<UpgradeId, boolean>
export const NO_UPGRADES: UpgradeConfig = {
  brake_servicing: false,
  comms_improvement: false,
  local_fallback: false,
}

export interface UpgradeSpec {
  id: UpgradeId
  name: string
  price_cad: number
  parameter: string
  change: string
  params: Record<string, number>
}

export interface BudgetDefaults {
  cash_on_hand: number
  remaining_commitments: number
  reserve: number
}

export interface UpgradeOption {
  key: string
  label: string
  upgrades: UpgradeConfig
  cost_cad: number
}

export interface UpgradeCatalog {
  budget_defaults: BudgetDefaults
  upgrades: UpgradeSpec[]
  configs: UpgradeOption[]
}

export interface Acceptance {
  max_track_exits: number
  min_clearance_m: number
  require_lap_complete: boolean
}

export interface SuiteTestInfo {
  id: string
  track: TrackId
  name: string
  seed: number
  faults: FaultState
  onset_distance: number
  end_distance: number
  cruise_speed: number
  reaction_s: number
  lateral_offset: number
}

export interface SuiteInfo {
  version: string
  acceptance: Acceptance
  tests: SuiteTestInfo[]
}

export interface TestResult {
  test_id: string
  track: TrackId
  passed: boolean
  track_exit: boolean
  completed: boolean
  min_clearance_m: number
  min_warning_lead_s: number | null
  warnings_missed: number
  lap_time_s: number | null
}

export interface ConfigResult {
  key: string
  label: string
  upgrades: UpgradeConfig
  cost_cad: number
  test_count: number
  track_exits: number
  min_clearance_m: number
  min_warning_lead_s: number | null
  warnings_missed: number
  passed: boolean
  failed_test_ids: string[]
  tests: TestResult[]
}

export interface EvaluationResponse {
  suite: SuiteInfo
  configs: ConfigResult[]
}

export interface ReplayFrame {
  t: number
  x: number
  y: number
  heading: number
  speed: number
  throttle: number
  brake: number
  distance: number
  clearance: number
  warning_active: boolean
  track_exit: boolean
  lap_complete: boolean
}

export interface ReplayRun {
  label: string
  upgrades: UpgradeConfig
  result: TestResult
  frames: ReplayFrame[]
}

export interface ReplayResponse {
  test: SuiteTestInfo
  baseline: ReplayRun
  upgraded: ReplayRun
}
