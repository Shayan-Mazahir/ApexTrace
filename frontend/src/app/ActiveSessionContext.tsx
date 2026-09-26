import { createContext, useContext, useState, type ReactNode } from 'react'
import type { TrackId, TrackProfile } from '../types/schemas'

export interface DriverSession {
  id: string
  track: TrackId
  seed: number
  profile: TrackProfile
}

interface ActiveSessionContextValue {
  driverSession: DriverSession | null
  setDriverSession: (session: DriverSession | null) => void
}

const ActiveSessionContext = createContext<ActiveSessionContextValue | null>(null)

// Survives screen switches so the Engineer screen can join the session the
// Drive screen created, and the Drive screen can reconnect to it on return.
export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const [driverSession, setDriverSession] = useState<DriverSession | null>(null)
  return (
    <ActiveSessionContext.Provider value={{ driverSession, setDriverSession }}>
      {children}
    </ActiveSessionContext.Provider>
  )
}

export function useActiveSession() {
  const ctx = useContext(ActiveSessionContext)
  if (!ctx) throw new Error('useActiveSession must be used within ActiveSessionProvider')
  return ctx
}
