import { describe, expect, it, vi } from 'vitest'
import {
  computeReclaimable,
  createDiskCollector,
  findLxssEntry,
  parseLxssRegistry,
  parseSparseFlag,
  stripExtendedPrefix,
  sumAllocatedRanges,
  type DiskHostAccess
} from '../../../src/main/wsl/disk'
import type { HostCommandRunner } from '../../../src/main/wsl/windows-ports'
import { fakeRunner, ok } from './collectors/helpers'

const GIB = 1024 ** 3

/** Real `reg query … /s` shape: the root key first, then one key per distro. */
const REG_OUTPUT = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss',
  '    NatIpAddress    REG_SZ    172.29.150.197',
  '    DefaultDistribution    REG_SZ    {87c9fd9c}',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{2e7f6afe}',
  '    State    REG_DWORD    0x1',
  '    DistributionName    REG_SZ    docker-desktop',
  '    Version    REG_DWORD    0x2',
  '    BasePath    REG_SZ    \\\\?\\C:\\Users\\dev\\AppData\\Local\\Docker\\wsl\\main',
  '    VhdFileName    REG_SZ    docker_data.vhdx',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{87c9fd9c}',
  '    State    REG_DWORD    0x1',
  '    DistributionName    REG_SZ    Ubuntu-24.04',
  '    Version    REG_DWORD    0x2',
  '    DefaultUid    REG_DWORD    0x3e8',
  '    BasePath    REG_SZ    C:\\Users\\dev\\AppData\\Local\\wsl\\Ubuntu-24.04',
  '    Flags    REG_DWORD    0xf',
  '    ShortcutPath    REG_SZ    C:\\Users\\dev\\Start Menu\\Ubuntu-24.04.lnk',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{11111111}',
  '    DistributionName    REG_SZ    Legacy',
  '    Version    REG_DWORD    0x1',
  '    BasePath    REG_SZ    C:\\Users\\dev\\AppData\\Local\\lxss',
  '',
  'End of search: 3 match(es) found.'
].join('\r\n')

const UBUNTU_BASE = 'C:\\Users\\dev\\AppData\\Local\\wsl\\Ubuntu-24.04'
const UBUNTU_VHDX = `${UBUNTU_BASE}\\ext4.vhdx`

const DF_OUTPUT = [
  'Filesystem     1B-blocks         Used    Available Use% Mounted on',
  `/dev/sdc   1081101176832  ${12 * GIB}  1000000000000   2% /`
].join('\n')

const RANGES_OUTPUT = [
  'Allocated range[0]: Offset: 0x0         Length: 0x100000000',
  'Allocated range[1]: Offset: 0x180000000 Length: 0x40000000'
].join('\r\n')

interface Fakes {
  access: Partial<DiskHostAccess>
  calls: string[][]
}

function fakes(
  over: {
    reg?: string | Error
    ranges?: string | Error
    sparse?: string | Error
    sizes?: Record<string, number>
    images?: string[] | null
  } = {}
): Fakes {
  const sizes = over.sizes ?? { [UBUNTU_VHDX]: 80 * GIB }
  const calls: string[][] = []
  const answer = (value: string | Error | undefined, fallback: string): string => {
    if (value instanceof Error) throw value
    return value ?? fallback
  }
  const run: HostCommandRunner = async (file, args) => {
    calls.push([file, ...args])
    if (file === 'reg.exe') return answer(over.reg, REG_OUTPUT)
    if (args[0] === 'sparse') return answer(over.sparse, 'This file is NOT set as sparse')
    return answer(over.ranges, RANGES_OUTPUT)
  }
  return {
    calls,
    access: {
      run,
      fileSize: async (path) => sizes[path] ?? null,
      listImages: async () => (over.images === undefined ? [] : over.images)
    }
  }
}

const runnerWithDf = (out = DF_OUTPUT): ReturnType<typeof fakeRunner> => fakeRunner(() => ok(out))

