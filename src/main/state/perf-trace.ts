import { appendFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** Local opt-in polling timings. Nothing is written without an absolute path. */
export async function recordPollingDuration(
  tier: 'fast' | 'medium' | 'slow',
  elapsedMs: number,
  outcome: 'ok' | 'error'
): Promise<void> {
  const target = process.env.WSLPAD_PERF_TRACE_PATH
  if (!target || !isAbsolute(target)) return
  const row = JSON.stringify({
    utc: new Date().toISOString(),
    tier,
    elapsedMs: Math.round(elapsedMs * 1000) / 1000,
    outcome
  })
  try {
    await appendFile(target, `${row}\n`, 'utf8')
  } catch {
    // A trace path must never break polling or surface local file details in the UI.
  }
}
