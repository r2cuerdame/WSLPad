import { MAX_TEXT_FILE_BYTES, RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { HermesInfo, HermesProcessInfo } from '@shared/types'
import type { DistroRunner, RunResult } from '../contracts'
import { assertValidDistroName } from '../escape'

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
    logPaths
  }
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
