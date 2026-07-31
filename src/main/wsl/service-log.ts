import type { ServiceLog, ServiceScope } from '@shared/types'
import type { DistroRunner } from './contracts'

/**
 * The last lines of a unit's journal, without opening a shell (issue #67).
 *
 * The Services card can already prepare `journalctl -u …` in the Console, which
 * is the right answer for following a log. It is the wrong answer for the far
 * more common "did it fail, and why" — that wants the last twenty lines, in
 * place, now.
 *
 * Read-only in the strict sense: `journalctl` only reads, the unit name is
 * validated before it can reach a shell, and nothing here starts, stops or
 * restarts anything.
 */

/**
 * systemd unit names allow letters, digits and `:-_.\` plus `@` for instances.
 * Anything else — a space, a quote, a `$` — is not a unit name, and refusing
 * it here means the name can never escape its quotes downstream.
 */
const VALID_UNIT = /^[A-Za-z0-9@._:\\-]{1,128}$/

export function isValidUnitName(unit: string): boolean {
  return VALID_UNIT.test(unit)
}

export const DEFAULT_LOG_LINES = 200
export const MAX_LOG_LINES = 1000

export function clampLines(lines: number | undefined): number {
  if (typeof lines !== 'number' || !Number.isFinite(lines)) return DEFAULT_LOG_LINES
  return Math.min(MAX_LOG_LINES, Math.max(1, Math.floor(lines)))
}

/**
 * `--output=short-iso` because the default format writes month names in the
 * system locale; ISO timestamps are the same in every language, which is the
 * rule everywhere else in this app. `--no-pager` so it cannot block waiting for
 * a terminal that is not there.
 */
export function buildServiceLogCommand(
  unit: string,
  scope: ServiceScope,
  lines: number
): string {
  if (!isValidUnitName(unit)) throw new Error(`not a unit name: ${unit}`)
  const user = scope === 'user' ? '--user ' : ''
  // LC_ALL=C so the two strings journalctl produces itself — the empty-journal
  // marker and the privilege hint — arrive in a form that can be recognised
  // rather than guessed at in whatever language the distro is set to.
  return `LC_ALL=C journalctl ${user}-u '${unit}' -n ${clampLines(lines)} --no-pager --output=short-iso`
}

/**
 * journalctl writes `-- No entries --` on stdout for an empty journal. It is
 * not a log line, and passing it through would show it as one.
 */
const NO_ENTRIES = /^--\s*No entries\s*--$/

/**
 * The privilege hint goes to stderr, not stdout — which is why an empty system
 * journal looks identical to "you are not allowed to read it". Recovering that
 * distinction is the whole reason stderr is read here at all.
 */
export function privilegeHint(stderr: string): string | null {
  const line = stderr
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('Hint:'))
  return line === undefined ? null : line.replace(/^Hint:\s*/, '')
}

export async function readServiceLog(
  runner: DistroRunner,
  distro: string,
  unit: string,
  scope: ServiceScope,
  lines = DEFAULT_LOG_LINES
): Promise<ServiceLog> {
  if (!isValidUnitName(unit)) {
    return { unit, scope, lines: [], truncated: false, error: `Not a unit name: ${unit}` }
  }
  const command = buildServiceLogCommand(unit, scope, lines)
  let result
  try {
    result = await runner.runInDistro(distro, `command -v journalctl >/dev/null 2>&1 || exit 66
${command}`, {
      timeoutMs: 15_000,
      maxOutputBytes: 512 * 1024
    })
  } catch (err) {
    return {
      unit,
      scope,
      lines: [],
      truncated: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
  if (result.timedOut) {
    return { unit, scope, lines: [], truncated: false, error: 'journalctl did not answer in time' }
  }
  if (result.code === 66) {
    // No journal at all — a distro without systemd, which is not a failure of
    // this unit and must not read like one.
    return { unit, scope, lines: [], truncated: false, error: 'journalctl is not available here' }
  }
  const text = result.stdout.replace(/\r/g, '').replace(/\n+$/, '')
  const out = (text === '' ? [] : text.split('\n')).filter((line) => !NO_ENTRIES.test(line.trim()))
  const hint = privilegeHint(result.stderr)

  if (out.length === 0) {
    return {
      unit,
      scope,
      lines: [],
      truncated: false,
      // An empty system journal and a journal this user may not read look
      // exactly alike on stdout. When the hint says which, say which.
      error: hint ?? (result.code === 0 ? null : result.stderr.trim().slice(0, 400) || null)
    }
  }
  return {
    unit,
    scope,
    lines: out,
    // The window was filled, so there is almost certainly more behind it.
    truncated: out.length >= clampLines(lines),
    // Entries did arrive, but possibly not all of them.
    error: hint
  }
}
