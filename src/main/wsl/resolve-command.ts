import type { CommandResolution } from '@shared/types'
import type { DistroRunner } from './contracts'
import { classifyToolPath, parseWindowsMounts, WINDOWS_MOUNTS_SCRIPT } from './detectors/tools'

/**
 * Which binary a command name actually runs (issue #62).
 *
 * The question an agent asks constantly and no snapshot answers: `python` may
 * be a shim, a pyenv shell function, or — the classic WSL trap — a Windows
 * executable reached through a Windows drive mount (`/mnt/c` by default)
 * because Windows' PATH is appended to the distro's. `pip install` then writes
 * somewhere the shell will never look.
 *
 * Read-only: it resolves and reports, and never runs the command it found.
 */

/**
 * Command names only. No slash, no space, no shell metacharacter — so the name
 * cannot escape its quotes no matter what an MCP client sends, and cannot be a
 * path either: resolving `/tmp/x` would be running an arbitrary lookup on an
 * arbitrary path rather than answering "what does this name mean here".
 */
const VALID_COMMAND = /^[A-Za-z0-9._+-]{1,64}$/

export function isResolvableCommand(command: string): boolean {
  return VALID_COMMAND.test(command)
}

const BEGIN = (name: string): string => `###WSLPAD_CMD_${name}_BEGIN`
const END = (name: string): string => `###WSLPAD_CMD_${name}_END`

/**
 * `command -v` prints a path, or the bare name for a shell builtin — never a
 * localized word, which is why it is used instead of `type`. The PATH walk is
 * done in the shell rather than in TypeScript so the answer reflects the
 * distro's own PATH, including the Windows entries WSL appends.
 *
 * The MOUNTS section is the tools detector's own /proc/mounts read, so a distro
 * that moved [automount] root (C: at /c or /windows/c) gets the same answer
 * here as on its tool cards. It only reads the mount table.
 */
export function buildResolveScript(command: string): string {
  if (!isResolvableCommand(command)) throw new Error(`not a command name: ${command}`)
  return `c='${command}'
echo "${BEGIN('PATH')}"
printf '%s' "\${PATH:-}" | tr ':' '\\n'
echo "${END('PATH')}"
echo "${BEGIN('WHICH')}"
command -v -- "$c" 2>/dev/null
echo "${END('WHICH')}"
echo "${BEGIN('ALL')}"
oldifs=$IFS
IFS=:
for d in \${PATH:-}; do
  [ -n "$d" ] || d=.
  if [ -x "$d/$c" ] && [ ! -d "$d/$c" ]; then printf '%s\\n' "$d/$c"; fi
done
IFS=$oldifs
echo "${END('ALL')}"
echo "${BEGIN('MOUNTS')}"
${WINDOWS_MOUNTS_SCRIPT}echo "${END('MOUNTS')}"
:`
}

function section(text: string, name: string): string[] {
  const begin = BEGIN(name)
  const end = END(name)
  const lines = text.replace(/\r/g, '').split('\n')
  const from = lines.findIndex((line) => line.trim() === begin)
  if (from < 0) return []
  const rest = lines.slice(from + 1)
  const to = rest.findIndex((line) => line.trim() === end)
  return (to < 0 ? rest : rest.slice(0, to)).filter((line) => line.trim() !== '')
}

/**
 * A path under a Windows drive mount is a Windows executable reached through
 * DrvFs. `mounts` are the DrvFs mount points the distro reported; empty means
 * the table was not read, and the documented /mnt/<drive> layout decides.
 */
export function isWindowsPath(path: string, mounts: readonly string[] = []): boolean {
  return classifyToolPath(path, mounts) === 'windows-mount'
}

export function parseResolution(command: string, stdout: string): CommandResolution {
  const pathEntries = section(stdout, 'PATH')
  const which = section(stdout, 'WHICH')[0]?.trim() ?? null
  const matches = section(stdout, 'ALL').map((line) => line.trim())
  const mounts = parseWindowsMounts(section(stdout, 'MOUNTS').join('\n'))

  if (which === null) {
    return {
      command,
      kind: 'not-found',
      path: null,
      matches: [],
      pathEntries,
      shadowedByWindows: false,
      shadows: []
    }
  }
  // `command -v` answers with the bare name for a builtin, a path for a file.
  if (!which.startsWith('/')) {
    return {
      command,
      kind: 'builtin',
      path: null,
      matches,
      pathEntries,
      shadowedByWindows: false,
      // A builtin wins over every file on PATH — worth saying, because the
      // file someone just installed will not run.
      shadows: matches
    }
  }
  return {
    command,
    kind: 'file',
    path: which,
    matches,
    pathEntries,
    shadowedByWindows: isWindowsPath(which, mounts),
    // Everything the winner hides, in PATH order.
    shadows: matches.filter((m) => m !== which)
  }
}

export async function resolveCommand(
  runner: DistroRunner,
  distro: string,
  command: string
): Promise<CommandResolution | null> {
  if (!isResolvableCommand(command)) return null
  let result
  try {
    result = await runner.runInDistro(distro, buildResolveScript(command), { timeoutMs: 8000 })
  } catch {
    return null
  }
  if (result.timedOut) return null
  return parseResolution(command, result.stdout)
}
