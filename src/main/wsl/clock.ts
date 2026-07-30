/**
 * Windows versus distro wall clock (issue #28).
 *
 * After the host sleeps, the WSL clock can come back seconds or minutes behind
 * Windows. Nothing says so: apt reports a signature that is "not yet valid",
 * TLS handshakes fail on certificate dates, build caches decide everything is
 * stale. This collector reads both clocks as close together as it can and
 * reports the difference — it never sets a clock.
 */
import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { ClockInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'
import { assertValidDistroName } from './escape'

/** GNU date prints nanoseconds; busybox may leave %N literal, hence the tolerant parse. */
export const CLOCK_SCRIPT = 'date +%s.%N'

const EPOCH_RE = /^(\d+)(?:\.(\d+))?/
/** The ECMAScript Date range: past it there is no ISO string to report. */
const MAX_EPOCH_MS = 8.64e15

/** Epoch milliseconds from `date +%s.%N`; null when the first line is not a time. */
export function parseEpochMs(text: string): number | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const match = EPOCH_RE.exec(line)
    if (match === null) return null
    const fraction = match[2] === undefined ? 0 : Number.parseFloat(`0.${match[2]}`)
    const ms = Number.parseInt(match[1], 10) * 1000 + Math.round(fraction * 1000)
    // A garbled reading degrades to null instead of throwing on toISOString().
    return Number.isFinite(ms) && Math.abs(ms) <= MAX_EPOCH_MS ? ms : null
  }
  return null
}

export interface SkewMeasurement {
  /** The Windows instant the distro reading is paired with. */
  windowsMs: number
  skewSeconds: number
}

/**
 * The two clocks are read a round trip apart, so the Windows instant that pairs
 * with the distro reading is the middle of that round trip and the answer is
 * only good to half of it. A difference smaller than that half is measurement
 * noise, and is reported as no skew rather than as a number the method cannot
 * support — the card says the value is approximate for the same reason.
 */
export function computeSkew(
  distroMs: number,
  startedMs: number,
  finishedMs: number
): SkewMeasurement {
  const windowsMs = Math.round((startedMs + finishedMs) / 2)
  const uncertaintyMs = Math.max(0, (finishedMs - startedMs) / 2)
  const diffMs = distroMs - windowsMs
  return {
    windowsMs,
    skewSeconds: Math.abs(diffMs) <= uncertaintyMs ? 0 : Math.round(diffMs / 1000)
  }
}

export interface ClockDeps {
  /** Injected so the Windows side of the measurement is deterministic in tests. */
  now?: () => number
}

/**
 * Both clocks, or as much of the pair as could be read. A distro that does not
 * answer leaves its own side null: the Windows time alone is still a fact, and
 * a one-sided reading is never turned into a skew.
 */
export async function collectClock(
  runner: DistroRunner,
  distro: string,
  deps: ClockDeps = {}
): Promise<ClockInfo> {
  assertValidDistroName(distro)
  const now = deps.now ?? Date.now
  const startedMs = now()
  let stdout: string | null = null
  try {
    const res = await runner.runInDistro(distro, CLOCK_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
    if (!res.timedOut) stdout = res.stdout
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
    // Everything else keeps the Windows half rather than failing the section.
  }
  const finishedMs = now()

  const distroMs = stdout === null ? null : parseEpochMs(stdout)
  if (distroMs === null) {
    return { windowsIso: new Date(finishedMs).toISOString(), distroIso: null, skewSeconds: null }
  }
  const { windowsMs, skewSeconds } = computeSkew(distroMs, startedMs, finishedMs)
  return {
    windowsIso: new Date(windowsMs).toISOString(),
    distroIso: new Date(distroMs).toISOString(),
    skewSeconds
  }
}
