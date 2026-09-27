import { afterEach, describe, expect, it, vi } from 'vitest'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

// graphics.ts reads storage once at import (a page load), so each case
// imports it fresh.
async function pageLoad(storage: object) {
  vi.resetModules()
  vi.stubGlobal('localStorage', storage)
  return import('./graphics')
}

afterEach(() => vi.unstubAllGlobals())

describe('graphics setting', () => {
  it('defaults to the full-quality look and writes nothing until chosen', async () => {
    const storage = fakeStorage()
    const g = await pageLoad(storage)
    expect(g.getGraphicsMode()).toBe('quality')
    expect(storage.data).toEqual({})
  })

  it('remembers Performance across a page reload', async () => {
    const storage = fakeStorage()
    const first = await pageLoad(storage)
    first.setGraphicsMode('performance')
    expect(first.getGraphicsMode()).toBe('performance')

    const reloaded = await pageLoad(storage)
    expect(reloaded.getGraphicsMode()).toBe('performance')
  })

  it('tells every subscribed screen when it changes, and stops after unsubscribe', async () => {
    const g = await pageLoad(fakeStorage())
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = g.subscribeGraphicsMode(a)
    g.subscribeGraphicsMode(b)
    g.setGraphicsMode('performance')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    unsubscribeA()
    g.setGraphicsMode('quality')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('treats anything unexpected in storage as Quality', async () => {
    const g = await pageLoad(fakeStorage({ 'limitlab.graphics': 'ultra' }))
    expect(g.getGraphicsMode()).toBe('quality')
  })

  it('still works when storage is blocked', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const g = await pageLoad(blocked)
    expect(g.getGraphicsMode()).toBe('quality')
    expect(() => g.setGraphicsMode('performance')).not.toThrow()
    expect(g.getGraphicsMode()).toBe('performance') // applies for this page anyway
  })
})
