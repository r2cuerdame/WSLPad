import { RUNNER_SLOW_TIMEOUT_MS, TOOL_SPECS } from '@shared/constants'
import type { ToolInfo } from '@shared/types'
import type { DistroRunner } from '../contracts'
import { assertValidDistroName, shellQuote } from '../escape'

/**
 * Installed Tools detection (goal.md §6.5). The whole catalog is probed by ONE
 * batched POSIX sh script through the Hidden Runner; a single extra call lists
 * user services. Output is a line protocol parsed here:
 *   TOOL:<id> / PATH:<command -v> / VER:<version line> / PROC:<count> / CFG:<path>
 *
 * Cost control, because the catalog is ~86 tools and the slow tier only has
 * RUNNER_SLOW_TIMEOUT_MS: the per-tool work is a shell function called with
 * arguments (so the script stays ~7 KB rather than ~30 KB), and every probe
 * that costs a fork — the version command and pgrep — runs ONLY after
 * `command -v` resolved the tool. An absent tool therefore costs one builtin
 * lookup. Version commands are additionally wrapped in `timeout` when the
 * distro has one, so a single pathological CLI cannot eat the whole budget.
 */

type VersionProbe =
  /** run `<resolved path> <args>`; args are split by the shell on purpose */
  | { kind: 'args'; args: string }
  /** run a fixed command line when `guardBin` resolves (docker compose plugin) */
  | { kind: 'custom'; guardBin: string; command: string }
  | { kind: 'none' }

export interface ToolScriptSpec {
  id: string
  displayName: string
  /** binary probed with command -v */
  bin: string
  /** fallback binaries tried in order; a `~/x` entry becomes "$HOME/x" */
  altBins: string[]
  version: VersionProbe
  /**
   * pgrep pattern matched against process NAMES only — never -f: the sh -c
   * command line contains every tool name and would self-match. null skips
   * pgrep entirely for tools that never run as a process worth counting.
   */
  procPattern: string | null
  procExact: boolean
  /** `~`- or `/`-rooted candidates existence-checked with test -e (CFG: lines) */
  configCandidates: string[]
  /**
   * Substrings of a found config path that on their own prove the tool is
   * installed — for tools that live in a directory rather than on PATH
   * (Playwright browsers, the VS Code server, an OpenClaw data dir).
   */
  installSignals: string[]
}

interface ToolConfigInit {
  bin: string
  alt?: string[]
  /** version arguments, e.g. '--version', '-v', 'version --client' */
  version?: string
  custom?: { guardBin: string; command: string }
  proc?: string
  exact?: boolean
  cfg?: string[]
  signals?: string[]
}

type ToolScriptConfig = Omit<ToolScriptSpec, 'id' | 'displayName'>

function cfgSpec(init: ToolConfigInit): ToolScriptConfig {
  const version: VersionProbe = init.custom
    ? { kind: 'custom', ...init.custom }
    : init.version !== undefined
      ? { kind: 'args', args: init.version }
      : { kind: 'none' }
  return {
    bin: init.bin,
    altBins: init.alt ?? [],
    version,
    procPattern: init.proc ?? null,
    procExact: init.exact ?? false,
    configCandidates: init.cfg ?? [],
    installSignals: init.signals ?? []
  }
}

/** Well-known roots for the two tools that are usually shell functions. */
const CONDA_BINS = [
  '~/miniconda3/bin/conda',
  '~/anaconda3/bin/conda',
  '~/miniforge3/bin/conda',
  '/opt/conda/bin/conda'
]
const BREW_BINS = ['/home/linuxbrew/.linuxbrew/bin/brew', '~/.linuxbrew/bin/brew']

