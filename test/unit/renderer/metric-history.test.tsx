import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  METRIC_HISTORY_LIMIT,
  getMetricHistory,
  recordMetricSample,
  resetMetricHistory,
  useMetricHistory,
  type MetricHistoryInput
} from '@renderer/hooks/useMetricHistory'

const MIB = 1024 ** 2

/** Instants spaced a fast tier apart, well inside the gap threshold. */
function at(seconds: number): string {
  return new Date(Date.UTC(2026, 6, 30, 12, 0, seconds)).toISOString()
}

function sample(seconds: number, cpuPercent: number | null, memMib: number | null): void {
  recordMetricSample({
    distro: 'Ubuntu',
    at: at(seconds),
    cpuPercent,
    memUsedBytes: memMib === null ? null : memMib * MIB
  })
}

function render(props: MetricHistoryInput) {
  return renderHook((p: MetricHistoryInput) => useMetricHistory(p), { initialProps: props })
}

afterEach(() => {
  cleanup()
  resetMetricHistory()
})

describe('metric history buffer', () => {
  it('keeps one sample per snapshot instant and ignores a replayed instant', () => {
    sample(0, 10, 500)
    sample(3, 20, 600)
    sample(3, 99, 999)

    expect(getMetricHistory().map((s) => s.cpuPercent)).toEqual([10, 20])
    expect(getMetricHistory().map((s) => s.at)).toEqual([at(0), at(3)])
  })

  it('drops the oldest sample past the cap instead of growing without bound', () => {
    for (let i = 0; i <= METRIC_HISTORY_LIMIT + 20; i += 1) sample(i * 3, i, 100 + i)
    const samples = getMetricHistory()

    expect(samples).toHaveLength(METRIC_HISTORY_LIMIT)
    expect(samples[0].cpuPercent).toBe(21)
    expect(samples[samples.length - 1].cpuPercent).toBe(METRIC_HISTORY_LIMIT + 20)
  })

  it('empties the buffer when the selected distro changes', () => {
    sample(0, 10, 500)
    sample(3, 20, 600)
    recordMetricSample({ distro: 'Debian', at: at(6), cpuPercent: 30, memUsedBytes: 700 * MIB })
    const samples = getMetricHistory()

    expect(samples).toHaveLength(1)
    expect(samples[0].cpuPercent).toBe(30)
  })

  it('keeps null metrics as null so a failed collector is never drawn as zero', () => {
    sample(0, 10, 500)
    sample(3, null, null)
    const samples = getMetricHistory()

    expect(samples[1].cpuPercent).toBeNull()
    expect(samples[1].memUsedBytes).toBeNull()
  })

  it('breaks the line with a gap sample when sampling stopped for a while', () => {
    sample(0, 10, 500)
    sample(3, 12, 510)
    // Monitoring paused, or the card off screen, for five minutes.
    sample(303, 80, 900)
    const samples = getMetricHistory()

    expect(samples).toHaveLength(4)
    expect(samples[2].cpuPercent).toBeNull()
    expect(samples[2].memUsedBytes).toBeNull()
    expect(Date.parse(samples[2].at)).toBeGreaterThan(Date.parse(samples[1].at))
    expect(Date.parse(samples[2].at)).toBeLessThan(Date.parse(samples[3].at))
    expect(samples[3].cpuPercent).toBe(80)
  })

  it('records nothing before the first snapshot instant exists', () => {
    recordMetricSample({ distro: 'Ubuntu', at: null, cpuPercent: 10, memUsedBytes: 500 * MIB })

    expect(getMetricHistory()).toEqual([])
  })
})

describe('useMetricHistory', () => {
  const initial: MetricHistoryInput = {
    distro: 'Ubuntu',
    at: at(0),
    cpuPercent: 10,
    memUsedBytes: 500 * MIB
  }

  it('samples every snapshot it renders with', () => {
    const { result, rerender } = render(initial)
    expect(result.current).toHaveLength(1)

    rerender({ ...initial, at: at(3), cpuPercent: 20 })
    expect(result.current.map((s) => s.cpuPercent)).toEqual([10, 20])

    // The same snapshot rendered again: a re-render is not a measurement.
    rerender({ ...initial, at: at(3), cpuPercent: 20 })
    expect(result.current).toHaveLength(2)
  })

  it('survives the card unmounting, so switching sections keeps the trend', () => {
    const first = render(initial)
    first.rerender({ ...initial, at: at(3), cpuPercent: 20 })
    first.unmount()

    const second = render({ ...initial, at: at(6), cpuPercent: 30 })

    expect(second.result.current.map((s) => s.cpuPercent)).toEqual([10, 20, 30])
  })

  it('starts over when the hook is rendered for another distro', () => {
    const { result, rerender } = render(initial)
    rerender({ ...initial, at: at(3), cpuPercent: 20 })
    rerender({ ...initial, distro: 'Debian', at: at(6), cpuPercent: 30 })

    expect(result.current.map((s) => s.cpuPercent)).toEqual([30])
  })

  it('persists nothing: no localStorage, no disk, no time-series store', () => {
    const writes: string[] = []
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function patched(key: string, value: string): void {
      writes.push(key)
      original.call(this, key, value)
    }
    try {
      const { rerender } = render(initial)
      rerender({ ...initial, at: at(3), cpuPercent: 20 })
    } finally {
      Storage.prototype.setItem = original
    }

    expect(writes).toEqual([])
  })
})
