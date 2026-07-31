import { describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  DEFAULT_LOG_LINES,
  MAX_LOG_LINES,
  buildServiceLogCommand,
  clampLines,
  isValidUnitName,
  privilegeHint,
  readServiceLog
} from '../../../src/main/wsl/service-log'

class FakeRunner implements DistroRunner {
  scripts: string[] = []
  constructor(private result: RunResult | Error) {}
  async runWsl(): Promise<RunResult> {
    throw new Error('not used')
  }
  async runInDistro(_d: string, script: string, _o?: RunOptions): Promise<RunResult> {
    this.scripts.push(script)
    if (this.result instanceof Error) throw this.result
    return this.result
  }
  async disposeAll(): Promise<void> {}
}

const res = (over: Partial<RunResult>): RunResult => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...over
})

describe('what counts as a unit name', () => {
  it('accepts the shapes systemd actually uses', () => {
    expect(isValidUnitName('docker.service')).toBe(true)
    expect(isValidUnitName('user@1000.service')).toBe(true)
    expect(isValidUnitName('dev-disk\\x2dby.device')).toBe(true)
    expect(isValidUnitName('systemd-journald.socket')).toBe(true)
  })

  it('refuses anything that could escape its quotes', () => {
    expect(isValidUnitName("a'; id; '")).toBe(false)
    expect(isValidUnitName('a b')).toBe(false)
    expect(isValidUnitName('$(id)')).toBe(false)
    expect(isValidUnitName('../etc/passwd')).toBe(false)
    expect(isValidUnitName('')).toBe(false)
  })
})

describe('the journalctl command', () => {
  it('asks for ISO timestamps, because month names are localized', () => {
    // The rule everywhere in this app: never read a localized word.
    expect(buildServiceLogCommand('docker.service', 'system', 50)).toContain('--output=short-iso')
  })

  it('never blocks on a pager that is not there', () => {
    expect(buildServiceLogCommand('docker.service', 'system', 50)).toContain('--no-pager')
  })

  it('reads the user journal for a user unit', () => {
    expect(buildServiceLogCommand('app.service', 'user', 10)).toContain('--user')
    expect(buildServiceLogCommand('app.service', 'system', 10)).not.toContain('--user')
  })

  it('only ever reads', () => {
    const command = buildServiceLogCommand('docker.service', 'system', 10)
    expect(command).toContain('journalctl ')
    expect(command).not.toContain('systemctl')
    expect(command).not.toMatch(/\b(start|stop|restart|vacuum|rotate)\b/)
  })

  it('refuses to build a command for a name it would not accept', () => {
    expect(() => buildServiceLogCommand("x'; id; '", 'system', 10)).toThrow()
  })
})

describe('clampLines', () => {
  it('keeps the request inside sane bounds', () => {
    expect(clampLines(undefined)).toBe(DEFAULT_LOG_LINES)
    expect(clampLines(0)).toBe(1)
    expect(clampLines(10_000)).toBe(MAX_LOG_LINES)
    expect(clampLines(42)).toBe(42)
    expect(clampLines(Number.NaN)).toBe(DEFAULT_LOG_LINES)
  })
})

describe('readServiceLog', () => {
  it('returns the lines it was given', async () => {
    const runner = new FakeRunner(res({ stdout: 'line one\nline two\n' }))
    const log = await readServiceLog(runner, 'Ubuntu', 'docker.service', 'system')
    expect(log.lines).toEqual(['line one', 'line two'])
    expect(log.error).toBeNull()
  })

  it('says journalctl is missing rather than blaming the unit', async () => {
    // A distro without systemd is not a unit that failed.
    const log = await readServiceLog(new FakeRunner(res({ code: 66 })), 'Ubuntu', 'x.service', 'system')
    expect(log.lines).toEqual([])
    expect(log.error).toContain('not available')
  })

  it('reports a unit with no entries as empty, not as an error', async () => {
    const runner = new FakeRunner(res({ stdout: '', code: 0 }))
    const log = await readServiceLog(runner, 'Ubuntu', 'quiet.service', 'system')
    expect(log.lines).toEqual([])
    expect(log.error).toBeNull()
  })

  it('carries journalctl’s own reason when it fails with nothing to show', async () => {
    const runner = new FakeRunner(res({ code: 1, stderr: 'Failed to add match: Invalid argument' }))
    const log = await readServiceLog(runner, 'Ubuntu', 'x.service', 'system')
    expect(log.error).toContain('Invalid argument')
  })

  it('never reaches the runner with a name it would not accept', async () => {
    const runner = new FakeRunner(res({}))
    const log = await readServiceLog(runner, 'Ubuntu', 'a; id', 'system')
    expect(runner.scripts).toEqual([])
    expect(log.error).toContain('Not a unit name')
  })

  it('says a cut-off read was cut off', async () => {
    const runner = new FakeRunner(res({ timedOut: true, code: null }))
    const log = await readServiceLog(runner, 'Ubuntu', 'x.service', 'system')
    expect(log.error).toContain('did not answer')
  })

  it('marks the tail as truncated once it fills the requested window', async () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n')
    const log = await readServiceLog(new FakeRunner(res({ stdout: lines })), 'Ubuntu', 'x.service', 'system', 5)
    expect(log.truncated).toBe(true)
  })
})

describe('the two things journalctl says about itself', () => {
  it('does not show the empty-journal marker as a log line', async () => {
    // `-- No entries --` arrives on stdout and is not a log line.
    const runner = new FakeRunner(res({ stdout: '-- No entries --\n' }))
    const log = await readServiceLog(runner, 'Ubuntu', 'quiet.service', 'system')
    expect(log.lines).toEqual([])
    expect(log.error).toBeNull()
  })

  it('reads that marker in a fixed language, not the distro’s', () => {
    // LC_ALL=C is why the marker can be recognised at all.
    expect(buildServiceLogCommand('x.service', 'system', 5).startsWith('LC_ALL=C ')).toBe(true)
  })

  it('explains an empty system journal the user is not allowed to read', async () => {
    // Found on a real machine: the hint goes to stderr, so an unreadable
    // journal is indistinguishable from an empty one without reading it.
    const runner = new FakeRunner(
      res({
        stdout: '-- No entries --\n',
        stderr:
          'Hint: You are currently not seeing messages from other users and the system.\n' +
          "      Users in groups 'adm', 'systemd-journal' can see all messages.\n"
      })
    )
    const log = await readServiceLog(runner, 'Ubuntu', 'ssh.service', 'system')
    expect(log.lines).toEqual([])
    expect(log.error).toContain('not seeing messages')
  })

  it('keeps the hint alongside entries that did arrive', async () => {
    const runner = new FakeRunner(
      res({ stdout: 'a line\n', stderr: 'Hint: You are currently not seeing messages\n' })
    )
    const log = await readServiceLog(runner, 'Ubuntu', 'ssh.service', 'system')
    expect(log.lines).toEqual(['a line'])
    expect(log.error).toContain('not seeing messages')
  })

  it('finds no hint where there is none', () => {
    expect(privilegeHint('')).toBeNull()
    expect(privilegeHint('some other stderr\n')).toBeNull()
  })
})
