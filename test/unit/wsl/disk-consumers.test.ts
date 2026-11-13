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

  it("keeps du's exit status instead of losing it in a pipe", () => {
    const script = buildConsumersScript()
    // `du … | cut` reports cut's status; a du that hit a Permission denied
    // would then read as complete.
    expect(script).not.toMatch(/du -sxb "\$p" 2>\/dev\/null \|/)
    expect(script).toContain('rc=$?')
    expect(script).toMatch(/%s:%s\\n' '[a-z-]+' "\$p" "\$s" "\$rc"/)
  })
})

/** Same distro, but run as a user who may not read /var/lib/docker or parts of /var/log. */
const PARTIAL_OUTPUT = [
  '###WSLPAD_DU_BEGIN',
  'apt-cache|/var/cache/apt|354354783:0',
  'journal|/var/log/journal|838860800:1',
  'logs|/var/log|861074268:1',
  'docker|/var/lib/docker|4096:1',
  'trash|/home/hermes/.local/share/Trash|0:0',
  'tmp|/tmp|:124',
  'dnf-cache|/var/cache/dnf|missing',
  '###WSLPAD_DU_END'
].join('\n')

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

  it('marks a size du could only partly read as a floor, not an answer', () => {
    const docker = parseConsumers(PARTIAL_OUTPUT).find((c) => c.id === 'docker')
    // A root-only Docker store read as 4 KB is exactly the culprit nobody suspects.
    expect(docker).toMatchObject({ exists: true, bytes: 4096, partial: true })
  })

  it('keeps a complete read, a genuine zero, a timeout and a missing path as they were', () => {
    const consumers = parseConsumers(PARTIAL_OUTPUT)
    expect(consumers.find((c) => c.id === 'apt-cache')).toMatchObject({
      bytes: 354_354_783,
      partial: false
    })
    expect(consumers.find((c) => c.id === 'trash')).toMatchObject({ bytes: 0, partial: false })
    // A du cut off by `timeout` printed nothing: unknown, not a floor of nothing.
    expect(consumers.find((c) => c.id === 'tmp')).toMatchObject({
      exists: true,
      bytes: null,
      partial: false
    })
    expect(consumers.find((c) => c.id === 'dnf-cache')).toMatchObject({
      exists: false,
      bytes: null,
      partial: false
    })
  })

  it('reads a row without a status as complete', () => {
    expect(parseConsumers(REAL_OUTPUT).every((c) => !c.partial)).toBe(true)
  })

  it('keeps a path that carries the separator', () => {
    const text = '###WSLPAD_DU_BEGIN\ntmp|/tmp/a|b|12:1\n###WSLPAD_DU_END'
    expect(parseConsumers(text)[0]).toMatchObject({ path: '/tmp/a|b', bytes: 12, partial: true })
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
      { id: 'a', path: '/var/log', exists: true, bytes: 1, partial: false, cleanup: null, needsRoot: false, containedIn: null },
      { id: 'b', path: '/var/logs', exists: true, bytes: 1, partial: false, cleanup: null, needsRoot: false, containedIn: null }
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

  it('says the total is a floor when a cache could only be partly read', () => {
    const text =
      '###WSLPAD_DU_BEGIN\napt-cache|/var/cache/apt|100:0\ndocker|/var/lib/docker|4096:1\n###WSLPAD_DU_END'
    // The floor still counts — it is at least that much — but the sum is no answer.
    expect(measuredTotal(parseConsumers(text))).toEqual({ bytes: 4196, partial: true })
  })

  it('says so even when the floor sits inside another row', () => {
    const text =
      '###WSLPAD_DU_BEGIN\nlogs|/var/log|500:0\njournal|/var/log/journal|300:1\n###WSLPAD_DU_END'
    expect(measuredTotal(parseConsumers(text))).toEqual({ bytes: 500, partial: true })
  })
})

describe('collectDiskConsumers', () => {
  it('returns the measured caches', async () => {
    const info = await collectDiskConsumers(new FakeRunner(ok(REAL_OUTPUT)), 'Ubuntu')
    expect(info?.consumers).toHaveLength(CONSUMER_SPECS.length)
    expect(info?.measuredBytes).toBeGreaterThan(1_000_000_000)
    expect(info?.partial).toBe(false)
  })

  it('reports a partly unreadable cache as a floor in the total too', async () => {
    const info = await collectDiskConsumers(new FakeRunner(ok(PARTIAL_OUTPUT)), 'Ubuntu')
    expect(info?.partial).toBe(true)
    expect(info?.consumers.find((c) => c.id === 'docker')?.partial).toBe(true)
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
