import { useBackendHealth } from '../hooks/useBackendHealth'
import { LoadingIndicator } from './LoadingIndicator'
import { StatusBadge } from './StatusBadge'

export function ConnectionStatus() {
  const status = useBackendHealth()

  if (status === 'checking') {
    return <LoadingIndicator label="Connecting to backend" />
  }

  if (status === 'connected') {
    return <StatusBadge label="Backend connected" tone="success" />
  }

  return <StatusBadge label="Backend unreachable" tone="danger" />
}
