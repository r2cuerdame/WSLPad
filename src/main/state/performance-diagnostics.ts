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
  private exportReady: Promise<string | null> | null = null
  private buffer: string[] = []
  private writeError = false
  private subscribers = new Set<(state: PerformanceState) => void>()

  constructor(
    private directory: string,
    private getProcessMetrics: () => { cpuPercent: number; memoryBytes: number } | null,
    private now: () => number = () => performance.now(),
    private sendPing: (id: number) => boolean = () => false
  ) {}

  get(): PerformanceState {
    return {
      enabled: this.enabled,
      path: this.path,
      intervals: [...this.intervals],
      writeError: this.writeError,
      unsavedSamples: this.buffer.length
    }
  }

  subscribe(cb: (state: PerformanceState) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  async setEnabled(enabled: boolean): Promise<PerformanceState> {
    if (enabled === this.enabled) return this.get()
    if (enabled) {
      if (this.writeError) throw new Error('Export the unsaved recording before starting another')
      await mkdir(this.directory, { recursive: true })
      this.path = join(this.directory, `slowdown-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.jsonl`)
      await writeFile(this.path, '', { flag: 'wx' })
      this.intervals = []
      this.exportReady = null
      this.enabled = true
      this.pingAt = 0
      this.expected = this.now() + 1000
      this.timer = setInterval(() => this.tick(), 1000)
    } else {
      this.enabled = false
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      await this.flush()
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

  private flush(): Promise<void> {
    if (!this.path || this.buffer.length === 0) return this.pendingWrite
    const target = this.path
    this.pendingWrite = this.pendingWrite
      .then(async () => {
        if (this.buffer.length === 0) return
        const count = this.buffer.length
        try {
          await appendFile(target, this.buffer.slice(0, count).join(''), 'utf8')
          this.buffer.splice(0, count)
          if (this.writeError) {
            this.writeError = false
            this.emit()
          }
        } catch {
          // Keep the batch for export retry, and stop sampling before memory grows.
          this.writeError = true
          this.enabled = false
          if (this.timer) clearInterval(this.timer)
          this.timer = null
          this.emit()
        }
      })
    return this.pendingWrite
  }

  readyToExport(): Promise<string | null> {
    if (this.enabled) return Promise.resolve(null)
    if (!this.path) return Promise.resolve(null)
    if (!this.exportReady) {
      const path = this.path
      const intervals = this.get().intervals
      this.exportReady = (async () => {
        await this.flush()
        if (this.buffer.length > 0) throw new Error('Recording has unsaved samples')
        try {
          await appendFile(path, JSON.stringify({
            type: 'slowIntervalsSummary',
            formatVersion: 1,
            thresholdsMs: PERFORMANCE_THRESHOLDS_MS,
            intervals
          }) + '\n', 'utf8')
          if (this.writeError) {
            this.writeError = false
            this.emit()
          }
          return path
        } catch (error) {
          this.writeError = true
          this.emit()
          throw error
        }
      })().catch((error: unknown) => {
        this.exportReady = null
        throw error
      })
    }
    return this.exportReady
  }

  private emit(): void {
    const state = this.get()
    for (const cb of this.subscribers) cb(state)
  }

  async dispose(): Promise<void> {
    await this.setEnabled(false)
    await this.flush()
  }
}
