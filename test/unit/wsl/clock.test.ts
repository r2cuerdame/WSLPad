import { describe, expect, it } from 'vitest'
import { CLOCK_SCRIPT, collectClock, computeSkew, parseEpochMs } from '../../../src/main/wsl/clock'
import { WslNotAvailableError, type DistroRunner } from '../../../src/main/wsl/contracts'
import { fakeRunner, ok } from './collectors/helpers'

const WINDOWS_MS = 1718452800000
const BEHIND_MS = WINDOWS_MS - 47000

/** Successive Date.now() readings around the one command the collector runs. */
function fakeNow(...values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

function throwingRunner(err: unknown): DistroRunner {
  return fakeRunner(() => {
    throw err
  })
}

describe('parseEpochMs', () => {
  it('reads seconds and nanoseconds from GNU date', () => {
    expect(parseEpochMs('1718452800.123456789\n')).toBe(1718452800123)
  })

  it('accepts whole seconds and busybox leaving %N unexpanded', () => {
    expect(parseEpochMs('1718452800\n')).toBe(1718452800000)
    expect(parseEpochMs('1718452800.N\n')).toBe(1718452800000)
  })

  it('returns null for empty and non-numeric output', () => {
    expect(parseEpochMs('')).toBeNull()
    expect(parseEpochMs('\n  \n')).toBeNull()
    expect(parseEpochMs('date: invalid option -- +%s\n')).toBeNull()
  })

  it('refuses an instant outside the Date range instead of a broken ISO string', () => {
    expect(parseEpochMs('999999999999999999\n')).toBeNull()
  })
})

describe('computeSkew', () => {
  it('pairs the distro reading with the middle of the round trip', () => {
    const { windowsMs, skewSeconds } = computeSkew(BEHIND_MS, WINDOWS_MS - 100, WINDOWS_MS + 100)
    expect(windowsMs).toBe(WINDOWS_MS)
    expect(skewSeconds).toBe(-47)
  })

  it('reports a clock ahead as a positive difference', () => {
    expect(computeSkew(WINDOWS_MS + 12000, WINDOWS_MS, WINDOWS_MS).skewSeconds).toBe(12)
  })

  it('calls a difference smaller than the measurement window no skew', () => {
    // 4 s round trip: a 1 s difference is indistinguishable from the method.
    expect(computeSkew(WINDOWS_MS + 1000, WINDOWS_MS - 2000, WINDOWS_MS + 2000).skewSeconds).toBe(0)
  })
})

describe('collectClock', () => {
  it('reports both instants and the drift between them', async () => {
    const runner = fakeRunner(() => ok('1718452753.000\n'))
    const clock = await collectClock(runner, 'Ubuntu-24.04', {
      now: fakeNow(WINDOWS_MS - 100, WINDOWS_MS + 100)
    })
    expect(runner.calls[0]).toBe(CLOCK_SCRIPT)
    expect(clock.windowsIso).toBe(new Date(WINDOWS_MS).toISOString())
    expect(clock.distroIso).toBe(new Date(BEHIND_MS).toISOString())
    expect(clock.skewSeconds).toBe(-47)
  })

  it('keeps the Windows side when the distro does not answer', async () => {
    const clock = await collectClock(throwingRunner(new Error('exit 1')), 'Ubuntu-24.04', {
      now: fakeNow(WINDOWS_MS, WINDOWS_MS + 50)
    })
    expect(clock.windowsIso).toBe(new Date(WINDOWS_MS + 50).toISOString())
    expect(clock.distroIso).toBeNull()
    expect(clock.skewSeconds).toBeNull()
  })

  it('treats a timeout and unreadable output as one unknown clock, never as zero skew', async () => {
    const timedOut = await collectClock(
      fakeRunner(() => ({ stdout: '1718452753', stderr: '', code: null, timedOut: true })),
      'Ubuntu-24.04',
      { now: fakeNow(WINDOWS_MS) }
    )
    expect(timedOut.distroIso).toBeNull()
    expect(timedOut.skewSeconds).toBeNull()

    const garbage = await collectClock(
      fakeRunner(() => ok('command not found\n')),
      'Ubuntu-24.04',
      {
        now: fakeNow(WINDOWS_MS)
      }
    )
    expect(garbage.distroIso).toBeNull()
    expect(garbage.skewSeconds).toBeNull()
  })

  it('propagates a missing WSL and rejects an invalid distro name', async () => {
    await expect(
      collectClock(throwingRunner(new WslNotAvailableError()), 'Ubuntu-24.04')
    ).rejects.toBeInstanceOf(WslNotAvailableError)
    await expect(
      collectClock(
        fakeRunner(() => ok('')),
        'bad name'
      )
    ).rejects.toThrow(/Invalid WSL distro name/)
  })
})