const SCRIPT_CONFIG: Record<string, ToolConfigInit> = {
  // --- ai ---
  hermes: { bin: 'hermes', version: '--version', proc: 'hermes', cfg: ['~/.hermes'] },
  codex: { bin: 'codex', version: '--version', proc: 'codex', cfg: ['~/.codex'] },
  claude: {
    bin: 'claude',
    version: '--version',
    proc: 'claude',
    cfg: ['~/.claude', '~/.claude.json']
  },
  gemini: { bin: 'gemini', version: '--version', proc: 'gemini', exact: true, cfg: ['~/.gemini'] },
  openclaw: {
    bin: 'openclaw',
    version: '--version',
    proc: 'openclaw',
    exact: true,
    cfg: ['~/.openclaw'],
    signals: ['.openclaw']
  },
  ollama: { bin: 'ollama', version: '--version', proc: 'ollama', exact: true, cfg: ['~/.ollama'] },
  aider: {
    bin: 'aider',
    version: '--version',
    proc: 'aider',
    exact: true,
    cfg: ['~/.aider.conf.yml']
  },
  // --- runtime ---
  node: { bin: 'node', version: '-v', proc: 'node', exact: true, cfg: ['~/.npmrc'] },
  deno: { bin: 'deno', version: '--version', proc: 'deno', exact: true, cfg: ['~/.deno'] },
  bun: { bin: 'bun', version: '--version', proc: 'bun', exact: true, cfg: ['~/.bunfig.toml'] },
  python: {
    bin: 'python3',
    version: '--version',
    proc: 'python3.*',
    exact: true,
    cfg: ['~/.config/pip']
  },
  ruby: { bin: 'ruby', version: '--version', proc: 'ruby', exact: true, cfg: ['~/.gemrc'] },
  // `go --version` is not a thing: the subcommand is the only version surface.
  go: { bin: 'go', version: 'version', proc: 'go', exact: true, cfg: ['~/.config/go'] },
  rust: {
    bin: 'rustc',
    version: '--version',
    proc: 'rustc',
    exact: true,
    cfg: ['~/.rustup', '~/.cargo']
  },
  // java prints its version banner on STDERR — the probe merges 2>&1.
  java: { bin: 'java', version: '-version', proc: 'java', exact: true, cfg: [] },
  dotnet: {
    bin: 'dotnet',
    version: '--version',
    proc: 'dotnet',
    exact: true,
    cfg: ['~/.dotnet', '~/.nuget']
  },
  php: { bin: 'php', version: '--version', proc: 'php', exact: true, cfg: ['~/.config/php'] },
  // --- package ---
  npm: { bin: 'npm', version: '-v', proc: 'npm', exact: true, cfg: ['~/.npmrc'] },
  pnpm: { bin: 'pnpm', version: '-v', proc: 'pnpm', exact: true, cfg: ['~/.npmrc'] },
  yarn: {
    bin: 'yarn',
    version: '-v',
    proc: 'yarn',
    exact: true,
    cfg: ['~/.yarnrc', '~/.yarnrc.yml']
  },
  pip: {
    bin: 'pip3',
    alt: ['pip'],
    version: '--version',
    proc: 'pip3?',
    exact: true,
    cfg: ['~/.config/pip/pip.conf', '~/.pip/pip.conf']
  },
  pipx: { bin: 'pipx', version: '--version', cfg: ['~/.local/share/pipx'] },
  uv: { bin: 'uv', version: '--version', proc: 'uv', exact: true, cfg: ['~/.config/uv'] },
  poetry: { bin: 'poetry', version: '--version', cfg: ['~/.config/pypoetry'] },
  conda: {
    bin: 'conda',
    alt: CONDA_BINS,
    version: '--version',
    cfg: ['~/.condarc', '~/miniconda3', '~/anaconda3', '~/miniforge3', '/opt/conda'],
    signals: ['miniconda3', 'anaconda3', 'miniforge3', '/opt/conda']
  },
  cargo: {
    bin: 'cargo',
    version: '--version',
    proc: 'cargo',
    exact: true,
    cfg: ['~/.cargo/config.toml']
  },
  gem: { bin: 'gem', version: '--version', cfg: ['~/.gemrc'] },
  composer: { bin: 'composer', version: '--version', cfg: ['~/.config/composer'] },
  maven: { bin: 'mvn', version: '-version', cfg: ['~/.m2'] },
  gradle: { bin: 'gradle', version: '--version', cfg: ['~/.gradle'] },
  brew: {
    bin: 'brew',
    alt: BREW_BINS,
    version: '--version',
    cfg: ['/home/linuxbrew/.linuxbrew', '~/.linuxbrew'],
    signals: ['linuxbrew']
  },
  // --- vcs ---
  git: {
    bin: 'git',
    version: '--version',
    proc: 'git',
    exact: true,
    cfg: ['~/.gitconfig', '~/.config/git/config']
  },
  'git-lfs': { bin: 'git-lfs', version: 'version', cfg: [] },
  gh: { bin: 'gh', version: '--version', cfg: ['~/.config/gh'] },
  svn: { bin: 'svn', version: '--version', cfg: ['~/.subversion'] },
  // --- container ---
  docker: { bin: 'docker', version: '--version', proc: 'docker', cfg: ['~/.docker'] },
  'docker-compose': {
    bin: 'docker-compose',
    // compose v2 is a docker plugin without its own binary on PATH
    custom: { guardBin: 'docker', command: 'docker compose version' },
    proc: 'docker-compose',
    cfg: ['~/.docker']
  },
  podman: { bin: 'podman', version: '--version', proc: 'podman', cfg: ['~/.config/containers'] },
  // `version --client --short` was removed in kubectl 1.28; plain --client
  // prints one client line on every release still in the wild.
  kubectl: {
    bin: 'kubectl',
    version: 'version --client',
    proc: 'kubectl',
    exact: true,
    cfg: ['~/.kube/config']
  },
  helm: { bin: 'helm', version: 'version --short', cfg: ['~/.config/helm'] },
  k9s: { bin: 'k9s', version: 'version', proc: 'k9s', exact: true, cfg: ['~/.config/k9s'] },
  // --- cloud ---
  aws: { bin: 'aws', version: '--version', cfg: ['~/.aws'] },
  gcloud: { bin: 'gcloud', version: '--version', cfg: ['~/.config/gcloud'] },
  az: { bin: 'az', version: 'version', cfg: ['~/.azure'] },
  terraform: { bin: 'terraform', version: 'version', cfg: ['~/.terraform.d'] },
  ansible: { bin: 'ansible', version: '--version', cfg: ['~/.ansible.cfg', '~/.ansible'] },
  ssh: { bin: 'ssh', version: '-V', proc: 'ssh', exact: true, cfg: ['~/.ssh/config'] },
  // --- build ---
  gcc: { bin: 'gcc', version: '--version', cfg: [] },
  make: { bin: 'make', version: '--version', proc: 'make', exact: true, cfg: [] },
  cmake: { bin: 'cmake', version: '--version', cfg: [] },
  clang: { bin: 'clang', version: '--version', cfg: [] },
  ninja: { bin: 'ninja', version: '--version', proc: 'ninja', exact: true, cfg: [] },
  'pkg-config': { bin: 'pkg-config', version: '--version', cfg: [] },
  // --- database ---
  sqlite3: { bin: 'sqlite3', version: '--version', cfg: ['~/.sqliterc'] },
  psql: { bin: 'psql', version: '--version', proc: 'psql', exact: true, cfg: ['~/.psqlrc'] },
  mysql: { bin: 'mysql', version: '--version', proc: 'mysql', exact: true, cfg: ['~/.my.cnf'] },
  'redis-cli': { bin: 'redis-cli', version: '--version', proc: 'redis-cli', exact: true, cfg: [] },
  mongosh: { bin: 'mongosh', version: '--version', proc: 'mongosh', exact: true, cfg: [] },
  // --- editor ---
  vim: { bin: 'vim', version: '--version', proc: 'vim', exact: true, cfg: ['~/.vimrc'] },
  neovim: {
    bin: 'nvim',
    version: '--version',
    proc: 'nvim',
    exact: true,
    cfg: ['~/.config/nvim']
  },
  nano: { bin: 'nano', version: '--version', proc: 'nano', exact: true, cfg: ['~/.nanorc'] },
  emacs: { bin: 'emacs', version: '--version', proc: 'emacs', exact: true, cfg: ['~/.emacs.d'] },
  // The VS Code server is a directory, not a binary: `code` in WSL shells out
  // to the Windows client, which is far too slow to version on every poll.
  code: {
    bin: 'code',
    cfg: ['~/.vscode-server', '~/.vscode-server-insiders'],
    signals: ['.vscode-server']
  },
  tmux: { bin: 'tmux', version: '-V', proc: 'tmux', exact: true, cfg: ['~/.tmux.conf'] },
  zsh: { bin: 'zsh', version: '--version', proc: 'zsh', exact: true, cfg: ['~/.zshrc'] },
  fish: { bin: 'fish', version: '--version', proc: 'fish', exact: true, cfg: ['~/.config/fish'] },
  starship: { bin: 'starship', version: '--version', cfg: ['~/.config/starship.toml'] },
  // --- media ---
  ffmpeg: { bin: 'ffmpeg', version: '--version', proc: 'ffmpeg', exact: true, cfg: [] },
  // ImageMagick 7 ships `magick`; `convert` is the v6 name and is also the
  // shim v7 installs, so it stays the fallback rather than the probe.
  imagemagick: { bin: 'magick', alt: ['convert'], version: '-version', cfg: [] },
  'yt-dlp': { bin: 'yt-dlp', version: '--version', cfg: ['~/.config/yt-dlp'] },
  pandoc: { bin: 'pandoc', version: '--version', cfg: [] },
  tesseract: { bin: 'tesseract', version: '--version', cfg: [] },
  // --- util ---
  ripgrep: { bin: 'rg', version: '--version', proc: 'rg', exact: true, cfg: ['~/.ripgreprc'] },
  fd: { bin: 'fd', alt: ['fdfind'], version: '--version', cfg: [] },
  fzf: { bin: 'fzf', version: '--version', cfg: [] },
  bat: { bin: 'bat', alt: ['batcat'], version: '--version', cfg: ['~/.config/bat'] },
  eza: { bin: 'eza', version: '--version', cfg: [] },
  jq: { bin: 'jq', version: '--version', cfg: [] },
  yq: { bin: 'yq', version: '--version', cfg: [] },
  htop: { bin: 'htop', version: '--version', proc: 'htop', exact: true, cfg: ['~/.config/htop'] },
  curl: { bin: 'curl', version: '--version', proc: 'curl', exact: true, cfg: ['~/.curlrc'] },
  wget: { bin: 'wget', version: '--version', proc: 'wget', exact: true, cfg: ['~/.wgetrc'] },
  rsync: { bin: 'rsync', version: '--version', proc: 'rsync', exact: true, cfg: [] },
  direnv: { bin: 'direnv', version: 'version', cfg: ['~/.config/direnv'] },
  playwright: {
    // `npx playwright --version` is too slow for polling; the browser cache
    // dir existing is the install signal instead.
    bin: 'playwright',
    proc: 'playwright',
    cfg: ['~/.cache/ms-playwright'],
    signals: ['ms-playwright']
  },
  chromium: {
    bin: 'chromium',
    alt: ['chromium-browser'],
    version: '--version',
    proc: 'chrom',
    cfg: ['~/.config/chromium']
  }
}

