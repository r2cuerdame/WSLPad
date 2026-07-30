import { describe, expect, it } from 'vitest'
import { IMPORTANT_PATH_SPECS } from '../../../../src/shared/constants'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import {
  buildImportantPathsScript,
  collectImportantPaths,
  linuxPathToUnc,
  parseImportantPaths
} from '../../../../src/main/wsl/paths'
import { fakeRunner, ok } from './helpers'

const OUTPUT = [
  'home|/home/recuerdame|d',
  'etc|/etc|d',
  'usr-local-bin|/usr/local/bin|d',
  'local-bin|/home/recuerdame/.local/bin|d',
  'config|/home/recuerdame/.config|d',
  'cache|/home/recuerdame/.cache|d',
  'ssh|/home/recuerdame/.ssh|x',
  'hermes|/home/recuerdame/.hermes|f',
  'windows-user-profile|/mnt/c/Users/recue|d',
  'current-project|/home/recuerdame/wslpad|d'
].join('\n')

describe('linuxPathToUnc', () => {
  it('maps absolute linux paths to \\\\wsl.localhost UNC paths', () => {
    expect(linuxPathToUnc('Ubuntu-24.04', '/home/user/project')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\project'
    )
    expect(linuxPathToUnc('Debian', '/')).toBe('\\\\wsl.localhost\\Debian\\')
  })
})

describe('buildImportantPathsScript', () => {
  it('expands ~ via $HOME and quotes literal paths and ids', () => {
    const script = buildImportantPathsScript()
    expect(script).toContain('p="$HOME";')
    expect(script).toContain(`p="$HOME"'/.local/bin';`)
    expect(script).toContain(`p='/usr/local/bin';`)
    expect(script).toContain(`'local-bin'`)
    expect(script).toContain('windows-user-profile')
    expect(script).toContain('current-project')
    // every ~ from the specs must have been expanded
    expect(script).not.toContain('~')
  })
})

describe('parseImportantPaths', () => {
  it('parses id|path|type lines with labels from the specs', () => {
    const paths = parseImportantPaths(OUTPUT, 'Ubuntu-24.04')
    expect(paths).toHaveLength(10)

    const home = paths[0]
    expect(home).toEqual({
      id: 'home',
      label: 'HOME',
      linuxPath: '/home/recuerdame',
      windowsPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\recuerdame',
      exists: true,
      isDirectory: true
    })

    const ssh = paths.find((p) => p.id === 'ssh')
    expect(ssh).toMatchObject({ label: '~/.ssh', exists: false, isDirectory: null })

    const hermes = paths.find((p) => p.id === 'hermes')
    expect(hermes).toMatchObject({ label: '~/.hermes', exists: true, isDirectory: false })

    expect(paths.find((p) => p.id === 'windows-user-profile')).toMatchObject({
      label: 'Windows user profile',
      linuxPath: '/mnt/c/Users/recue'
    })
    expect(paths.find((p) => p.id === 'current-project')).toMatchObject({
      label: 'Current project',
      linuxPath: '/home/recuerdame/wslpad'
    })

    // ids covered by the shared spec keep the spec order
    const specIds = IMPORTANT_PATH_SPECS.map((s) => s.id)
    expect(paths.slice(0, specIds.length).map((p) => p.id)).toEqual(specIds)
  })

  it('skips malformed lines, relative paths, unknown types and duplicates', () => {
    const text = [
      'garbage',
      'noslash|relative/path|d',
      '|/no-id|d',
      'badtype|/etc|z',
      'home|/home/a|d',
      'home|/home/b|d',
      ''
    ].join('\n')
    const paths = parseImportantPaths(text, 'Ubuntu-24.04')
    expect(paths).toHaveLength(1)
    expect(paths[0].linuxPath).toBe('/home/a')
  })

  it('handles empty and huge input', () => {
    expect(parseImportantPaths('', 'Ubuntu-24.04')).toEqual([])
    const huge = Array.from({ length: 50000 }, (_, i) => `id-${i}|/path/${i}|d`).join('\n')
    expect(parseImportantPaths(huge, 'Ubuntu-24.04')).toHaveLength(50000)
  })
})

describe('collectImportantPaths', () => {
  it('runs the script and parses its output', async () => {
    const runner = fakeRunner(() => ok(OUTPUT))
    const paths = await collectImportantPaths(runner, 'Ubuntu-24.04')
    expect(paths).toHaveLength(10)
    expect(runner.calls).toHaveLength(1)
  })

  it('rejects invalid distro names before running anything', async () => {
    const runner = fakeRunner(() => ok(OUTPUT))
    await expect(collectImportantPaths(runner, 'bad;name')).rejects.toThrow(/Invalid WSL distro/)
    expect(runner.calls).toHaveLength(0)
  })

  it('returns [] when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    expect(await collectImportantPaths(runner, 'Ubuntu-24.04')).toEqual([])
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectImportantPaths(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
