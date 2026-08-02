import { MAX_TEXT_FILE_BYTES, RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type {
  HermesHomeInfo,
  HermesInfo,
  HermesPlatformInfo,
  HermesProcessInfo,
  HermesProfileInfo
} from '@shared/types'
import type { DistroRunner, RunResult } from '../contracts'
import { assertValidDistroName, shellQuote } from '../escape'

/**
 * Hermes card data (goal.md §6.6). One batched Hidden-Runner script emits a
 * line protocol (DATA, EXEC, EXECLOCAL, VENV, CONFIG, JSONBEGIN/JSONEND,
 * PROCLINE, SS, SVC, LOGP) parsed here.
 * The script is fully static — no interpolation — and the awk
 * self-filter drops our own `sh -c` process, whose command line contains the
 * word "hermes" and would otherwise match `pgrep -af`.
 */
export const HERMES_SCRIPT = `[ -e "$HOME/.hermes" ] && printf '%s\\n' "DATA:$HOME/.hermes"
p=$(command -v hermes 2>/dev/null) || p=
[ -n "$p" ] && printf '%s\\n' "EXEC:$p"
[ -x "$HOME/.local/bin/hermes" ] && printf '%s\\n' "EXECLOCAL:$HOME/.local/bin/hermes"
for d in "$HOME/.hermes/venv" "$HOME/.hermes/.venv"; do
  [ -x "$d/bin/python" ] && printf '%s\\n' "VENV:$d"
done
for c in "$HOME/.hermes/config.json" "$HOME/.hermes/config.yaml" "$HOME/.hermes/config"; do
  [ -e "$c" ] && printf '%s\\n' "CONFIG:$c"
done
if [ -f "$HOME/.hermes/config.json" ]; then
  printf '%s\\n' JSONBEGIN
  head -c ${MAX_TEXT_FILE_BYTES} "$HOME/.hermes/config.json" 2>/dev/null
  printf '\\n%s\\n' JSONEND
fi
pgrep -af hermes 2>/dev/null | awk -v self="$$" '$1 != self { print "PROCLINE:" $0 }'
ss -tlnpH 2>/dev/null | sed 's/^/SS:/'
systemctl --user list-units 'hermes*' --plain --no-legend --no-pager 2>/dev/null | sed 's/^/SVC:/'
[ -e "$HOME/.hermes/logs" ] && printf '%s\\n' "LOGP:$HOME/.hermes/logs"
[ -e "$HOME/.local/state/hermes" ] && printf '%s\\n' "LOGP:$HOME/.local/state/hermes"
:
`

/**
 * Count keys of the mcpServers object in Hermes config JSON.
 * Invalid/truncated JSON or a non-object mcpServers value → null.
 */
export function countMcpServers(jsonText: string | null): number | null {
  if (jsonText === null) return null
  try {
    const parsed: unknown = JSON.parse(jsonText)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const servers = (parsed as Record<string, unknown>).mcpServers
    if (servers === undefined) return 0
    if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null
    return Object.keys(servers).length
  } catch {
    return null
  }
}

interface SsListener {
  port: number
  pids: number[]
}

/** Parse one `ss -tlnpH` row (State Recv-Q Send-Q Local Peer Process). */
export function parseSsLine(line: string): SsListener | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 4) return null
  const local = parts[3]
  const portMatch = local.match(/:(\d+)$/)
  if (!portMatch) return null
  const port = Number.parseInt(portMatch[1], 10)
  if (!Number.isFinite(port) || port <= 0) return null
  const pids = [...line.matchAll(/pid=(\d+)/g)].map((m) => Number.parseInt(m[1], 10))
  return { port, pids }
}

function parseUnitName(line: string): string | null {
  const cleaned = line.replace(/^[^A-Za-z0-9]+/, '').trimEnd()
  if (!cleaned) return null
  const token = cleaned.split(/\s+/)[0]
  return token && token.includes('.') ? token : null
}

const orNull = (s: string): string | null => {
  const t = s.trim()
  return t.length > 0 ? t : null
}

