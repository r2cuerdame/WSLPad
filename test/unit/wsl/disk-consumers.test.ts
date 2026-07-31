import { describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  CONSUMER_SPECS,
  buildConsumersScript,
  collectDiskConsumers,
  markNesting,
  measuredTotal,
  parseConsumers
} from '../../../src/main/wsl/disk-consumers'

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

const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0, timedOut: false })

/** Captured from a real Ubuntu-24.04: 1.2 GB of cache nobody had ever seen. */
const REAL_OUTPUT = [
  '###WSLPAD_DU_BEGIN',
  'apt-cache|/var/cache/apt|354354783',
  'dnf-cache|/var/cache/dnf|missing',
  'journal|/var/log/journal|838860800',
  'logs|/var/log|861074268',
  'user-cache|/home/hermes/.cache|1372061',
  'snap|/var/lib/snapd|188317',
  'docker|/var/lib/docker|missing',
  'trash|/home/hermes/.local/share/Trash|0',
  'tmp|/tmp|8741',
  '###WSLPAD_DU_END'
].join('\n')

describe('the consumers script', () => {
  it('measures, and only measures', () => {
    const script = buildConsumersScript()
    expect(script).toContain('du -sxb')
    // Read-only: nothing here may remove anything, whatever the cleanup
    // commands elsewhere say.
    expect(script).not.toContain('rm ')
    expect(script).not.toMatch(/\bclean\b/)
    expect(script).not.toContain('prune')
  })

  it('stays on this filesystem and inside a timeout', () => {
    const script = buildConsumersScript()
    // -x keeps a bind-mounted Windows drive from turning a bounded read into
    // an unbounded one.
    expect(script).toContain('-sxb')
    expect(script).toContain('timeout 20')
  })

  it('asks about a path that is not there instead of assuming', () => {
    expect(buildConsumersScript()).toContain('missing')
  })
})

describe('parseConsumers', () => {
  it('reads a real answer, biggest first', () => {
    const consumers = parseConsumers(REAL_OUTPUT)
    expect(consumers[0]).toMatchObject({ id: 'logs', bytes: 861_074_268 })
    expect(consumers[1]).toMatchObject({ id: 'journal', bytes: 838_860_800 })
    expect(consumers.find((c) => c.id === 'apt-cache')?.bytes).toBe(354_354_783)
  })

  it('marks a path that is not there as absent, not as empty', () => {
    const docker = parseConsumers(REAL_OUTPUT).find((c) => c.id === 'docker')
    expect(docker).toMatchObject({ exists: false, bytes: null })
  })

  it('keeps a genuine zero as zero', () => {
    // An empty trash really is empty; that is a measurement, not a gap.
    expect(parseConsumers(REAL_OUTPUT).find((c) => c.id === 'trash')?.bytes).toBe(0)
  })

  it('leaves a size unknown when du could not report one', () => {
    const text = '###WSLPAD_DU_BEGIN\napt-cache|/var/cache/apt|\n###WSLPAD_DU_END'
    expect(parseConsumers(text)[0]).toMatchObject({ exists: true, bytes: null })
  })

  it('ignores rows for ids it does not know', () => {
    const text = '###WSLPAD_DU_BEGIN\nsomething-else|/x|10\n###WSLPAD_DU_END'
    expect(parseConsumers(text)).toEqual([])
  })

  it('offers a cleanup only where one exists, and says when it needs root', () => {
    const consumers = parseConsumers(REAL_OUTPUT)
    expect(consumers.find((c) => c.id === 'apt-cache')).toMatchObject({
      cleanup: 'sudo apt clean',
      needsRoot: true
    })
    expect(consumers.find((c) => c.id === 'tmp')?.cleanup).toBeNull()
  })
})

describe('nesting', () => {
  it('marks a cache that sits inside another', () => {
    const consumers = parseConsumers(REAL_OUTPUT)
    expect(consumers.find((c) => c.id === 'journal')?.containedIn).toBe('logs')
    expect(consumers.find((c) => c.id === 'logs')?.containedIn).toBeNull()
  })

  it('does not mistake a sibling with a shared prefix for a parent', () => {
    const rows = markNesting([
      { id: 'a', path: '/var/log', exists: true, bytes: 1, cleanup: null, needsRoot: false, containedIn: null },
      { id: 'b', path: '/var/logs', exists: true, bytes: 1, cleanup: null, needsRoot: false, containedIn: null }
    ])
    expect(rows.every((r) => r.containedIn === null)).toBe(true)
  })
})

describe('measuredTotal', () => {
  it('counts each byte once', () => {
    // /var/log/journal is inside /var/log; adding both would report 1.7 GB of
    // logs where there are 861 MB.
    const total = measuredTotal(parseConsumers(REAL_OUTPUT))
    expect(total.bytes).toBe(861_074_268 + 354_354_783 + 1_372_061 + 188_317 + 0 + 8_741)
    expect(total.partial).toBe(false)
  })

  it('says the total is partial when something could not be measured', () => {
    const text = '###WSLPAD_DU_BEGIN\napt-cache|/var/cache/apt|\ntmp|/tmp|10\n###WSLPAD_DU_END'
    expect(measuredTotal(parseConsumers(text))).toEqual({ bytes: 10, partial: true })
  })
})

describe('collectDiskConsumers', () => {
  it('returns the measured caches', async () => {
    const info = await collectDiskConsumers(new FakeRunner(ok(REAL_OUTPUT)), 'Ubuntu')
    expect(info?.consumers).toHaveLength(CONSUMER_SPECS.length)
    expect(info?.measuredBytes).toBeGreaterThan(1_000_000_000)
    expect(info?.partial).toBe(false)
  })

  it('answers nothing when the read was cut off, so the last answer stands', async () => {
    const timedOut: RunResult = { stdout: '', stderr: '', code: null, timedOut: true }
    expect(await collectDiskConsumers(new FakeRunner(timedOut), 'Ubuntu')).toBeNull()
    expect(await collectDiskConsumers(new FakeRunner(new Error('gone')), 'Ubuntu')).toBeNull()
  })

  it('answers nothing rather than an empty breakdown', async () => {
    expect(await collectDiskConsumers(new FakeRunner(ok('')), 'Ubuntu')).toBeNull()
  })
})
