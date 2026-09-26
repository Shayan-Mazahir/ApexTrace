// Mirrors backend/app/schemas.py — keep both in sync by hand until codegen is added.
//
// Units: metres, seconds, m/s, m/s^2, radians unless a name says otherwise
// (`*_ms` = milliseconds). World frame: track starts at the origin heading +x,
// +y is to the left. Simulator values are ground truth; nothing here is a
// real-world probability.

export interface HealthStatus {
  status: string
  service: string
}

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
  corner_curvature: number | null
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
  warning: WarningLevel
  warning_source: WarningSource
  advised_speed: number | null
  measured_speed: number | null
  telemetry_age_ms: number | null
  packet_dropped: boolean
}

export interface SimulationMetrics {
  corner_entry_speed: number | null
  safe_corner_speed: number
  advised_corner_speed: number
  overspeed_at_entry: number | null
  max_lateral_error: number
  max_grip_usage: number
  warning_lead_time: number | null
  warning_too_late: boolean
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
  length: number
  corner_curvature: number
  centerline: Point2[]
  left_boundary: Point2[]
  right_boundary: Point2[]
  corners: CornerInfo[]
  braking_zones: BrakingZoneInfo[]
  telemetry_shadow_zones: Point2[]
}

export interface ReplayEvent {
  timestamp: number
  kind: 'caution_shown' | 'brake_now_shown' | 'corner_entry' | 'left_track' | 'finished'
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
  corner_entry_speed: number | null
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
