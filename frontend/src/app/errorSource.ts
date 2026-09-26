const EXTENSION_SOURCE = /^(?:chrome|moz|safari-web)-extension:\/\//

/** Only classify the throwing script, not extension wrappers later in a stack. */
export function isExtensionError(filename: string | undefined, error: unknown): boolean {
  if (filename) return EXTENSION_SOURCE.test(filename)
  if (!error || typeof error !== 'object' || !('stack' in error) || typeof error.stack !== 'string') {
    return false
  }
  const firstFrame = error.stack.split('\n').find((line) => /^\s*at\s/.test(line) || line.includes('@'))
  if (!firstFrame) return false
  const source = firstFrame.match(/(?:\(|\s|@)((?:chrome|moz|safari-web)-extension:\/\/[^\s)]+)/)?.[1]
  return source !== undefined && EXTENSION_SOURCE.test(source)
}
