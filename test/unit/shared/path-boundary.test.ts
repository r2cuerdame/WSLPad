import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTOMOUNT_ROOT,
  automountRootFromSettings,
  classifyPathSide,
  isCrossBoundary,
  normalizeAutomountRoot,
  wslUncDistro
} from '@shared/path-boundary'
import type { WslSettingInfo } from '@shared/types'

function setting(patch: Partial<WslSettingInfo>): WslSettingInfo {
  return {
    key: 'root',
    section: 'automount',
    scope: 'linux',
    declaredValue: null,
    effectiveValue: null,
    origin: 'default',
    provenance: 'wsl-default',
    verdict: 'applied',
    note: null,
    ...patch
  }
}

describe('classifyPathSide', () => {
  it('calls the distro disk ext4', () => {
    expect(classifyPathSide('/home/dev/projects')).toBe('ext4')
    expect(classifyPathSide('/')).toBe('ext4')
    expect(classifyPathSide('/usr/local/bin/node')).toBe('ext4')
  })

  it('calls the drive mounts windows-mount', () => {
    expect(classifyPathSide('/mnt/c')).toBe('windows-mount')
    expect(classifyPathSide('/mnt/c/Users/dev')).toBe('windows-mount')
    expect(classifyPathSide('/mnt/D/repos')).toBe('windows-mount')
  })

  it('does not mistake a multi-letter directory under /mnt for a drive', () => {
    // /mnt/wsl is the VM's own tmpfs, not a Windows drive.
    expect(classifyPathSide('/mnt/wsl/docker-desktop')).toBe('ext4')
    expect(classifyPathSide('/mnt/data')).toBe('ext4')
  })

  it('respects an automount root that is not /mnt', () => {
    expect(classifyPathSide('/c/Users/dev', '/')).toBe('windows-mount')
    expect(classifyPathSide('/home/dev', '/')).toBe('ext4')
    expect(classifyPathSide('/drives/c/Users', '/drives')).toBe('windows-mount')
    // …and then /mnt/c is no longer a drive mount, because it is not mounted.
    expect(classifyPathSide('/mnt/c/Users', '/drives/')).toBe('ext4')
  })

  it('calls a wsl share unc, whichever distro or separator it names', () => {
    expect(classifyPathSide('\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev')).toBe('unc')
    expect(classifyPathSide('\\\\wsl$\\Debian\\etc')).toBe('unc')
    expect(classifyPathSide('//wsl.localhost/Ubuntu-24.04/home')).toBe('unc')
    expect(classifyPathSide('\\\\WSL.LOCALHOST\\Ubuntu')).toBe('unc')
  })

  it('refuses to judge paths that are not on either side of the boundary', () => {
    expect(classifyPathSide(null)).toBe('unknown')
    expect(classifyPathSide('')).toBe('unknown')
    expect(classifyPathSide(undefined)).toBe('unknown')
    expect(classifyPathSide('relative/path')).toBe('unknown')
    // An ordinary file server is somebody else's filesystem, not a WSL one.
    expect(classifyPathSide('\\\\fileserver\\share\\docs')).toBe('unknown')
    // A plain drive letter read from Windows sits on neither side.
    expect(classifyPathSide('C:\\Users\\dev')).toBe('unknown')
  })
})

describe('normalizeAutomountRoot', () => {
  it('always yields an absolute prefix ending in one slash', () => {
    expect(normalizeAutomountRoot('/mnt')).toBe('/mnt/')
    expect(normalizeAutomountRoot('/mnt/')).toBe('/mnt/')
    expect(normalizeAutomountRoot('  /drives  ')).toBe('/drives/')
    expect(normalizeAutomountRoot('//mnt//')).toBe('/mnt/')
    expect(normalizeAutomountRoot('/')).toBe('/')
  })

  it('falls back to the WSL default rather than to a prefix matching nothing', () => {
    expect(normalizeAutomountRoot(null)).toBe(DEFAULT_AUTOMOUNT_ROOT)
    expect(normalizeAutomountRoot(undefined)).toBe(DEFAULT_AUTOMOUNT_ROOT)
    expect(normalizeAutomountRoot('')).toBe(DEFAULT_AUTOMOUNT_ROOT)
    expect(normalizeAutomountRoot('mnt')).toBe(DEFAULT_AUTOMOUNT_ROOT)
  })
})

describe('wslUncDistro', () => {
  it('names the distro a WSL share reaches into', () => {
    expect(wslUncDistro('\\\\wsl.localhost\\Ubuntu-24.04\\home')).toBe('Ubuntu-24.04')
    expect(wslUncDistro('//wsl$/Debian')).toBe('Debian')
  })

  it('is null for anything that is not a WSL share', () => {
    expect(wslUncDistro('\\\\fileserver\\share')).toBeNull()
    expect(wslUncDistro('/home/dev')).toBeNull()
    expect(wslUncDistro('C:\\Users')).toBeNull()
  })
})

describe('isCrossBoundary', () => {
  it('counts only the two crossings, never unknown', () => {
    expect(isCrossBoundary('windows-mount')).toBe(true)
    expect(isCrossBoundary('unc')).toBe(true)
    expect(isCrossBoundary('ext4')).toBe(false)
    expect(isCrossBoundary('unknown')).toBe(false)
  })
})

describe('automountRootFromSettings', () => {
  it('prefers the observed root over the declared one', () => {
    const settings = [
      setting({ declaredValue: '/drives/', effectiveValue: '/mnt/' }),
      setting({ key: 'enabled', effectiveValue: 'true' })
    ]
    expect(automountRootFromSettings(settings)).toBe('/mnt/')
  })

  it('uses the declared root when nothing was observed', () => {
    expect(automountRootFromSettings([setting({ declaredValue: '/drives' })])).toBe('/drives/')
  })

  it('falls back to the default when the setting is absent or unreadable', () => {
    expect(automountRootFromSettings(null)).toBe(DEFAULT_AUTOMOUNT_ROOT)
    expect(automountRootFromSettings([])).toBe(DEFAULT_AUTOMOUNT_ROOT)
    expect(automountRootFromSettings([setting({ section: 'wsl2', key: 'memory' })])).toBe(
      DEFAULT_AUTOMOUNT_ROOT
    )
  })
})
