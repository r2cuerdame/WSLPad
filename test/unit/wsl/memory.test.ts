import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WslNotAvailableError } from '../../../src/main/wsl/contracts'
import {
  createMemoryCollector,
  parseGuestMemory,
  parseVmProcessMemory,
  parseWslConfigMemory
} from '../../../src/main/wsl/memory'
import type { HostCommandRunner } from '../../../src/main/wsl/windows-ports'
import { fakeRunner, ok } from './collectors/helpers'

const KB = 1024
const GIB = 1024 ** 3

/** A real WSL2 /proc/meminfo: nearly all of the VM's memory is page cache. */
const MEMINFO = [
  'MemTotal:       16303256 kB',
  'MemFree:         1249848 kB',
  'MemAvailable:   13980336 kB',
  'Buffers:          121364 kB',
  'Cached:         13327948 kB',
  'SwapCached:            0 kB',
  'Active:          2841236 kB',
  'Inactive:       11744120 kB',
  'Shmem:            219560 kB',
  'SReclaimable:     421236 kB',
  'SUnreclaim:       138904 kB',
  'SwapTotal:       4194304 kB',
  'SwapFree:        4062204 kB',
  'HugePages_Total:       0'
].join('\n')

// What `free` prints for MEMINFO: buff/cache is Buffers + Cached + SReclaimable
// and used is whatever is left of MemTotal.
const CACHE_KB = 121364 + 13327948 + 421236
const USED_KB = 16303256 - 1249848 - CACHE_KB

const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"svchost.exe","1044","Services","0","12,345 K"',
  '"vmmemWSL","20456","Services","0","7,340,032 K"',
  '"Docker Desktop.exe","9000","Console","1","500,000 K"'
].join('\r\n')

const WSLCONFIG = [
  '# hand written',
  '[wsl2]',
  'memory=12GB',
  'processors=8',
  '',
  '[experimental]',
  'autoMemoryReclaim=gradual'
].join('\r\n')

describe('parseGuestMemory', () => {
  it('derives the used / cache / free split free(1) reports', () => {
    const guest = parseGuestMemory(MEMINFO)
    expect(guest.totalBytes).toBe(16303256 * KB)
    expect(guest.freeBytes).toBe(1249848 * KB)
    expect(guest.cacheBytes).toBe(CACHE_KB * KB)
    expect(guest.usedBytes).toBe(USED_KB * KB)
    // used + free + buff/cache adds back up to MemTotal, as free -h shows it
    expect((guest.usedBytes ?? 0) + (guest.freeBytes ?? 0) + (guest.cacheBytes ?? 0)).toBe(
      guest.totalBytes
    )
    expect(guest.swapTotalBytes).toBe(4194304 * KB)
    expect(guest.swapUsedBytes).toBe((4194304 - 4062204) * KB)
  })

  it('counts SReclaimable as zero when the kernel does not report it', () => {
    const text = ['MemTotal: 1000 kB', 'MemFree: 200 kB', 'Buffers: 100 kB', 'Cached: 400 kB'].join(
      '\n'
    )
    const guest = parseGuestMemory(text)
    expect(guest.cacheBytes).toBe(500 * KB)
    expect(guest.usedBytes).toBe(300 * KB)
  })

  it('returns nulls rather than zeros for empty or partial input', () => {
    expect(parseGuestMemory('')).toEqual({
      totalBytes: null,
      usedBytes: null,
      cacheBytes: null,
      freeBytes: null,
      swapTotalBytes: null,
      swapUsedBytes: null
    })
    // no Cached line — the used figure would be wrong, so it stays unknown
    const partial = parseGuestMemory('MemTotal: 1000 kB\nMemFree: 200 kB\nBuffers: 100 kB')
    expect(partial.totalBytes).toBe(1000 * KB)
    expect(partial.cacheBytes).toBeNull()
    expect(partial.usedBytes).toBeNull()
  })
})

