/**
 * Per-directory sizes for the Explorer (issue #31).
 *
 * `df` says a distro is 40 GB; it never says which directory caused it. The
 * usual answer is "install ncdu", which means installing a package in every
 * distro just to read a number. This measures the immediate children of one
 * directory with a single batched `du -s` and hands back the result sorted,
 * so the Explorer can answer the question without adding anything to the
 * distro and without a mutating command.
 */
import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { DirSizeEntry, DirSizeResult, FileEntry } from '@shared/types'
import type { DistroRunner } from '../wsl/contracts'
import { assertValidLinuxPath, shellQuoteAll } from '../wsl/escape'
import { listDirectory } from './listing'

/**
 * Children measured in one pass. du walks each subtree, so the cost is the
 * tree and not the argument list; the cap exists so a directory with tens of
 * thousands of entries cannot build an argv the shell refuses.
 */
export const DIR_SIZE_CHILD_CAP = 400

/**
 * `du -s` prints one `<bytes>\t<path>` line per argument, with the path
 * verbatim as it was passed, which is what makes exact-match parsing safe.
 * LC_ALL=C keeps the diagnostics parseable; -x stays on one filesystem so
 * measuring / does not wander into /mnt and time out on the Windows drive.
 */
export function buildDirSizesScript(paths: string[]): string {
  return `LC_ALL=C du -s -x --block-size=1 -- ${shellQuoteAll(paths)}`
}

/** Parse du stdout into path → bytes. Unparseable lines are dropped. */
export function parseDuOutput(stdout: string): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const bytes = Number.parseInt(line.slice(0, tab), 10)
    const path = line.slice(tab + 1)
    if (!Number.isFinite(bytes) || path.length === 0) continue
    sizes.set(path, bytes)
  }
  return sizes
}

/**
 * Paths du reported but could not fully read. Their totals are floors, not
 * answers, so the UI has to say so instead of showing them as final.
 */
export function parseDuPartials(stderr: string): Set<string> {
  const partial = new Set<string>()
  for (const line of stderr.split('\n')) {
    const match = /(?:cannot read directory|cannot access|Permission denied)[^']*'([^']+)'/.exec(
      line
    )
    if (match !== null) partial.add(match[1])
  }
  return partial
}

/** Which measured path a du diagnostic belongs to: itself or an ancestor of it. */
function ownerOf(reported: string, requested: string[]): string | null {
  for (const path of requested) {
    if (reported === path || reported.startsWith(`${path}/`)) return path
  }
  return null
}

function byLargest(a: DirSizeEntry, b: DirSizeEntry): number {
  if (a.sizeBytes === null && b.sizeBytes === null) return a.name.localeCompare(b.name)
  // Unmeasured entries sink to the bottom: an unknown is not a small number.
  if (a.sizeBytes === null) return 1
  if (b.sizeBytes === null) return -1
  return b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name)
}

function emptyResult(path: string, patch: Partial<DirSizeResult> = {}): DirSizeResult {
  return {
    path,
    entries: [],
    totalBytes: null,
    skipped: 0,
    cancelled: false,
    error: null,
    ...patch
  }
}

export interface DirSizeOptions {
  /** Polled between the two phases; a cancelled run reports no numbers at all. */
  isCancelled?: () => boolean
  /** Children listed and passed in already — skips the listing round trip. */
  children?: FileEntry[]
}

/**
 * Measure the immediate children of one directory.
 *
 * Failures degrade per entry: a child du could not read keeps sizeBytes null
 * instead of 0, and a du that fails outright leaves every size null rather
 * than reporting an empty directory that is not empty.
 */
export async function collectDirSizes(
  runner: DistroRunner,
  distro: string,
  dirPath: string,
  opts: DirSizeOptions = {}
): Promise<DirSizeResult> {
  assertValidLinuxPath(dirPath)
  const cancelled = opts.isCancelled ?? ((): boolean => false)

  const children = opts.children ?? (await listDirectory(runner, distro, dirPath, true))
  if (cancelled()) return emptyResult(dirPath, { cancelled: true })

  // A tab would make du's `<bytes>\t<path>` output ambiguous, so such a child
  // is listed as unmeasured rather than matched to the wrong number.
  const measurable = children.filter((c) => !c.path.includes('\t'))
  const measured = measurable.slice(0, DIR_SIZE_CHILD_CAP)
  const skipped = children.length - measured.length

  if (measured.length === 0) {
    return emptyResult(dirPath, { skipped, totalBytes: children.length === 0 ? 0 : null })
  }

  const paths = measured.map((c) => c.path)
  const result = await runner.runInDistro(distro, buildDirSizesScript(paths), {
    timeoutMs: RUNNER_SLOW_TIMEOUT_MS
  })
  if (cancelled()) return emptyResult(dirPath, { cancelled: true })

  // du exits non-zero when single children are unreadable but still measures
  // the rest, so only an empty stdout means the whole run failed.
  if (result.timedOut || (result.code !== 0 && result.stdout.length === 0)) {
    return emptyResult(dirPath, {
      skipped,
      error: result.timedOut ? `Timed out measuring ${dirPath}` : result.stderr.trim() || 'du failed'
    })
  }

  const sizes = parseDuOutput(result.stdout)
  const partials = new Set<string>()
  for (const reported of parseDuPartials(result.stderr)) {
    const owner = ownerOf(reported, paths)
    if (owner !== null) partials.add(owner)
  }

  let total: number | null = null
  const entries = measured.map<DirSizeEntry>((child) => {
    const bytes = sizes.get(child.path)
    if (bytes !== undefined) total = (total ?? 0) + bytes
    return {
      name: child.name,
      path: child.path,
      isDirectory: child.type === 'directory',
      sizeBytes: bytes ?? null,
      partial: partials.has(child.path)
    }
  })
  entries.sort(byLargest)

  return { path: dirPath, entries, totalBytes: total, skipped, cancelled: false, error: null }
}
