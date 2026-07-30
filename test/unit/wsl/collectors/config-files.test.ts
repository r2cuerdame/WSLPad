import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONFIG_FILE_SPECS } from '../../../../src/shared/constants'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import {
  buildConfigFilesScript,
  collectConfigFiles,
  parseConfigFiles
} from '../../../../src/main/wsl/config-files'
import { fakeRunner, ok } from './helpers'

const LINUX_OUTPUT = [
  'wsl-conf|/etc/wsl.conf|1|1|0',
  'fstab|/etc/fstab|1|1|0',
  'bashrc|/home/recuerdame/.bashrc|1|1|1',
  'profile|/home/recuerdame/.profile|1|1|1',
  'zshrc|/home/recuerdame/.zshrc|0|0|0',
  'config-dir|/home/recuerdame/.config|1|1|1',
  'environment|/etc/environment|1|1|0'
].join('\n')

describe('buildConfigFilesScript', () => {
  it('covers only linux specs and expands ~ via $HOME', () => {
    const script = buildConfigFilesScript()
    expect(script).not.toContain('wslconfig')
    expect(script).toContain(`'wsl-conf'`)
    expect(script).toContain(`p="$HOME"'/.bashrc';`)
    expect(script).toContain(`p='/etc/environment';`)
    expect(script).not.toContain('~')
  })
})

describe('parseConfigFiles', () => {
  it('parses id|path|exists|readable|writable lines', () => {
    const lines = parseConfigFiles(LINUX_OUTPUT)
    expect(lines).toHaveLength(7)
    expect(lines[0]).toEqual({
      id: 'wsl-conf',
      linuxPath: '/etc/wsl.conf',
      exists: true,
      readable: true,
      writable: false
    })
    expect(lines[4]).toMatchObject({ id: 'zshrc', exists: false, readable: false })
  })

  it('keeps pipes inside the path by splitting from both ends', () => {
    const lines = parseConfigFiles('odd|/tmp/we|ird|1|0|1')
    expect(lines).toHaveLength(1)
    expect(lines[0].linuxPath).toBe('/tmp/we|ird')
    expect(lines[0]).toMatchObject({ exists: true, readable: false, writable: true })
  })

  it('skips malformed lines and handles empty and huge input', () => {
    expect(parseConfigFiles('')).toEqual([])
    expect(parseConfigFiles('too|few|fields')).toEqual([])
    expect(parseConfigFiles('id|relative/path|1|1|1')).toEqual([])
    expect(parseConfigFiles('id|/p|2|1|1')).toEqual([])
    expect(parseConfigFiles('|/p|1|1|1')).toEqual([])
    const huge = Array.from({ length: 50000 }, (_, i) => `id-${i}|/etc/f${i}|1|1|0`).join('\n')
    expect(parseConfigFiles(huge)).toHaveLength(50000)
  })
})

describe('collectConfigFiles', () => {
  let tempProfile: string
  let savedProfile: string | undefined

  beforeEach(() => {
    savedProfile = process.env.USERPROFILE
    tempProfile = mkdtempSync(join(tmpdir(), 'wslpad-test-'))
    process.env.USERPROFILE = tempProfile
  })

  afterEach(() => {
    if (savedProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = savedProfile
    rmSync(tempProfile, { recursive: true, force: true })
  })

  it('returns all specs in order with the windows entry resolved via fs', async () => {
    writeFileSync(join(tempProfile, '.wslconfig'), '[wsl2]\nmemory=8GB\n')
    const runner = fakeRunner(() => ok(LINUX_OUTPUT))
    const files = await collectConfigFiles(runner, 'Ubuntu-24.04')

    expect(files.map((f) => f.id)).toEqual(CONFIG_FILE_SPECS.map((s) => s.id))

    const wslconfig = files[0]
    expect(wslconfig).toMatchObject({
      id: 'wslconfig',
      scope: 'windows',
      linuxPath: null,
      windowsPath: join(tempProfile, '.wslconfig'),
      exists: true,
      readable: true,
      writable: true
    })

    const bashrc = files.find((f) => f.id === 'bashrc')
    expect(bashrc).toMatchObject({
      scope: 'linux',
      linuxPath: '/home/recuerdame/.bashrc',
      windowsPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\recuerdame\\.bashrc',
      exists: true,
      readable: true,
      writable: true
    })

    const zshrc = files.find((f) => f.id === 'zshrc')
    expect(zshrc).toMatchObject({ exists: false, readable: false, writable: false })
  })

  it('reports a missing .wslconfig as not existing', async () => {
    const runner = fakeRunner(() => ok(LINUX_OUTPUT))
    const files = await collectConfigFiles(runner, 'Ubuntu-24.04')
    expect(files[0]).toMatchObject({ exists: false, readable: false, writable: false })
  })

  it('returns nulls for the windows entry when USERPROFILE is unset', async () => {
    delete process.env.USERPROFILE
    const runner = fakeRunner(() => ok(LINUX_OUTPUT))
    const files = await collectConfigFiles(runner, 'Ubuntu-24.04')
    expect(files[0]).toMatchObject({
      windowsPath: null,
      exists: null,
      readable: null,
      writable: null
    })
  })

  it('degrades linux entries to nulls when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    const files = await collectConfigFiles(runner, 'Ubuntu-24.04')
    const wslConf = files.find((f) => f.id === 'wsl-conf')
    expect(wslConf).toMatchObject({
      linuxPath: '/etc/wsl.conf',
      exists: null,
      readable: null,
      writable: null
    })
    const bashrc = files.find((f) => f.id === 'bashrc')
    expect(bashrc).toMatchObject({ linuxPath: null, windowsPath: null, exists: null })
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectConfigFiles(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(
      WslNotAvailableError
    )
  })
})
