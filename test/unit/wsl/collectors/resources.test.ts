import { beforeEach, describe, expect, it } from 'vitest'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import {
  _resetCpuSamples,
  collectResources,
  parseDfBlocks,
  parseDfP,
  parseLoadavg,
  parseMeminfo,
  parseProcStat
} from '../../../../src/main/wsl/resources'
import { fakeRunner, joinSections, MARKER, ok } from './helpers'

const MEMINFO = [
  'MemTotal:       16302996 kB',
  'MemFree:         9776520 kB',
  'MemAvailable:   12345600 kB',
  'Buffers:           81748 kB',
  'SwapTotal:       4194304 kB',
  'SwapFree:        4194000 kB',
  'HugePages_Total:       0'
].join('\n')

const STAT_1 = [
  'cpu  100 0 100 700 100 0 0 0 0 0',
  'cpu0 50 0 50 350 50 0 0 0 0 0',
  'cpu1 50 0 50 350 50 0 0 0 0 0',
  'intr 12345',
  'ctxt 6789'
].join('\n')

const STAT_2 = [
  'cpu  200 0 200 1000 200 0 0 0 0 0',
  'cpu0 100 0 100 500 100 0 0 0 0 0',
  'cpu1 100 0 100 500 100 0 0 0 0 0'
].join('\n')

const DF_OUTPUT = [
  `${MARKER} /`,
  'Filesystem      1-blocks        Used   Available Capacity Mounted on',
  '/dev/sdd   1081101176832 47110483968 978996318208       5% /',
  `${MARKER} /home`,
  'Filesystem      1-blocks        Used   Available Capacity Mounted on',
  '/dev/sdd   1081101176832 47110483968 978996318208       5% /',
  `${MARKER} /mnt/c`,
  ''
].join('\n')

describe('parseMeminfo', () => {
  it('converts kB fields to bytes', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      memTotalBytes: 16302996 * 1024,
      memAvailableBytes: 12345600 * 1024,
      swapTotalBytes: 4194304 * 1024,
      swapFreeBytes: 4194000 * 1024
    })
  })

  it('returns nulls for missing keys, empty and malformed input', () => {
    expect(parseMeminfo('')).toEqual({
      memTotalBytes: null,
      memAvailableBytes: null,
      swapTotalBytes: null,
      swapFreeBytes: null
    })
    expect(parseMeminfo('MemTotal garbage\nMemAvailable: abc kB').memTotalBytes).toBeNull()
  })
})

describe('parseLoadavg', () => {
  it('parses the three load figures', () => {
    expect(parseLoadavg('0.52 0.58 0.59 1/525 12345\n')).toEqual([0.52, 0.58, 0.59])
  })

  it('rejects malformed input', () => {
    expect(parseLoadavg('')).toBeNull()
    expect(parseLoadavg('a b c')).toBeNull()
    expect(parseLoadavg('0.5 0.5')).toBeNull()
  })
})

describe('parseProcStat', () => {
  it('sums ticks and counts cores; idle includes iowait', () => {
    const sample = parseProcStat(STAT_1)
    expect(sample).toEqual({ totalTicks: 1000, idleTicks: 800, cpuCount: 2 })
  })

  it('returns null when there is no aggregate cpu line', () => {
    expect(parseProcStat('')).toBeNull()
    expect(parseProcStat('intr 1 2 3\nctxt 4')).toBeNull()
    expect(parseProcStat('cpu a b c d')).toBeNull()
  })
})

