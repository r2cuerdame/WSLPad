import { shellQuote, shellQuoteAll } from '@shared/shell-quote'

// Quoting moved to shared/ so the profile resolver (issue #90) builds the same
// prepared commands; re-exported here so runner/collector imports keep one path.
export { shellQuote, shellQuoteAll }

const DISTRO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Conservative distro-name allowlist (goal.md §16). */
export function isValidDistroName(name: string): boolean {
  return name.length > 0 && name.length <= 128 && DISTRO_NAME_RE.test(name)
}

export function assertValidDistroName(name: string): void {
  if (!isValidDistroName(name)) {
    throw new Error(`Invalid WSL distro name: ${JSON.stringify(name)}`)
  }
}

/** Absolute Linux path guard shared by explorer/MCP surfaces. */
export function isValidLinuxPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 4096 &&
    path.startsWith('/') &&
    !path.includes('\0') &&
    !path.includes('\n')
  )
}

export function assertValidLinuxPath(path: string): void {
  if (!isValidLinuxPath(path)) {
    throw new Error(`Invalid Linux path: ${JSON.stringify(path)}`)
  }
}
