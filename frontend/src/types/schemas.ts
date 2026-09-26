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
  track_profile: TrackProfile
}

export interface SessionJoinResponse {
  session_id: string
  role: SessionRole
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
  warning_reason: string | null
  track_exit: boolean
  lap_complete: boolean
}