describe('parseDfP', () => {
  it('parses data rows and skips the header', () => {
    const rows = parseDfP(
      [
        'Filesystem      1-blocks        Used   Available Capacity Mounted on',
        '/dev/sdd   1081101176832 47110483968 978996318208       5% /',
        'C:\\ 511044222976 271044222976 240000000000 54% /mnt/c'
      ].join('\n')
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      filesystem: '/dev/sdd',
      totalBytes: 1081101176832,
      usedBytes: 47110483968,
      availableBytes: 978996318208,
      usePercent: 5,
      mountedOn: '/'
    })
    expect(rows[1].mountedOn).toBe('/mnt/c')
  })

  it('ignores malformed and empty input', () => {
    expect(parseDfP('')).toEqual([])
    expect(parseDfP('df: /nope: No such file or directory')).toEqual([])
  })

  it('survives huge input', () => {
    const huge = Array.from(
      { length: 50000 },
      (_, i) => `/dev/loop${i} 1000 500 500 50% /snap/x/${i}`
    ).join('\n')
    expect(parseDfP(huge)).toHaveLength(50000)
  })
})

describe('parseDfBlocks', () => {
  it('marks missing mounts as exists:false', () => {
    const disks = parseDfBlocks(DF_OUTPUT)
    expect(disks.map((d) => d.mountPoint)).toEqual(['/', '/home', '/mnt/c'])
    expect(disks[0]).toMatchObject({ exists: true, totalBytes: 1081101176832, usePercent: 5 })
    expect(disks[1].exists).toBe(true)
    expect(disks[2]).toEqual({
      mountPoint: '/mnt/c',
      exists: false,
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      usePercent: null
    })
  })

  it('returns three non-existing disks for empty input', () => {
    expect(parseDfBlocks('').every((d) => !d.exists)).toBe(true)
  })
})

describe('collectResources', () => {
  beforeEach(() => {
    _resetCpuSamples()
  })

  const fastOutput = (stat: string): string => joinSections(stat, MEMINFO, '0.52 0.58 0.59 1/525 999', '123')

  it('computes cpuPercent from two samples', async () => {
    let fastCall = 0
    const runner = fakeRunner((script) => {
      if (script.includes('df -P')) return ok(DF_OUTPUT)
      fastCall++
      return ok(fastOutput(fastCall === 1 ? STAT_1 : STAT_2))
    })

    const first = await collectResources(runner, 'Ubuntu-24.04')
    expect(first.cpuPercent).toBeNull()
    expect(first.cpuCount).toBe(2)
    expect(first.memTotalBytes).toBe(16302996 * 1024)
    expect(first.memUsedBytes).toBe((16302996 - 12345600) * 1024)
    expect(first.swapUsedBytes).toBe((4194304 - 4194000) * 1024)
    expect(first.loadAvg).toEqual([0.52, 0.58, 0.59])
    expect(first.processCount).toBe(123)
    expect(first.disks[2].exists).toBe(false)

    // STAT_1 → STAT_2: dTotal 600, dIdle 400 → 33.3% busy
    const second = await collectResources(runner, 'Ubuntu-24.04')
    expect(second.cpuPercent).toBe(33.3)
  })

  it('keeps cpu samples per distro', async () => {
    let call = 0
    const runner = fakeRunner((script) => {
      if (script.includes('df -P')) return ok('')
      call++
      return ok(fastOutput(call <= 2 ? STAT_1 : STAT_2))
    })
    await collectResources(runner, 'Ubuntu-24.04')
    expect((await collectResources(runner, 'Debian')).cpuPercent).toBeNull()
    expect((await collectResources(runner, 'Ubuntu-24.04')).cpuPercent).toBe(33.3)
  })

  it('returns null cpuPercent when counters go backwards', async () => {
    let call = 0
    const runner = fakeRunner((script) => {
      if (script.includes('df -P')) return ok('')
      call++
      return ok(fastOutput(call === 1 ? STAT_2 : STAT_1))
    })
    await collectResources(runner, 'Ubuntu-24.04')
    expect((await collectResources(runner, 'Ubuntu-24.04')).cpuPercent).toBeNull()
  })

  it('returns safe nulls when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    const res = await collectResources(runner, 'Ubuntu-24.04')
    expect(res.cpuPercent).toBeNull()
    expect(res.memTotalBytes).toBeNull()
    expect(res.loadAvg).toBeNull()
    expect(res.processCount).toBeNull()
    expect(res.disks).toHaveLength(3)
    expect(res.disks.every((d) => !d.exists)).toBe(true)
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectResources(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
