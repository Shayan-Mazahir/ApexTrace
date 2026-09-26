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
  barrier_offset: number
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

export type WarningDisplayState = 'clear' | 'brake' | 'stale' | 'no_data'

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
  // real, measured: age of the driver device's last control message
  packet_age_ms: number
  // simulated warning-data pipeline
  sample_age_ms: number | null
  injected_delay_ms: number
  warning_path_delay_ms: number
  warning_delivery_delay_ms: number
  blackout: boolean
  local_fallback_active: boolean
  warning_reason: string | null
  warning_state: WarningDisplayState
  true_grip: number
  estimated_grip: number
  track_exit: boolean
  lap_complete: boolean
  off_track: boolean
  track_exits: number
  barrier_contacts: number
  lap: number
  laps_completed: number
  lap_time_s: number
  last_lap_s: number | null
  best_lap_s: number | null
  // TCN observer (null while warming up or unavailable)
  tcn_risk: number | null
  tcn_clearance: number | null
  tcn_spread: number | null
}

// --- stress framework ------------------------------------------------------

export type FaultTarget = 'world' | 'vehicle' | 'sensor' | 'uplink' | 'downlink' | 'warning_service' | 'driver'
export type FaultSource = 'manual' | 'preset' | 'random' | 'sac'
export type TriggerKind = 'always' | 'time' | 'distance' | 'zone' | 'speed_above'

export interface ParamSpec {
  name: string
  unit: string
  min: number
  max: number
  default: number
  description: string
}

export interface FaultType {
  type: string
  label: string
  target: FaultTarget
  status: 'implemented' | 'requires_model_extension'
  description: string
  params: ParamSpec[]
  composition: string
}

export interface Trigger {
  kind: TriggerKind
  start?: number
  end?: number | null
  zone_id?: string | null
  pad_m?: number
  repeat?: 'once_per_run' | 'once_per_lap'
}

export interface FaultSpec {
  id: string
  type: string
  enabled?: boolean
  target?: FaultTarget | null
  trigger?: Trigger
  duration_s?: number | null
  parameters?: Record<string, number>
  ramp_in_s?: number
  ramp_out_s?: number
  seed?: number
  source?: FaultSource
}

export interface StressScenario {
  id: string
  name: string
  description: string
  track: TrackId
  seed: number
  faults: FaultSpec[]
  source: FaultSource
  driver: { kind: string; cruise_speed_ms: number; reaction_s: number }
}

export type FaultLifecycle = 'pending' | 'active' | 'waiting' | 'completed' | 'cancelled'

export interface FaultSummary {
  id: string
  type: string
  target: FaultTarget
  source: FaultSource
  state: FaultLifecycle
  level: number
  description: string
  parameters: Record<string, number>
  activations: number
  remaining_m: number | null
}

export interface EffectiveValues {
  grip: number
  brake_fade: number
  uplink_delay_ms: number
  uplink_loss: number
  blackout: boolean
  downlink_delay_ms: number
  downlink_loss: number
  compute_delay_ms: number
  speed_scale: number
  speed_offset: number
  frozen: string[]
  position_offset: number
  [key: string]: unknown
}

export interface ScenarioOverrides {
  seed?: number
  severity?: number
  zone_id?: string
  duration_s?: number
}

export interface WarningEventMessage {
  type: 'warning_event'
  seq: number
  active: boolean
  state: WarningDisplayState
  reason: string | null
  hazard_zone: string | null
  hazard_id: string | null
  advised_speed: number | null
  source: 'remote' | 'local' | null
  data_age_ms: number | null
  generated_t: number | null
  displayed_t: number
  source_t: number
}

export interface FaultEventMessage {
  type: 'fault_event'
  event: 'fault_activated' | 'fault_deactivated' | 'fault_cancelled'
  t: number
  distance: number
  fault_id: string
  fault_type: string
  target: FaultTarget
  source: FaultSource
  description: string
}

export interface RunEventMessage {
  type: 'run_event'
  event: string
  t: number
  distance?: number
  location?: string | null
}

export interface FaultStateMessage {
  type: 'fault_state'
  faults: FaultSummary[]
  effective: EffectiveValues
  scenario_id: string | null
  distance_along_lap: number
  t: number
}

export interface TcnStatus {
  available: boolean
  reason?: string
  created?: string
  ensemble_size?: number
  window_s?: number
  horizon_s?: number
  test_pr_auc?: number
  test_brier?: number
  test_clearance_mae_m?: number
  role?: string
}

export interface SessionInfoMessage {
  type: 'session_info'
  session_id: string
  run_id: string
  seed: number
  track: TrackId
  scenario_id: string | null
  scenario_name: string | null
  upgrades: UpgradeConfig
  driver_connected: boolean
  engineer_connected: boolean
  engineer_ever_connected: boolean
  tcn: TcnStatus
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
  | FaultEventMessage
  | RunEventMessage
  | SessionInfoMessage
  | HeartbeatMessage
  | ServerErrorMessage

export type ClientCommand =
  | { type: 'pause' | 'resume' | 'reset' | 'pong' | 'cancel_scenario' }
  | { type: 'arm_scenario'; scenario_id: string; overrides?: ScenarioOverrides }
  | { type: 'add_fault'; fault: FaultSpec }
  | { type: 'cancel_fault'; fault_id: string }
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
  scenario_id: string
  track: TrackId
  name: string
  seed: number
  description: string
  faults: string[]
  cruise_speed: number
  reaction_s: number
}

export interface SuiteInfo {
  version: string
  kind: 'dev' | 'heldout'
  acceptance: Acceptance
  tests: SuiteTestInfo[]
}

export interface TestResult {
  test_id: string
  scenario_id: string
  track: TrackId
  passed: boolean
  track_exit: boolean
  completed: boolean
  exit_location: string | null
  min_clearance_m: number
  warnings: number
  unnecessary_warnings: number
  min_warning_margin_m: number | null
  stale_time_s: number
  blackout_time_s: number
  fallback_first_t: number | null
  packets_rejected_old: number
  barrier_contacts: number
  lap_time_s: number | null
  driver_ignored: number
}

export interface ConfigResult {
  key: string
  label: string
  upgrades: UpgradeConfig
  cost_cad: number
  test_count: number
  track_exits: number
  min_clearance_m: number
  min_warning_margin_m: number | null
  unnecessary_warnings: number
  passed: boolean
  failed_test_ids: string[]
  tests: TestResult[]
}

export interface SuiteGroup {
  label: string
  test_ids: string[]
  configs: ConfigResult[]
}

export interface EvaluationResponse {
  suite: SuiteInfo
  groups: Record<string, SuiteGroup>
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
  warning_state: WarningDisplayState
  track_exit: boolean
  lap_complete: boolean
  true_grip: number
  estimated_grip: number
  sample_age_ms: number | null
  fallback_active: boolean
  active_faults: string[]
  tcn_risk?: number | null
  tcn_clearance?: number | null
  tcn_spread?: number | null
}

export interface ReplayRun {
  label: string
  upgrades: UpgradeConfig
  result: TestResult
  frames: ReplayFrame[]
  events: (FaultEventMessage | WarningEventMessage | RunEventMessage)[]
}

export interface ReplayResponse {
  test: SuiteTestInfo
  baseline: ReplayRun
  upgraded: ReplayRun
  tcn?: TcnStatus
}

export interface PairedRow {
  key: string
  label: string
  upgrades: UpgradeConfig
  result: TestResult
}

export interface PairedResponse {
  scenario_id: string
  scenario_name: string
  seed: number
  rows: PairedRow[]
}
