import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { ServiceInfo } from '@shared/types'
import type { DistroRunner } from './contracts'
import { SECTION_MARKER, splitSections } from './system'

// Four systemctl views in one round-trip. The system scope must succeed;
// a missing user manager may leave only the user sections empty.
const SERVICES_SCRIPT = [
  'systemctl list-units --type=service --all --plain --no-legend --no-pager 2>/dev/null || exit $?',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'systemctl list-unit-files --type=service --plain --no-legend --no-pager 2>/dev/null || exit $?',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'systemctl --user list-units --type=service --all --plain --no-legend --no-pager 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'systemctl --user list-unit-files --type=service --plain --no-legend --no-pager 2>/dev/null || true'
].join('\n')

const LIST_UNITS_RE = /^\s*(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/
const UNIT_FILES_RE = /^\s*(\S+\.service)\s+(\S+)/

/** Parse `systemctl list-units --type=service --plain --no-legend` output. */
export function parseListUnits(text: string, scope: 'system' | 'user'): ServiceInfo[] {
  const out: ServiceInfo[] = []
  for (const line of text.split('\n')) {
    const m = LIST_UNITS_RE.exec(line)
    if (!m) continue
    out.push({
      name: m[1],
      scope,
      loadState: m[2],
      activeState: m[3],
      subState: m[4],
      enabled: null,
      description: m[5].trim()
    })
  }
  return out
}

/** Parse `systemctl list-unit-files --type=service` into name → enabled state. */
export function parseUnitFiles(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = UNIT_FILES_RE.exec(line)
    if (m) out.set(m[1], m[2])
  }
  return out
}

function mergeEnabled(units: ServiceInfo[], files: Map<string, string>): ServiceInfo[] {
  return units.map((u) => ({ ...u, enabled: files.get(u.name) ?? null }))
}

export async function collectServices(
  runner: DistroRunner,
  distro: string,
  systemdEnabled: boolean | null
): Promise<ServiceInfo[]> {
  // Without systemd there is nothing to query — do not spawn systemctl at all.
  if (systemdEnabled === false) return []
  const res = await runner.runInDistro(distro, SERVICES_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
  if (res.code !== 0 || res.timedOut) throw new Error('systemctl service query failed')
  const s = splitSections(res.stdout)
  if (s.length !== 4) throw new Error('systemctl service query returned incomplete output')
  const system = mergeEnabled(parseListUnits(s[0], 'system'), parseUnitFiles(s[1]))
  const user = mergeEnabled(parseListUnits(s[2], 'user'), parseUnitFiles(s[3]))
  return [...system, ...user]
}
