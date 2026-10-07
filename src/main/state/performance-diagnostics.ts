import { appendFile, mkdir, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { performance } from 'perf_hooks'
import type { PerformanceMetric, PerformanceState, SlowInterval } from '@shared/types'

export const PERFORMANCE_THRESHOLDS_MS = {
  ui: 200,
  eventLoop: 100,
  render: 100,
  wsl: 1000
} as const

type SampleKind = PerformanceMetric['kind']

/** Session-only opt-in recorder. It observes existing calls and never launches WSL work. */
export class PerformanceDiagnostics {
  private enabled = false
  private path: string | null = null
  private intervals: SlowInterval[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private expected = 0
  private pingId = 0
  private pingAt = 0
  private pendingWrite: Promise<void> = Promise.resolve()
  private buffer: string[] = []
  private subscribers = new Set<(state: PerformanceState) => void>()

  constructor(
    private directory: string,
    private getProcessMetrics: () => { cpuPercent: number; memoryBytes: number } | null,
    private now: () => number = () => performance.now(),
    private sendPing: (id: number) => boolean = () => false
  ) {}

  get(): PerformanceState {
    return { enabled: this.enabled, path: this.path, intervals: [...this.intervals] }
  }

  subscribe(cb: (state: PerformanceState) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  async setEnabled(enabled: boolean): Promise<PerformanceState> {
    if (enabled === this.enabled) return this.get()
    if (enabled) {
      await mkdir(this.directory, { recursive: true })
      this.path = join(this.directory, `slowdown-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.jsonl`)
      await writeFile(this.path, '', { flag: 'wx' })
      this.intervals = []
      this.enabled = true
      this.pingAt = 0
      this.expected = this.now() + 1000
      this.timer = setInterval(() => this.tick(), 1000)
    } else {
      this.enabled = false
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      this.flush()
      await this.pendingWrite
    }
    this.emit()
    return this.get()
  }

  record(kind: SampleKind, value: number): void {
    if (!this.enabled || !Number.isFinite(value) || value < 0 || !this.path) return
    const at = new Date().toISOString()
    const metric: PerformanceMetric = { at, kind, value: Math.round(value * 100) / 100 }
    this.buffer.push(JSON.stringify(metric) + '\n')
    const threshold = PERFORMANCE_THRESHOLDS_MS[kind as keyof typeof PERFORMANCE_THRESHOLDS_MS]
    if (kind !== 'cpu' && kind !== 'memory' && threshold !== undefined && value >= threshold) {
      const previous = this.intervals[0]
      if (previous?.kind === kind && Date.parse(at) - Date.parse(previous.end) <= 2000) {
        previous.end = at
        previous.count++
        previous.peakMs = Math.max(previous.peakMs, Math.round(value))
      } else {
        this.intervals.unshift({ kind, start: at, end: at, count: 1, peakMs: Math.round(value) })
        this.intervals = this.intervals.slice(0, 50)
      }
      this.emit()
    }
  }

  replyToPing(id: number): void {
    if (this.enabled && id === this.pingId && this.pingAt > 0) {
      this.record('ui', this.now() - this.pingAt)
      this.pingAt = 0
    }
  }

  private tick(): void {
    if (!this.enabled) return
    const now = this.now()
    this.record('eventLoop', Math.max(0, now - this.expected))
    this.expected = now + 1000
    const usage = this.getProcessMetrics()
    if (usage) {
      this.record('cpu', usage.cpuPercent)
      this.record('memory', usage.memoryBytes)
    }
    if (this.pingAt > 0 && now - this.pingAt > 3000) {
      this.record('ui', now - this.pingAt)
      this.pingAt = 0
    }
    if (this.pingAt === 0 && this.sendPing(++this.pingId)) {
      this.pingAt = this.now()
    }
    this.flush()
  }

  private flush(): void {
    if (!this.path || this.buffer.length === 0) return
    const lines = this.buffer.join('')
    const target = this.path
    this.buffer = []
    this.pendingWrite = this.pendingWrite
      .then(() => appendFile(target, lines, 'utf8'))
      .catch(() => { /* Diagnostics must not disrupt the app. */ })
  }

  async readyToExport(): Promise<string | null> {
    if (this.enabled) return null
    this.flush()
    await this.pendingWrite
    return this.path
  }

  private emit(): void {
    const state = this.get()
    for (const cb of this.subscribers) cb(state)
  }

  async dispose(): Promise<void> {
    await this.setEnabled(false)
  }
}