/**
 * Probe set = catalog entries that have a detector config, in catalog order.
 * TOOL_SPECS is the wider published catalog, so an entry with no probe yet is
 * skipped instead of crashing the collector; adding its config here is all it
 * takes to make it detected.
 */
export const TOOL_SCRIPT_SPECS: ToolScriptSpec[] = TOOL_SPECS.flatMap((t) => {
  const init = SCRIPT_CONFIG[t.id]
  return init ? [{ id: t.id, displayName: t.displayName, ...cfgSpec(init) }] : []
})

// Static spec fragments are embedded into the script unquoted where $HOME must
// expand or where the shell must word-split them, so they are allowlist-checked
// to keep the script injection-proof even if a future spec edit introduces odd
// characters.
const BIN_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/
const PATH_RE = /^~?(\/[A-Za-z0-9._+-]+)+$/
const ARGS_RE = /^-{0,2}[A-Za-z][A-Za-z0-9-]*( -{0,2}[A-Za-z][A-Za-z0-9-]*)*$/
const CUSTOM_CMD_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/
const PROC_PATTERN_RE = /^[A-Za-z0-9][A-Za-z0-9.?*|_-]*$/

function assertSafeSpec(spec: ToolScriptSpec): void {
  const ok =
    BIN_RE.test(spec.bin) &&
    spec.altBins.every((a) => BIN_RE.test(a) || PATH_RE.test(a)) &&
    (spec.procPattern === null || PROC_PATTERN_RE.test(spec.procPattern)) &&
    spec.configCandidates.every((c) => PATH_RE.test(c)) &&
    (spec.version.kind !== 'args' || ARGS_RE.test(spec.version.args)) &&
    (spec.version.kind !== 'custom' ||
      (BIN_RE.test(spec.version.guardBin) && CUSTOM_CMD_RE.test(spec.version.command)))
  if (!ok) throw new Error(`Unsafe detector spec for tool ${spec.id}`)
}