describe('parseLxssRegistry', () => {
  it('reads every distro subkey positionally and strips the \\\\?\\ prefix', () => {
    const entries = parseLxssRegistry(REG_OUTPUT)
    expect(entries.map((e) => e.distro)).toEqual(['docker-desktop', 'Ubuntu-24.04', 'Legacy'])
    expect(entries[0]).toEqual({
      distro: 'docker-desktop',
      basePath: 'C:\\Users\\dev\\AppData\\Local\\Docker\\wsl\\main',
      vhdFileName: 'docker_data.vhdx',
      version: 2,
      defaultUid: null
    })
    // The root key carries no DistributionName and must not become an entry.
    expect(entries).toHaveLength(3)
    expect(entries[1].basePath).toBe(UBUNTU_BASE)
    expect(entries[1].vhdFileName).toBeNull()
    expect(entries[2].version).toBe(1)
  })

  it('reads DefaultUid as a number, and leaves it null where the value is absent', () => {
    const entries = parseLxssRegistry(REG_OUTPUT)
    // 0x3e8 is the uid every first-run WSL user gets.
    expect(entries[1].defaultUid).toBe(1000)
    // Absent is unknown, not root: a missing value must never read as uid 0.
    expect(entries[0].defaultUid).toBeNull()
    expect(entries[2].defaultUid).toBeNull()
  })

  it('reads DefaultUid 0 as root rather than as absent', () => {
    const text = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{1}',
      '    DistributionName    REG_SZ    Rooted',
      '    DefaultUid    REG_DWORD    0x0'
    ].join('\r\n')
    expect(parseLxssRegistry(text)[0].defaultUid).toBe(0)
  })

  it('keeps values whose data contains spaces', () => {
    const entries = parseLxssRegistry(
      [
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{a}',
        '    DistributionName    REG_SZ    My Distro 2',
        '    BasePath    REG_SZ    C:\\Program Files\\WSL\\My Distro 2'
      ].join('\n')
    )
    expect(entries).toEqual([
      {
        distro: 'My Distro 2',
        basePath: 'C:\\Program Files\\WSL\\My Distro 2',
        vhdFileName: null,
        version: null,
        defaultUid: null
      }
    ])
  })

  it('returns nothing for empty output, garbage or an error message', () => {
    expect(parseLxssRegistry('')).toEqual([])
    expect(parseLxssRegistry('ERROR: The system was unable to find the specified key')).toEqual([])
    expect(parseLxssRegistry('\u0000\u0001 not registry output at all')).toEqual([])
  })
})

describe('findLxssEntry', () => {
  const entries = parseLxssRegistry(REG_OUTPUT)

  it('matches the exact name first and falls back to case-insensitive', () => {
    expect(findLxssEntry(entries, 'Ubuntu-24.04')?.basePath).toBe(UBUNTU_BASE)
    expect(findLxssEntry(entries, 'ubuntu-24.04')?.distro).toBe('Ubuntu-24.04')
  })

  it('returns null for a distro that has no registry entry', () => {
    expect(findLxssEntry(entries, 'Debian')).toBeNull()
  })
})

describe('stripExtendedPrefix', () => {
  it('removes the \\\\?\\ forms and leaves a plain path alone', () => {
    expect(stripExtendedPrefix('\\\\?\\C:\\wsl')).toBe('C:\\wsl')
    expect(stripExtendedPrefix('\\\\?\\UNC\\srv\\share')).toBe('\\\\srv\\share')
    expect(stripExtendedPrefix('C:\\wsl')).toBe('C:\\wsl')
  })
})

describe('sumAllocatedRanges', () => {
  it('adds the length of every range', () => {
    expect(sumAllocatedRanges(RANGES_OUTPUT)).toBe(0x100000000 + 0x40000000)
    expect(sumAllocatedRanges('Allocated range[0]: Offset: 0x0 Length: 0x1420000000')).toBe(
      0x1420000000
    )
  })

  it('reads the length positionally, so a localized label still sums', () => {
    expect(sumAllocatedRanges('Zugewiesener Bereich[0]: Offset: 0x1000 Länge: 0x2000')).toBe(0x2000)
  })

  it('is unknown rather than zero when there is no usable range', () => {
    expect(sumAllocatedRanges('')).toBeNull()
    expect(sumAllocatedRanges('Error 3: The system cannot find the path specified.')).toBeNull()
    // A single hex number is an offset without a length — not a range.
    expect(sumAllocatedRanges('Offset: 0x0')).toBeNull()
  })
})

describe('parseSparseFlag', () => {
  it('reads the two English answers', () => {
    expect(parseSparseFlag('This file is NOT set as sparse\r\n')).toBe(false)
    expect(parseSparseFlag('This file is set as sparse')).toBe(true)
  })

  it('stays unknown for an empty or translated answer', () => {
    expect(parseSparseFlag('')).toBeNull()
    expect(parseSparseFlag('Diese Datei ist als Sparse-Datei festgelegt')).toBeNull()
  })
})

describe('computeReclaimable', () => {
  it('reports the surplus the image keeps', () => {
    expect(computeReclaimable(80 * GIB, 12 * GIB)).toBe(68 * GIB)
  })

  it('never reports a negative or empty surplus', () => {
    expect(computeReclaimable(10 * GIB, 12 * GIB)).toBeNull()
    expect(computeReclaimable(10 * GIB, 10 * GIB)).toBeNull()
    expect(computeReclaimable(null, 12 * GIB)).toBeNull()
    expect(computeReclaimable(80 * GIB, null)).toBeNull()
  })
})

