import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DefenderInfo } from '@shared/types'
import type { DistroRunner, RunResult } from '../../../src/main/wsl/contracts'

const collectDefender = vi.fn<() => Promise<DefenderInfo | null>>()
vi.mock('../../../src/main/wsl/defender', () => ({ collectDefender }))

const { createRealProvider } = await import('../../../src/main/wsl/collect')

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
})