export function parseHermesOutput(stdout: string): HermesInfo {
  let dataDir: string | null = null
  let execPath: string | null = null
  let execLocal: string | null = null
  let venvPath: string | null = null
  let configPath: string | null = null
  let jsonText: string | null = null
  const processes: HermesProcessInfo[] = []
  const listeners: SsListener[] = []
  const services: string[] = []
  const logPaths: string[] = []

  const jsonLines: string[] = []
  let inJson = false
  let sawJson = false

  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (inJson) {
      if (line === 'JSONEND') {
        inJson = false
        continue
      }
      jsonLines.push(raw)
      continue
    }
    if (line === 'JSONBEGIN') {
      inJson = true
      sawJson = true
      continue
    }
    if (line.startsWith('DATA:')) {
      dataDir = dataDir ?? orNull(line.slice(5))
    } else if (line.startsWith('EXECLOCAL:')) {
      execLocal = execLocal ?? orNull(line.slice(10))
    } else if (line.startsWith('EXEC:')) {
      execPath = execPath ?? orNull(line.slice(5))
    } else if (line.startsWith('VENV:')) {
      venvPath = venvPath ?? orNull(line.slice(5))
    } else if (line.startsWith('CONFIG:')) {
      configPath = configPath ?? orNull(line.slice(7))
    } else if (line.startsWith('PROCLINE:')) {
      const m = line.slice(9).match(/^(\d+)\s+(.+)$/)
      if (m) processes.push({ pid: Number.parseInt(m[1], 10), command: m[2].trim() })
    } else if (line.startsWith('SS:')) {
      const listener = parseSsLine(line.slice(3))
      if (listener) listeners.push(listener)
    } else if (line.startsWith('SVC:')) {
      const unit = parseUnitName(line.slice(4))
      if (unit) services.push(unit)
    } else if (line.startsWith('LOGP:')) {
      const p = orNull(line.slice(5))
      if (p) logPaths.push(p)
    }
  }

  if (sawJson) jsonText = jsonLines.join('\n')

  const hermesPids = new Set(processes.map((p) => p.pid))
  const ports = [
    ...new Set(
      listeners.filter((l) => l.pids.some((pid) => hermesPids.has(pid))).map((l) => l.port)
    )
  ].sort((a, b) => a - b)

  const executablePath = execPath ?? execLocal
  const hasGateway = processes.some((p) => /gateway/i.test(p.command))
  const hasDashboard = processes.some((p) => /dashboard/i.test(p.command))

  return {
    installed: executablePath !== null || dataDir !== null,
    executablePath,
    dataDir,
    venvPath,
    configPath,
    gatewayStatus: hasGateway ? 'running' : 'not-detected',
    dashboardStatus: hasDashboard ? 'running' : 'not-detected',
    mcpServerCount: countMcpServers(jsonText),
    processes,
    ports,
    services,
    logPaths,
    platforms: [],
    profiles: [],
    activeSessions: null,
    scheduledJobs: null,
    dashboardPort: ports.includes(HERMES_DASHBOARD_PORT) ? HERMES_DASHBOARD_PORT : null,
    home: null
  }
}

/** Default port of `hermes dashboard` (its own `--port` default). */
export const HERMES_DASHBOARD_PORT = 9119

/** The part of HermesInfo that only Hermes itself can answer. */
export type HermesCliDetail = Pick<
  HermesInfo,
  'platforms' | 'profiles' | 'activeSessions' | 'scheduledJobs' | 'home'
>

/**
 * Ask Hermes about itself (goal.md §6.6). Two read-only CLI subcommands, both
 * time-boxed inside the distro as well as by the Hidden Runner, and never run
 * unless `hermes` is on PATH. `hermes status` is the only place the messaging
 * platforms and session counts are published; `profile list` is the only place
 * the profiles ("agents") are.
 */
