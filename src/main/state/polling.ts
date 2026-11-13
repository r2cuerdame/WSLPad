import { POLL_BACKGROUND_MS, POLL_BOUNDS } from '@shared/constants'
import type { MonitoringSettings } from '@shared/types'
import type { SnapshotStore } from './store'

type Tier = 'fast' | 'medium' | 'slow'

const TIER_KEY = { fast: 'fastMs', medium: 'mediumMs', slow: 'slowMs' } as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Tiered polling driver (goal.md §9.3): one interval per tier, immediate
 * first run on start/resume, and a full stop while monitoring is paused.
 * Overlap protection lives in the store's per-tier in-flight guards, and so
 * does the backoff for an unresponsive distro (issue #37) — the timers stay
 * dumb on purpose, since the store is the only place that knows what answered.
 *
 * The configured intervals apply only while the window is on screen (shown and
 * not minimized, or focused). Minimized, hidden or in the tray, each tier
 * stretches to at least POLL_BACKGROUND_MS: nobody is looking, and every
 * in-distro query is a wsl.exe start whose wslhost console Windows Terminal
 * can flash onto the desktop. Coming back on screen refreshes every tier that
 * is older than its on-screen interval, so the window never opens stale.
 */
export class PollingScheduler {
  private timers = new Map<Tier, ReturnType<typeof setInterval>>()
  private lastRun: Record<Tier, number> = { fast: 0, medium: 0, slow: 0 }
  private started = false
  private paused: boolean

  constructor(
    private store: SnapshotStore,
    private intervals: MonitoringSettings,
    private foreground = true
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

  /** Whether the window is on screen; drives the short, configured intervals. */
  setForeground(foreground: boolean): void {
    if (foreground === this.foreground) return
    this.foreground = foreground
    if (!this.started || this.paused) return
    if (foreground) {
      const now = Date.now()
      for (const tier of ['fast', 'medium', 'slow'] as const) {
        if (now - this.lastRun[tier] >= this.configuredMs(TIER_KEY[tier])) this.refresh(tier)
      }
    }
    this.arm()
  }

  isForeground(): boolean {
    return this.foreground
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
  private configuredMs(key: 'fastMs' | 'mediumMs' | 'slowMs'): number {
    const bounds = POLL_BOUNDS[key]
    return clamp(this.intervals[key], bounds.min, bounds.max)
  }

  private tierMs(key: 'fastMs' | 'mediumMs' | 'slowMs'): number {
    const configured = this.configuredMs(key)
    return this.foreground ? configured : Math.max(configured, POLL_BACKGROUND_MS[key])
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
  }

  private refresh(tier: Tier): void {
    this.lastRun[tier] = Date.now()
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
