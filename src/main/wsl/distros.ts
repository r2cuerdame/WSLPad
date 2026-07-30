import type { DistroState, DistroSummary } from '@shared/types'
import type { DistroRunner } from './contracts'

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
  // wsl.exe exits non-zero when no distros are installed; treat as empty.
  if (verbose.code !== 0 && !verbose.stdout.trim()) return []
  const runningNames = new Set(running.code === 0 ? parseQuietList(running.stdout) : [])
  return parseVerboseList(verbose.stdout, runningNames)
}