describe('createDiskCollector', () => {
  it('locates the image and reconciles both sides', async () => {
    const { access, calls } = fakes()
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'Ubuntu-24.04')

    expect(info).toEqual({
      distro: 'Ubuntu-24.04',
      vhdxPath: UBUNTU_VHDX,
      basePath: UBUNTU_BASE,
      vhdxBytes: 80 * GIB,
      allocatedBytes: 0x100000000 + 0x40000000,
      sparse: false,
      fsSizeBytes: 1081101176832,
      fsUsedBytes: 12 * GIB,
      reclaimableBytes: 68 * GIB,
      error: null
    })
    // queryAllocRanges needs both bounds or it refuses to run.
    expect(calls[1]).toEqual([
      'fsutil',
      'file',
      'queryAllocRanges',
      'offset=0',
      `length=${80 * GIB}`,
      UBUNTU_VHDX
    ])
    expect(calls[2]).toEqual(['fsutil', 'sparse', 'queryflag', UBUNTU_VHDX])
  })

  it('prefers the image name the registry recorded', async () => {
    const base = 'C:\\Users\\dev\\AppData\\Local\\Docker\\wsl\\main'
    const { access } = fakes({ sizes: { [`${base}\\docker_data.vhdx`]: 4 * GIB } })
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'docker-desktop')
    expect(info.vhdxPath).toBe(`${base}\\docker_data.vhdx`)
    expect(info.vhdxBytes).toBe(4 * GIB)
  })

  it('falls back to the only *.vhdx in the folder', async () => {
    const other = `${UBUNTU_BASE}\\disk.vhdx`
    const { access } = fakes({ sizes: { [other]: 9 * GIB }, images: ['disk.vhdx'] })
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'Ubuntu-24.04')
    expect(info.vhdxPath).toBe(other)
    expect(info.error).toBeNull()
  })

  it('refuses to guess when the folder holds several images', async () => {
    const { access } = fakes({ sizes: {}, images: ['a.vhdx', 'b.vhdx'] })
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'Ubuntu-24.04')
    expect(info.vhdxPath).toBeNull()
    expect(info.vhdxBytes).toBeNull()
    expect(info.basePath).toBe(UBUNTU_BASE)
    expect(info.error).toBe('Several .vhdx images in the distribution folder')
  })

  it('keeps the numbers null when fsutil fails', async () => {
    const { access } = fakes({
      ranges: new Error('fsutil exited with code 1'),
      sparse: new Error('fsutil exited with code 1')
    })
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'Ubuntu-24.04')
    expect(info.allocatedBytes).toBeNull()
    expect(info.sparse).toBeNull()
    expect(info.vhdxBytes).toBe(80 * GIB)
    expect(info.error).toBe(
      'Size on disk is unknown (fsutil did not answer); Sparse flag is unknown (fsutil did not answer)'
    )
  })

  it('still reports the Windows side when the distro does not answer df', async () => {
    const { access } = fakes()
    const runner = fakeRunner(() => {
      throw new Error('distro is stopped')
    })
    const info = await createDiskCollector(access).collect(runner, 'Ubuntu-24.04')
    expect(info.vhdxBytes).toBe(80 * GIB)
    expect(info.fsSizeBytes).toBeNull()
    expect(info.fsUsedBytes).toBeNull()
    expect(info.reclaimableBytes).toBeNull()
    expect(info.error).toBe('In-distro usage is unknown (df did not answer)')
  })

  it('says so when the registry cannot be read at all', async () => {
    const { access } = fakes({ reg: new Error('reg.exe exited with code 1') })
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'Ubuntu-24.04')
    expect(info.vhdxPath).toBeNull()
    expect(info.basePath).toBeNull()
    expect(info.error).toBe('The WSL registry entries could not be read')
    // The in-distro view survives a Windows-side failure.
    expect(info.fsUsedBytes).toBe(12 * GIB)
  })

  it('names the distro that has no registry entry', async () => {
    const { access } = fakes()
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'Debian')
    expect(info.error).toBe('No registry entry for Debian')
    expect(info.vhdxPath).toBeNull()
  })

  it('explains a WSL 1 distro instead of hunting for an image', async () => {
    const { access, calls } = fakes()
    const info = await createDiskCollector(access).collect(runnerWithDf(), 'Legacy')
    expect(info.basePath).toBe('C:\\Users\\dev\\AppData\\Local\\lxss')
    expect(info.vhdxPath).toBeNull()
    expect(info.error).toBe('WSL 1 distributions do not use a virtual disk image')
    expect(calls.map((c) => c[0])).toEqual(['reg.exe'])
  })

  it('never throws, whatever the host does', async () => {
    const boom = (): never => {
      throw new Error('access denied')
    }
    const collector = createDiskCollector({
      run: vi.fn(boom),
      fileSize: vi.fn(boom),
      listImages: vi.fn(boom)
    })
    const runner = fakeRunner(boom)
    await expect(collector.collect(runner, 'Ubuntu-24.04')).resolves.toMatchObject({
      distro: 'Ubuntu-24.04',
      vhdxPath: null,
      vhdxBytes: null
    })
  })
})
