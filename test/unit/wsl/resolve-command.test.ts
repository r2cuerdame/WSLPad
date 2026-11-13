import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  buildResolveScript,
  isResolvableCommand,
  isWindowsPath,
  parseResolution,
  resolveCommand
} from '../../../src/main/wsl/resolve-command'
import { WINDOWS_MOUNTS_SCRIPT } from '../../../src/main/wsl/detectors/tools'

class FakeRunner implements DistroRunner {
  scripts: string[] = []
  constructor(private result: RunResult | Error) {}
  async runWsl(): Promise<RunResult> {
    throw new Error('not used')
  }
  async runInDistro(_distro: string, script: string, _opts?: RunOptions): Promise<RunResult> {
    this.scripts.push(script)
    if (this.result instanceof Error) throw this.result
    return this.result
  }
  async disposeAll(): Promise<void> {}
}

const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0, timedOut: false })

function output(opts: {
  path?: string
  all?: string[]
  pathEntries?: string[]
  mounts?: string[]
}): string {
  return [
    '###WSLPAD_CMD_PATH_BEGIN',
    ...(opts.pathEntries ?? ['/usr/local/bin', '/usr/bin', '/mnt/c/Windows/System32']),
    '###WSLPAD_CMD_PATH_END',
    '###WSLPAD_CMD_WHICH_BEGIN',
    ...(opts.path === undefined ? [] : [opts.path]),
    '###WSLPAD_CMD_WHICH_END',
    '###WSLPAD_CMD_ALL_BEGIN',
    ...(opts.all ?? []),
    '###WSLPAD_CMD_ALL_END',
    '###WSLPAD_CMD_MOUNTS_BEGIN',
    ...(opts.mounts ?? []).map((m) => `MNT:${m}`),
    '###WSLPAD_CMD_MOUNTS_END'
  ].join('\n')
}

/** Parse with a local POSIX sh when one is reachable; same rules as detectors.test. */
function shSyntaxCheck(script: string): { ran: boolean; ok: boolean; message: string } {
  const res = spawnSync('sh', ['-n'], { input: script, timeout: 20000, windowsHide: true })
  if (res.error) return { ran: false, ok: false, message: '' }
  const message = `${res.stdout?.toString('utf8') ?? ''}${res.stderr?.toString('utf8') ?? ''}`.trim()
  if (res.status === 0) return { ran: true, ok: true, message }
  if (/syntax error|unexpected|parse error/i.test(message)) {
    return { ran: true, ok: false, message }
  }
  return { ran: false, ok: false, message: '' }
}

describe('what counts as a command name', () => {
  it('accepts names and refuses everything that is not one', () => {
    expect(isResolvableCommand('python3')).toBe(true)
    expect(isResolvableCommand('docker-compose')).toBe(true)
    expect(isResolvableCommand('g++')).toBe(true)

    // A path is a different question, and a shell metacharacter is an attack.
    expect(isResolvableCommand('/usr/bin/python')).toBe(false)
    expect(isResolvableCommand('a; rm -rf /')).toBe(false)
    expect(isResolvableCommand("x'y")).toBe(false)
    expect(isResolvableCommand('$(id)')).toBe(false)
    expect(isResolvableCommand('a b')).toBe(false)
    expect(isResolvableCommand('')).toBe(false)
  })

  it('refuses to build a script for anything it would not accept', () => {
    expect(() => buildResolveScript("x'; id; '")).toThrow()
  })
})

describe('the resolve script', () => {
  it('asks the distro, and only asks', () => {
    const script = buildResolveScript('python3')
    expect(script).toContain("c='python3'")
    expect(script).toContain('command -v -- "$c"')
    // The command must be resolved, never run: the name never appears as the
    // first word of a line on its own.
    expect(script).not.toMatch(/^python3/m)
    // `type` is localized in some shells; `command -v` prints a path.
    expect(script).not.toContain('type -a')
  })

  it('reads the drive mounts from the mount table, and only reads it', () => {
    const script = buildResolveScript('python3')
    const mounts = script.slice(
      script.indexOf('###WSLPAD_CMD_MOUNTS_BEGIN'),
      script.indexOf('###WSLPAD_CMD_MOUNTS_END')
    )
    // The tools detector's own probe, so both answer the same question the same way.
    expect(mounts).toContain(WINDOWS_MOUNTS_SCRIPT)
    expect(mounts).toContain('done < /proc/mounts')
    expect(mounts).toContain('printf \'%s\\n\' "MNT:$mp"')
    // Nothing in it runs the resolved command or writes anywhere.
    expect(mounts).not.toContain('$c')
    expect(mounts).not.toMatch(/(^|[^<])>[^&]/m)
    expect(script.trimEnd().endsWith(':')).toBe(true)
  })

  it('is one well-formed sh program', () => {
    const verdict = shSyntaxCheck(buildResolveScript('python3'))
    if (verdict.ran) expect(verdict.ok ? '' : verdict.message).toBe('')
  })
})

