import { MASKED_VALUE, RUNNER_TIMEOUT_MS } from '@shared/constants'
import { isPathLikeName, isSecretName, looksWindowsOriginated } from '@shared/masking'
import type { EnvironmentVariableInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'

// The runner strips NUL bytes while decoding, so env -0 separators are
// re-encoded in-distro as RS (0x1E) — parseEnvNul accepts both.
const ENV_SCRIPT = "env -0 2>/dev/null | tr '\\000' '\\036'"

// NUL (0x00) from raw env -0 fixtures, RS (0x1E) from the tr-rewritten script.
const SEPARATOR_RE = new RegExp('[' + String.fromCharCode(0) + String.fromCharCode(30) + ']')

export interface EnvironmentCollectResult {
  list: EnvironmentVariableInfo[]
  /** Raw values incl. secrets — must never leave the main process except revealEnv. */
  raw: Map<string, string>
}

/** Parse NUL- (or RS-)separated `env -0` output; values keep embedded newlines. */
export function parseEnvNul(text: string): EnvironmentCollectResult {
  const raw = new Map<string, string>()
  const infos = new Map<string, EnvironmentVariableInfo>()
  for (const entry of text.split(SEPARATOR_RE)) {
    if (!entry) continue
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    const name = entry.slice(0, eq)
    const value = entry.slice(eq + 1)
    raw.set(name, value)
    const secret = isSecretName(name)
    infos.set(name, {
      name,
      maskedValue: secret ? MASKED_VALUE : value,
      valueLength: value.length,
      isSecret: secret,
      isPathLike: isPathLikeName(name),
      fromWindows: looksWindowsOriginated(name, value)
    })
  }
  const list = [...infos.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { list, raw }
}

export async function collectEnvironment(
  runner: DistroRunner,
  distro: string
): Promise<EnvironmentCollectResult> {
  try {
    const res = await runner.runInDistro(distro, ENV_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
    return parseEnvNul(res.stdout)
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
    return { list: [], raw: new Map() }
  }
}
