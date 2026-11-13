import { describe, expect, it } from 'vitest'
import type { DistroRunner } from '../../../src/main/wsl/contracts'
import { createDistroLister, parseQuietList, parseVerboseList } from '../../../src/main/wsl/distros'

describe('parseVerboseList', () => {
  it('parses English output with default marker', () => {
    const decoded = [
      '  NAME              STATE           VERSION',
      '* Ubuntu-24.04      Running         2',
      '  docker-desktop    Running         2',
      '  Debian            Stopped         1',
      ''
    ].join('\n')
    const distros = parseVerboseList(decoded, new Set(['Ubuntu-24.04', 'docker-desktop']))
    expect(distros).toEqual([
      { name: 'Ubuntu-24.04', state: 'Running', wslVersion: 2, isDefault: true },
      { name: 'docker-desktop', state: 'Running', wslVersion: 2, isDefault: false },
      { name: 'Debian', state: 'Stopped', wslVersion: 1, isDefault: false }
    ])
  })

  it('ignores localized state words (Korean)', () => {
    const decoded = [
      '  이름              상태      버전',
      '* Ubuntu-24.04      실행 중   2',
      '  Debian            중지됨    2',
      ''
    ].join('\n')
    const distros = parseVerboseList(decoded, new Set(['Ubuntu-24.04']))
    expect(distros[0]).toMatchObject({ name: 'Ubuntu-24.04', state: 'Running', isDefault: true })
    expect(distros[1]).toMatchObject({ name: 'Debian', state: 'Stopped', wslVersion: 2 })
  })

  it('ignores localized state words (German multi-word states)', () => {
    const decoded = [
      '  NAME       STATUS               VERSION',
      '* Ubuntu     Wird ausgeführt      2',
      ''
    ].join('\n')
    const distros = parseVerboseList(decoded, new Set())
    expect(distros[0]).toMatchObject({ name: 'Ubuntu', state: 'Stopped', wslVersion: 2 })
  })

  it('returns empty for header-only output', () => {
    expect(parseVerboseList('  NAME STATE VERSION\n', new Set())).toEqual([])
  })
})

describe('parseQuietList', () => {
  it('parses names and drops blanks', () => {
    expect(parseQuietList('Ubuntu-24.04\ndocker-desktop\n\n')).toEqual([
      'Ubuntu-24.04',
      'docker-desktop'
    ])
  })
})

describe('createDistroLister', () => {
  const VERBOSE = ['  NAME      STATE     VERSION', '* Ubuntu    Running   2', '  Debian    Stopped   2', ''].join('\n')
  const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false })

  function fakeRunner(running: () => string, verbose: () => string = () => VERBOSE) {
    const calls: string[] = []
    const runner: DistroRunner = {
      runWsl: async (args) => {
        calls.push(args.join(' '))
        return ok(args.includes('--verbose') ? verbose() : running())
      },
      runInDistro: async () => ok(''),
      disposeAll: async () => {}
    }
    return { runner, calls }
  }

  it('asks which distros run on every call but reuses the installed list for a minute', async () => {
    let now = 0
    let running = 'Ubuntu\n'
    const { runner, calls } = fakeRunner(() => running)
    const lister = createDistroLister(runner, { now: () => now })

    expect((await lister.list()).map((d) => [d.name, d.state])).toEqual([
      ['Ubuntu', 'Running'],
      ['Debian', 'Stopped']
    ])
    running = 'Ubuntu\nDebian\n'
    now = 3000
    expect((await lister.list()).map((d) => d.state)).toEqual(['Running', 'Running'])
    expect(calls).toEqual(['--list --verbose', '--list --running --quiet', '--list --running --quiet'])

    now = 60_000
    await lister.list()
    expect(calls.filter((c) => c === '--list --verbose')).toHaveLength(2)
  })

  it('re-reads the installed list at once when an unknown distro starts', async () => {
    let running = 'Ubuntu\n'
    let verbose = VERBOSE
    const { runner, calls } = fakeRunner(
      () => running,
      () => verbose
    )
    const lister = createDistroLister(runner, { now: () => 0 })
    await lister.list()
    running = 'Ubuntu\nAlpine\n'
    verbose = VERBOSE + '  Alpine    Running   2\n'
    const list = await lister.list()
    expect(list.find((d) => d.name === 'Alpine')?.state).toBe('Running')
    expect(calls.filter((c) => c === '--list --verbose')).toHaveLength(2)
  })

  it('does not cache an unreadable list', async () => {
    const { runner, calls } = fakeRunner(
      () => '',
      () => ''
    )
    const failing: DistroRunner = {
      ...runner,
      runWsl: async (args, opts) => ({ ...(await runner.runWsl(args, opts)), code: 1 })
    }
    const lister = createDistroLister(failing, { now: () => 0 })
    expect(await lister.list()).toEqual([])
    expect(await lister.list()).toEqual([])
    expect(calls.filter((c) => c === '--list --verbose')).toHaveLength(2)
  })
})
