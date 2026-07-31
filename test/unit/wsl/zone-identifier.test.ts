import { describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  MAX_GROUPS,
  ZONE_SCRIPT,
  detectZoneIdentifiers,
  groupZoneRows,
  parseZoneRows,
  totalBytes,
  zoneCleanupCommand
} from '../../../src/main/wsl/zone-identifier'

class FakeRunner implements DistroRunner {
  calls: string[] = []
  constructor(private result: RunResult | Error) {}
  async runWsl(): Promise<RunResult> {
    throw new Error('not used')
  }
  async runInDistro(_distro: string, script: string, _opts?: RunOptions): Promise<RunResult> {
    this.calls.push(script)
    if (this.result instanceof Error) throw this.result
    return this.result
  }
  async disposeAll(): Promise<void> {}
}

const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0, timedOut: false })

function scriptOutput(status: string, rows: string[], root = '/home/dev'): string {
  return [
    '###WSLPAD_ZONE_ROOT_BEGIN',
    root,
    '###WSLPAD_ZONE_ROOT_END',
    '###WSLPAD_ZONE_STATUS_BEGIN',
    status,
    '###WSLPAD_ZONE_STATUS_END',
    '###WSLPAD_ZONE_ROWS_BEGIN',
    ...rows,
    '###WSLPAD_ZONE_ROWS_END'
  ].join('\n')
}

describe('parseZoneRows', () => {
  it('reads size and directory off each row', () => {
    expect(parseZoneRows('174\t/home/dev/Downloads\n88\t/home/dev/docs')).toEqual([
      { bytes: 174, directory: '/home/dev/Downloads' },
      { bytes: 88, directory: '/home/dev/docs' }
    ])
  })

  it('keeps a directory whose name contains spaces intact', () => {
    // The tab is the separator precisely because paths may contain spaces.
    expect(parseZoneRows('12\t/home/dev/My Files/sub')[0].directory).toBe('/home/dev/My Files/sub')
  })

  it('leaves the size unknown where the shell could not report one', () => {
    // busybox find has no -printf; a missing size must not become zero bytes.
    expect(parseZoneRows('-\t/home/dev/Downloads')).toEqual([
      { bytes: null, directory: '/home/dev/Downloads' }
    ])
  })

  it('ignores blank and malformed lines', () => {
    expect(parseZoneRows('\n\nnot a row\n42\t')).toEqual([])
  })
})

describe('groupZoneRows', () => {
  const rows = [
    { bytes: 100, directory: '/a' },
    { bytes: 50, directory: '/b' },
    { bytes: 20, directory: '/a' }
  ]

  it('folds rows into directories, busiest first', () => {
    expect(groupZoneRows(rows)).toEqual([
      { directory: '/a', count: 2, bytes: 120 },
      { directory: '/b', count: 1, bytes: 50 }
    ])
  })

  it('gives up a group total the moment one row has no size', () => {
    // Half a sum presented as the whole is the same lie as a zero.
    const mixed = [{ bytes: null, directory: '/a' }, ...rows]
    expect(groupZoneRows(mixed)[0]).toEqual({ directory: '/a', count: 3, bytes: null })
  })
})

describe('totalBytes', () => {
  it('adds up only when every row carried a size', () => {
    expect(totalBytes([{ bytes: 10, directory: '/a' }])).toBe(10)
    expect(
      totalBytes([
        { bytes: 10, directory: '/a' },
        { bytes: null, directory: '/b' }
      ])
    ).toBeNull()
  })
})

describe('zoneCleanupCommand', () => {
  it('stays inside the home directory and off the Windows drives', () => {
    const command = zoneCleanupCommand('/home/dev')
    expect(command).toContain("'/home/dev'")
    // -xdev is what keeps this out of /mnt/c, where the streams are Windows'
    // own and deleting them would be wrong.
    expect(command).toContain('-xdev')
    expect(command).toContain("-name '*:Zone.Identifier'")
    // Printed before deleted, so the user sees what goes.
    expect(command.indexOf('-print')).toBeLessThan(command.indexOf('-delete'))
  })

  it('quotes a home directory containing a quote', () => {
    expect(zoneCleanupCommand("/home/o'brien")).toContain(`'/home/o'\\''brien'`)
  })
})

