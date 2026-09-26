import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { isExtensionError } from './errorSource'

interface ErrorState {
  message: string
}

interface ErrorContextValue {
  error: ErrorState | null
  reportError: (message: string) => void
  clearError: () => void
}

const ErrorContext = createContext<ErrorContextValue | null>(null)

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ErrorState | null>(null)

  const reportError = useCallback((message: string) => setError({ message }), [])
  const clearError = useCallback(() => setError(null), [])

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isExtensionError(event.filename, event.error)) return
      reportError(event.message)
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isExtensionError(undefined, event.reason)) return
      reportError(String(event.reason?.message ?? event.reason ?? 'Unhandled promise rejection'))
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [reportError])

  return (
    <ErrorContext.Provider value={{ error, reportError, clearError }}>
      {children}
    </ErrorContext.Provider>
  )
}

export function useErrorContext() {
  const ctx = useContext(ErrorContext)
  if (!ctx) throw new Error('useErrorContext must be used within ErrorProvider')
  return ctx
}
