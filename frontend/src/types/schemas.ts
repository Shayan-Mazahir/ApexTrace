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

// Driver assists and modes of the 2026 car (backend app/f1_car.py).
export type TractionControl = 'off' | 'medium' | 'full'
export type Gearbox = 'automatic' | 'manual'
export type DrsMode = 'off' | 'auto' | 'manual'
export type ErsMode = 'harvest' | 'balanced' | 'overtake'

export interface CarSetupConfig {
  traction_control: TractionControl
  abs: boolean
  gearbox: Gearbox
  drs_mode: DrsMode
  ers_mode: ErsMode
}

export const DEFAULT_CAR_SETUP: CarSetupConfig = {
  traction_control: 'full',
  abs: true,
  gearbox: 'automatic',
  drs_mode: 'auto',
  ers_mode: 'balanced',
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
  // running totals of button presses; the server acts on the increase
  shift_up_count?: number
  shift_down_count?: number
  drs_toggle_count?: number
  reverse_toggle_count?: number
}

export interface CarSetupMessage {
  type: 'car_setup'
  setup: CarSetupConfig
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
  session_best_lap_s?: number | null // best valid lap this session, kept across resets
  lap_valid?: boolean
  last_lap_valid?: boolean | null
  // car / power unit
  gear?: number // -1 = reverse
  rpm?: number
  battery_pct?: number
  ers_deploy_kw?: number
  drs_open?: boolean
  drs_available?: boolean
  tc_active?: boolean
  wheelspin?: boolean
  lockup?: boolean
  g_lat?: number
  g_long?: number
  setup?: CarSetupConfig
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
  | CarSetupMessage

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

// ===========================================================================
// Lap simulator (Person A): deterministic scenario runs, replays, configuration
// comparison and AI search, served under /simulation, /scenario,
// /configuration, /ai and /ws/simulation.
//
// A scenario is one flying lap of a closed track; `s` wraps at the lap length.
// Units: metres, seconds, m/s, m/s^2, radians unless a name says otherwise
// (`*_ms` = milliseconds). World frame: track starts at the origin heading +x,
// +y is to the left. Simulator values are ground truth; nothing here is a
// real-world probability.
// ===========================================================================

export type TrackName = 'monza' | 'baku'
export type WarningLevel = 'SAFE' | 'CAUTION' | 'BRAKE_NOW'
export type WarningSource = 'remote' | 'local'
export type ConfigurationName =
  | 'baseline'
  | 'brake_service'
  | 'reliable_telemetry'
  | 'local_warning_fallback'

// ---------------------------------------------------------------- scenario

export interface Scenario {
  scenario_id: string
  seed: number
  track: TrackName
  entry_speed: number
  actual_grip: number
  estimated_grip: number
  telemetry_delay_ms: number
  sensor_noise: number
  packet_loss: number
  driver_reaction_delay: number
  warning_margin: number
  brake_effectiveness: number
}

// ------------------------------------------------------- simulation output

export interface VehicleState {
  timestamp: number
  x: number
  y: number
  s: number
  lap_progress: number
  lateral_offset: number
  speed: number
  heading: number
  steering: number
  throttle: number
  brake: number
  acceleration: number
  lateral_acceleration: number
  grip_usage: number
  actual_grip: number
  estimated_grip: number
  boundary_distance: number
  on_track: boolean
  next_corner: string
  warning: WarningLevel
  warning_source: WarningSource
  warning_corner: string | null
  advised_speed: number | null
  measured_speed: number | null
  telemetry_age_ms: number | null
  packet_dropped: boolean
}

export interface CornerMetrics {
  name: string
  entry_speed: number
  approach_max_speed: number
  safe_speed: number
  advised_speed: number
  overspeed_at_entry: number
  warning_timestamp: number | null
  warning_lead_time: number | null
  warning_too_late: boolean
}

export interface SimulationMetrics {
  lap_completed: boolean
  lap_time: number | null
  lap_distance: number
  corners: CornerMetrics[]
  max_overspeed_at_entry: number | null
  corners_with_late_warning: number
  warning_too_late: boolean
  max_lateral_error: number
  max_grip_usage: number
  stale_telemetry_fraction: number
  packets_dropped: number
  sim_time: number
  ticks: number
}

export interface SimulationResult {
  scenario_id: string
  configuration: ConfigurationName
  scenario: Scenario
  success: boolean
  failed: boolean
  left_track: boolean
  failure_reason: 'left_track' | null
  failure_corner: string | null
  failure_s: number | null
  warning_triggered: boolean
  warning_timestamp: number | null
  failure_timestamp: number | null
  minimum_boundary_distance: number
  metrics: SimulationMetrics
  telemetry: VehicleState[] | null
}

// ------------------------------------------------------- track and replay

export interface CornerInfo {
  name: string
  s_entry: number
  s_exit: number
  curvature: number
  radius: number
  direction: 'left' | 'right'
  width: number
}

export interface BrakingZoneInfo {
  corner: string
  s_start: number
  s_end: number
}

export type Point2 = [number, number]

export interface TrackGeometry {
  name: TrackName
  display_name: string
  purpose: string
  width: number
  min_width: number
  length: number
  closed: boolean
  centerline: Point2[]
  left_boundary: Point2[]
  right_boundary: Point2[]
  corners: CornerInfo[]
  braking_zones: BrakingZoneInfo[]
  telemetry_shadow_zones: Point2[]
}

export interface ReplayEvent {
  timestamp: number
  kind:
    | 'caution_shown'
    | 'brake_now_shown'
    | 'corner_entry'
    | 'left_track'
    | 'lap_completed'
    | 'finished'
  detail: string | null
}

export interface Replay {
  replay_id: string
  scenario: Scenario
  configuration: ConfigurationName
  sample_hz: number
  track: TrackGeometry
  frames: VehicleState[]
  events: ReplayEvent[]
  result: SimulationResult
}

// ------------------------------------------------- configuration testing

export interface ScenarioOutcome {
  scenario_id: string
  failed: boolean
  minimum_boundary_distance: number
  warning_too_late: boolean
  failure_corner: string | null
  lap_time: number | null
}

export interface ConfigurationEvaluation {
  configuration: ConfigurationName
  description: string
  scenario_count: number
  stress_test_failures: number
  failed_scenario_ids: string[]
  outcomes: ScenarioOutcome[]
}

export interface ConfigurationComparison {
  scenario_count: number
  scenario_ids: string[]
  evaluations: ConfigurationEvaluation[]
  fixed_vs_baseline: Record<string, string[]>
  new_failures_vs_baseline: Record<string, string[]>
}

export interface ScenarioPreset {
  name: string
  description: string
  scenario: Scenario
}

export interface ConfigurationInfo {
  name: ConfigurationName
  description: string
}

// ------------------------------------------------------------ requests

export interface RunRequest {
  scenario: Partial<Scenario>
  configuration?: ConfigurationName
  include_telemetry?: boolean
}

export interface BatchRequest {
  scenarios: Partial<Scenario>[]
  configuration?: ConfigurationName
}

export interface BatchResult {
  configuration: ConfigurationName
  scenario_count: number
  stress_test_failures: number
  results: SimulationResult[]
}

export interface ReplayRequest {
  scenario: Partial<Scenario>
  configuration?: ConfigurationName
  sample_hz?: number
}

export interface GenerateScenariosRequest {
  count?: number
  seed?: number
  track?: TrackName | null
}

export interface EvaluateRequest {
  scenarios: Partial<Scenario>[]
  configuration?: ConfigurationName
}

export interface CompareRequest {
  scenarios: Partial<Scenario>[]
  configurations?: ConfigurationName[]
}

// ------------------------------------------------- live (/ws/simulation)

export interface LiveStart {
  type: 'start'
  scenario: Partial<Scenario>
  configuration?: ConfigurationName
  mode?: 'scripted' | 'manual'
  rate_hz?: number
  speedup?: number
}

export interface LiveControl {
  type: 'control'
  steering: number
  throttle: number
  brake: number
}

export type LiveServerMessage =
  | { type: 'track'; track: TrackGeometry }
  | { type: 'state'; state: VehicleState }
  | { type: 'result'; result: SimulationResult }
  | { type: 'error'; detail: string }

// ------------------------------------------------------- AI (predictions)
// ModelPrediction values are TCN estimates of the simulator outcome, never a
// simulator result. Ground truth is always a SimulationResult.

export type SearchStrategyName = 'sac' | 'tpe' | 'random'

export interface ModelPrediction {
  kind: 'model_prediction'
  scenario_id: string
  failure_probability: number
  uncertainty: number
  predicted_failure: boolean
}

export interface PredictRequest {
  scenarios: Partial<Scenario>[]
  configuration?: ConfigurationName
}

export interface ScenarioSearchRequest {
  strategy?: SearchStrategyName
  use_tcn_selection?: boolean
  budget?: number
  track?: TrackName | null
  seed?: number
  candidates_per_round?: number
  per_round?: number
}

export interface SearchTestRecord {
  scenario: Scenario
  prediction: ModelPrediction | null
  result: SimulationResult
}

export interface ScenarioSearchResponse {
  strategy_requested: SearchStrategyName
  strategy_used: string
  used_tcn_selection: boolean
  notes: string[]
  budget: number
  simulations_run: number
  stress_test_failures: number
  distinct_failure_conditions: number
  tests_until_first_failure: number | null
  candidates_screened: number
  screening_sim_seconds: number
  tested: SearchTestRecord[]
}

export interface ModelStatus {
  available: boolean
  path: string
  metadata: Record<string, unknown> | null
}

export interface AIStatus {
  tcn: ModelStatus
  tcn_heldout_evaluation: Record<string, unknown> | null
  sac: ModelStatus
  default_strategy: SearchStrategyName
  experiment: Record<string, unknown> | null
}
