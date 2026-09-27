import type { UpgradeId } from '../types/schemas'

// One-line, plain-language summary of each upgrade for the cards.
export const UPGRADE_COPY: Record<UpgradeId, { fixes: string; not: string }> = {
  brake_servicing: { fixes: 'Worn brakes: stopping power 75% back to 100%.', not: 'Brakes fading during the run.' },
  comms_improvement: { fixes: 'Slow or lossy pit-wall link: 60% less delay, half the packet loss.', not: 'A complete radio blackout.' },
  local_fallback: { fixes: 'The car warns the driver itself when pit-wall data goes stale.', not: 'Broken sensors (it reads the same ones).' },
}
