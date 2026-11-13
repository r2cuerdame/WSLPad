/**
 * How the Windows drives are really mounted (goal.md §6.3.1).
 *
 * `[automount] options=` says what was asked for. `/proc/mounts` says what the
 * kernel did. The gap matters most for one option: without `metadata`, `chmod`
 * and `chown` under /mnt/c report success and change nothing — the bits are
 * never stored, so "I already made it executable" is true and useless at the
 * same time. Nothing in WSL surfaces that.
 *
 * Read-only: the options are reported, never rewritten.
 */
import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { DriveMountInfo, DriveMountsInfo } from '@shared/types'
import type { DistroRunner } from './contracts'
import { assertValidDistroName } from './escape'
import { SECTION_MARKER, splitSections } from './system'
import {
  isDrvFsMount,
  normalizeAutomountRoot,
  normalizeBool,
  parseIni,
  parseMounts,
  type MountEntry
} from './wsl-config'

/**
 * Markers go BETWEEN probes, never before the first one: splitSections keys off
 * the marker, so a leading one inserts an empty section 0 and shifts every
 * reading one place. Here that empty first section reads as "/proc/mounts could
 * not be read" and the whole block degrades to unknown.
 */
export const DRIVE_MOUNTS_SCRIPT = [
  'cat /proc/mounts 2>/dev/null || true',
  'cat /etc/wsl.conf 2>/dev/null || true'
].join(`\nprintf '\\n${SECTION_MARKER}\\n'\n`)

/**
 * DrvFs options are not one comma-separated list. On current WSL 2 the drive
 * rides on 9p and its real options live inside the `aname=` value, separated by
 * semicolons: `aname=drvfs;path=C:\;uid=1000;metadata`. Splitting on commas
 * alone — the obvious implementation — never finds `metadata` on any current
 * machine, and would report every drive as lacking it.
 */
export function splitMountOptions(options: string): string[] {
  return options
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function optionValue(parts: readonly string[], name: string): string | null {
  const prefix = `${name}=`
  for (const part of parts) {
    if (part.startsWith(prefix)) return part.slice(prefix.length)
  }
  return null
}

function numericOption(parts: readonly string[], name: string): number | null {
  const raw = optionValue(parts, name)
  if (raw === null || !/^\d+$/.test(raw)) return null
  const n = Number.parseInt(raw, 10)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * A drive mount is one single-letter directory under the automount root. A
 * declared root moves that directory — root=/ gives /c, root=/mnt/win/ gives
 * /mnt/win/c — but the running VM may still hold the previous mounts until
 * wsl --shutdown, so the usual /<root>/<letter> shape keeps counting too.
 */
function isDriveMount(point: string, declaredRoot: string | null): boolean {
  if (/^\/[^/]+\/[A-Za-z]$/.test(point)) return true
  if (declaredRoot === null) return false
  const root = normalizeAutomountRoot(declaredRoot)
  return point.startsWith(root) && /^[A-Za-z]$/.test(point.slice(root.length))
}

export function describeMount(entry: MountEntry): DriveMountInfo {
  const parts = splitMountOptions(entry.options)
  return {
    point: entry.point,
    // `path=C:\` is the Windows side as the kernel recorded it; the source
    // field carries it too, but only on some releases.
    source: optionValue(parts, 'path') ?? (entry.source === 'drvfs' ? null : entry.source),
    metadata: parts.includes('metadata'),
    caseSensitivity: optionValue(parts, 'case'),
    uid: numericOption(parts, 'uid'),
    gid: numericOption(parts, 'gid'),
    umask: optionValue(parts, 'umask'),
    fmask: optionValue(parts, 'fmask'),
    dmask: optionValue(parts, 'dmask'),
    options: entry.options
  }
}

export function parseDriveMounts(stdout: string): DriveMountsInfo | null {
  const sections = splitSections(stdout)
  const mountText = sections[0]
  // No /proc/mounts at all is unknown, which is not the same as no drives.
  if (mountText === undefined || mountText.trim() === '') return null

  const entries = parseIni(sections[1] ?? '')
  const declared = (key: string): string | null => {
    let found: string | null = null
    for (const e of entries) {
      if (e.section === 'automount' && e.key.toLowerCase() === key) found = e.value
    }
    return found === null || found === '' ? null : found
  }

  const root = declared('root')
  const drives = parseMounts(mountText)
    .filter((m) => isDrvFsMount(m) && isDriveMount(m.point, root))
    .map(describeMount)
    .sort((a, b) => a.point.localeCompare(b.point))

  const enabled = declared('enabled')
  const word = enabled === null ? null : normalizeBool(enabled)

  return {
    drives,
    declaredOptions: declared('options'),
    declaredEnabled: word === null ? null : word === 'true'
  }
}

export async function collectDriveMounts(
  runner: DistroRunner,
  distro: string
): Promise<DriveMountsInfo | null> {
  assertValidDistroName(distro)
  try {
    const res = await runner.runInDistro(distro, DRIVE_MOUNTS_SCRIPT, {
      timeoutMs: RUNNER_TIMEOUT_MS
    })
    // Both reads end in `|| true`, so only a cut-off run exits non-zero: a
    // mount table read half-way would drop drives and still look complete.
    if (res.timedOut || res.code !== 0) return null
    return parseDriveMounts(res.stdout)
  } catch {
    // A stopped or wedged distro has no mounts to report; that is unknown.
    return null
  }
}
