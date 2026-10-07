import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { performance } from 'perf_hooks'
import http from 'http'
import https from 'https'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PerformanceDiagnostics } from '../../../src/main/state/performance-diagnostics'

const directories: string[] = []
async function recorder(): Promise<{ service: PerformanceDiagnostics; directory: string }> {
  const directory = await mkdtemp(join(process.cwd(), '.performance-test-'))
  directories.push(directory)
  return { service: new PerformanceDiagnostics(directory, () => ({ cpuPercent: 2, memoryBytes: 1024 })), directory }
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('opt-in performance diagnostics', () => {
  it('starts and stops recording, then summarizes only intervals above the thresholds', async () => {
    const { service } = await recorder()
    expect(service.get()).toEqual({ enabled: false, path: null, intervals: [] })
    const on = await service.setEnabled(true)
    expect(on.enabled).toBe(true)
    service.record('wsl', 1200)
    service.record('wsl', 1500)
    service.record('render', 120)
    service.record('cpu', 42)
    const off = await service.setEnabled(false)
    expect(off.enabled).toBe(false)
    expect(off.intervals).toMatchObject([
      { kind: 'render', peakMs: 120, count: 1 },
      { kind: 'wsl', peakMs: 1500, count: 2 }
    ])
    const lines = (await readFile(on.path!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.map((line) => line.kind)).toEqual(['wsl', 'wsl', 'render', 'cpu'])
    expect(lines.every((line) => Object.keys(line).sort().join() === 'at,kind,value')).toBe(true)
  })

  it('writes zero records and creates zero files while disabled, including after stop', async () => {
    const { service, directory } = await recorder()
    service.record('ui', 500)
    service.record('wsl', 2000)
    expect(await readdir(directory)).toEqual([])
    const on = await service.setEnabled(true)
    service.record('ui', 300)
    await service.setEnabled(false)
    const before = await readFile(on.path!, 'utf8')
    service.record('ui', 700)
    expect(await readFile(on.path!, 'utf8')).toBe(before)
    expect(before.trim().split('\n')).toHaveLength(1)
  })

  it('includes the slow-interval summary exactly once in the exported JSONL', async () => {
    const { service } = await recorder()
    await service.setEnabled(true)
    service.record('wsl', 1200)
    service.record('wsl', 1500)
    service.record('cpu', 42)
    await service.setEnabled(false)
    const source = await service.readyToExport()
    expect(await service.readyToExport()).toBe(source)
    const lines = (await readFile(source!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(lines.filter((line) => line.type === 'slowIntervalsSummary')).toHaveLength(1)
    expect(lines.at(-1)).toMatchObject({
      type: 'slowIntervalsSummary',
      intervals: [{ kind: 'wsl', count: 2, peakMs: 1500 }]
    })
  })

  it('uses local file output with no external transmission', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const httpRequest = vi.spyOn(http, 'request')
    const httpsRequest = vi.spyOn(https, 'request')
    const { service } = await recorder()
    await service.setEnabled(true)
    service.record('eventLoop', 300)
    service.record('memory', 1024)
    await service.setEnabled(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(httpRequest).not.toHaveBeenCalled()
    expect(httpsRequest).not.toHaveBeenCalled()
  })

  it('samples main event-loop delay and app process totals only while enabled', async () => {
    vi.useFakeTimers()
    const { directory } = await recorder()
    let now = 0
    const pings: number[] = []
    const service = new PerformanceDiagnostics(
      directory,
      () => ({ cpuPercent: 12, memoryBytes: 2048 }),
      () => now,
      (id) => { pings.push(id); return true }
    )
    await service.setEnabled(true)
    now = 1250
    await vi.advanceTimersByTimeAsync(1000)
    now = 1500
    service.replyToPing(pings[0])
    const path = service.get().path!
    await service.setEnabled(false)
    expect(service.get().intervals.map((item) => item.kind)).toEqual(['ui', 'eventLoop'])
    const kinds = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).kind)
    expect(kinds).toEqual(['eventLoop', 'cpu', 'memory', 'ui'])
    now = 2500
    await vi.advanceTimersByTimeAsync(1000)
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(4)
  })

  it('measures enabled recording overhead against the documented 2 ms/sample budget', async () => {
    const { service } = await recorder()
    const count = 1000
    const baseline = performance.now()
    for (let index = 0; index < count; index++) service.record('wsl', 10)
    const disabledMs = performance.now() - baseline
    await service.setEnabled(true)
    const start = performance.now()
    for (let index = 0; index < count; index++) service.record('wsl', 10)
    const enabledMs = performance.now() - start
    await service.setEnabled(false)
    const overheadMs = Math.max(0, enabledMs - disabledMs) / count
    console.log(`performance diagnostics: ${count} samples, disabled ${disabledMs.toFixed(2)} ms, enabled ${enabledMs.toFixed(2)} ms, overhead ${overheadMs.toFixed(4)} ms/sample`)
    expect(overheadMs).toBeLessThan(2)
  })
})
