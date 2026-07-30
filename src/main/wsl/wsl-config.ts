/**
 * Declared versus effective WSL settings (goal.md §6.4).
 *
 * `wsl --status` reports the default distro and the kernel version and nothing
 * else: not the networking mode, not the memory ceiling, not whether .wslconfig
 * was read at all. Keys also migrated between [experimental] and [wsl2] as they
 * graduated, so a file that worked in 2023 can be silently inert today. This
 * collector parses both configuration files, probes what the running system
 * actually exhibits, and reports the difference — it never writes either file.
 */
import { readFile, stat } from 'fs/promises'
import { RUNNER_SLOW_TIMEOUT_MS, RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { SettingVerdict, WslConfigInfo, WslSettingInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'
import { assertValidDistroName } from './escape'
import { SECTION_MARKER, splitSections } from './system'

export const WSL_CONF_PATH = '/etc/wsl.conf'

const KIB = 1024
const MIB = 1024 * 1024
const GIB = 1024 * 1024 * 1024

/**
 * Filesystem timestamps and the derived boot instant come from two clocks, and
 * mtime granularity is coarse, so a file has to be clearly newer than the VM
 * before it counts as pending.
 */
const RESTART_GRACE_MS = 5000

// ---------------------------------------------------------------------------
// INI parsing
// ---------------------------------------------------------------------------

export interface IniEntry {
  /** Lowercased section name; '' for a key written before any [section]. */
  section: string
  /** Key verbatim as written, so a case mistake stays visible. */
  key: string
  /** Value with surrounding whitespace and any trailing comment removed. */
  value: string
  /** 1-based source line, so a duplicate can be pointed at precisely. */
  line: number
}

/**
 * A comment marker only counts at the start of a line or after whitespace, so
 * a '#' inside a value (a kernel command line, a hostname) survives.
 */
function stripComment(line: string): string {
  const match = /(^|\s)[;#]/.exec(line)
  return match === null ? line : line.slice(0, match.index)
}

/**
 * Tolerant INI reader for .wslconfig and /etc/wsl.conf. Duplicates are all
 * returned in file order — deciding which one wins is the reconciler's job, and
 * reporting the duplicate is half the value.
 */
export function parseIni(text: string): IniEntry[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const out: IniEntry[] = []
  let section = ''
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i].replace(/\r$/, '')).trim()
    if (line === '') continue
    const header = /^\[(.*)\]$/.exec(line)
    if (header !== null) {
      section = header[1].trim().toLowerCase()
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (key === '') continue
    out.push({ section, key, value: line.slice(eq + 1).trim(), line: i + 1 })
  }
  return out
}

/** Notepad still writes UTF-16; a mis-decoded .wslconfig would parse as empty. */
export function decodeConfigFile(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2)
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return Buffer.from(buf.subarray(2)).swap16().toString('utf16le')
  }
  return buf.toString('utf8')
}

// ---------------------------------------------------------------------------
// Known-key catalog
// ---------------------------------------------------------------------------

export interface KnownKey {
  key: string
  /** Section the installed generation of WSL reads the key from. */
  section: string
  scope: 'windows' | 'linux'
  /** Documented default; null when it depends on the host and is probed. */
  defaultValue: string | null
  /** Sections older releases read this key from — the silent-migration trap. */
  movedFrom?: readonly string[]
  /** First WSL release that understands the key. */
  since?: string
  /** Short English explanation shown on the row. */
  note?: string
}

/**
 * Documented settings, their canonical section and their defaults. Where a
 * default depends on the host it is left null and probed instead, so the table
 * never shows an invented number.
 */
