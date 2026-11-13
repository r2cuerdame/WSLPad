import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DefenderInfo } from '@shared/types'
import type { DistroRunner, RunResult } from '../../../src/main/wsl/contracts'
import { joinSections } from './collectors/helpers'

const collectDefender = vi.fn<() => Promise<DefenderInfo | null>>()
vi.mock('../../../src/main/wsl/defender', () => ({ collectDefender }))

const { createRealProvider } = await import('../../../src/main/wsl/collect')
const { DRIVE_MOUNTS_SCRIPT } = await import('../../../src/main/wsl/drive-mounts')
const { INOTIFY_SCRIPT } = await import('../../../src/main/wsl/inotify')
const { HERMES_SCRIPT } = await import('../../../src/main/wsl/detectors/hermes')

const ok: RunResult = { stdout: '', stderr: '', code: 0, timedOut: false }

function fakeRunner(answered: boolean): DistroRunner & { runInDistro: ReturnType<typeof vi.fn> } {
  return {
    runWsl: vi.fn(async () => ok),
    runInDistro: vi.fn(async () => ok),
    answeredRecently: vi.fn(() => answered),
    disposeAll: vi.fn(async () => {})
  }
}

const defender = (realtimeEnabled: boolean): DefenderInfo => ({
  available: true,
  elevated: false,
  realtimeEnabled,
  exclusionPaths: null
})

describe('createRealProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
    collectDefender.mockReset()
  })

  it('skips the liveness probe when the distro answered a moment ago', async () => {
    const runner = fakeRunner(true)
    const provider = createRealProvider(runner)
    await expect(provider.probeDistro?.('Ubuntu')).resolves.toBe(true)
    expect(runner.runInDistro).not.toHaveBeenCalled()
  })

  it('still probes a distro with no recent answer', async () => {
    const runner = fakeRunner(false)
    const provider = createRealProvider(runner)
    await expect(provider.probeDistro?.('Ubuntu')).resolves.toBe(true)
    expect(runner.runInDistro).toHaveBeenCalledWith('Ubuntu', 'true', expect.objectContaining({ timeoutMs: expect.any(Number) }))
  })

  it('reads Defender and elevation once per ten minutes, keeping the last answer on a failed read', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const provider = createRealProvider(fakeRunner(true))
    collectDefender.mockResolvedValueOnce(defender(true))
    expect(await provider.getDefender?.()).toEqual(defender(true))
    vi.setSystemTime(599_000)
    expect(await provider.getDefender?.()).toEqual(defender(true))
    expect(collectDefender).toHaveBeenCalledTimes(1)

    vi.setSystemTime(600_000)
    collectDefender.mockResolvedValueOnce(null)
    expect(await provider.getDefender?.()).toEqual(defender(true))
    collectDefender.mockResolvedValueOnce(defender(false))
    expect(await provider.getDefender?.()).toEqual(defender(false))
    expect(collectDefender).toHaveBeenCalledTimes(3)
  })

  it('keeps the last good drive mounts, watch limits and Hermes per distro on a failed read', async () => {
    const answers = new Map<string, RunResult | Error>([
      [DRIVE_MOUNTS_SCRIPT, { ...ok, stdout: '/dev/sdd / ext4 rw 0 0\nC:\\134 /mnt/c 9p rw,aname=drvfs;path=C:\\;metadata 0 0' }],
      [INOTIFY_SCRIPT, { ...ok, stdout: joinSections('524288', '256') }],
      [HERMES_SCRIPT, { ...ok, stdout: 'DATA:/home/dev/.hermes\n' }]
    ])
    const runner = fakeRunner(false)
    runner.runInDistro.mockImplementation(async (_distro: string, script: string) => {
      const answer = answers.get(script) ?? ok
      if (answer instanceof Error) throw answer
      return answer
    })
    const provider = createRealProvider(runner)
    const mounts = await provider.getDriveMounts?.('Ubuntu')
    const inotify = await provider.getInotify?.('Ubuntu')
    const hermes = await provider.getHermes('Ubuntu')
    expect(mounts?.drives.map((d) => d.point)).toEqual(['/mnt/c'])
    expect(inotify?.maxUserWatches).toBe(524288)
    expect(hermes?.installed).toBe(true)

    // A cut-off mount read, a timed-out sysctl read and a failed Hermes query.
    answers.set(DRIVE_MOUNTS_SCRIPT, { ...ok, stdout: '/dev/sdd / ext4 rw 0 0', code: 1 })
    answers.set(INOTIFY_SCRIPT, { ...ok, stdout: '524288\n', code: null, timedOut: true })
    answers.set(HERMES_SCRIPT, new Error('distro is busy'))
    expect(await provider.getDriveMounts?.('Ubuntu')).toEqual(mounts)
    expect(await provider.getInotify?.('Ubuntu')).toEqual(inotify)
    expect(await provider.getHermes('Ubuntu')).toEqual(hermes)

    // Another distro never inherits the first one's answers.
    expect(await provider.getDriveMounts?.('Debian')).toBeNull()
    expect(await provider.getInotify?.('Debian')).toBeNull()
    expect(await provider.getHermes('Debian')).toBeNull()

    // A fresh answer replaces the remembered one.
    answers.set(INOTIFY_SCRIPT, { ...ok, stdout: joinSections('1048576', '512') })
    expect((await provider.getInotify?.('Ubuntu'))?.maxUserWatches).toBe(1048576)
  })
})
