import { describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  buildResolveScript,
  isResolvableCommand,
  isWindowsPath,
  parseResolution,
  resolveCommand
} from '../../../src/main/wsl/resolve-command'

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

function output(opts: { path?: string; all?: string[]; pathEntries?: string[] }): string {
  return [
    '###WSLPAD_CMD_PATH_BEGIN',
    ...(opts.pathEntries ?? ['/usr/local/bin', '/usr/bin', '/mnt/c/Windows/System32']),
    '###WSLPAD_CMD_PATH_END',
    '###WSLPAD_CMD_WHICH_BEGIN',
    ...(opts.path === undefined ? [] : [opts.path]),
    '###WSLPAD_CMD_WHICH_END',
    '###WSLPAD_CMD_ALL_BEGIN',
    ...(opts.all ?? []),
    '###WSLPAD_CMD_ALL_END'
  ].join('\n')
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
