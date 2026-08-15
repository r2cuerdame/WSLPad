/**
 * Does a Defender exclusion actually cover this distro's image?
 *
 * Pure over the cached snapshot, like port ownership: the answer needs one
 * fact from the Defender read and one from the disk section, and neither
 * collector should have to wait for the other.
 */
import type { DefenderInfo, DiskImageInfo } from './types'

export type DefenderCoverage =
  /** An exclusion covers the image; Defender is not scanning it. */
  | 'covered'
  /** The list was readable and nothing in it covers the image. */
  | 'not-covered'
  /** The list could not be read, or there is no image path to judge. */
  | 'unknown'

/** Windows paths are case-insensitive, and a trailing slash means nothing. */
function normalize(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\//g, '\\')
    .toLowerCase()
}

/**
 * An exclusion on a folder covers everything under it, so this is a segment
 * boundary test rather than a plain prefix — `C:\wsl` must not be taken to
 * cover `C:\wsl-backup\ext4.vhdx`.
 */
export function pathCovers(exclusion: string, target: string): boolean {
  const a = normalize(exclusion)
  const b = normalize(target)
  if (a === '' || b === '') return false
  return b === a || b.startsWith(`${a}\\`)
}

export function defenderCoverage(
  defender: DefenderInfo | null,
  disk: DiskImageInfo | null
): DefenderCoverage {
  if (defender === null || defender.exclusionPaths === null) return 'unknown'
  // The image itself is the thing being scanned; its folder is what a user
  // would sensibly exclude, so either one counts as covered.
  const targets = [disk?.vhdxPath ?? null, disk?.basePath ?? null].filter(
    (p): p is string => p !== null && p !== ''
  )
  if (targets.length === 0) return 'unknown'
  const hit = defender.exclusionPaths.some((ex) => targets.some((t) => pathCovers(ex, t)))
  return hit ? 'covered' : 'not-covered'
}

/** The folder to suggest excluding: the whole distro directory, not one file. */
export function suggestedExclusion(disk: DiskImageInfo | null): string | null {
  return disk?.basePath ?? null
}

/** Offered as text to copy — it needs an elevated PowerShell this app has not got. */
export function addExclusionCommand(path: string): string {
  // Single quotes are PowerShell's literal string; a quote inside a path is
  // impossible on Windows, but doubling is the correct escape regardless.
  return `Add-MpPreference -ExclusionPath '${path.replace(/'/g, "''")}'`
}
