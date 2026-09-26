// Mirrors backend/app/schemas.py — keep both in sync by hand until codegen is added.

export interface HealthStatus {
  status: string
  service: string
}

export type TrackId = 'monza' | 'baku'

export interface TrackProfile {
  id: TrackId
  name: string
  approach_length: number
  corner_radius: number
  corner_arc_degrees: number
  exit_length: number
  track_width: number
  centerline: [number, number][]
  left_edge: [number, number][]
  right_edge: [number, number][]
}

export interface SessionCreateResponse {
  session_id: string
  track_profile: TrackProfile
}

export type SessionRole = 'driver' | 'engineer'

export interface SessionJoinResponse {
  session_id: string
  role: SessionRole
  track_profile: TrackProfile
}

export interface ControlInputMessage {
  type: 'control_input'
  seq: number
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
  track_exit: boolean
  completed: boolean
}
