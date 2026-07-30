import { describe, expect, it } from 'vitest'
import {
  convertLinuxToWindows,
  convertWindowsToLinux,
  joinLinuxPath,
  linuxBasename,
  parentLinuxPath,
  windowsBasename
} from '../../../src/main/explorer/path-convert'

const DISTRO = 'Ubuntu-24.04'

describe('convertLinuxToWindows (goal.md §13 table)', () => {
  it('maps distro paths to \\\\wsl.localhost UNC', () => {
    expect(convertLinuxToWindows(DISTRO, '/home/user/project')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\project'
    )
  })

  it('maps /mnt/<drive> to drive letters', () => {
    expect(convertLinuxToWindows(DISTRO, '/mnt/c/Users/user/project')).toBe(
      'C:\\Users\\user\\project'
    )
    expect(convertLinuxToWindows(DISTRO, '/mnt/d/Data')).toBe('D:\\Data')
  })

  it('maps bare /mnt/c to the drive root', () => {
    expect(convertLinuxToWindows(DISTRO, '/mnt/c')).toBe('C:\\')
  })

  it('maps / to the distro share root', () => {
    expect(convertLinuxToWindows(DISTRO, '/')).toBe('\\\\wsl.localhost\\Ubuntu-24.04\\')
  })

  it('keeps non-drive /mnt paths on the UNC side', () => {
    expect(convertLinuxToWindows(DISTRO, '/mnt/wsl/data')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\mnt\\wsl\\data'
    )
  })

  it('preserves hostile names literally (spaces, quotes, $(cmd), hangul)', () => {
    expect(convertLinuxToWindows(DISTRO, "/home/u/a'b $(x).txt")).toBe(
      "\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\a'b $(x).txt"
    )
    expect(convertLinuxToWindows(DISTRO, '/home/유저/프로젝트 파일')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\유저\\프로젝트 파일'
    )
  })

  it('rejects newline and relative paths', () => {
    expect(() => convertLinuxToWindows(DISTRO, '/home/a\nb')).toThrow()
    expect(() => convertLinuxToWindows(DISTRO, 'relative/path')).toThrow()
  })
})

describe('convertWindowsToLinux (goal.md §13 table)', () => {
  it('maps drive paths to /mnt', () => {
    expect(convertWindowsToLinux(DISTRO, 'C:\\Users\\user\\project')).toBe(
      '/mnt/c/Users/user/project'
    )
  })

  it('accepts forward slashes and lowercase drives', () => {
    expect(convertWindowsToLinux(DISTRO, 'c:/Users/x')).toBe('/mnt/c/Users/x')
  })

  it('maps drive roots', () => {
    expect(convertWindowsToLinux(DISTRO, 'C:\\')).toBe('/mnt/c')
  })

  it('maps wsl.localhost UNC of the same distro', () => {
    expect(convertWindowsToLinux(DISTRO, '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user')).toBe(
      '/home/user'
    )
  })

  it('maps legacy wsl$ UNC of the same distro', () => {
    expect(convertWindowsToLinux(DISTRO, '\\\\wsl$\\Ubuntu-24.04\\etc')).toBe('/etc')
  })

  it('maps the UNC share root to /', () => {
    expect(convertWindowsToLinux(DISTRO, '\\\\wsl.localhost\\Ubuntu-24.04')).toBe('/')
    expect(convertWindowsToLinux(DISTRO, '\\\\wsl.localhost\\Ubuntu-24.04\\')).toBe('/')
  })

  it('matches the distro segment case-insensitively', () => {
    expect(convertWindowsToLinux(DISTRO, '\\\\wsl.localhost\\ubuntu-24.04\\opt')).toBe('/opt')
  })

  it('returns null for other distros — no guessing', () => {
    expect(convertWindowsToLinux(DISTRO, '\\\\wsl.localhost\\Debian\\home\\user')).toBeNull()
  })

  it('returns null for foreign UNC shares and relative paths', () => {
    expect(convertWindowsToLinux(DISTRO, '\\\\server\\share\\x')).toBeNull()
    expect(convertWindowsToLinux(DISTRO, 'relative\\path')).toBeNull()
  })

  it('returns null for newline-poisoned input', () => {
    expect(convertWindowsToLinux(DISTRO, 'C:\\a\nb')).toBeNull()
  })

  it('preserves hostile names literally', () => {
    expect(convertWindowsToLinux(DISTRO, "C:\\Users\\한 글\\a'b $(x).txt")).toBe(
      "/mnt/c/Users/한 글/a'b $(x).txt"
    )
  })

  it('round-trips the §13 table in both directions', () => {
    const linux = ['/home/user/project', '/mnt/c/Users/user/project']
    for (const p of linux) {
      const win = convertLinuxToWindows(DISTRO, p)
      expect(convertWindowsToLinux(DISTRO, win)).toBe(p)
    }
  })
})

describe('linux path helpers', () => {
  it('joins paths incl. root', () => {
    expect(joinLinuxPath('/home/u', 'file.txt')).toBe('/home/u/file.txt')
    expect(joinLinuxPath('/', 'etc')).toBe('/etc')
  })

  it('computes parents', () => {
    expect(parentLinuxPath('/home/u/file.txt')).toBe('/home/u')
    expect(parentLinuxPath('/etc')).toBe('/')
    expect(parentLinuxPath('/')).toBe('/')
  })

  it('computes basenames', () => {
    expect(linuxBasename('/home/u/file.txt')).toBe('file.txt')
    expect(linuxBasename('/home/u/dir/')).toBe('dir')
    expect(linuxBasename('/')).toBe('/')
  })

  it('computes windows basenames', () => {
    expect(windowsBasename('C:\\Users\\u\\file.txt')).toBe('file.txt')
    expect(windowsBasename('C:\\Users\\u\\dir\\')).toBe('dir')
    expect(windowsBasename('C:/mixed/slash.txt')).toBe('slash.txt')
  })
})
