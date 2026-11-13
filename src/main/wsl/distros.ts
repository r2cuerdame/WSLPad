import type { DistroState, DistroSummary } from '@shared/types'
import type { DistroRunner, RunResult } from './contracts'

/**
 * Parse `wsl.exe --list --verbose` output that has already been decoded from
 * UTF-16LE. Localized STATE words are ignored — the running set comes from
 * `--list --running --quiet`, keeping parsing locale-independent (goal.md §18.1).
 */
export function parseVerboseList(
  decoded: string,
  runningNames: ReadonlySet<string>
): DistroSummary[] {
  const lines = decoded.split('\n').map((l) => l.replace(/\s+$/, ''))
  const out: DistroSummary[] = []
  let sawHeader = false
  for (const line of lines) {
    if (!line.trim()) continue
    if (!sawHeader) {
      // First non-empty line is the localized header row.
      sawHeader = true
      continue
    }
    const isDefault = /^\s*\*/.test(line)
    const body = line.replace(/^\s*\*?\s*/, '')
    if (!body) continue
    const tokens = body.split(/\s+/)
    if (tokens.length < 1) continue
    const name = tokens[0]
    if (!name) continue
    const last = tokens[tokens.length - 1]
    const version = last === '1' ? 1 : 2
    const state: DistroState = runningNames.has(name)
      ? 'Running'
      : tokens.length >= 2
        ? 'Stopped'
        : 'Unknown'
    out.push({ name, state, wslVersion: version, isDefault })
  }
  return out
}

/** Parse `--list --quiet` / `--list --running --quiet` decoded output. */
export function parseQuietList(decoded: string): string[] {
  return decoded
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

export async function listDistros(runner: DistroRunner): Promise<DistroSummary[]> {
  const [verbose, running] = await Promise.all([
    runner.runWsl(['--list', '--verbose'], { encoding: 'utf16le' }),
    runner.runWsl(['--list', '--running', '--quiet'], { encoding: 'utf16le' })
  ])
  return fromLists(verbose, running)
}

function fromLists(verbose: RunResult, running: RunResult): DistroSummary[] {
  // wsl.exe exits non-zero when no distros are installed; treat as empty.
  if (verbose.code !== 0 && !verbose.stdout.trim()) return []
  const runningNames = new Set(running.code === 0 ? parseQuietList(running.stdout) : [])
  return parseVerboseList(verbose.stdout, runningNames)
}

/** How long one `--list --verbose` (names, versions, default) is reused. */
export const VERBOSE_LIST_TTL_MS = 60_000

export interface DistroLister {
  list(): Promise<DistroSummary[]>
}

/**
 * listDistros for polling. Which distros run is asked on every call, but the
 * installed set, their versions and the default change only when the user
 * installs, converts or unregisters one — so `--list --verbose` is reused for
 * a minute, and re-read at once when a running name is not in it. Every fast
 * tick used to start both wsl.exe listings; now it starts one.
 */
export function createDistroLister(
  runner: DistroRunner,
  options: { ttlMs?: number; now?: () => number } = {}
): DistroLister {
  const ttlMs = options.ttlMs ?? VERBOSE_LIST_TTL_MS
  const now = options.now ?? Date.now
  let verbose: { at: number; result: RunResult; names: Set<string> } | null = null

  const readVerbose = async (): Promise<RunResult> => {
    const at = now()
    const result = await runner.runWsl(['--list', '--verbose'], { encoding: 'utf16le' })
    const names = new Set(parseVerboseList(result.stdout, new Set()).map((d) => d.name))
    // An unreadable answer is not cached: the next call asks again.
    verbose = result.code === 0 || result.stdout.trim() ? { at, result, names } : null
    return result
  }

  return {
    async list(): Promise<DistroSummary[]> {
      const cached = verbose !== null && now() - verbose.at < ttlMs ? verbose : null
      const [fresh, running] = await Promise.all([
        cached === null ? readVerbose() : Promise.resolve(null),
        runner.runWsl(['--list', '--running', '--quiet'], { encoding: 'utf16le' })
      ])
      let listed = fresh ?? cached!.result
      if (fresh === null && running.code === 0) {
        const known = cached!.names
        if (parseQuietList(running.stdout).some((name) => !known.has(name))) listed = await readVerbose()
      }
      return fromLists(listed, running)
    }
  }
}