/** `~/x` must reach the shell as an expandable "$HOME/x", not a literal tilde. */
function homePath(candidate: string): string {
  return candidate.startsWith('~') ? `$HOME${candidate.slice(1)}` : candidate
}

/**
 * The preamble first drops the Windows drive mounts that WSL appends to PATH:
 * every tool that is NOT installed otherwise stat-walks ~48 of them over the
 * 9p mount at ~95 ms a piece — measured at 9 s for the whole catalog, 0.6 s
 * once they are gone. W() gets those directories back at the end, reading each
 * one once with a glob instead of one PATH walk per tool, so a tool that only
 * exists on the Windows side is still reported (as `windows-interop`) for
 * ~150 ms and no forks: ~0.9 s for the whole catalog.
 *
 * Per-tool work as shell functions so the emitted script stays small:
 *   V  version command, bounded by `timeout` when the distro has one, first
 *      output line that looks like a version wins (gradle and k9s print a
 *      banner first, java prints to stderr).
 *   T  one tool: id, bin, fallback bins, version args, pgrep pattern, -x flag.
 *   Q  fallback version for a plugin-style tool with no binary of its own; it
 *      reads the $v the preceding T left behind and stays quiet if it is set.
 *   C  config/install path probe (a builtin test, so it costs nothing).
 *   W  Windows-interop sweep for the '|name|name|' list it is handed.
 */
