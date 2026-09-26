export const BACKOFF_BASE_MS = 500
export const BACKOFF_MAX_MS = 5000

export function nextBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt))
}