describe('parseVmProcessMemory', () => {
  it('reads the working set of vmmemWSL', () => {
    expect(parseVmProcessMemory(TASKLIST)).toBe(7340032 * KB)
  })

  it('falls back to the older vmmem name', () => {
    const legacy = '"vmmem","1234","Services","0","6,291,456 K"'
    expect(parseVmProcessMemory(legacy)).toBe(6291456 * KB)
  })

  it('prefers vmmemWSL when both names are present', () => {
    const both = [TASKLIST, '"vmmem","1234","Services","0","6,291,456 K"'].join('\r\n')
    expect(parseVmProcessMemory(both)).toBe(7340032 * KB)
  })

  it('reads localized thousands separators', () => {
    const german = '"vmmemWSL","20456","Services","0","7.340.032 K"'
    const french = '"vmmemWSL","20456","Services","0","7 340 032 K"'
    expect(parseVmProcessMemory(german)).toBe(7340032 * KB)
    expect(parseVmProcessMemory(french)).toBe(7340032 * KB)
  })

  it('takes the largest row when the name appears twice', () => {
    const twice = [
      '"vmmemWSL","20456","Services","0","1,000 K"',
      '"vmmemWSL","20999","Services","0","4,000 K"'
    ].join('\n')
    expect(parseVmProcessMemory(twice)).toBe(4000 * KB)
  })

  it('is null when no VM process is listed at all', () => {
    expect(parseVmProcessMemory('')).toBeNull()
    expect(parseVmProcessMemory('"svchost.exe","1044","Services","0","12,345 K"')).toBeNull()
    expect(parseVmProcessMemory('INFO: No tasks are running.')).toBeNull()
    // a row with an unreadable memory column is skipped, not read as zero
    expect(parseVmProcessMemory('"vmmemWSL","20456","Services","0","N/A"')).toBeNull()
  })
})

describe('parseWslConfigMemory', () => {
  it('reads memory from [wsl2] and autoMemoryReclaim from [experimental]', () => {
    expect(parseWslConfigMemory(WSLCONFIG)).toEqual({
      memoryBytes: 12 * GIB,
      autoMemoryReclaim: 'gradual'
    })
  })

  it('accepts every documented size unit and spacing', () => {
    expect(parseWslConfigMemory('[wsl2]\nmemory = 512MB').memoryBytes).toBe(512 * 1024 ** 2)
    expect(parseWslConfigMemory('[wsl2]\nMemory=8gb').memoryBytes).toBe(8 * GIB)
    expect(parseWslConfigMemory('[wsl2]\nmemory=2048kb').memoryBytes).toBe(2048 * KB)
  })

  it('ignores keys placed in a section WSL does not read them from', () => {
    const wrong = ['[experimental]', 'memory=12GB', '[wsl2]', 'autoMemoryReclaim=gradual'].join(
      '\n'
    )
    expect(parseWslConfigMemory(wrong)).toEqual({ memoryBytes: null, autoMemoryReclaim: null })
  })

  it('rejects a size without a unit and ignores comments', () => {
    expect(parseWslConfigMemory('[wsl2]\nmemory=8192').memoryBytes).toBeNull()
    expect(parseWslConfigMemory('[wsl2]\n# memory=4GB\n; memory=2GB').memoryBytes).toBeNull()
    expect(parseWslConfigMemory('').memoryBytes).toBeNull()
  })

  it('lets the last declaration of a key win', () => {
    expect(parseWslConfigMemory('[wsl2]\nmemory=4GB\nmemory=6GB').memoryBytes).toBe(6 * GIB)
  })
})

