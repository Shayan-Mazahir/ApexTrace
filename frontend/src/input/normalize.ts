export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Subtracts the calibrated center, zeroes anything inside the deadzone, then
// rescales what's left so the full [-1, 1] range is still reachable just
// past the deadzone edge.
export function normalizeSteering(raw: number, center: number, deadzone: number): number {
  const centered = raw - center
  const magnitude = Math.abs(centered)
  if (magnitude <= deadzone) return 0
  const sign = Math.sign(centered)
  const scaled = (magnitude - deadzone) / (1 - deadzone)
  return clamp(sign * scaled, -1, 1)
}

export function normalizePedal(raw: number): number {
  return clamp(raw, 0, 1)
}
