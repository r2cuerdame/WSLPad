import { describe, expect, it } from 'vitest'
import {
  DRIVE_MOUNTS_SCRIPT,
  collectDriveMounts,
  describeMount,
  parseDriveMounts,
  splitMountOptions
} from '../../../src/main/wsl/drive-mounts'
import { parseMounts } from '../../../src/main/wsl/wsl-config'
import type { DistroRunner } from '../../../src/main/wsl/contracts'
import { SECTION_MARKER } from '../../../src/main/wsl/system'
import { joinSections, ok } from './collectors/helpers'

/**
 * Captured from a current WSL 2 machine. The drives ride on 9p and their real
 * DrvFs options live inside the aname= value, separated by semicolons — the
 * detail that makes a comma-only split silently wrong.
 */
const MOUNTS = [
  '/dev/sdd / ext4 rw,relatime,discard,errors=remount-ro,data=ordered 0 0',
  'none /mnt/wsl tmpfs rw,relatime 0 0',
  'C:\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\;uid=1000;gid=1001;symlinkroot=/mnt/,cache=5,access=client,msize=65536,trans=fd 0 0',
  'D:\\134 /mnt/d 9p rw,noatime,aname=drvfs;path=D:\\;uid=1000;gid=1001;metadata;case=off;fmask=133,cache=5 0 0',
  // A DrvFs bind that is not an automount drive: Docker Desktop does this.
  'C:\\134Program\\040Files\\134Docker /Docker/host 9p rw,noatime,aname=drvfs;path=C:\\Prog 0 0',
  'none /mnt/wslg tmpfs rw,relatime 0 0'
].join('\n')

const WSLCONF = '[automount]\nenabled=true\noptions=metadata,umask=22\n'

function probe(mounts = MOUNTS, conf = WSLCONF): string {
  return joinSections(mounts, conf)
}

function runner(stdout: string): DistroRunner {
  return {
    async runWsl() {
      return ok('')
    },
    async runInDistro() {
      return ok(stdout)
    },
    async disposeAll() {
      /* nothing spawned */
    }
  }
}

describe('splitMountOptions', () => {
  it('splits on both separators DrvFs actually uses', () => {
    const parts = splitMountOptions('rw,noatime,aname=drvfs;path=C:\\;uid=1000;metadata,cache=5')
    expect(parts).toContain('metadata')
    expect(parts).toContain('uid=1000')
    expect(parts).toContain('cache=5')
  })

  it('drops empties so a trailing separator does not become an option', () => {
    expect(splitMountOptions('rw,,;metadata;')).toEqual(['rw', 'metadata'])
  })
})

describe('describeMount', () => {
  it('finds metadata inside the aname= value, where current WSL 2 puts it', () => {
    const row = parseMounts(MOUNTS).find((m) => m.point === '/mnt/d')
    expect(row).toBeDefined()
    const info = describeMount(row!)
    // A comma-only split would report false here on every real machine.
    expect(info.metadata).toBe(true)
    expect(info.caseSensitivity).toBe('off')
    expect(info.fmask).toBe('133')
    expect(info.source).toBe('D:\\')
    expect(info.uid).toBe(1000)
    expect(info.gid).toBe(1001)
  })

  it('reports a drive without metadata as exactly that', () => {
    const row = parseMounts(MOUNTS).find((m) => m.point === '/mnt/c')!
    const info = describeMount(row)
    expect(info.metadata).toBe(false)
    // Absent is absent: no option must be invented from a missing one.
    expect(info.caseSensitivity).toBeNull()
    expect(info.umask).toBeNull()
    expect(info.fmask).toBeNull()
    expect(info.dmask).toBeNull()
  })

  it('reads the WSL 1 shape, where the options are plain and comma separated', () => {
    const row = parseMounts('C: /mnt/c drvfs rw,noatime,uid=1000,gid=1000,metadata,case=dir 0 0')[0]
    const info = describeMount(row)
    expect(info.metadata).toBe(true)
    expect(info.caseSensitivity).toBe('dir')
    expect(info.source).toBe('C:')
  })

  it('ignores a non-numeric uid rather than coercing it', () => {
    const row = parseMounts('drvfs /mnt/c drvfs rw,uid=abc 0 0')[0]
    expect(describeMount(row).uid).toBeNull()
  })
})

describe('parseDriveMounts', () => {
  it('reports one row per drive, sorted, and nothing else', () => {
    const info = parseDriveMounts(probe())
    expect(info?.drives.map((d) => d.point)).toEqual(['/mnt/c', '/mnt/d'])
  })

  it('leaves out DrvFs mounts that are not automount drives', () => {
    const info = parseDriveMounts(probe())
    // Docker's bind is a Windows filesystem but says nothing about a drive.
    expect(info?.drives.some((d) => d.point === '/Docker/host')).toBe(false)
  })

  it('carries what /etc/wsl.conf declared, so the two can be compared', () => {
    const info = parseDriveMounts(probe())
    expect(info?.declaredOptions).toBe('metadata,umask=22')
    expect(info?.declaredEnabled).toBe(true)
  })

  it('leaves the declaration null when the file says nothing', () => {
    const info = parseDriveMounts(probe(MOUNTS, ''))
    expect(info?.declaredOptions).toBeNull()
    expect(info?.declaredEnabled).toBeNull()
    // The drives themselves still stand on their own.
    expect(info?.drives).toHaveLength(2)
  })

  it('returns null when /proc/mounts could not be read at all', () => {
    // Unknown is not "no drives are mounted".
    expect(parseDriveMounts(probe('', WSLCONF))).toBeNull()
  })

  it('reports an empty list when the file was read and holds no drives', () => {
    const info = parseDriveMounts(probe('/dev/sdd / ext4 rw 0 0', WSLCONF))
    expect(info?.drives).toEqual([])
  })
})

describe('collectDriveMounts', () => {
  it('asks for both files in one round trip', async () => {
    expect(DRIVE_MOUNTS_SCRIPT).toContain('/proc/mounts')
    expect(DRIVE_MOUNTS_SCRIPT).toContain('/etc/wsl.conf')
    const info = await collectDriveMounts(runner(probe()), 'Ubuntu')
    expect(info?.drives).toHaveLength(2)
  })

  it('degrades to unknown when the distro does not answer', async () => {
    const dead: DistroRunner = {
      async runWsl() {
        return ok('')
      },
      async runInDistro() {
        throw new Error('distribution is stopped')
      },
      async disposeAll() {
        /* nothing spawned */
      }
    }
    expect(await collectDriveMounts(dead, 'Ubuntu')).toBeNull()
  })
})

/** Same alignment regression as inotify: a leading marker shifts every section. */
describe('DRIVE_MOUNTS_SCRIPT section alignment', () => {
  it('puts the marker between the two probes, never before the first', () => {
    expect(DRIVE_MOUNTS_SCRIPT.startsWith('cat /proc/mounts')).toBe(true)
    expect(DRIVE_MOUNTS_SCRIPT.indexOf(SECTION_MARKER)).toBeGreaterThan(0)
    expect(DRIVE_MOUNTS_SCRIPT.split(SECTION_MARKER)).toHaveLength(2)
  })

  it('reads a real round trip back into the right fields', () => {
    const stdout = [MOUNTS, '', SECTION_MARKER, '', WSLCONF].join('\n')
    const info = parseDriveMounts(stdout)
    // A shifted section 0 would make this null — "no mounts could be read".
    expect(info?.drives.map((d) => d.point)).toEqual(['/mnt/c', '/mnt/d'])
    expect(info?.declaredOptions).toBe('metadata,umask=22')
  })
})
