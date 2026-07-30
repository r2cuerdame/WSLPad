import { IMPORTANT_PATH_SPECS, RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { ImportantPathInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'
import { assertValidDistroName, shellQuote } from './escape'

/** UNC view of an absolute Linux path inside a distro (goal.md §13). */
export function linuxPathToUnc(distro: string, linuxPath: string): string {
  return '\\\\wsl.localhost\\' + distro + linuxPath.split('/').join('\\')
}

/** Labels for the two dynamic entries appended after IMPORTANT_PATH_SPECS. */
const EXTRA_PATH_LABELS: Record<string, string> = {
  'windows-user-profile': 'Windows user profile',
  'current-project': 'Current project'
}

/** `~` and `~/...` expand via $HOME inside the distro; everything else is literal. */
function pathExpr(specPath: string): string {
  if (specPath === '~') return '"$HOME"'
  if (specPath.startsWith('~/')) return '"$HOME"' + shellQuote(specPath.slice(1))
  return shellQuote(specPath)
}

// First profile-looking directory under /mnt/c/Users; skips the glob-literal
// case when /mnt/c is not mounted via the [ -d ] guard.
const WINDOWS_PROFILE_SNIPPET =
  'for d in /mnt/c/Users/*/; do [ -d "$d" ] || continue; ' +
  'b=${d%/}; b=${b##*/}; ' +
  "case \"$b\" in Public|Default*|'All Users') ;; *) " +
  "printf '%s|%s|%s\\n' windows-user-profile \"/mnt/c/Users/$b\" d; break ;; esac; done"

// Newest non-hidden directory under $HOME that contains .git; prints nothing
// when there is no such project (the entry is then skipped).
const CURRENT_PROJECT_SNIPPET =
  'ls -1t "$HOME" 2>/dev/null | while IFS= read -r b; do ' +
  'case "$b" in .*|"") continue ;; esac; ' +
  '[ -d "$HOME/$b/.git" ] || continue; ' +
  "printf '%s|%s|%s\\n' current-project \"$HOME/$b\" d; break; done"

export function buildImportantPathsScript(): string {
  const lines = IMPORTANT_PATH_SPECS.map(
    (spec) =>
      'p=' +
      pathExpr(spec.path) +
      '; if [ -d "$p" ]; then t=d; elif [ -e "$p" ]; then t=f; else t=x; fi; ' +
      "printf '%s|%s|%s\\n' " +
      shellQuote(spec.id) +
      ' "$p" "$t"'
  )
  lines.push(WINDOWS_PROFILE_SNIPPET, CURRENT_PROJECT_SNIPPET)
  return lines.join('\n')
}

/** Parse `id|resolvedpath|type` lines (type d=dir, f=file, x=missing). */
export function parseImportantPaths(text: string, distro: string): ImportantPathInfo[] {
  const out: ImportantPathInfo[] = []
  const seen = new Set<string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const first = line.indexOf('|')
    const last = line.lastIndexOf('|')
    if (first <= 0 || last <= first) continue
    const id = line.slice(0, first)
    const type = line.slice(last + 1)
    const linuxPath = line.slice(first + 1, last)
    if (type !== 'd' && type !== 'f' && type !== 'x') continue
    if (!linuxPath.startsWith('/')) continue
    if (seen.has(id)) continue
    seen.add(id)
    const spec = IMPORTANT_PATH_SPECS.find((s) => s.id === id)
    const label = spec !== undefined ? spec.label : (EXTRA_PATH_LABELS[id] ?? id)
    out.push({
      id,
      label,
      linuxPath,
      windowsPath: linuxPathToUnc(distro, linuxPath),
      exists: type !== 'x',
      isDirectory: type === 'd' ? true : type === 'f' ? false : null
    })
  }
  return out
}

export async function collectImportantPaths(
  runner: DistroRunner,
  distro: string
): Promise<ImportantPathInfo[]> {
  assertValidDistroName(distro)
  try {
    const res = await runner.runInDistro(distro, buildImportantPathsScript(), {
      timeoutMs: RUNNER_TIMEOUT_MS
    })
    return parseImportantPaths(res.stdout, distro)
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
    return []
  }
}
