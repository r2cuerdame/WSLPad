import { POLL_BOUNDS } from '@shared/constants'
import type { MonitoringSettings } from '@shared/types'
import type { SnapshotStore } from './store'

type Tier = 'fast' | 'medium' | 'slow'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Tiered polling driver (goal.md §9.3): one interval per tier, immediate
 * first run on start/resume, and a full stop while monitoring is paused.
 * Overlap protection lives in the store's per-tier in-flight guards, and so
 * does the backoff for an unresponsive distro (issue #37) — the timers stay
 * dumb on purpose, since the store is the only place that knows what answered.
 */
export class PollingScheduler {
  private timers = new Map<Tier, ReturnType<typeof setInterval>>()
  private started = false
  private paused: boolean

  constructor(
    private store: SnapshotStore,
    private intervals: MonitoringSettings
  ) {
    this.paused = intervals.paused
  }

  start(): void {
    if (this.started) return
    this.started = true
    if (!this.paused) this.runNowAndArm()
  }

  stop(): void {
    this.started = false
    this.clearTimers()
  }

  setIntervals(m: MonitoringSettings): void {
    this.intervals = m
    if (m.paused !== this.paused) {
      this.setPaused(m.paused)
      return
    }
    if (this.started && !this.paused) this.arm()
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    if (!this.started) return
    if (paused) this.clearTimers()
    else this.runNowAndArm()
  }

  private runNowAndArm(): void {
    this.refresh('fast')
    this.refresh('medium')
    this.refresh('slow')
    this.arm()
  }

  private arm(): void {
    this.clearTimers()
    this.timers.set(
      'fast',
      setInterval(() => this.refresh('fast'), this.tierMs('fastMs'))
    )
    this.timers.set(
      'medium',
      setInterval(() => this.refresh('medium'), this.tierMs('mediumMs'))
    )
    this.timers.set(
      'slow',
      setInterval(() => this.refresh('slow'), this.tierMs('slowMs'))
    )
  }

  /** Settings arrive pre-clamped, but a timer must never run with a bad period. */
  private tierMs(key: 'fastMs' | 'mediumMs' | 'slowMs'): number {
    const bounds = POLL_BOUNDS[key]
    return clamp(this.intervals[key], bounds.min, bounds.max)
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
  }

  private refresh(tier: Tier): void {
    const run =
      tier === 'fast'
        ? this.store.refreshFast()
        : tier === 'medium'
          ? this.store.refreshMedium()
          : this.store.refreshSlow()
    // Refreshes are contract-bound not to throw; the catch keeps a defect in a
    // collector from surfacing as an unhandled rejection inside a timer tick.
    run.catch(() => {})
  }
}
