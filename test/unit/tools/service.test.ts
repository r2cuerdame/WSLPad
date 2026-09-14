import { describe, expect, it } from 'vitest'
import type { DistroRunner, RunOptions, RunResult } from '../../../src/main/wsl/contracts'
import {
  LivePackageDiscoveryService,
  parseAptSearch,
  parseAptUpdates,
  parseBrewUpdates,
  parseCargoSearch,
  parseNpmSearch,
  parseNpmUpdates,
  parseSnapSearch,
  parseSnapUpdates,
  parseWingetSearch,
  parseWingetTable,
  parseWingetUpdates
} from '../../../src/main/tools/service'

const result = (stdout: string, code = 0, timedOut = false, stderr = ''): RunResult => ({
  stdout,
  stderr,
  code,
  timedOut
})

class FakeRunner implements DistroRunner {
  readonly wslScripts: string[] = []
  readonly hostArgs: string[][] = []
  constructor(
    private readonly wsl: (script: string) => RunResult,
    private readonly host: (args: string[]) => RunResult
  ) {}
  runWsl(): Promise<RunResult> {
    return Promise.reject(new Error('not used'))
  }
  runInDistro(_distro: string, script: string, _opts?: RunOptions): Promise<RunResult> {
    this.wslScripts.push(script)
    return Promise.resolve(this.wsl(script))
  }
  runHostCommand(_file: string, args: string[]): Promise<RunResult> {
    this.hostArgs.push(args)
    return Promise.resolve(this.host(args))
  }
  disposeAll(): Promise<void> {
    return Promise.resolve()
  }
}

describe('package provider parsers', () => {
  it('normalizes apt, npm and cargo search without trusting package names', () => {
    expect(parseAptSearch('ripgrep - recursively search files\nevil;rm - nope\n')[0]).toMatchObject(
      {
        provider: 'apt',
        name: 'ripgrep',
        installCommand: "sudo apt install -- 'ripgrep'"
      }
    )
    expect(
      parseNpmSearch('[{"name":"typescript","version":"5.9.2","description":"language tools"}]')[0]
    ).toMatchObject({
      provider: 'npm',
      name: 'typescript',
      version: '5.9.2'
    })
    expect(parseCargoSearch('bat = "0.25.0" # a cat clone\n')[0]).toMatchObject({
      provider: 'cargo',
      name: 'bat',
      installCommand: "cargo install --locked 'bat'"
    })
  })

  it('normalizes apt, npm and brew updates', () => {
    expect(
      parseAptUpdates('git/noble-updates 2.43.0-1.3 amd64 [upgradable from: 2.43.0-1.2]\n')[0]
    ).toMatchObject({
      name: 'git',
      installedVersion: '2.43.0-1.2',
      availableVersion: '2.43.0-1.3'
    })
    expect(parseNpmUpdates('{"npm":{"current":"10.8.1","latest":"11.0.0"}}')[0]).toMatchObject({
      name: 'npm',
      availableVersion: '11.0.0'
    })
    expect(
      parseBrewUpdates(
        '{"formulae":[{"name":"jq","installed_versions":["1.7"],"current_version":"1.8"}],"casks":[]}'
      )[0]
    ).toMatchObject({
      name: 'jq',
      updateCommand: "brew upgrade 'jq'"
    })
  })

  it('parses snap tables and joins installed versions to refresh rows', () => {
    expect(
      parseSnapSearch(
        'Name      Version  Publisher  Notes  Summary\nripgrep   14.1.1   canonical**  -  fast search\n'
      )[0]
    ).toMatchObject({
      name: 'ripgrep',
      version: '14.1.1'
    })
    const updates = [
      '__WSLPAD_SNAP_LIST__',
      'Name  Version  Rev  Tracking  Publisher  Notes',
      'core  1.0      1    latest    canonical**  base',
      '__WSLPAD_SNAP_UPDATES__',
      'Name  Version  Rev  Size  Publisher  Notes',
      'core  1.1      2    10MB  canonical**  base'
    ].join('\n')
    expect(parseSnapUpdates(updates)[0]).toMatchObject({
      name: 'core',
      installedVersion: '1.0',
      availableVersion: '1.1'
    })
  })

  it('uses winget separator offsets, not localized headings, and rejects truncated ids', () => {
    const table = [
      '이름                  장치 ID                    버전       사용 가능   원본',
      '--------------------  -------------------------  ---------  ----------  ------',
      'PowerShell            Microsoft.PowerShell       7.5.2.0    7.5.3.0     winget',
      'Unsafe                Vendor.Truncated…          1.0        2.0         winget'
    ].join('\n')
    expect(parseWingetTable(table)[0]).toEqual([
      'PowerShell',
      'Microsoft.PowerShell',
      '7.5.2.0',
      '7.5.3.0',
      'winget'
    ])
    expect(parseWingetUpdates(table)).toEqual([
      {
        provider: 'winget',
        target: 'windows',
        name: 'Microsoft.PowerShell',
        installedVersion: '7.5.2.0',
        availableVersion: '7.5.3.0',
        updateCommand: 'winget.exe upgrade --id Microsoft.PowerShell --exact --source winget'
      }
    ])
    expect(parseWingetSearch(table)[0]).toMatchObject({
      name: 'Microsoft.PowerShell',
      target: 'windows'
    })
  })
})

