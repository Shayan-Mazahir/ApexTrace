import { useErrorContext } from '../app/ErrorContext'
import './ErrorBanner.css'

export function ErrorBanner() {
  const { error, clearError } = useErrorContext()

  if (!error) return null

  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__glyph" aria-hidden="true">
        ✕
      </span>
      <span className="error-banner__message">{error.message}</span>
      <button className="error-banner__dismiss" onClick={clearError} type="button">
        Dismiss
      </button>
    </div>
  )
}
