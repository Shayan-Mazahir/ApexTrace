import './StatusBadge.css'

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

// Text label + glyph always carry the meaning; color is a redundant accent,
// never the only signal (a colorblind viewer, or a printout, still reads it).
const GLYPH: Record<StatusTone, string> = {
  success: '●',
  info: '◆',
  warning: '▲',
  danger: '✕',
  neutral: '○',
}

interface StatusBadgeProps {
  label: string
  tone: StatusTone
}

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className="status-badge__glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      {label}
    </span>
  )
}
