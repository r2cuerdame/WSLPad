import { describe, expect, it } from 'vitest'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import {
  collectSystemInfo,
  parseOsRelease,
  parseSystemInfo,
  splitSections
} from '../../../../src/main/wsl/system'
import { fakeRunner, joinSections, ok } from './helpers'

const OS_RELEASE = [
  'PRETTY_NAME="Ubuntu 24.04.2 LTS"',
  'NAME="Ubuntu"',
  'VERSION_ID="24.04"',
  'ID=ubuntu',
  'ID_LIKE=debian',
  '# a comment',
  'HOME_URL="https://www.ubuntu.com/"'
].join('\n')

const FULL_OUTPUT = joinSections(
  '6.6.36.3-microsoft-standard-WSL2',
  'devbox',
  'recuerdame',
  '/home/recuerdame',
  'recuerdame:x:1000:1000:,,,:/home/recuerdame:/bin/bash',
  '12345.67 98765.43',
  'yes',
  '172.29.112.5 fe80::215:5dff:fe00:1',
  OS_RELEASE,
  '/mnt/c/Users/recue'
)

describe('parseOsRelease', () => {
  it('parses quoted and unquoted values, skipping comments', () => {
    const map = parseOsRelease(OS_RELEASE)
    expect(map['PRETTY_NAME']).toBe('Ubuntu 24.04.2 LTS')
    expect(map['ID']).toBe('ubuntu')
    expect(map['VERSION_ID']).toBe('24.04')
    expect(map['# a comment']).toBeUndefined()
  })

  it('unescapes backslash escapes inside quoted values', () => {
    expect(parseOsRelease('PRETTY_NAME="Foo \\"Bar\\" OS"')['PRETTY_NAME']).toBe('Foo "Bar" OS')
  })

  it('returns empty map for empty and malformed input', () => {
    expect(parseOsRelease('')).toEqual({})
    expect(parseOsRelease('=nokey\njust text\n===')).toEqual({})
  })
})

describe('splitSections', () => {
  it('splits on marker lines and keeps empty sections', () => {
    expect(splitSections(joinSections('a', '', 'c'))).toEqual(['a', '', 'c'])
  })

  it('returns single section when no marker present', () => {
    expect(splitSections('just text')).toEqual(['just text'])
  })
})

describe('parseSystemInfo', () => {
  it('parses the full script output', () => {
    const { system, osName } = parseSystemInfo(FULL_OUTPUT)
    expect(system).toEqual({
      kernel: '6.6.36.3-microsoft-standard-WSL2',
      hostname: 'devbox',
      user: 'recuerdame',
      home: '/home/recuerdame',
      shell: '/bin/bash',
      uptimeSeconds: 12345,
      systemdEnabled: true,
      ip: '172.29.112.5',
      windowsUserProfileLinux: '/mnt/c/Users/recue'
    })
    expect(osName).toBe('Ubuntu 24.04.2 LTS')
  })

  it('returns all nulls for empty input', () => {
    const { system, osName } = parseSystemInfo('')
    expect(system).toEqual({
      kernel: null,
      hostname: null,
      user: null,
      home: null,
      shell: null,
      uptimeSeconds: null,
      systemdEnabled: null,
      ip: null,
      windowsUserProfileLinux: null
    })
    expect(osName).toBeNull()
  })

  it('falls back to the passwd home when $HOME is not absolute', () => {
    const out = joinSections(
      'k',
      'h',
      'u',
      'not-absolute',
      'u:x:1000:1000::/home/u:/usr/bin/zsh',
      '',
      'no',
      '',
      '',
      ''
    )
    const { system } = parseSystemInfo(out)
    expect(system.home).toBe('/home/u')
    expect(system.shell).toBe('/usr/bin/zsh')
    expect(system.systemdEnabled).toBe(false)
  })

  it('rejects malformed uptime, ip and profile sections', () => {
    const out = joinSections(
      'k',
      'h',
      'u',
      '/home/u',
      'garbage-without-colons',
      'not-a-number',
      'maybe',
      'no ip here',
      'PRETTY_NAME=',
      'C:\\Users\\recue'
    )
    const { system } = parseSystemInfo(out)
    expect(system.shell).toBeNull()
    expect(system.uptimeSeconds).toBeNull()
    expect(system.systemdEnabled).toBeNull()
    expect(system.ip).toBeNull()
    expect(system.windowsUserProfileLinux).toBeNull()
  })

  it('accepts an IPv6 first token', () => {
    const out = joinSections('k', 'h', 'u', '/h', '', '1 1', 'yes', 'fe80::1 172.1.2.3', '', '')
    expect(parseSystemInfo(out).system.ip).toBe('fe80::1')
  })

  it('survives huge input', () => {
    const huge = joinSections(
      'kernel-x',
      'host',
      'user',
      '/home/user',
      'user:x:1:1::/home/user:/bin/sh',
      '5.0 5.0',
      'yes',
      '10.0.0.2',
      Array.from({ length: 50000 }, (_, i) => `KEY_${i}="value ${i}"`).join('\n'),
      '/mnt/c/Users/big'
    )
    const { system, osName } = parseSystemInfo(huge)
    expect(system.kernel).toBe('kernel-x')
    expect(system.windowsUserProfileLinux).toBe('/mnt/c/Users/big')
    expect(osName).toBeNull()
  })
})

describe('collectSystemInfo', () => {
  it('runs one script and parses its output', async () => {
    const runner = fakeRunner(() => ok(FULL_OUTPUT))
    const { system, osName } = await collectSystemInfo(runner, 'Ubuntu-24.04')
    expect(runner.calls).toHaveLength(1)
    expect(system.user).toBe('recuerdame')
    expect(osName).toBe('Ubuntu 24.04.2 LTS')
  })

  it('returns safe nulls when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    const { system, osName } = await collectSystemInfo(runner, 'Ubuntu-24.04')
    expect(system.kernel).toBeNull()
    expect(osName).toBeNull()
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectSystemInfo(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
