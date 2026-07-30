import { RUNNER_SLOW_TIMEOUT_MS, TOOL_SPECS } from '@shared/constants'
import type { ToolInfo } from '@shared/types'
import type { DistroRunner } from '../contracts'
import { assertValidDistroName, shellQuote } from '../escape'

/**
 * Installed Tools detection (goal.md §6.5). All 18 tools are probed by ONE
 * batched POSIX sh script through the Hidden Runner; a single extra call
 * lists user services. Output is a line protocol parsed here:
 *   TOOL:<id> / PATH:<command -v> / VER:<first line> / PROC:<count> / CFG:<path>
 */

type VersionProbe =
  | { kind: 'flag'; flag: string }
  | { kind: 'custom'; guardBin: string; command: string }
  | { kind: 'none' }

export interface ToolScriptSpec {
  id: string
  displayName: string
  /** binary probed with command -v */
  bin: string
  /** fallback binary name (e.g. chromium-browser) */
  altBin?: string
  version: VersionProbe
  /**
   * pgrep pattern matched against process NAMES only — never -f: the sh -c
   * command line contains every tool name and would self-match.
   */
  procPattern: string
  procExact: boolean
  /** ~-prefixed candidates existence-checked with test -e (CFG: lines) */
  configCandidates: string[]
}

type ToolScriptConfig = Omit<ToolScriptSpec, 'id' | 'displayName'>

const flag = (f: string): VersionProbe => ({ kind: 'flag', flag: f })

const SCRIPT_CONFIG: Record<string, ToolScriptConfig> = {
  hermes: {
    bin: 'hermes',
    version: flag('--version'),
    procPattern: 'hermes',
    procExact: false,
    configCandidates: ['~/.hermes']
  },
  codex: {
    bin: 'codex',
    version: flag('--version'),
    procPattern: 'codex',
    procExact: false,
    configCandidates: ['~/.codex']
  },
  claude: {
    bin: 'claude',
    version: flag('--version'),
    procPattern: 'claude',
    procExact: false,
    configCandidates: ['~/.claude', '~/.claude.json']
  },
  node: {
    bin: 'node',
    version: flag('-v'),
    procPattern: 'node',
    procExact: true,
    configCandidates: ['~/.npmrc']
  },
  npm: {
    bin: 'npm',
    version: flag('-v'),
    procPattern: 'npm',
    procExact: true,
    configCandidates: ['~/.npmrc']
  },
  pnpm: {
    bin: 'pnpm',
    version: flag('-v'),
    procPattern: 'pnpm',
    procExact: true,
    configCandidates: ['~/.npmrc']
  },
  yarn: {
    bin: 'yarn',
    version: flag('-v'),
    procPattern: 'yarn',
    procExact: true,
    configCandidates: ['~/.yarnrc', '~/.yarnrc.yml']
  },
  python: {
    bin: 'python3',
    version: flag('--version'),
    procPattern: 'python3.*',
    procExact: true,
    configCandidates: ['~/.config/pip']
  },
  pip: {
    bin: 'pip3',
    version: flag('--version'),
    procPattern: 'pip3?',
    procExact: true,
    configCandidates: ['~/.config/pip/pip.conf', '~/.pip/pip.conf']
  },
  uv: {
    bin: 'uv',
    version: flag('--version'),
    procPattern: 'uv',
    procExact: true,
    configCandidates: ['~/.config/uv']
  },
  git: {
    bin: 'git',
    version: flag('--version'),
    procPattern: 'git',
    procExact: true,
    configCandidates: ['~/.gitconfig', '~/.config/git/config']
  },
  docker: {
    bin: 'docker',
    version: flag('--version'),
    procPattern: 'docker',
    procExact: false,
    configCandidates: ['~/.docker']
  },
  'docker-compose': {
    bin: 'docker-compose',
    // compose v2 is a docker plugin without its own binary on PATH
    version: { kind: 'custom', guardBin: 'docker', command: 'docker compose version' },
    procPattern: 'docker-compose',
    procExact: false,
    configCandidates: ['~/.docker']
  },
  bun: {
    bin: 'bun',
    version: flag('--version'),
    procPattern: 'bun',
    procExact: true,
    configCandidates: ['~/.bunfig.toml']
  },
  ripgrep: {
    bin: 'rg',
    version: flag('--version'),
    procPattern: 'rg',
    procExact: true,
    configCandidates: ['~/.ripgreprc']
  },
  ffmpeg: {
    bin: 'ffmpeg',
    version: flag('--version'),
    procPattern: 'ffmpeg',
    procExact: true,
    configCandidates: []
  },
  playwright: {
    // `npx playwright --version` is too slow for polling; the browser cache
    // dir existing is the install signal instead.
    bin: 'playwright',
    version: { kind: 'none' },
    procPattern: 'playwright',
    procExact: false,
    configCandidates: ['~/.cache/ms-playwright']
  },
  chromium: {
    bin: 'chromium',
    altBin: 'chromium-browser',
    version: flag('--version'),
    procPattern: 'chrom',
    procExact: false,
    configCandidates: ['~/.config/chromium']
  }
}

