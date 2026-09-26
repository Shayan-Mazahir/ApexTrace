import { useEffect, useState } from 'react'
import { fetchHealth } from '../api/health'

export type BackendHealthStatus = 'checking' | 'connected' | 'unreachable'

const POLL_MS = 3000

// Polled, not one-shot: the badge must go red when the backend dies mid-demo.
export function useBackendHealth(): BackendHealthStatus {
  const [status, setStatus] = useState<BackendHealthStatus>('checking')

  useEffect(() => {
    let cancelled = false
    const check = () =>
      fetchHealth()
        .then(() => !cancelled && setStatus('connected'))
        .catch(() => !cancelled && setStatus('unreachable'))
    void check()
    const id = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return status
}
