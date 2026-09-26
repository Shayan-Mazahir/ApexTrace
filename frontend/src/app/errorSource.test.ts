import { describe, expect, it } from 'vitest'
import { isExtensionError } from './errorSource'

const extension = 'chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon/executors/200.js'
const app = 'http://localhost:5173/src/scene/Scene.tsx'

describe('global error source', () => {
  it('recognizes the observed extension error by its script URL', () => {
    expect(isExtensionError(extension, new TypeError("Cannot read properties of undefined (reading 'M_ID')"))).toBe(true)
  })

  it('recognizes extension promise rejections by their throwing frame', () => {
    expect(isExtensionError(undefined, { stack: `TypeError: M_ID\n    at Y (${extension}:1:761)\n    at E (${extension}:1:1442)` })).toBe(true)
  })

  it('keeps app errors even with extension wrappers lower in their stack', () => {
    expect(isExtensionError(undefined, { stack: `TypeError: M_ID\n    at render (${app}:12:5)\n    at hook (${extension}:1:1)` })).toBe(false)
    expect(isExtensionError(app, { stack: `Error\n    at hook (${extension}:1:1)` })).toBe(false)
  })

  it('does not suppress errors just because they mention M_ID or an extension URL', () => {
    expect(isExtensionError(undefined, new Error(`M_ID failed: ${extension}`))).toBe(false)
    expect(isExtensionError('', 'M_ID')).toBe(false)
    expect(isExtensionError(undefined, null)).toBe(false)
    expect(isExtensionError(undefined, { stack: 42 })).toBe(false)
  })
})
