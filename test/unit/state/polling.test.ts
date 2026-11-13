import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitoringSettings } from '@shared/types'
import { PollingScheduler } from '../../../src/main/state/polling'
import type { SnapshotStore } from '../../../src/main/state/store'

function makeStore() {
  return {
    refreshFast: vi.fn(() => Promise.resolve()),
    refreshMedium: vi.fn(() => Promise.resolve()),
    refreshSlow: vi.fn(() => Promise.resolve())
  }
}

type FakeStore = ReturnType<typeof makeStore>

const asStore = (s: FakeStore): SnapshotStore => s as unknown as SnapshotStore

const intervals = (over: Partial<MonitoringSettings> = {}): MonitoringSettings => ({
  paused: false,
  fastMs: 3000,
  mediumMs: 15000,
  slowMs: 60000,
  ...over
})

describe('PollingScheduler', () => {
  let store: FakeStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = makeStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs every tier immediately on start', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    expect(store.refreshMedium).toHaveBeenCalledTimes(1)
    expect(store.refreshSlow).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('ticks each tier at its own interval', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    vi.advanceTimersByTime(3000)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    expect(store.refreshMedium).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(12000)
    expect(store.refreshFast).toHaveBeenCalledTimes(6)
    expect(store.refreshMedium).toHaveBeenCalledTimes(2)
    expect(store.refreshSlow).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(45000)
    expect(store.refreshSlow).toHaveBeenCalledTimes(2)
    sched.stop()
  })

  it('does not run when constructed paused; resume triggers an immediate run', () => {
    const sched = new PollingScheduler(asStore(store), intervals({ paused: true }))
    sched.start()
    vi.advanceTimersByTime(60000)
    expect(store.refreshFast).not.toHaveBeenCalled()

    sched.setPaused(false)
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    sched.stop()
  })

  it('pause stops the timers', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    sched.setPaused(true)
    vi.advanceTimersByTime(120000)
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    expect(store.refreshMedium).toHaveBeenCalledTimes(1)
    expect(store.refreshSlow).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('stop clears all timers', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    sched.stop()
    vi.advanceTimersByTime(120000)
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
  })

  it('setIntervals re-arms timers with the new cadence', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    sched.setIntervals(intervals({ fastMs: 1000 }))
    vi.advanceTimersByTime(1000)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    sched.stop()
  })

  it('setIntervals with paused=true stops polling', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    sched.setIntervals(intervals({ paused: true }))
    vi.advanceTimersByTime(120000)
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('clamps out-of-range intervals to the allowed bounds', () => {
    const sched = new PollingScheduler(asStore(store), intervals({ fastMs: 1 }))
    sched.start()
    vi.advanceTimersByTime(999)
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    // POLL_BOUNDS.fastMs.min is 1000 — a 1ms setting must not spin the timer
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    sched.stop()
  })

  it('start is idempotent', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    sched.start()
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    sched.stop()
  })
})

describe('PollingScheduler off screen (minimized, hidden, tray)', () => {
  let store: FakeStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = makeStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stretches every tier to the background floor while the window is off screen', () => {
    const sched = new PollingScheduler(asStore(store), intervals(), false)
    sched.start()
    // Initial data is still collected once at start.
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(59_999)
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    expect(store.refreshMedium).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(240_000)
    expect(store.refreshMedium).toHaveBeenCalledTimes(2)
    expect(store.refreshSlow).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(600_000)
    expect(store.refreshSlow).toHaveBeenCalledTimes(2)
    // 15 minutes off screen: 16 fast ticks instead of the 301 a 3 s tier makes.
    expect(store.refreshFast).toHaveBeenCalledTimes(16)
    sched.stop()
  })

  it('keeps a configured interval that is already longer than the floor', () => {
    const sched = new PollingScheduler(asStore(store), intervals({ slowMs: 600_000 }), false)
    sched.start()
    vi.advanceTimersByTime(600_000)
    expect(store.refreshSlow).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300_000)
    expect(store.refreshSlow).toHaveBeenCalledTimes(2)
    sched.stop()
  })

  it('slows down when the window leaves the screen, without an extra refresh', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    vi.advanceTimersByTime(3000)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    sched.setForeground(false)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(57_000)
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(3000)
    expect(store.refreshFast).toHaveBeenCalledTimes(3)
    sched.stop()
  })

  it('refreshes stale tiers at once when the window comes back, then ticks fast again', () => {
    const sched = new PollingScheduler(asStore(store), intervals(), false)
    sched.start()
    vi.advanceTimersByTime(20_000)
    sched.setForeground(true)
    // fast (20 s old > 3 s) and medium (20 s > 15 s) are stale; slow (20 s < 60 s) is not.
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    expect(store.refreshMedium).toHaveBeenCalledTimes(2)
    expect(store.refreshSlow).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(store.refreshFast).toHaveBeenCalledTimes(3)
    sched.stop()
  })

  it('does not re-run tiers that are still fresh when the window flickers back', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    sched.setForeground(false)
    sched.setForeground(true)
    expect(store.refreshFast).toHaveBeenCalledTimes(1)
    expect(store.refreshMedium).toHaveBeenCalledTimes(1)
    expect(store.refreshSlow).toHaveBeenCalledTimes(1)
    sched.stop()
  })

  it('stays silent while paused, whatever the window does', () => {
    const sched = new PollingScheduler(asStore(store), intervals({ paused: true }), false)
    sched.start()
    sched.setForeground(true)
    vi.advanceTimersByTime(120_000)
    expect(store.refreshFast).not.toHaveBeenCalled()
    sched.stop()
  })

  it('ignores a repeated state', () => {
    const sched = new PollingScheduler(asStore(store), intervals())
    sched.start()
    vi.advanceTimersByTime(2000)
    sched.setForeground(true)
    vi.advanceTimersByTime(1000)
    // The fast timer was not re-armed by the no-op call: it still fires at 3 s.
    expect(store.refreshFast).toHaveBeenCalledTimes(2)
    expect(sched.isForeground()).toBe(true)
    sched.stop()
  })
})