describe('LivePackageDiscoveryService', () => {
  it('merges successful providers while isolating missing and timed-out ones', async () => {
    const runner = new FakeRunner(
      (script) => {
        if (script.includes('apt-cache search')) return result('ripgrep - fast recursive search\n')
        if (script.includes('npm search'))
          return result('[{"name":"typescript","version":"5.9.2"}]')
        if (script.includes('cargo search')) return result('', 0, true)
        if (script.includes('brew search')) return result('__WSLPAD_PROVIDER_MISSING__\n')
        if (script.includes('snap find'))
          return result(
            'Name  Version  Publisher  Notes  Summary\nhttpie  3.2.4  snapcrafters  -  HTTP client\n'
          )
        throw new Error(`unexpected script: ${script}`)
      },
      () =>
        result(
          'Name        Id                 Version  Source\n----------- ------------------ -------- -------\nPowerShell  Microsoft.PowerShell 7.5.3.0 winget\n'
        )
    )
    const value = await new LivePackageDiscoveryService(runner).discover('Ubuntu-24.04', 'power')
    expect(value.results.map((item) => item.provider)).toEqual(['snap', 'winget', 'apt', 'npm'])
    expect(value.providers.find((item) => item.provider === 'cargo')?.state).toBe('timed-out')
    expect(value.providers.find((item) => item.provider === 'brew')?.state).toBe('unavailable')
    expect(value.results.every((item) => !/[\r\n]/.test(item.installCommand))).toBe(true)
    expect(runner.wslScripts.join('\n')).not.toMatch(/\b(?:apt|npm|cargo|brew|snap) install\b/)
    expect(runner.hostArgs[0][0]).toBe('search')
    expect(runner.hostArgs[0]).not.toContain('--accept-source-agreements')
  })

  it('aggregates updates and treats npm exit 1 JSON as useful output', async () => {
    const runner = new FakeRunner(
      (script) => {
        if (script.includes('apt list'))
          return result('git/noble 2.0 amd64 [upgradable from: 1.0]\n')
        if (script.includes('npm outdated'))
          return result('{"npm":{"current":"10","latest":"11"}}', 1)
        if (script.includes('__WSLPAD_PROVIDER_UNSUPPORTED__'))
          return result('__WSLPAD_PROVIDER_UNSUPPORTED__\n')
        if (script.includes('brew outdated')) return result('', 1, false, 'brew database busy')
        if (script.includes('snap refresh'))
          return result(
            '__WSLPAD_SNAP_LIST__\nName  Version\ncore  1.0\n__WSLPAD_SNAP_UPDATES__\nName  Version\ncore  1.1\n'
          )
        throw new Error(`unexpected script: ${script}`)
      },
      () =>
        result(
          'Name        Id                    Version  Available  Source\n----------- --------------------- -------- ---------- ------\nPowerShell  Microsoft.PowerShell  7.5.2.0  7.5.3.0   winget\n'
        )
    )
    const value = await new LivePackageDiscoveryService(runner).updates('Ubuntu-24.04')
    expect(value.updates.map((item) => `${item.provider}:${item.name}`)).toEqual([
      'apt:git',
      'npm:npm',
      'snap:core',
      'winget:Microsoft.PowerShell'
    ])
    expect(value.providers.find((item) => item.provider === 'cargo')?.state).toBe('unsupported')
    expect(value.providers.find((item) => item.provider === 'brew')?.state).toBe('error')
    expect(value.updates.every((item) => !/[\r\n]/.test(item.updateCommand))).toBe(true)
    expect(runner.wslScripts.join('\n')).not.toMatch(
      /\b(?:apt install|npm install|cargo install|brew upgrade|snap install)\b/
    )
    expect(runner.hostArgs[0]).not.toContain('--all')
    expect(runner.hostArgs[0]).not.toContain('--accept-source-agreements')
  })
})