const SCRIPT_PREAMBLE = `op=$PATH
np=
IFS=:
set -f
set -- $PATH
set +f
unset IFS
for d in "$@"; do
  case $d in /mnt/[A-Za-z] | /mnt/[A-Za-z]/*) continue ;; esac
  np=\${np:+$np:}$d
done
[ -n "$np" ] && PATH=$np
w=
timeout 1 true 2>/dev/null && w='timeout 5'
V() { $w "$@" 2>&1 | awk 'NR>20{exit}/[0-9]+[.][0-9]/{print;exit}'; }
T() {
  printf '%s\\n' "TOOL:$1"
  p=$(command -v "$2" 2>/dev/null) || p=
  if [ -z "$p" ] && [ -n "$3" ]; then
    for a in $3; do
      p=$(command -v "$a" 2>/dev/null) && break
      p=
    done
  fi
  printf '%s\\n' "PATH:$p"
  v=
  [ -n "$p" ] && [ -n "$4" ] && v=$(V "$p" $4)
  printf '%s\\n' "VER:$v"
  n=0
  [ -n "$p" ] && [ -n "$5" ] && { n=$(pgrep -c $6 "$5" 2>/dev/null) || n=0; }
  printf '%s\\n' "PROC:$n"
}
Q() {
  [ -n "$v" ] && return 0
  command -v "$1" >/dev/null 2>&1 || return 0
  v=$(V $2)
  [ -n "$v" ] && printf '%s\\n' "VER:$v"
  return 0
}
C() { [ -e "$1" ] && printf '%s\\n' "CFG:$1"; return 0; }
W() {
  m=$1
  IFS=:
  set -f
  set -- $op
  set +f
  unset IFS
  for d in "$@"; do
    case $d in /mnt/[A-Za-z] | /mnt/[A-Za-z]/*) ;; *) continue ;; esac
    for f in "$d"/*; do
      case "$m" in *"|\${f##*/}|"*) printf '%s\\n' "WIN:$f" ;; esac
    done
  done
  return 0
}
`

function toolBlock(spec: ToolScriptSpec): string {
  assertSafeSpec(spec)
  const alts = spec.altBins.map(homePath).join(' ')
  const versionArgs = spec.version.kind === 'args' ? spec.version.args : ''
  const lines = [
    [
      'T',
      shellQuote(spec.id),
      shellQuote(spec.bin),
      `"${alts}"`,
      shellQuote(versionArgs),
      shellQuote(spec.procPattern ?? ''),
      shellQuote(spec.procPattern !== null && spec.procExact ? '-x' : '')
    ].join(' ')
  ]
  if (spec.version.kind === 'custom') {
    lines.push(`Q ${shellQuote(spec.version.guardBin)} ${shellQuote(spec.version.command)}`)
  }
  for (const candidate of spec.configCandidates) {
    lines.push(`C "${homePath(candidate)}"`)
  }
  return lines.join('\n')
}