export const KNOWN_KEYS: readonly KnownKey[] = [
  // --- .wslconfig [wsl2] ---
  {
    key: 'kernel',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: null,
    note: 'Absolute Windows path to a custom kernel; WSL uses its bundled kernel when unset.'
  },
  {
    key: 'kernelCommandLine',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: null,
    note: 'Extra kernel command line; empty by default.'
  },
  {
    key: 'memory',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: null,
    note: 'Defaults to 50% of host memory (capped at 8GB on Windows builds before 20175).'
  },
  {
    key: 'processors',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: null,
    note: 'Defaults to every logical processor on the host.'
  },
  {
    key: 'swap',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: null,
    note: 'Defaults to 25% of the memory limit, rounded up to the nearest gigabyte.'
  },
  {
    key: 'swapFile',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: '%USERPROFILE%\\AppData\\Local\\Temp\\swap.vhdx'
  },
  { key: 'localhostForwarding', section: 'wsl2', scope: 'windows', defaultValue: 'true' },
  { key: 'pageReporting', section: 'wsl2', scope: 'windows', defaultValue: 'true' },
  { key: 'nestedVirtualization', section: 'wsl2', scope: 'windows', defaultValue: 'true' },
  { key: 'debugConsole', section: 'wsl2', scope: 'windows', defaultValue: 'false' },
  { key: 'guiApplications', section: 'wsl2', scope: 'windows', defaultValue: 'true' },
  { key: 'safeMode', section: 'wsl2', scope: 'windows', defaultValue: 'false' },
  {
    key: 'vmIdleTimeout',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: '60000',
    note: 'Milliseconds the utility VM stays alive after the last distribution exits.'
  },
  {
    key: 'defaultVhdSize',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: '1099511627776',
    note: 'Maximum size of a new virtual disk, in bytes (1TB by default).'
  },
  {
    key: 'networkingMode',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: 'nat',
    movedFrom: ['experimental'],
    since: '2.0.0'
  },
  {
    key: 'firewall',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: 'true',
    movedFrom: ['experimental'],
    since: '2.0.9'
  },
  {
    key: 'dnsTunneling',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: 'true',
    movedFrom: ['experimental'],
    since: '2.0.0',
    note: 'Enabled by default on current releases; older builds shipped it disabled.'
  },
  {
    key: 'autoProxy',
    section: 'wsl2',
    scope: 'windows',
    defaultValue: 'true',
    movedFrom: ['experimental'],
    since: '2.0.0',
    note: 'Enabled by default on current releases; older builds shipped it disabled.'
  },
  // --- .wslconfig [experimental] ---
  {
    key: 'autoMemoryReclaim',
    section: 'experimental',
    scope: 'windows',
    defaultValue: 'disabled',
    since: '2.0.0',
    note: 'Accepts disabled, gradual or dropcache.'
  },
  {
    key: 'sparseVhd',
    section: 'experimental',
    scope: 'windows',
    defaultValue: 'false',
    since: '2.0.0'
  },
  { key: 'useWindowsDnsCache', section: 'experimental', scope: 'windows', defaultValue: 'false' },
  { key: 'bestEffortDnsParsing', section: 'experimental', scope: 'windows', defaultValue: 'false' },
  { key: 'hostAddressLoopback', section: 'experimental', scope: 'windows', defaultValue: 'false' },
  {
    key: 'ignoredPorts',
    section: 'experimental',
    scope: 'windows',
    defaultValue: null,
    note: 'Comma-separated ports the guest keeps for itself under mirrored networking.'
  },
  // --- /etc/wsl.conf ---
  { key: 'systemd', section: 'boot', scope: 'linux', defaultValue: 'false', since: '0.67.6' },
  {
    key: 'command',
    section: 'boot',
    scope: 'linux',
    defaultValue: null,
    note: 'Runs as root at distribution start; empty by default.'
  },
  { key: 'enabled', section: 'automount', scope: 'linux', defaultValue: 'true' },
  { key: 'root', section: 'automount', scope: 'linux', defaultValue: '/mnt/' },
  {
    key: 'options',
    section: 'automount',
    scope: 'linux',
    defaultValue: null,
    note: 'Extra DrvFs mount options such as metadata or umask; empty by default.'
  },
  { key: 'mountFsTab', section: 'automount', scope: 'linux', defaultValue: 'true' },
  { key: 'generateHosts', section: 'network', scope: 'linux', defaultValue: 'true' },
  { key: 'generateResolvConf', section: 'network', scope: 'linux', defaultValue: 'true' },
  {
    key: 'hostname',
    section: 'network',
    scope: 'linux',
    defaultValue: null,
    note: 'Defaults to the Windows host name.'
  },
  { key: 'enabled', section: 'interop', scope: 'linux', defaultValue: 'true' },
  { key: 'appendWindowsPath', section: 'interop', scope: 'linux', defaultValue: 'true' },
  {
    key: 'default',
    section: 'user',
    scope: 'linux',
    defaultValue: null,
    note: 'Defaults to the user created when the distribution was installed.'
  }
]

/** Section display order; anything unknown sorts last. */
const SECTION_ORDER = ['wsl2', 'experimental', 'boot', 'automount', 'network', 'interop', 'user']

/** Every catalog entry sharing a key name — 'enabled' exists twice, on purpose. */
export function findKnownKeys(key: string): KnownKey[] {
  const lower = key.toLowerCase()
  return KNOWN_KEYS.filter((k) => k.key.toLowerCase() === lower)
}

/** Levenshtein distance, capped: only used to suggest a fix for a typo. */
function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1)
  const cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
  }
  return prev[b.length]
}

