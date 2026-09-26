import { useBackendHealth } from '../hooks/useBackendHealth'
import { StatusBadge } from './StatusBadge'

// Silent while everything works; only speaks up when the backend is down.
export function ConnectionStatus() {
  const status = useBackendHealth()
  if (status !== 'unreachable') return null
  return <StatusBadge label="Backend unreachable — start it with scripts/start.sh" tone="danger" />
}
