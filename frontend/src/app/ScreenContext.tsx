import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Screen = 'drive' | 'engineer' | 'garage' | 'compare'

export const SCREENS: Screen[] = ['drive', 'engineer', 'garage', 'compare']

interface ScreenContextValue {
  screen: Screen
  setScreen: (screen: Screen) => void
}

const ScreenContext = createContext<ScreenContextValue | null>(null)

export function screenFromHash(hash: string): Screen | null {
  const name = hash.replace(/^#\/?/, '')
  return (SCREENS as string[]).includes(name) ? (name as Screen) : null
}

// The hash mirrors the current screen so a reload (or a shared link) lands on it.
export function ScreenProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<Screen>(() => screenFromHash(window.location.hash) ?? 'drive')

  const setScreen = useCallback((next: Screen) => {
    setScreenState(next)
    if (window.location.hash !== `#${next}`) window.history.replaceState(null, '', `#${next}`)
  }, [])

  useEffect(() => {
    const onHash = () => {
      const fromHash = screenFromHash(window.location.hash)
      if (fromHash) setScreenState(fromHash)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return <ScreenContext.Provider value={{ screen, setScreen }}>{children}</ScreenContext.Provider>
}

export function useScreen() {
  const ctx = useContext(ScreenContext)
  if (!ctx) throw new Error('useScreen must be used within ScreenProvider')
  return ctx
}
