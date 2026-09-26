import { useCallback, useState } from 'react'
import { joinSession } from '../api/session'
import { useErrorContext } from '../app/ErrorContext'
import { useSessionStream } from '../stream/useSessionStream'
import type { TrackProfile } from '../types/schemas'

interface Joined {
  id: string
  profile: TrackProfile
}

export function useEngineerSession() {
  const { reportError } = useErrorContext()
  const [joined, setJoined] = useState<Joined | null>(null)
  const [joining, setJoining] = useState(false)
  const stream = useSessionStream('engineer', joined?.id ?? null)

  const join = useCallback(
    async (sessionId: string) => {
      const id = sessionId.trim()
      if (!id) return
      setJoining(true)
      try {
        const response = await joinSession(id, 'engineer')
        setJoined({ id: response.session_id, profile: response.track_profile })
      } catch (err) {
        reportError(err instanceof Error ? err.message : 'Failed to join session')
      } finally {
        setJoining(false)
      }
    },
    [reportError],
  )

  const leave = useCallback(() => setJoined(null), [])

  return {
    ...stream,
    joined,
    joining,
    join,
    leave,
    trackProfile: joined?.profile ?? null,
  }
}
