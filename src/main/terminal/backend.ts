import { createHash } from 'crypto'
import type { ConsoleBackendFactory, DistroRunner, PtyHandle } from '../wsl/contracts'
import { assertValidDistroName, assertValidLinuxPath, shellQuote } from '../wsl/escape'
import { BASH_RC, ZSH_RC, syncFilePath } from './rc'

export type ShellKind = 'bash' | 'zsh' | 'other'

const RC_DIR = '$HOME/.cache/wslpad'

/**
 * Install (or refresh) the WSLPad rc file inside the distro through the hidden
 * runner. Content travels via stdin as base64 so no shell escaping of the rc
 * body is needed; the write is skipped when the on-disk sha256 already matches.
 */
export async function ensureRcInstalled(
  runner: DistroRunner,
  distro: string,
  kind: 'bash' | 'zsh'
): Promise<void> {
  assertValidDistroName(distro)
  const content = kind === 'bash' ? BASH_RC : ZSH_RC
  const dir = kind === 'bash' ? RC_DIR : `${RC_DIR}/zdotdir`
  const file = kind === 'bash' ? 'rc.bash' : '.zshrc'
  const sha = createHash('sha256').update(content, 'utf8').digest('hex')
  const script = [
    `dir="${dir}"`,
    'mkdir -p "$dir"',
    `f="$dir/${file}"`,
    `want=${sha}`,
    'have=$(sha256sum "$f" 2>/dev/null | cut -d" " -f1)',
    'if [ "$have" != "$want" ]; then base64 -d > "$f"; fi'
  ].join('\n')
  const res = await runner.runInDistro(distro, script, {
    stdin: Buffer.from(content, 'utf8').toString('base64')
  })
  if (res.code !== 0) {
    throw new Error(`Failed to install console rc in ${distro}: ${res.stderr.trim()}`)
  }
}

/**
 * Install the rc, or give it up. A busy or briefly unreachable distro (WSL is
 * routinely still settling when WSLPad autostarts at Windows login) must not
 * cost the user their console: the plain login shell is launched instead, so
 * only invisible cwd sync degrades. `shellKind` keeps its cached answer, so the
 * next spawn tries the rc again.
 */
export async function installRcOrDegrade(
  runner: DistroRunner,
  distro: string,
  kind: ShellKind
): Promise<ShellKind> {
  if (kind === 'other') return 'other'
  try {
    await ensureRcInstalled(runner, distro, kind)
    return kind
  } catch {
    return 'other'
  }
}

/**
 * wsl.exe arguments for one console session. Paths are relative to the session
 * cwd (`--cd ~`): quotes or `$HOME` would be re-quoted by node-pty's Windows
 * argv encoding and reach the in-distro shell as literal characters, silently
 * skipping the rcfile. 'other' launches plain — a usable console without sync.
 */
export function consoleSpawnArgs(distro: string, kind: ShellKind): string[] {
  const args = ['-d', distro, '--cd', '~']
  if (kind === 'bash') {
    args.push(
      '--',
      'env',
      `WSLPAD_SYNC_FILE=${syncFilePath(distro)}`,
      'bash',
      '--rcfile',
      '.cache/wslpad/rc.bash',
      '-i'
    )
  } else if (kind === 'zsh') {
    args.push(
      '--',
      'env',
      `WSLPAD_SYNC_FILE=${syncFilePath(distro)}`,
      'ZDOTDIR=.cache/wslpad/zdotdir',
      'zsh',
      '-i'
    )
  }
  return args
}

/**
 * Real node-pty console backend (goal.md §8). Spawns wsl.exe under ConPTY with
 * the WSLPad rc injected so the session emits OSC 7 / OSC 133;A markers and
 * consumes cwd sync files invisibly. node-pty is imported lazily so simply
 * loading this module never touches the native addon.
 */
export function createRealConsoleFactory(runner: DistroRunner): ConsoleBackendFactory {
  const shellKinds = new Map<string, ShellKind>()

  const shellKind = async (distro: string): Promise<ShellKind> => {
    assertValidDistroName(distro)
    const cached = shellKinds.get(distro)
    if (cached) return cached
    let res
    try {
      res = await runner.runInDistro(
        distro,
        'sh=$(getent passwd "$(id -un)" | cut -d: -f7); [ -n "$sh" ] || sh=$SHELL; printf %s "$sh"'
      )
    } catch {
      return 'other'
    }
    if (res.code !== 0) return 'other'
    const base = res.stdout.trim().split('/').pop() ?? ''
    const kind: ShellKind = base === 'bash' ? 'bash' : base === 'zsh' ? 'zsh' : 'other'
    shellKinds.set(distro, kind)
    return kind
  }

  const spawn = async (distro: string, cols: number, rows: number): Promise<PtyHandle> => {
    assertValidDistroName(distro)
    const kind = await installRcOrDegrade(runner, distro, await shellKind(distro))
    const args = consoleSpawnArgs(distro, kind)
    const pty = await import('node-pty')
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
    const proc = pty.spawn('wsl.exe', args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd: process.cwd(),
      env
    })
    return {
      write: (data: string) => proc.write(data),
      resize: (c: number, r: number) => proc.resize(Math.max(2, c), Math.max(2, r)),
      kill: () => proc.kill(),
      onData: (cb: (data: string) => void) => {
        proc.onData(cb)
      },
      onExit: (cb: (code: number) => void) => {
        proc.onExit(({ exitCode }) => cb(exitCode))
      }
    }
  }

  // The sync file is deterministic per distro (one console session per distro,
  // goal.md §8.2) so the rc's $WSLPAD_SYNC_FILE, set at spawn time, always
  // matches regardless of the manager's session id.
  const writeCwdSyncFile = async (
    distro: string,
    _sessionId: string,
    path: string
  ): Promise<void> => {
    assertValidDistroName(distro)
    assertValidLinuxPath(path)
    const script = `umask 077 && printf %s ${shellQuote(path)} > ${shellQuote(syncFilePath(distro))}`
    const res = await runner.runInDistro(distro, script)
    if (res.code !== 0) {
      throw new Error(`Failed to write cwd sync file for ${distro}: ${res.stderr.trim()}`)
    }
  }

  return { spawn, writeCwdSyncFile, shellKind }
}