export const TOOL_SCRIPT_SPECS: ToolScriptSpec[] = TOOL_SPECS.map((t) => {
  const cfg = SCRIPT_CONFIG[t.id]
  if (!cfg) throw new Error(`No detector config for tool ${t.id}`)
  return { id: t.id, displayName: t.displayName, ...cfg }
})

// Static spec fragments are embedded into the script unquoted where $HOME must
// expand, so they are allowlist-checked to keep the script injection-proof
// even if a future spec edit introduces odd characters.
const BIN_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/
const FLAG_RE = /^--?[A-Za-z][A-Za-z-]*$/
const CUSTOM_CMD_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/
const PROC_PATTERN_RE = /^[A-Za-z0-9][A-Za-z0-9.?*|_-]*$/
const CONFIG_CANDIDATE_RE = /^~(\/[A-Za-z0-9._+-]+)+$/

function assertSafeSpec(spec: ToolScriptSpec): void {
  const ok =
    BIN_RE.test(spec.bin) &&
    (spec.altBin === undefined || BIN_RE.test(spec.altBin)) &&
    PROC_PATTERN_RE.test(spec.procPattern) &&
    spec.configCandidates.every((c) => CONFIG_CANDIDATE_RE.test(c)) &&
    (spec.version.kind !== 'flag' || FLAG_RE.test(spec.version.flag)) &&
    (spec.version.kind !== 'custom' ||
      (BIN_RE.test(spec.version.guardBin) && CUSTOM_CMD_RE.test(spec.version.command)))
  if (!ok) throw new Error(`Unsafe detector spec for tool ${spec.id}`)
}

function toolBlock(spec: ToolScriptSpec): string {
  assertSafeSpec(spec)
  const lines: string[] = [`printf '%s\\n' ${shellQuote(`TOOL:${spec.id}`)}`]
  lines.push(
    spec.altBin
      ? `p=$(command -v ${spec.bin} 2>/dev/null || command -v ${spec.altBin} 2>/dev/null) || p=`
      : `p=$(command -v ${spec.bin} 2>/dev/null) || p=`
  )
  lines.push(`printf '%s\\n' "PATH:$p"`)
  lines.push('v=')
  if (spec.version.kind === 'flag') {
    lines.push(`[ -n "$p" ] && v=$("$p" ${spec.version.flag} 2>&1 | head -n 1)`)
  } else if (spec.version.kind === 'custom') {
    lines.push(
      `command -v ${spec.version.guardBin} >/dev/null 2>&1 && ` +
        `v=$(${spec.version.command} 2>&1 | head -n 1)`
    )
  }
  lines.push(`printf '%s\\n' "VER:$v"`)
  const exact = spec.procExact ? '-x ' : ''
  lines.push(`n=$(pgrep -c ${exact}${shellQuote(spec.procPattern)} 2>/dev/null) || n=`)
  lines.push('[ -n "$n" ] || n=0')
  lines.push(`printf '%s\\n' "PROC:$n"`)
  for (const candidate of spec.configCandidates) {
    const p = `$HOME${candidate.slice(1)}`
    lines.push(`[ -e "${p}" ] && printf '%s\\n' "CFG:${p}"`)
  }
  return lines.join('\n')
}

export function buildToolsScript(specs: ReadonlyArray<ToolScriptSpec>): string {
  return `${specs.map(toolBlock).join('\n')}\n:\n`
}

/** Single extra call for tool-related user services; `|| :` keeps exit 0. */
export const USER_SERVICES_SCRIPT =
  'systemctl --user list-units --type=service --all --plain --no-legend --no-pager 2>/dev/null || :'

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')
const VERSION_RE = /v?(\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.~]+)?)/

/** Extract a dotted version number out of noisy version-command output. */
export function parseVersionLine(line: string): string | null {
  const cleaned = line.replace(ANSI_RE, '').trim()
  if (!cleaned) return null
  const match = VERSION_RE.exec(cleaned)
  return match ? match[1] : null
}