export const HERMES_CLI_SCRIPT = `command -v hermes >/dev/null 2>&1 || exit 0
if command -v timeout >/dev/null 2>&1; then t="timeout 20"; else t=""; fi
export NO_COLOR=1 TERM=dumb
printf '%s\\n' STATUSBEGIN
$t hermes status 2>/dev/null
printf '\\n%s\\n' STATUSEND
printf '%s\\n' PROFILESBEGIN
$t hermes profile list 2>/dev/null
printf '\\n%s\\n' PROFILESEND
printf '%s\\n' HOMEBEGIN
printf 'STATUS_HOME=%s\\n' "\${HERMES_HOME:-$HOME/.hermes}"
for u in hermes-gateway hermes-agent hermes; do
  ls=$(systemctl show "$u.service" -p LoadState --value 2>/dev/null)
  [ "$ls" = "loaded" ] || continue
  printf 'GATEWAY_UNIT=%s\\n' "$u.service"
  printf 'GATEWAY_USER=%s\\n' "$(systemctl show "$u.service" -p User --value 2>/dev/null)"
  printf 'GATEWAY_ENV=%s\\n' "$(systemctl show "$u.service" -p Environment --value 2>/dev/null)"
  break
done
printf '%s\\n' HOMEEND
:
`

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
/** Hermes marks a section with ◆; anything else at column 0 ends one. */
const SECTION_RE = /^[◆▸*]\s*(.+?)\s*$/
const YES = '✓'

const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

function parseCounter(lines: string[], label: RegExp): number | null {
  for (const line of lines) {
    const m = line.match(label)
    if (m) {
      const n = Number.parseInt(m[1], 10)
      return Number.isFinite(n) ? n : null
    }
  }
  return null
}

/** Split `hermes status` into its ◆ sections, keyed by lowercased title. */
function statusSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string[] | null = null
  for (const raw of text.split('\n')) {
    const line = stripAnsi(raw).replace(/\s+$/, '')
    const header = line.match(SECTION_RE)
    if (header) {
      current = []
      sections.set(header[1].toLowerCase(), current)
      continue
    }
    if (current !== null) current.push(line)
  }
  return sections
}

export function parseHermesPlatforms(text: string): HermesPlatformInfo[] {
  const section = statusSections(text).get('messaging platforms')
  if (section === undefined) return []
  const platforms: HermesPlatformInfo[] = []
  for (const line of section) {
    if (line.trim() === '') continue
    const m = line.match(/^\s+(\S.*?)\s+([✓✗])\s*(.*)$/)
    if (!m) continue
    platforms.push({
      name: m[1].trim(),
      configured: m[2] === YES,
      detail: m[3].trim() === '' ? null : m[3].trim()
    })
  }
  return platforms
}

/**
 * `hermes profile list` prints a box-drawn table: header, a ─ rule, then one
 * row per profile with ◆ marking the sticky default. Columns are separated by
 * runs of two or more spaces, so a model name with a single space survives.
 */
export function parseHermesProfiles(text: string): HermesProfileInfo[] {
  const lines = stripAnsi(text).split('\n')
  const ruleAt = lines.findIndex((l) => /─{3,}/.test(l))
  if (ruleAt < 0) return []
  const profiles: HermesProfileInfo[] = []
  for (const line of lines.slice(ruleAt + 1)) {
    const trimmed = line.trim()
    if (trimmed === '' || /─{3,}/.test(trimmed)) continue
    const isCurrent = /^[◆*]/.test(trimmed)
    const cells = trimmed.replace(/^[◆*]\s*/, '').split(/\s{2,}/)
    const name = cells[0]?.trim() ?? ''
    if (name === '') continue
    const cell = (i: number): string | null => {
      const v = cells[i]?.trim()
      return v === undefined || v === '' || v === '—' || v === '-' ? null : v
    }
    profiles.push({ name, model: cell(1), gatewayState: cell(2), isCurrent })
  }
  return profiles
}

/**
 * `systemctl show -p Environment --value` prints the unit's environment as one
 * line of `KEY=value` pairs, quoted where a value contains spaces. Only
 * HERMES_HOME is wanted, and PATH — which is enormous and full of `=` — must
 * not be mistaken for it.
 */
export function hermesHomeFromEnvironment(line: string): string | null {
  // systemd quotes the whole assignment when a value contains a space —
  // `"HERMES_HOME=/root/my hermes"` — not just the value, so the quoted form
  // has to be matched from the opening quote or the value is cut at the space.
  const quoted = /(?:^|\s)"HERMES_HOME=([^"]*)"/.exec(line)
  if (quoted !== null) return quoted[1] === '' ? null : quoted[1]
  const bare = /(?:^|\s)HERMES_HOME=(\S+)/.exec(line)
  return bare === null || bare[1] === '' ? null : bare[1]
}