describe('the search script', () => {
  it('never leaves the home directory or crosses a filesystem', () => {
    expect(ZONE_SCRIPT).toContain('"$h"')
    expect(ZONE_SCRIPT).toContain('-xdev')
    expect(ZONE_SCRIPT).not.toContain('/mnt')
    // Read-only: the script that counts must never be the script that deletes.
    expect(ZONE_SCRIPT).not.toContain('-delete')
    expect(ZONE_SCRIPT).not.toContain('rm ')
  })

  it('bounds itself in both time and rows', () => {
    expect(ZONE_SCRIPT).toContain('timeout 8')
    expect(ZONE_SCRIPT).toContain('head -n 5000')
  })
})

describe('detectZoneIdentifiers', () => {
  it('counts, groups and offers the cleanup for a real answer', async () => {
    const runner = new FakeRunner(
      ok(
        scriptOutput('0', [
          '174\t/home/dev/Downloads',
          '174\t/home/dev/Downloads',
          '88\t/home/dev/docs'
        ])
      )
    )
    const info = await detectZoneIdentifiers(runner, 'Ubuntu')

    expect(info).not.toBeNull()
    expect(info?.root).toBe('/home/dev')
    expect(info?.count).toBe(3)
    expect(info?.bytes).toBe(436)
    expect(info?.groups[0]).toEqual({ directory: '/home/dev/Downloads', count: 2, bytes: 348 })
    expect(info?.cleanupCommand).toContain("'/home/dev'")
    expect(info?.error).toBeNull()
  })

  it('reports a clean home as zero, which is a real answer', async () => {
    const info = await detectZoneIdentifiers(new FakeRunner(ok(scriptOutput('0', []))), 'Ubuntu')
    expect(info?.count).toBe(0)
    expect(info?.groups).toEqual([])
  })

  it('refuses to turn an unfinished search into a count', async () => {
    // 124 is timeout(1). Reporting "0 markers" here would tell someone their
    // tree is clean when it may hold thousands.
    const info = await detectZoneIdentifiers(
      new FakeRunner(ok(scriptOutput('124', ['174\t/home/dev/Downloads']))),
      'Ubuntu'
    )
    expect(info?.count).toBeNull()
    expect(info?.bytes).toBeNull()
    expect(info?.error).toContain('timed out')
    // The cleanup command is still correct — the count is what is unknown.
    expect(info?.cleanupCommand).toContain('-delete')
  })

  it('returns nothing at all when the whole read was cut off', async () => {
    const runner = new FakeRunner({ stdout: '', stderr: '', code: null, timedOut: true })
    // null lets the caller keep the last good answer instead of publishing one.
    expect(await detectZoneIdentifiers(runner, 'Ubuntu')).toBeNull()
  })

  it('survives a distro that cannot be reached', async () => {
    expect(await detectZoneIdentifiers(new FakeRunner(new Error('gone')), 'Ubuntu')).toBeNull()
  })

  it('cannot be truncated by a directory named after the end marker', async () => {
    // The path is attacker-influenceable: anyone can `mkdir` this name. A
    // marker only counts as one when it is the whole line.
    const runner = new FakeRunner(
      ok(
        scriptOutput('0', [
          '10\t/home/dev/###WSLPAD_ZONE_ROWS_END',
          '10\t/home/dev/after',
          '10\t/home/dev/later'
        ])
      )
    )
    const info = await detectZoneIdentifiers(runner, 'Ubuntu')
    expect(info?.count).toBe(3)
  })

  it('says the count is a floor once the row cap is hit', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `1\t/home/dev/d${i % 3}`)
    const info = await detectZoneIdentifiers(new FakeRunner(ok(scriptOutput('0', rows))), 'Ubuntu')
    expect(info?.truncated).toBe(true)
    expect(info?.count).toBe(5000)
  })

  it('shows only the busiest directories, not every one of them', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `1\t/home/dev/d${i}`)
    const info = await detectZoneIdentifiers(new FakeRunner(ok(scriptOutput('0', rows))), 'Ubuntu')
    expect(info?.groups).toHaveLength(MAX_GROUPS)
    expect(info?.count).toBe(40)
  })
})