const NPM_ECOSYSTEM_TOOLS = new Set([
  'node',
  'npm',
  'pnpm',
  'yarn',
  'codex',
  'claude',
  'playwright'
])

/** Best-effort install method from where the executable lives (goal.md §6.5). */
export function inferInstallMethod(toolId: string, executablePath: string | null): string | null {
  if (!executablePath) return null
  const p = executablePath
  if (p.includes('/.nvm/')) return 'nvm'
  if (p.includes('/.bun/')) return 'bundled'
  if (p.includes('/.local/share/pipx/')) return 'pipx'
  if (p.includes('/.local/bin/')) return 'user-local'
  if (p.startsWith('/snap/') || p.includes('/snap/')) return 'snap'
  if (p.includes('/usr/local/lib/node_modules/')) return 'npm-global'
  if (p.startsWith('/usr/local/bin/')) {
    return NPM_ECOSYSTEM_TOOLS.has(toolId) ? 'npm-global' : 'unknown'
  }
  if (
    p.startsWith('/usr/bin/') ||
    p.startsWith('/bin/') ||
    p.startsWith('/usr/sbin/') ||
    p.startsWith('/sbin/')
  ) {
    return 'apt'
  }
  return 'unknown'
}

export interface ParsedToolSection {
  path: string | null
  versionLine: string | null
  processCount: number
  configPaths: string[]
}

function emptySection(): ParsedToolSection {
  return { path: null, versionLine: null, processCount: 0, configPaths: [] }
}

const orNull = (s: string): string | null => {
  const t = s.trim()
  return t.length > 0 ? t : null
}

export function parseToolsOutput(stdout: string): Map<string, ParsedToolSection> {
  const sections = new Map<string, ParsedToolSection>()
  let current: ParsedToolSection | null = null
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('TOOL:')) {
      const id = line.slice(5).trim()
      current = emptySection()
      if (id) sections.set(id, current)
      continue
    }
    if (!current) continue
    if (line.startsWith('PATH:')) {
      current.path = orNull(line.slice(5))
    } else if (line.startsWith('VER:')) {
      current.versionLine = orNull(line.slice(4))
    } else if (line.startsWith('PROC:')) {
      const n = Number.parseInt(line.slice(5).trim(), 10)
      current.processCount = Number.isFinite(n) && n > 0 ? n : 0
    } else if (line.startsWith('CFG:')) {
      const p = orNull(line.slice(4))
      if (p) current.configPaths.push(p)
    }
  }
  return sections
}

export function parseUserServiceUnits(stdout: string): string[] {
  const units: string[] = []
  for (const raw of stdout.split('\n')) {
    const cleaned = raw.replace(/^[^A-Za-z0-9]+/, '').trimEnd()
    if (!cleaned) continue
    const name = cleaned.split(/\s+/)[0]
    if (name && name.endsWith('.service')) units.push(name)
  }
  return units
}

function buildToolInfo(
  spec: ToolScriptSpec,
  section: ParsedToolSection | undefined,
  units: string[]
): ToolInfo {
  const executablePath = section?.path ?? null
  const version = section?.versionLine ? parseVersionLine(section.versionLine) : null
  const configPaths = section?.configPaths ?? []
  let installed = executablePath !== null || version !== null
  if (spec.id === 'playwright') {
    installed = executablePath !== null || configPaths.some((p) => p.includes('ms-playwright'))
  }
  return {
    id: spec.id,
    displayName: spec.displayName,
    installed,
    executablePath,
    version,
    installMethod: installed ? inferInstallMethod(spec.id, executablePath) : null,
    configPaths,
    runningProcesses: section?.processCount ?? 0,
    services: units.filter((u) => u.includes(spec.id))
  }
}

export async function runToolDetection(
  runner: DistroRunner,
  distro: string,
  specs: ReadonlyArray<ToolScriptSpec>
): Promise<ToolInfo[]> {
  assertValidDistroName(distro)
  const script = buildToolsScript(specs)
  const [batch, services] = await Promise.all([
    runner.runInDistro(distro, script, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS }),
    runner.runInDistro(distro, USER_SERVICES_SCRIPT).catch((): null => null)
  ])
  const sections = parseToolsOutput(batch.stdout)
  const units =
    services !== null && services.code === 0 && !services.timedOut
      ? parseUserServiceUnits(services.stdout)
      : []
  return specs.map((spec) => buildToolInfo(spec, sections.get(spec.id), units))
}
