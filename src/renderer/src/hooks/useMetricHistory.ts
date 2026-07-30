import { useEffect, useSyncExternalStore } from 'react'
import type { MetricSample } from '@shared/types'

/**
 * Roughly four minutes at the default fast tier. The buffer is capped rather
 * than aged out: a tray companion keeps a trend, not a time series. Nothing
 * here is written to disk, to localStorage or to MCP (goal.md §2.2).
 */
export const METRIC_HISTORY_LIMIT = 120

/**
 * A pause longer than this is a hole in the record, not a flat line —
 * monitoring can be paused and the card only samples while it is on screen.
 */
const GAP_AFTER_MS = 60_000

export interface MetricHistoryInput {
  /** A change empties the buffer: two machines drawn as one line would lie. */
  distro: string | null
  /** Snapshot instant, and the sample identity — one sample per instant. */
  at: string | null
  cpuPercent: number | null
  memUsedBytes: number | null
}

// Module scope on purpose: the Dashboard unmounts the card whenever another
// section is selected, and losing the trend on every visit would defeat it.
let recordedDistro: string | null = null
let samples: MetricSample[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The buffer as it stands. Stable between records, so it is a safe store read. */
export function getMetricHistory(): MetricSample[] {
  return samples
}

/** Drops every sample. Used by the distro guard and by tests. */
export function resetMetricHistory(): void {
  recordedDistro = null
  if (samples.length === 0) return
  samples = []
  emit()
}

/**
 * A null sample sitting between two distant instants. It draws as a break in
 * the line, because what happened in between was never measured.
 */
function gapMarker(last: MetricSample | undefined, at: string): MetricSample | null {
  if (last === undefined) return null
  const from = Date.parse(last.at)
  const to = Date.parse(at)
  if (Number.isNaN(from) || Number.isNaN(to) || to - from <= GAP_AFTER_MS) return null
  return {
    at: new Date(from + (to - from) / 2).toISOString(),
    cpuPercent: null,
    memUsedBytes: null
  }
}

export function recordMetricSample(input: MetricHistoryInput): void {
  const before = samples
  if (input.distro !== recordedDistro) {
    recordedDistro = input.distro
    samples = []
  }
  const last = samples[samples.length - 1]
  // Re-renders, a second card and React's double-invoked effects all replay
  // the same instant; only a new one is a new measurement.
  if (input.at !== null && (last === undefined || last.at !== input.at)) {
    const next = samples.slice()
    const gap = gapMarker(last, input.at)
    if (gap !== null) next.push(gap)
    next.push({ at: input.at, cpuPercent: input.cpuPercent, memUsedBytes: input.memUsedBytes })
    samples =
      next.length > METRIC_HISTORY_LIMIT ? next.slice(next.length - METRIC_HISTORY_LIMIT) : next
  }
  if (samples !== before) emit()
}

/** Samples the snapshot metrics into the shared buffer and returns it. */
export function useMetricHistory(input: MetricHistoryInput): MetricSample[] {
  const { distro, at, cpuPercent, memUsedBytes } = input
  useEffect(() => {
    recordMetricSample({ distro, at, cpuPercent, memUsedBytes })
  }, [distro, at, cpuPercent, memUsedBytes])
  return useSyncExternalStore(subscribe, getMetricHistory)
}