describe('createMemoryCollector', () => {
  let dir: string
  let configPath: string
  let utf16Path: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'wslpad-memory-'))
    configPath = join(dir, '.wslconfig')
    utf16Path = join(dir, 'utf16.wslconfig')
    writeFileSync(configPath, WSLCONFIG, 'utf8')
    // Notepad's default for a re-saved .wslconfig: UTF-16LE with a BOM.
    writeFileSync(utf16Path, '\ufeff[wsl2]\r\nmemory=9GB\r\n', 'utf16le')
  })

  afterAll(() => {
    // Windows Defender/indexing can briefly retain a handle after writeFile.
    // Retry first, then tolerate only transient Windows lock errors: the
    // directory is under the OS temp root and hosted CI machines are ephemeral.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM') throw error
    }
  })

  const hostRunner = (text = TASKLIST): HostCommandRunner => vi.fn(async () => text)
  const guestRunner = (): ReturnType<typeof fakeRunner> => fakeRunner(() => ok(MEMINFO))

  it('reconciles all three views of the same memory', async () => {
    const run = hostRunner()
    const collector = createMemoryCollector({
      run,
      wslconfigPath: configPath,
      hostTotalBytes: () => 32 * GIB
    })
    const detail = await collector.collect(guestRunner(), 'Ubuntu-24.04')

    expect(run).toHaveBeenCalledWith('tasklist', ['/fo', 'csv', '/nh'], expect.any(Number))
    expect(detail).toEqual({
      hostTotalBytes: 32 * GIB,
      vmLimitBytes: 12 * GIB,
      vmLimitSource: 'wslconfig',
      vmmemWorkingSetBytes: 7340032 * KB,
      guestTotalBytes: 16303256 * KB,
      guestUsedBytes: USED_KB * KB,
      guestCacheBytes: CACHE_KB * KB,
      guestFreeBytes: 1249848 * KB,
      swapTotalBytes: 4194304 * KB,
      swapUsedBytes: (4194304 - 4062204) * KB,
      autoMemoryReclaim: 'gradual'
    })
  })

  it('computes the default ceiling as half of host RAM without a .wslconfig', async () => {
    const collector = createMemoryCollector({
      run: hostRunner(),
      wslconfigPath: join(dir, 'missing.wslconfig'),
      hostTotalBytes: () => 33 * GIB
    })
    const detail = await collector.collect(guestRunner(), 'Ubuntu-24.04')

    expect(detail.vmLimitBytes).toBe(Math.floor((33 * GIB) / 2))
    expect(detail.vmLimitSource).toBe('computed-default')
    expect(detail.autoMemoryReclaim).toBeNull()
  })

  it('leaves the ceiling unknown when neither side can be determined', async () => {
    const collector = createMemoryCollector({
      run: hostRunner(),
      wslconfigPath: join(dir, 'missing.wslconfig'),
      hostTotalBytes: () => 0
    })
    const detail = await collector.collect(guestRunner(), 'Ubuntu-24.04')

    expect(detail.hostTotalBytes).toBeNull()
    expect(detail.vmLimitBytes).toBeNull()
    expect(detail.vmLimitSource).toBe('unknown')
  })

  it('reads a .wslconfig saved as UTF-16 by Notepad', async () => {
    const collector = createMemoryCollector({
      run: hostRunner(),
      wslconfigPath: utf16Path,
      hostTotalBytes: () => 32 * GIB
    })
    const detail = await collector.collect(guestRunner(), 'Ubuntu-24.04')
    expect(detail.vmLimitBytes).toBe(9 * GIB)
    expect(detail.vmLimitSource).toBe('wslconfig')
  })

  it('keeps the guest view when the Windows process cannot be listed', async () => {
    const collector = createMemoryCollector({
      run: async () => {
        throw new Error('tasklist is not available')
      },
      wslconfigPath: configPath,
      hostTotalBytes: () => 32 * GIB
    })
    const detail = await collector.collect(guestRunner(), 'Ubuntu-24.04')

    expect(detail.vmmemWorkingSetBytes).toBeNull()
    expect(detail.guestUsedBytes).toBe(USED_KB * KB)
  })

  it('degrades the guest view to null when the distro cannot be read', async () => {
    const collector = createMemoryCollector({
      run: hostRunner(),
      wslconfigPath: configPath,
      hostTotalBytes: () => 32 * GIB
    })
    const runner = fakeRunner(() => {
      throw new Error('distro is stopped')
    })
    const detail = await collector.collect(runner, 'Ubuntu-24.04')

    expect(detail.guestTotalBytes).toBeNull()
    expect(detail.guestUsedBytes).toBeNull()
    expect(detail.guestCacheBytes).toBeNull()
    expect(detail.swapUsedBytes).toBeNull()
    // the Windows side is still answerable and still answered
    expect(detail.vmmemWorkingSetBytes).toBe(7340032 * KB)
    expect(detail.hostTotalBytes).toBe(32 * GIB)
  })

  it('passes WslNotAvailableError through', async () => {
    const collector = createMemoryCollector({
      run: hostRunner(),
      wslconfigPath: configPath,
      hostTotalBytes: () => 32 * GIB
    })
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collector.collect(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