/** Trailing slashes and a trailing `/.` must not make two equal homes differ. */
function normalizeHome(path: string | null): string | null {
  if (path === null) return null
  const trimmed = path.replace(/\/+\.?$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * A mismatch is only claimed when both homes are known and differ. Everything
 * unknown stays null: reporting "the gateway uses a different home" when we
 * could not read the unit would send someone chasing a difference that may not
 * exist.
 */
export function parseHermesHome(block: string, distro?: string): HermesHomeInfo | null {
  const field = (key: string): string | null => {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(block)
    const v = m?.[1]?.trim()
    return v === undefined || v === '' ? null : v
  }
  const statusHome = normalizeHome(field('STATUS_HOME'))
  const gatewayUnit = field('GATEWAY_UNIT')
  const gatewayUser = field('GATEWAY_USER')
  const env = field('GATEWAY_ENV')
  const gatewayHome = normalizeHome(env === null ? null : hermesHomeFromEnvironment(env))
  if (statusHome === null && gatewayHome === null && gatewayUnit === null) return null

  // The command that would ask the gateway's own home, prepared never run.
  //
  // `wsl.exe -u root`, not `sudo`. WSL's own launcher picks the user, so it
  // never asks for a password — which matters because on a distro set up by
  // automation, or imported, or with --set-default-user, nobody knows the sudo
  // password and `sudo` simply answers "a password is required". The same line
  // works pasted into PowerShell and typed into the Console below, where
  // interop makes wsl.exe reachable from inside the distro.
  const statusCommand =
    gatewayHome !== null && statusHome !== null && gatewayHome !== statusHome
      ? `wsl.exe${distro === undefined ? '' : ` -d ${shellQuote(distro)}`} -u root ` +
        `env HERMES_HOME=${shellQuote(gatewayHome)} hermes status`
      : null

  return { statusHome, gatewayHome, gatewayUser, gatewayUnit, statusCommand }
}


export function parseHermesCliOutput(stdout: string, distro?: string): HermesCliDetail {
  const between = (begin: string, end: string): string => {
    const start = stdout.indexOf(begin)
    if (start < 0) return ''
    const from = start + begin.length
    const stop = stdout.indexOf(end, from)
    return stdout.slice(from, stop < 0 ? undefined : stop)
  }
  const status = between('STATUSBEGIN', 'STATUSEND')
  const sections = statusSections(status)
  return {
    platforms: parseHermesPlatforms(status),
    profiles: parseHermesProfiles(between('PROFILESBEGIN', 'PROFILESEND')),
    home: parseHermesHome(between('HOMEBEGIN', 'HOMEEND'), distro),
    activeSessions: parseCounter(sections.get('sessions') ?? [], /Active:\s*(\d+)/i),
    scheduledJobs: parseCounter(sections.get('scheduled jobs') ?? [], /Jobs:\s*(\d+)/i)
  }
}

/**
 * Run the Hermes CLI queries. Returns null when Hermes could not answer at all
 * — the caller keeps whatever it knew before rather than reporting "none".
 */
export async function detectHermesCli(
  runner: DistroRunner,
  distro: string
): Promise<HermesCliDetail | null> {
  assertValidDistroName(distro)
  let result: RunResult
  try {
    result = await runner.runInDistro(distro, HERMES_CLI_SCRIPT, {
      timeoutMs: RUNNER_SLOW_TIMEOUT_MS
    })
  } catch {
    return null
  }
  if (result.timedOut || !result.stdout.includes('STATUSBEGIN')) return null
  return parseHermesCliOutput(result.stdout, distro)
}

/**
 * Query Hermes state in the distro. Returns null ONLY when the distro query
 * itself fails entirely (spawn error, timeout/nonzero exit with no output);
 * a healthy distro without Hermes yields `installed: false`.
 */
export async function detectHermes(
  runner: DistroRunner,
  distro: string
): Promise<HermesInfo | null> {
  assertValidDistroName(distro)
  let result: RunResult
  try {
    result = await runner.runInDistro(distro, HERMES_SCRIPT, {
      timeoutMs: RUNNER_SLOW_TIMEOUT_MS
    })
  } catch {
    return null
  }
  const failed = result.timedOut || result.code !== 0
  if (failed && !result.stdout.trim()) return null
  return parseHermesOutput(result.stdout)
}
