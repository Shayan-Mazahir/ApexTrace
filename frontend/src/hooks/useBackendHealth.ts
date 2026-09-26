import { useEffect, useState } from 'react'
import { fetchHealth } from '../api/health'

export type BackendHealthStatus = 'checking' | 'connected' | 'unreachable'

export function useBackendHealth(): BackendHealthStatus {
  const [status, setStatus] = useState<BackendHealthStatus>('checking')

  useEffect(() => {
    fetchHealth()
      .then(() => setStatus('connected'))
      .catch(() => setStatus('unreachable'))
  }, [])

  return status
}