/** `|name|name|` list of every binary the sweep should recognise. */
function interopNameList(specs: ReadonlyArray<ToolScriptSpec>): string {
  const names = new Set<string>()
  for (const spec of specs) {
    for (const name of [spec.bin, ...spec.altBins]) {
      if (BIN_RE.test(name)) names.add(name)
    }
  }
  return `|${[...names].join('|')}|`
}

export function buildToolsScript(specs: ReadonlyArray<ToolScriptSpec>): string {
  const blocks = specs.map(toolBlock).join('\n')
  return `${SCRIPT_PREAMBLE}${blocks}\nW ${shellQuote(interopNameList(specs))}\n:\n`
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
  'gemini',
  'openclaw',
  'playwright'
])

/** Best-effort install method from where the executable lives (goal.md §6.5). */
export function inferInstallMethod(toolId: string, executablePath: string | null): string | null {
  if (!executablePath) return null
  const p = executablePath
  if (p.includes('/.nvm/')) return 'nvm'
  if (p.includes('/.bun/')) return 'bundled'
  if (p.includes('/linuxbrew/')) return 'brew'
  if (p.includes('/.cargo/bin/')) return 'cargo'
  if (p.includes('conda3/') || p.startsWith('/opt/conda/')) return 'conda'
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
      // A tool may emit a second VER line from its fallback probe; an empty
      // one never erases a version that was already found.
      current.versionLine = orNull(line.slice(4)) ?? current.versionLine
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

/**
 * Windows-side binaries reachable through interop, keyed by file name. They
 * live outside the tool sections because one sweep serves the whole catalog.
 */
export function parseInteropBinaries(stdout: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (!line.startsWith('WIN:')) continue
    const path = line.slice(4).trim()
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (name && !found.has(name)) found.set(name, path)
  }
  return found
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

/**
 * A unit belongs to a tool when its name IS the tool or is prefixed by it —
 * a plain substring match would hand `mongodb.service` to `go` now that the
 * catalog has two-letter ids.
 */
function serviceMatchesTool(unit: string, toolId: string): boolean {
  const base = unit.slice(0, -'.service'.length)
  if (base === toolId) return true
  const rest = base.startsWith(toolId) ? base.slice(toolId.length) : ''
  return rest.length > 0 && /^[-_@.]/.test(rest)
}

/** The Windows binary a tool would resolve to when the distro has none. */
function interopPath(spec: ToolScriptSpec, interop: Map<string, string>): string | null {
  for (const name of [spec.bin, ...spec.altBins]) {
    const found = interop.get(name)
    if (found) return found
  }
  return null
}

function buildToolInfo(
  spec: ToolScriptSpec,
  section: ParsedToolSection | undefined,
  units: string[],
  interop: Map<string, string>
): ToolInfo {
  const linuxPath = section?.path ?? null
  const version = section?.versionLine ? parseVersionLine(section.versionLine) : null
  const configPaths = section?.configPaths ?? []
  // Windows binaries are never run to read a version: a background poll must
  // not spawn host processes, so an interop tool reports its path only.
  const fromWindows = linuxPath === null && version === null ? interopPath(spec, interop) : null
  const executablePath = linuxPath ?? fromWindows
  const installed =
    executablePath !== null ||
    version !== null ||
    configPaths.some((p) => spec.installSignals.some((signal) => p.includes(signal)))
  const installMethod =
    fromWindows !== null ? 'windows-interop' : inferInstallMethod(spec.id, linuxPath)
  return {
    id: spec.id,
    displayName: spec.displayName,
    installed,
    executablePath,
    version,
    installMethod: installed ? installMethod : null,
    configPaths,
    runningProcesses: section?.processCount ?? 0,
    services: units.filter((u) => serviceMatchesTool(u, spec.id))
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
  const interop = parseInteropBinaries(batch.stdout)
  const units =
    services !== null && services.code === 0 && !services.timedOut
      ? parseUserServiceUnits(services.stdout)
      : []
  return specs.map((spec) => buildToolInfo(spec, sections.get(spec.id), units, interop))
}