/** Closest documented key within two edits — 'memroy' → 'memory'. */
export function suggestKey(key: string, scope: 'windows' | 'linux'): string | null {
  const lower = key.toLowerCase()
  let best: string | null = null
  let bestDistance = 3
  for (const known of KNOWN_KEYS) {
    if (known.scope !== scope) continue
    const distance = editDistance(lower, known.key.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = known.key
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// WSL version
// ---------------------------------------------------------------------------

/** First version-looking token of `wsl --version`; the labels are localized. */
export function parseWslVersion(text: string): string | null {
  for (const line of text.split('\n')) {
    const match = /(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(line)
    if (match !== null) return match[1]
  }
  return null
}

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((p) => Number.parseInt(p, 10))
  const right = b.split('.').map((p) => Number.parseInt(p, 10))
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = Number.isFinite(left[i]) ? left[i] : 0
    const r = Number.isFinite(right[i]) ? right[i] : 0
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// In-distro probes
// ---------------------------------------------------------------------------

// One round trip, marker separated so a failing probe cannot corrupt its
// neighbours. Every command is a read: cat, stat, ps, nproc, uname.
const PROBES = [
  `cat ${WSL_CONF_PATH} 2>/dev/null || true`,
  `if [ -e ${WSL_CONF_PATH} ]; then echo 1; else echo 0; fi`,
  `stat -c %Y ${WSL_CONF_PATH} 2>/dev/null || true`,
  'cat /proc/uptime 2>/dev/null || true',
  'command -v wslinfo >/dev/null 2>&1 && wslinfo --networking-mode 2>/dev/null || true',
  'ps -p 1 -o comm= 2>/dev/null || true',
  'systemctl is-system-running 2>/dev/null || true',
  'nproc 2>/dev/null || true',
  "grep -E '^(MemTotal|SwapTotal):' /proc/meminfo 2>/dev/null || true",
  'cat /proc/mounts 2>/dev/null || true',
  'printf %s\\\\n "$PATH"',
  'id -un 2>/dev/null || true',
  'uname -r 2>/dev/null || true',
  'if [ -e /dev/kvm ]; then echo 1; else echo 0; fi',
  'hostname 2>/dev/null || true',
  'head -n 1 /etc/resolv.conf 2>/dev/null || true',
  'head -n 1 /etc/hosts 2>/dev/null || true'
]

export function buildWslConfigScript(): string {
  return PROBES.join(`\nprintf '\\n${SECTION_MARKER}\\n'\n`)
}

export interface MountEntry {
  source: string
  point: string
  type: string
}

/** /proc/mounts rows, with the octal escaping the kernel applies undone. */
export function parseMounts(text: string): MountEntry[] {
  const out: MountEntry[] = []
  for (const raw of text.split('\n')) {
    const fields = raw.trim().split(/\s+/)
    if (fields.length < 3 || fields[1] === '') continue
    const point = fields[1].replace(/\\(\d{3})/g, (_m, oct: string) =>
      String.fromCharCode(Number.parseInt(oct, 8))
    )
    if (!point.startsWith('/')) continue
    out.push({ source: fields[0], point, type: fields[2] })
  }
  return out
}

export interface WslObservations {
  /** Raw /etc/wsl.conf text; '' when the file is absent or unreadable. */
  wslConfText: string
  wslConfExists: boolean
  /** Epoch ms of the wsl.conf mtime, converted from the guest's epoch seconds. */
  wslConfMtimeMs: number | null
  uptimeSeconds: number | null
  networkingMode: string | null
  pid1Comm: string | null
  systemState: string | null
  processors: string | null
  memTotalBytes: number | null
  swapTotalBytes: number | null
  /** null when /proc/mounts could not be read at all — not the same as none. */
  drvfsRoots: string[] | null
  wslgMounted: boolean | null
  path: string | null
  user: string | null
  kernelRelease: string | null
  kvm: boolean | null
  hostname: string | null
  resolvConfHeader: string | null
  hostsHeader: string | null
}

export function emptyObservations(): WslObservations {
  return {
    wslConfText: '',
    wslConfExists: false,
    wslConfMtimeMs: null,
    uptimeSeconds: null,
    networkingMode: null,
    pid1Comm: null,
    systemState: null,
    processors: null,
    memTotalBytes: null,
    swapTotalBytes: null,
    drvfsRoots: null,
    wslgMounted: null,
    path: null,
    user: null,
    kernelRelease: null,
    kvm: null,
    hostname: null,
    resolvConfHeader: null,
    hostsHeader: null
  }
}

function firstLine(section: string | undefined): string | null {
  if (section === undefined) return null
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return null
}

function kbLine(text: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'mi').exec(text)
  return match === null ? null : Number.parseInt(match[1], 10) * KIB
}

/** Parse the marker-separated probe output; every field degrades on its own. */
export function parseObservations(text: string): WslObservations {
  const s = splitSections(text)
  const obs = emptyObservations()
  obs.wslConfText = s[0] ?? ''
  obs.wslConfExists = firstLine(s[1]) === '1'
  if (!obs.wslConfExists) obs.wslConfText = ''

  const mtime = firstLine(s[2])
  if (mtime !== null && /^\d+$/.test(mtime)) obs.wslConfMtimeMs = Number.parseInt(mtime, 10) * 1000

  const uptime = firstLine(s[3])
  if (uptime !== null) {
    const value = Number.parseFloat(uptime.split(/\s+/)[0])
    if (Number.isFinite(value) && value >= 0) obs.uptimeSeconds = value
  }

  const mode = firstLine(s[4])
  if (mode !== null && /^[A-Za-z]+$/.test(mode)) obs.networkingMode = mode.toLowerCase()

  obs.pid1Comm = firstLine(s[5])
  obs.systemState = firstLine(s[6])

  const nproc = firstLine(s[7])
  if (nproc !== null && /^\d+$/.test(nproc)) obs.processors = nproc

  obs.memTotalBytes = kbLine(s[8] ?? '', 'MemTotal')
  obs.swapTotalBytes = kbLine(s[8] ?? '', 'SwapTotal')

  const mountText = s[9] ?? ''
  if (mountText.trim() !== '') {
    const mounts = parseMounts(mountText)
    obs.drvfsRoots = mounts
      .filter((m) => m.source === 'drvfs' || m.type === 'drvfs')
      .map((m) => m.point)
    obs.wslgMounted = mounts.some(
      (m) => m.point === '/mnt/wslg' || m.point.startsWith('/mnt/wslg/')
    )
  }

  obs.path = firstLine(s[10])
  obs.user = firstLine(s[11])
  obs.kernelRelease = firstLine(s[12])

  const kvm = firstLine(s[13])
  if (kvm === '1' || kvm === '0') obs.kvm = kvm === '1'

  obs.hostname = firstLine(s[14])
  obs.resolvConfHeader = firstLine(s[15])
  obs.hostsHeader = firstLine(s[16])
  return obs
}

// ---------------------------------------------------------------------------
// Value comparison
// ---------------------------------------------------------------------------

const TRUE_WORDS = ['true', '1', 'yes', 'on', 'enabled']
const FALSE_WORDS = ['false', '0', 'no', 'off', 'disabled']

export function normalizeBool(value: string): string | null {
  const lower = value.trim().toLowerCase()
  if (TRUE_WORDS.includes(lower)) return 'true'
  if (FALSE_WORDS.includes(lower)) return 'false'
  return null
}

/** WSL size syntax: 8GB, 512MB, 1024, 16 gb. */
export function parseSize(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i.exec(value.trim())
  if (match === null) return null
  const scale: Record<string, number> = { '': 1, k: KIB, m: MIB, g: GIB, t: GIB * 1024 }
  const unit = scale[match[2].toLowerCase()]
  if (unit === undefined) return null
  return Math.round(Number.parseFloat(match[1]) * unit)
}

function formatSize(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes === 0) return '0'
  if (bytes >= GIB) {
    return bytes % GIB === 0 ? `${bytes / GIB}GB` : `${(bytes / GIB).toFixed(1)}GB`
  }
  return bytes % MIB === 0 ? `${bytes / MIB}MB` : `${Math.round(bytes / MIB)}MB`
}

/**
 * The guest never sees the whole configured ceiling — the kernel keeps a slice
 * for itself — so a memory or swap ceiling matches when the observed total sits
 * just under it rather than exactly on it.
 */
function sizeMatches(declared: number, effective: number): boolean {
  return effective <= declared * 1.02 && effective >= declared * 0.8
}

/** Does the observed value satisfy what the file declared? */
export function valuesMatch(key: string, declared: string, effective: string): boolean {
  const lower = key.toLowerCase()
  if (lower === 'memory' || lower === 'swap') {
    const a = parseSize(declared)
    const b = parseSize(effective)
    return a !== null && b !== null && (a === 0 ? b === 0 : sizeMatches(a, b))
  }
  const declaredBool = normalizeBool(declared)
  const effectiveBool = normalizeBool(effective)
  if (declaredBool !== null && effectiveBool !== null) return declaredBool === effectiveBool
  return declared.trim().toLowerCase() === effective.trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Effective values
// ---------------------------------------------------------------------------

interface Effective {
  value: string | null
  /** How the value was observed; kept short, appended to the row note. */
  evidence: string | null
}

const NONE: Effective = { value: null, evidence: null }

/** The automount root the drive mounts actually sit under, e.g. /mnt/. */
export function observedAutomountRoot(roots: string[]): string | null {
  if (roots.length === 0) return null
  const parents = new Set(roots.map((p) => p.slice(0, p.lastIndexOf('/') + 1)))
  return parents.size === 1 ? [...parents][0] : null
}

function pathHasWindows(pathValue: string, roots: string[] | null): boolean {
  const prefixes = roots !== null && roots.length > 0 ? roots : ['/mnt/c']
  return pathValue
    .split(':')
    .some((seg) => prefixes.some((root) => seg === root || seg.startsWith(`${root}/`)))
}

/**
 * What the running system exhibits for a setting. Anything that cannot be read
 * back stays null: an unverifiable key is reported as unknown, never applied.
 */
export function observeEffective(
  section: string,
  key: string,
  obs: WslObservations
): { value: string | null; evidence: string | null } {
  switch (`${section}.${key.toLowerCase()}`) {
    case 'wsl2.memory':
      return obs.memTotalBytes === null
        ? NONE
        : { value: formatSize(obs.memTotalBytes), evidence: 'Read from MemTotal in the guest.' }
    case 'wsl2.processors':
      return obs.processors === null
        ? NONE
        : { value: obs.processors, evidence: 'Counted with nproc in the guest.' }
    case 'wsl2.swap':
      return obs.swapTotalBytes === null
        ? NONE
        : { value: formatSize(obs.swapTotalBytes), evidence: 'Read from SwapTotal in the guest.' }
    case 'wsl2.networkingmode':
      return obs.networkingMode === null
        ? NONE
        : { value: obs.networkingMode, evidence: 'Reported by wslinfo --networking-mode.' }
    case 'wsl2.guiapplications':
      // WSLg mounted proves GUI support is on; its absence has other causes.
      return obs.wslgMounted === true ? { value: 'true', evidence: '/mnt/wslg is mounted.' } : NONE
    case 'wsl2.nestedvirtualization':
      return obs.kvm === null
        ? NONE
        : {
            value: obs.kvm ? 'true' : 'false',
            evidence: obs.kvm ? '/dev/kvm exists in the guest.' : '/dev/kvm is absent in the guest.'
          }
    case 'wsl2.kernel':
      return obs.kernelRelease === null
        ? NONE
        : { value: null, evidence: `The running kernel is ${obs.kernelRelease}.` }
    case 'boot.systemd': {
      if (obs.pid1Comm === null) return NONE
      const isSystemd = obs.pid1Comm === 'systemd'
      const state = obs.systemState === null ? '' : ` systemctl reports ${obs.systemState}.`
      return {
        value: isSystemd ? 'true' : 'false',
        evidence: `PID 1 is ${obs.pid1Comm}.${state}`
      }
    }
    case 'automount.enabled':
      return obs.drvfsRoots === null
        ? NONE
        : {
            value: obs.drvfsRoots.length > 0 ? 'true' : 'false',
            evidence:
              obs.drvfsRoots.length > 0
                ? `Windows drives are mounted at ${obs.drvfsRoots.join(', ')}.`
                : 'No DrvFs mount is present in /proc/mounts.'
          }
    case 'automount.root': {
      const root = obs.drvfsRoots === null ? null : observedAutomountRoot(obs.drvfsRoots)
      return root === null
        ? NONE
        : { value: root, evidence: 'Derived from the DrvFs mount points in /proc/mounts.' }
    }
    case 'interop.appendwindowspath':
      return obs.path === null
        ? NONE
        : {
            value: pathHasWindows(obs.path, obs.drvfsRoots) ? 'true' : 'false',
            evidence: 'Checked for Windows directories in PATH.'
          }
    case 'user.default':
      return obs.user === null
        ? NONE
        : { value: obs.user, evidence: 'The distribution runs commands as this user.' }
    case 'network.hostname':
      return obs.hostname === null
        ? NONE
        : { value: obs.hostname, evidence: 'Reported by hostname in the guest.' }
    case 'network.generateresolvconf':
      // Only the generated header proves WSL wrote the file; a hand-written one
      // could look like anything, so absence stays unknown.
      return obs.resolvConfHeader !== null && /generated by WSL/i.test(obs.resolvConfHeader)
        ? { value: 'true', evidence: '/etc/resolv.conf carries the WSL generated header.' }
        : NONE
    case 'network.generatehosts':
      return obs.hostsHeader !== null && /generated by WSL/i.test(obs.hostsHeader)
        ? { value: 'true', evidence: '/etc/hosts carries the WSL generated header.' }
        : NONE
    default:
      return NONE
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  wslconfigEntries: IniEntry[]
  wslConfEntries: IniEntry[]
  observations: WslObservations
  /** Installed wsl.exe version; null disables every unsupported verdict. */
  wslVersion: string | null
  /** Epoch ms the utility VM started; null when uptime was unreadable. */
  vmStartedAtMs: number | null
  wslconfigMtimeMs: number | null
  wslConfMtimeMs: number | null
}

export interface ReconcileResult {
  settings: WslSettingInfo[]
  restartPending: boolean
  networkingModeDeclared: string | null
  networkingModeEffective: string | null
}

const FILE_LABEL: Record<'windows' | 'linux', string> = {
  windows: '.wslconfig',
  linux: WSL_CONF_PATH
}

function join(...parts: (string | null)[]): string | null {
  const text = parts.filter((p) => p !== null && p !== '').join(' ')
  return text === '' ? null : text
}

function sectionRank(section: string): number {
  const index = SECTION_ORDER.indexOf(section)
  return index === -1 ? SECTION_ORDER.length : index
}

function sortSettings(settings: WslSettingInfo[]): WslSettingInfo[] {
  return [...settings].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'windows' ? -1 : 1
    const rank = sectionRank(a.section) - sectionRank(b.section)
    if (rank !== 0) return rank
    if (a.section !== b.section) return a.section.localeCompare(b.section)
    return a.key.localeCompare(b.key)
  })
}

/** Last declaration of a key wins; the rest are counted for the note. */
function collapseDuplicates(entries: IniEntry[]): { entry: IniEntry; count: number }[] {
  const byKey = new Map<string, { entry: IniEntry; count: number }>()
  for (const entry of entries) {
    const id = JSON.stringify([entry.section, entry.key.toLowerCase()])
    const existing = byKey.get(id)
    if (existing === undefined) {
      byKey.set(id, { entry, count: 1 })
    } else {
      byKey.set(id, { entry, count: existing.count + 1 })
    }
  }
  return [...byKey.values()]
}

/** Pick the catalog entry a declared key most plausibly meant. */
function resolveKnown(
  candidates: KnownKey[],
  section: string,
  scope: 'windows' | 'linux'
): KnownKey | null {
  if (candidates.length === 0) return null
  return (
    candidates.find((c) => c.section === section && c.scope === scope) ??
    candidates.find((c) => c.section === section) ??
    candidates.find((c) => c.scope === scope) ??
    candidates[0]
  )
}

function wrongSectionNote(known: KnownKey, entry: IniEntry, scope: 'windows' | 'linux'): string {
  if (known.scope !== scope) {
    return `${known.section}.${known.key} belongs in ${FILE_LABEL[known.scope]}, not ${FILE_LABEL[scope]}.`
  }
  if (entry.section === '') {
    return `${known.key} sits above every section heading; WSL reads it from [${known.section}].`
  }
  if (known.movedFrom?.includes(entry.section) === true) {
    return `Current WSL releases read ${known.key} from [${known.section}], not [${entry.section}] — the value in this file does nothing.`
  }
  return `${known.key} belongs under [${known.section}], not [${entry.section}].`
}

interface DeclaredContext {
  scope: 'windows' | 'linux'
  wslVersion: string | null
  fileNewerThanVm: boolean
  /** Without a VM start instant, a mismatch cannot be attributed to anything. */
  vmStartKnown: boolean
  observations: WslObservations
}

function declaredSetting(
  entry: IniEntry,
  duplicates: number,
  ctx: DeclaredContext
): { setting: WslSettingInfo; covered: KnownKey | null } {
  const origin = ctx.scope === 'windows' ? 'wslconfig' : 'wsl-conf'
  const known = resolveKnown(findKnownKeys(entry.key), entry.section, ctx.scope)
  const base = {
    key: entry.key,
    section: entry.section,
    scope: ctx.scope,
    declaredValue: entry.value,
    origin
  } as const
  const duplicateNote =
    duplicates > 1
      ? `Declared ${duplicates} times under [${entry.section}]; only one value can apply.`
      : null

  if (known === null) {
    const suggestion = suggestKey(entry.key, ctx.scope)
    return {
      covered: null,
      setting: {
        ...base,
        effectiveValue: null,
        verdict: 'unknown-key',
        note: join(
          'WSL ignores this key.',
          suggestion === null ? null : `Did you mean ${suggestion}?`,
          duplicateNote
        )
      }
    }
  }

  const misplaced = known.section !== entry.section || known.scope !== ctx.scope
  if (misplaced) {
    return {
      covered: known,
      setting: {
        ...base,
        effectiveValue: null,
        verdict: 'wrong-section',
        note: join(wrongSectionNote(known, entry, ctx.scope), duplicateNote)
      }
    }
  }

  const caseNote = known.key !== entry.key ? `The documented spelling is ${known.key}.` : null

  if (
    known.since !== undefined &&
    ctx.wslVersion !== null &&
    compareVersions(ctx.wslVersion, known.since) < 0
  ) {
    return {
      covered: known,
      setting: {
        ...base,
        effectiveValue: null,
        verdict: 'unsupported',
        note: join(
          `${known.key} needs WSL ${known.since} or newer; this machine runs ${ctx.wslVersion}.`,
          caseNote,
          duplicateNote
        )
      }
    }
  }

  const effective = observeEffective(known.section, known.key, ctx.observations)
  if (effective.value !== null) {
    if (valuesMatch(known.key, entry.value, effective.value)) {
      return {
        covered: known,
        setting: {
          ...base,
          effectiveValue: effective.value,
          verdict: 'applied',
          note: join(effective.evidence, caseNote, duplicateNote)
        }
      }
    }
    // The value on disk is not the value in force, and timing decides the
    // reading: a file newer than the VM merely needs a restart, while a VM that
    // started afterwards has already read the file and not honoured the value.
    // With no VM start instant neither statement can be made.
    const verdict: SettingVerdict = ctx.fileNewerThanVm
      ? 'pending-restart'
      : ctx.vmStartKnown
        ? 'unsupported'
        : 'unknown'
    const why = ctx.fileNewerThanVm
      ? `The running VM still reports ${effective.value}. Applies after wsl --shutdown.`
      : ctx.vmStartKnown
        ? `The VM started after this file was saved and still reports ${effective.value}, so WSL did not honour ${entry.value} here.`
        : `Declared ${entry.value} but the system reports ${effective.value}; WSLPad cannot tell whether a restart is pending.`
    return {
      covered: known,
      setting: {
        ...base,
        effectiveValue: effective.value,
        verdict,
        note: join(why, effective.evidence, caseNote, duplicateNote)
      }
    }
  }

  if (ctx.fileNewerThanVm) {
    return {
      covered: known,
      setting: {
        ...base,
        effectiveValue: null,
        verdict: 'pending-restart',
        note: join(
          `${FILE_LABEL[ctx.scope]} changed after the VM started; this value is not in force yet.`,
          caseNote,
          duplicateNote
        )
      }
    }
  }

  return {
    covered: known,
    setting: {
      ...base,
      effectiveValue: null,
      verdict: 'unknown',
      note: join(
        'WSLPad cannot read this value back from a running system, so it cannot confirm it applied.',
        effective.evidence,
        caseNote,
        duplicateNote
      )
    }
  }
}

function defaultSetting(known: KnownKey, obs: WslObservations): WslSettingInfo {
  const effective = observeEffective(known.section, known.key, obs)
  const observed = effective.value
  return {
    key: known.key,
    section: known.section,
    scope: known.scope,
    declaredValue: null,
    effectiveValue: observed ?? known.defaultValue,
    origin: observed !== null ? 'computed' : 'default',
    verdict: 'not-set',
    note: join(known.note ?? null, observed !== null ? effective.evidence : null)
  }
}

/**
 * Pure verdict engine: declared entries plus observations in, one row per
 * setting out. Kept free of I/O so the whole matrix is testable.
 */
export function reconcileSettings(input: ReconcileInput): ReconcileResult {
  const { observations: obs, vmStartedAtMs } = input
  const newer = (mtime: number | null): boolean =>
    mtime !== null && vmStartedAtMs !== null && mtime > vmStartedAtMs + RESTART_GRACE_MS
  const wslconfigNewer = newer(input.wslconfigMtimeMs)
  const wslConfNewer = newer(input.wslConfMtimeMs)

  const settings: WslSettingInfo[] = []
  const covered = new Set<KnownKey>()

  const files: { entries: IniEntry[]; ctx: DeclaredContext }[] = [
    {
      entries: input.wslconfigEntries,
      ctx: {
        scope: 'windows',
        wslVersion: input.wslVersion,
        fileNewerThanVm: wslconfigNewer,
        vmStartKnown: vmStartedAtMs !== null,
        observations: obs
      }
    },
    {
      entries: input.wslConfEntries,
      ctx: {
        scope: 'linux',
        wslVersion: input.wslVersion,
        fileNewerThanVm: wslConfNewer,
        vmStartKnown: vmStartedAtMs !== null,
        observations: obs
      }
    }
  ]

  for (const file of files) {
    for (const { entry, count } of collapseDuplicates(file.entries)) {
      const result = declaredSetting(entry, count, file.ctx)
      settings.push(result.setting)
      if (result.covered !== null) covered.add(result.covered)
    }
  }

  for (const known of KNOWN_KEYS) {
    if (covered.has(known)) continue
    settings.push(defaultSetting(known, obs))
  }

  // The declared mode is whatever the file says, wherever it says it: a
  // networkingMode stranded in [experimental] is exactly the case to surface.
  const declaredMode = input.wslconfigEntries
    .filter((e) => e.key.toLowerCase() === 'networkingmode')
    .map((e) => e.value.toLowerCase())
    .pop()

  return {
    settings: sortSettings(settings),
    restartPending: wslconfigNewer || wslConfNewer,
    networkingModeDeclared: declaredMode ?? null,
    networkingModeEffective: obs.networkingMode
  }
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export interface WindowsConfigFile {
  text: string
  mtimeMs: number
}

export interface WslConfigDeps {
  /** Reads the Windows-side .wslconfig; null when it does not exist. */
  readWindowsFile?: (path: string) => Promise<WindowsConfigFile | null>
  /** %USERPROFILE%; null when it cannot be resolved. */
  userProfile?: string | null
  /** Injected so restart-pending arithmetic is deterministic in tests. */
  now?: () => number
}

export interface WslConfigCollector {
  collect(runner: DistroRunner, distro: string): Promise<WslConfigInfo>
}

async function readWindowsConfig(path: string): Promise<WindowsConfigFile | null> {
  try {
    const [buf, info] = await Promise.all([readFile(path), stat(path)])
    return { text: decodeConfigFile(buf), mtimeMs: info.mtimeMs }
  } catch {
    // A missing or unreadable .wslconfig is a fact, not a collector failure.
    return null
  }
}

function resolveWslconfigPath(profile: string | null): string | null {
  if (profile === null || profile === '') return null
  return `${profile.replace(/[\\/]+$/, '')}\\.wslconfig`
}

export function createWslConfigCollector(deps: WslConfigDeps = {}): WslConfigCollector {
  const readWindowsFile = deps.readWindowsFile ?? readWindowsConfig
  const now = deps.now ?? Date.now
  // wsl.exe cannot change under a running WSLPad, so one successful read lasts.
  let cachedVersion: string | null = null

  const readVersion = async (runner: DistroRunner): Promise<string | null> => {
    if (cachedVersion !== null) return cachedVersion
    try {
      const res = await runner.runWsl(['--version'], {
        timeoutMs: RUNNER_TIMEOUT_MS,
        encoding: 'utf16le'
      })
      cachedVersion = parseWslVersion(res.stdout)
    } catch {
      // Builds before the store release have no --version; stay unknown so no
      // key is ever reported unsupported without evidence.
    }
    return cachedVersion
  }

  return {
    async collect(runner: DistroRunner, distro: string): Promise<WslConfigInfo> {
      assertValidDistroName(distro)
      const profile =
        deps.userProfile !== undefined ? deps.userProfile : (process.env.USERPROFILE ?? null)
      const wslconfigPath = resolveWslconfigPath(profile)
      const windowsFile = wslconfigPath === null ? null : await readWindowsFile(wslconfigPath)

      let obs = emptyObservations()
      try {
        const res = await runner.runInDistro(distro, buildWslConfigScript(), {
          timeoutMs: RUNNER_SLOW_TIMEOUT_MS
        })
        obs = parseObservations(res.stdout)
      } catch (err) {
        if (err instanceof WslNotAvailableError) throw err
        // Windows-side answers still stand; the guest columns stay null.
      }

      const version = await readVersion(runner)
      // /proc/uptime is the shared kernel's, so this is the utility VM start.
      // A distro launched later inside the same VM read its own wsl.conf at
      // that later moment, which can only make restartPending conservative.
      const vmStartedAtMs =
        obs.uptimeSeconds === null ? null : now() - Math.round(obs.uptimeSeconds * 1000)

      const result = reconcileSettings({
        wslconfigEntries: windowsFile === null ? [] : parseIni(windowsFile.text),
        wslConfEntries: parseIni(obs.wslConfText),
        observations: obs,
        wslVersion: version,
        vmStartedAtMs,
        wslconfigMtimeMs: windowsFile?.mtimeMs ?? null,
        wslConfMtimeMs: obs.wslConfMtimeMs
      })

      return {
        wslconfigPath,
        wslconfigExists: windowsFile !== null,
        wslConfPath: WSL_CONF_PATH,
        wslConfExists: obs.wslConfExists,
        restartPending: result.restartPending,
        vmStartedAt: vmStartedAtMs === null ? null : new Date(vmStartedAtMs).toISOString(),
        networkingModeDeclared: result.networkingModeDeclared,
        networkingModeEffective: result.networkingModeEffective,
        settings: result.settings
      }
    }
  }
}
