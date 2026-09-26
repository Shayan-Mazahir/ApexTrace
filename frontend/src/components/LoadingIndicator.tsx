import './LoadingIndicator.css'

interface LoadingIndicatorProps {
  label?: string
}

export function LoadingIndicator({ label = 'Loading' }: LoadingIndicatorProps) {
  return (
    <span className="loading-indicator">
      <span className="loading-indicator__spinner" aria-hidden="true" />
      {label}
    </span>
  )
}
