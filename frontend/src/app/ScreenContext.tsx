import { createContext, useContext, useState, type ReactNode } from 'react'

export type Screen = 'drive' | 'engineer' | 'garage' | 'compare'

export const SCREENS: Screen[] = ['drive', 'engineer', 'garage', 'compare']

interface ScreenContextValue {
  screen: Screen
  setScreen: (screen: Screen) => void
}

const ScreenContext = createContext<ScreenContextValue | null>(null)

export function ScreenProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<Screen>('drive')
  return <ScreenContext.Provider value={{ screen, setScreen }}>{children}</ScreenContext.Provider>
}

export function useScreen() {
  const ctx = useContext(ScreenContext)
  if (!ctx) throw new Error('useScreen must be used within ScreenProvider')
  return ctx
}
