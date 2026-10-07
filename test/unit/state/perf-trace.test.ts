import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordPollingDuration } from '../../../src/main/state/perf-trace'

afterEach(() => vi.unstubAllEnvs())

describe('local polling performance trace', () => {
  it('writes no trace without an absolute opt-in path', async () => {
    const relativePath = `relative-trace-${Date.now()}.jsonl`
    vi.stubEnv('WSLPAD_PERF_TRACE_PATH', relativePath)
    await recordPollingDuration('fast', 12.5, 'ok')
    await expect(readFile(relativePath, 'utf8')).rejects.toThrow()
  })

  it('writes only timing fields to the selected local file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wslpad-perf-trace-'))
    const path = join(directory, 'polling.jsonl')
    vi.stubEnv('WSLPAD_PERF_TRACE_PATH', path)
    try {
      await recordPollingDuration('medium', 23.45678, 'error')
      const row = JSON.parse((await readFile(path, 'utf8')).trim())
      expect(row).toEqual({
        utc: expect.any(String),
        tier: 'medium',
        elapsedMs: 23.457,
        outcome: 'error'
      })
    } finally {
      await unlink(path)
      await rmdir(directory)
    }
  })
})
