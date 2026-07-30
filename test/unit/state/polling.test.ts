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