describe('parseResolution', () => {
  it('reports the winner and what it hides', () => {
    const res = parseResolution(
      'python',
      output({ path: '/usr/bin/python', all: ['/usr/local/bin/python', '/usr/bin/python'] })
    )
    expect(res.kind).toBe('file')
    expect(res.path).toBe('/usr/bin/python')
    expect(res.shadows).toEqual(['/usr/local/bin/python'])
    expect(res.shadowedByWindows).toBe(false)
  })

  it('names the WSL trap: a Windows executable reached through /mnt', () => {
    // The classic. `pip install` then writes where the shell never looks.
    const res = parseResolution(
      'python',
      output({ path: '/mnt/c/Users/dev/AppData/Local/Microsoft/WindowsApps/python.exe' })
    )
    expect(res.shadowedByWindows).toBe(true)
  })

  it('finds the trap on a distro that mounts C: at /c ([automount] root=/)', () => {
    const res = parseResolution(
      'python',
      output({
        path: '/c/Users/dev/AppData/Local/Microsoft/WindowsApps/python.exe',
        mounts: ['/c', '/d']
      })
    )
    expect(res.shadowedByWindows).toBe(true)
  })

  it('finds the trap under a nested root ([automount] root=/windows/)', () => {
    const res = parseResolution(
      'node',
      output({ path: '/windows/c/Program Files/nodejs/node.exe', mounts: ['/windows/c'] })
    )
    expect(res.shadowedByWindows).toBe(true)
  })

  it('keeps Linux binaries Linux under a moved root, prefix lookalikes included', () => {
    const mounts = ['/c', '/d']
    expect(parseResolution('python3', output({ path: '/usr/bin/python3', mounts })).shadowedByWindows).toBe(false)
    // /cache shares its first letter with /c and is still an ext4 directory.
    expect(parseResolution('x', output({ path: '/cache/bin/x', mounts })).shadowedByWindows).toBe(false)
    expect(
      parseResolution('node', output({ path: '/windowsish/bin/node', mounts: ['/windows/c'] }))
        .shadowedByWindows
    ).toBe(false)
  })

  it('falls back to the /mnt/<drive> layout when the mount table was not read', () => {
    expect(
      parseResolution('python', output({ path: '/mnt/c/Python312/python.exe', mounts: [] }))
        .shadowedByWindows
    ).toBe(true)
    expect(
      parseResolution('docker', output({ path: '/mnt/wsl/docker-desktop/cli-tools/usr/bin/docker' }))
        .shadowedByWindows
    ).toBe(false)
    // An older answer without the MOUNTS section at all reads the same way.
    const legacy = output({ path: '/mnt/c/Python312/python.exe' }).split('\n###WSLPAD_CMD_MOUNTS_BEGIN')[0]
    expect(parseResolution('python', legacy).shadowedByWindows).toBe(true)
  })

  it('keeps the result shape on a moved root', () => {
    const res = parseResolution(
      'python',
      output({
        path: '/c/Python312/python.exe',
        all: ['/c/Python312/python.exe', '/usr/bin/python'],
        mounts: ['/c']
      })
    )
    expect(Object.keys(res).sort()).toEqual(
      ['command', 'kind', 'matches', 'path', 'pathEntries', 'shadowedByWindows', 'shadows'].sort()
    )
    expect(res.kind).toBe('file')
    expect(res.shadows).toEqual(['/usr/bin/python'])
    // The mount lines are not PATH entries or matches.
    expect(res.matches.some((m) => m.startsWith('MNT:'))).toBe(false)
  })

  it('knows a builtin from a file', () => {
    // `command -v` answers with the bare name for a builtin.
    const res = parseResolution('echo', output({ path: 'echo', all: ['/usr/bin/echo'] }))
    expect(res.kind).toBe('builtin')
    expect(res.path).toBeNull()
    // Worth saying: the /usr/bin/echo someone just installed will not run.
    expect(res.shadows).toEqual(['/usr/bin/echo'])
  })

  it('says a name resolves to nothing without inventing a path', () => {
    const res = parseResolution('nope', output({}))
    expect(res.kind).toBe('not-found')
    expect(res.path).toBeNull()
    expect(res.matches).toEqual([])
  })

  it('carries the PATH that was actually searched', () => {
    const res = parseResolution('x', output({ pathEntries: ['/a', '/b'] }))
    expect(res.pathEntries).toEqual(['/a', '/b'])
  })
})

describe('isWindowsPath', () => {
  it('recognises the DrvFs mounts and nothing else', () => {
    expect(isWindowsPath('/mnt/c/Windows/System32/where.exe')).toBe(true)
    expect(isWindowsPath('/mnt/d')).toBe(true)
    expect(isWindowsPath('/mnt/wsl/docker-desktop/bin')).toBe(false)
    expect(isWindowsPath('/usr/bin/python')).toBe(false)
  })

  it('believes the mounts the distro reported over the default layout', () => {
    expect(isWindowsPath('/c/Windows/System32/where.exe', ['/c'])).toBe(true)
    expect(isWindowsPath('/c', ['/c'])).toBe(true)
    expect(isWindowsPath('/cache/x', ['/c'])).toBe(false)
    expect(isWindowsPath('/c/Windows/System32/where.exe')).toBe(false)
  })
})

describe('resolveCommand', () => {
  it('resolves through the runner', async () => {
    const runner = new FakeRunner(ok(output({ path: '/usr/bin/node' })))
    const res = await resolveCommand(runner, 'Ubuntu', 'node')
    expect(res?.path).toBe('/usr/bin/node')
    expect(runner.scripts).toHaveLength(1)
  })

  it('never reaches the runner with a name it would not accept', async () => {
    const runner = new FakeRunner(ok(''))
    expect(await resolveCommand(runner, 'Ubuntu', 'a; id')).toBeNull()
    expect(runner.scripts).toEqual([])
  })

  it('answers nothing — not "not found" — when the distro did not answer', async () => {
    const timedOut: RunResult = { stdout: '', stderr: '', code: null, timedOut: true }
    expect(await resolveCommand(new FakeRunner(timedOut), 'Ubuntu', 'node')).toBeNull()
    expect(await resolveCommand(new FakeRunner(new Error('gone')), 'Ubuntu', 'node')).toBeNull()
  })
})
