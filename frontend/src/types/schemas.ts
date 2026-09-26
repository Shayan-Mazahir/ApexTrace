// Mirrors backend/app/schemas.py — keep both in sync by hand until codegen is added.

export interface HealthStatus {
  status: string
  service: string
}
