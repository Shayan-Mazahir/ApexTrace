import { useSyncExternalStore } from 'react'

// Graphics quality, remembered per machine. 'quality' is the full look: up to
// 1.5x resolution on sharp screens plus the post-processing (SMAA, bloom,
// vignette). 'performance' renders at 1x with no post-processing, for
// integrated GPUs such as Intel Iris Xe, where the full look keeps the GPU
// near 100% even while it still holds its frame rate.
export type GraphicsMode = 'quality' | 'performance'

const STORAGE_KEY = 'limitlab.graphics'
const listeners = new Set<() => void>()

function load(): GraphicsMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'performance' ? 'performance' : 'quality'
  } catch {
    return 'quality' // storage unavailable (private browsing, tests)
  }
}

let current: GraphicsMode = load()

export function setGraphicsMode(mode: GraphicsMode): void {
  current = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // not persisted; still applies for this page
  }
  listeners.forEach((listener) => listener())
}

export function getGraphicsMode(): GraphicsMode {
  return current
}

export function subscribeGraphicsMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Every canvas reads this, so switching it updates all screens at once.
export function useGraphicsMode(): GraphicsMode {
  return useSyncExternalStore(subscribeGraphicsMode, getGraphicsMode)
}
