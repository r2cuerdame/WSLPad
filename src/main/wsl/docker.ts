import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type {
  DockerContainerInfo,
  DockerDiskUsage,
  DockerImageInfo,
  DockerInfo
} from '@shared/types'
import type { DistroRunner, RunResult } from './contracts'
import { assertValidDistroName } from './escape'

/**
 * Docker as a distribution sees it (goal.md §6.6.2).
 *
 * Two facts make Docker on WSL confusing, and both are read here:
 *
 * 1. `docker system df` regularly reports tens of gigabytes of *build cache*
 *    while `docker image ls` lists a handful of small images. The cache is
 *    invisible in every listing people actually look at.
 * 2. Under Docker Desktop the `docker` command in a distribution is a shim
 *    into the `docker-desktop` distribution, so all of that space is on **that**
 *    distribution's virtual disk — not on the one whose Disk image section the
 *    user is reading. Chasing the missing space in the wrong .vhdx is the
 *    single most common wrong turn.
 *
 * Everything is read-only. Nothing here prunes, pulls, starts or stops
 * anything; `docker system prune` is only ever prepared in the Console.
 */

/** Docker Desktop mounts its tooling here and symlinks the CLI into the distro. */
const DESKTOP_MOUNT = '/mnt/wsl/docker-desktop'
/** The distribution whose disk holds the engine's data under Docker Desktop. */
export const DESKTOP_STORAGE_DISTRO = 'docker-desktop'

/** A daemon error is one line for a human, not a transcript. */
const MAX_ERROR_CHARS = 400

/**
 * Listing caps. A build machine can hold hundreds of images and containers,
 * and every row rides the snapshot to the renderer and out over MCP on each
 * poll. The tables say when they were cut rather than pretending to be whole.
 */
export const MAX_ROWS = 200

const BEGIN = (name: string): string => `WSLPAD_${name}_BEGIN`
const END = (name: string): string => `WSLPAD_${name}_END`

/**
 * One batched script. Every docker invocation is time-boxed inside the distro
 * as well as by the Hidden Runner, because a daemon that is starting up can
 * hang a client for a long time — and `--format '{{json .}}'` keeps the output
 * locale-independent, which the human-readable tables are not.
 */
export const DOCKER_SCRIPT = `p=$(command -v docker 2>/dev/null) || p=
[ -n "$p" ] || exit 0
printf '%s\\n' "WSLPAD_CLI_BEGIN"
printf '%s\\n' "$p"
readlink -f "$p" 2>/dev/null || printf '%s\\n' "$p"
printf '%s\\n' "WSLPAD_CLI_END"
if command -v timeout >/dev/null 2>&1; then t="timeout 6"; else t=""; fi
printf '%s\\n' "WSLPAD_VERSION_BEGIN"
$t docker version --format '{{json .}}' 2>&1
printf '\\n%s\\n' "WSLPAD_VERSION_END"
printf '%s\\n' "WSLPAD_CONTEXT_BEGIN"
$t docker context show 2>/dev/null
printf '%s\\n' "WSLPAD_CONTEXT_END"
printf '%s\\n' "WSLPAD_INFO_BEGIN"
$t docker info --format '{{.DockerRootDir}}|{{.Name}}|{{.ServerVersion}}' 2>/dev/null
printf '%s\\n' "WSLPAD_INFO_END"
printf '%s\\n' "WSLPAD_IMAGES_BEGIN"
$t docker image ls --format '{{json .}}' 2>/dev/null
printf '%s\\n' "WSLPAD_IMAGES_END"
printf '%s\\n' "WSLPAD_CONTAINERS_BEGIN"
$t docker ps -a --format '{{json .}}' 2>/dev/null
printf '%s\\n' "WSLPAD_CONTAINERS_END"
printf '%s\\n' "WSLPAD_DF_BEGIN"
$t docker system df --format '{{json .}}' 2>/dev/null
printf '%s\\n' "WSLPAD_DF_END"
:
`

/**
 * Docker prints sizes with `units.HumanSize`, which is base 1000 (kB, MB, GB).
 * Base-1024 spellings are accepted too so a future change of unit does not
 * silently produce numbers a thousandfold wrong.
 */
const UNIT_FACTOR: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
  pib: 1024 ** 5
}

/** "17.25GB" → 17250000000. Unparseable input stays null, never zero. */
export function parseDockerSize(text: string): number | null {
  const match = /^\s*([\d.]+)\s*([a-zA-Z]*)\s*$/.exec(text)
  if (match === null) return null
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value)) return null
  const unit = match[2].toLowerCase()
  const factor = unit === '' ? 1 : UNIT_FACTOR[unit]
  return factor === undefined ? null : Math.round(value * factor)
}

/**
 * `docker system df` writes reclaimable as "17.25GB (100%)". Only the size is
 * taken; the percentage is derivable and would just be a second thing to keep
 * in sync.
 */
export function parseReclaimable(text: string): number | null {
  const head = text.split('(')[0]
  return parseDockerSize(head)
}

/** Docker's Go timestamps ("2026-02-20 21:05:22 +0900 KST") → ISO, or null. */
export function parseDockerTime(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  // Drop the trailing zone abbreviation: Date cannot parse "+0900 KST".
  const cleaned = trimmed.replace(/\s+[A-Z]{2,5}$/, '')
  const parsed = new Date(cleaned)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * Everything between two markers, matched only when a marker is the whole
 * line. Container names, image tags and paths are attacker-influenceable and
 * end up inside this output: a container literally named
 * `WSLPAD_CONTAINERS_END` would otherwise truncate its own section and hide
 * every container after it. A whole-line match cannot be forged from inside a
 * JSON string, because a real newline would have been escaped by docker.
 */
function section(text: string, name: string): string {
  const begin = BEGIN(name)
  const end = END(name)
  const lines = text.split('\n')
  const from = lines.findIndex((line) => line.trim() === begin)
  if (from < 0) return ''
  const rest = lines.slice(from + 1)
  const to = rest.findIndex((line) => line.trim() === end)
  return (to < 0 ? rest : rest.slice(0, to)).join('\n').trim()
}

function jsonLines(block: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null) out.push(parsed as Record<string, unknown>)
    } catch {
      // A partial line (output cap, interleaved warning) is skipped, not fatal.
    }
  }
  return out
}

const str = (row: Record<string, unknown>, key: string): string => {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

const int = (row: Record<string, unknown>, key: string): number | null => {
  const value = row[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseDockerImages(block: string): DockerImageInfo[] {
  return jsonLines(block)
    .slice(0, MAX_ROWS)
    .map((row) => {
      const sizeText = str(row, 'Size')
      return {
        repository: str(row, 'Repository'),
        tag: str(row, 'Tag'),
        id: str(row, 'ID'),
        sizeBytes: parseDockerSize(sizeText),
        sizeText,
        createdAt: parseDockerTime(str(row, 'CreatedAt')),
        containers: int(row, 'Containers')
      }
    })
}

export function parseDockerContainers(block: string): DockerContainerInfo[] {
  // Labels are deliberately dropped: they are unbounded, and on Docker Desktop
  // they carry Windows paths from the user's profile that nothing here needs.
  return jsonLines(block)
    .slice(0, MAX_ROWS)
    .map((row) => ({
      id: str(row, 'ID').slice(0, 12),
      name: str(row, 'Names'),
      image: str(row, 'Image'),
      state: str(row, 'State'),
      status: str(row, 'Status'),
      ports: str(row, 'Ports'),
      createdAt: parseDockerTime(str(row, 'CreatedAt'))
    }))
}

export function parseDockerDiskUsage(block: string): DockerDiskUsage[] {
  return jsonLines(block).map((row) => {
    const sizeText = str(row, 'Size')
    const reclaimableText = str(row, 'Reclaimable')
    return {
      type: str(row, 'Type'),
      totalCount: int(row, 'TotalCount'),
      activeCount: int(row, 'Active'),
      sizeBytes: parseDockerSize(sizeText),
      sizeText,
      reclaimableBytes: parseReclaimable(reclaimableText),
      reclaimableText
    }
  })
}

/** Sum of every reclaimable row; null when not one row could be read. */
export function totalReclaimable(rows: readonly DockerDiskUsage[]): number | null {
  const known = rows.map((r) => r.reclaimableBytes).filter((n): n is number => n !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0)
}

function emptyDocker(): DockerInfo {
  return {
    cliInstalled: false,
    cliPath: null,
    dockerDesktop: false,
    daemonRunning: false,
    serverVersion: null,
    clientVersion: null,
    context: null,
    rootDir: null,
    engineHost: null,
    storageDistro: null,
    images: [],
    containers: [],
    diskUsage: [],
    error: null
  }
}

export function parseDockerOutput(stdout: string): DockerInfo {
  const info = emptyDocker()
  const cli = section(stdout, 'CLI')
  if (cli === '') return info

  const cliLines = cli
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  info.cliInstalled = true
  info.cliPath = cliLines[0] ?? null
  // The shim can be found either as the command itself or behind a symlink.
  info.dockerDesktop = cliLines.some((line) => line.startsWith(DESKTOP_MOUNT))

  const versionBlock = section(stdout, 'VERSION')
  const version = jsonLines(versionBlock)[0]
  if (version !== undefined) {
    const client = version.Client
    const server = version.Server
    if (typeof client === 'object' && client !== null) {
      info.clientVersion = str(client as Record<string, unknown>, 'Version') || null
    }
    if (typeof server === 'object' && server !== null) {
      info.serverVersion = str(server as Record<string, unknown>, 'Version') || null
    }
  }
  info.daemonRunning = info.serverVersion !== null
  if (!info.daemonRunning) {
    // The client prints why on stderr, which the script folds into this block.
    const reason = versionBlock
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('{'))
      .join(' ')
      .trim()
    // stderr is unbounded and rides the snapshot to the renderer and out over
    // MCP on every poll; one sentence is all a reader needs.
    info.error = reason === '' ? null : reason.slice(0, MAX_ERROR_CHARS)
  }

  const context = section(stdout, 'CONTEXT').split('\n')[0]?.trim() ?? ''
  info.context = context === '' ? null : context

  const infoLine = section(stdout, 'INFO').split('\n')[0] ?? ''
  const parts = infoLine.split('|')
  if (parts.length >= 3) {
    info.rootDir = parts[0].trim() === '' ? null : parts[0].trim()
    info.engineHost = parts[1].trim() === '' ? null : parts[1].trim()
    if (info.serverVersion === null && parts[2].trim() !== '') {
      info.serverVersion = parts[2].trim()
      info.daemonRunning = true
      info.error = null
    }
  }

  /**
   * Where the bytes physically are. Under Docker Desktop the engine runs in
   * its own distribution, so the data is on that distribution's disk however
   * the root dir reads from inside the engine.
   */
  info.storageDistro = info.dockerDesktop
    ? DESKTOP_STORAGE_DISTRO
    : info.engineHost === DESKTOP_STORAGE_DISTRO
      ? DESKTOP_STORAGE_DISTRO
      : null

  info.images = parseDockerImages(section(stdout, 'IMAGES'))
  info.containers = parseDockerContainers(section(stdout, 'CONTAINERS'))
  info.diskUsage = parseDockerDiskUsage(section(stdout, 'DF'))
  return info
}

/**
 * Query Docker inside a distribution. Returns a not-installed result rather
 * than null for a healthy distro without docker; null is reserved for a distro
 * query that failed outright, so "we could not ask" never reads as "no Docker".
 */
export async function detectDocker(
  runner: DistroRunner,
  distro: string
): Promise<DockerInfo | null> {
  assertValidDistroName(distro)
  let result: RunResult
  try {
    result = await runner.runInDistro(distro, DOCKER_SCRIPT, {
      timeoutMs: RUNNER_SLOW_TIMEOUT_MS
    })
  } catch {
    return null
  }
  /**
   * A run that was cut short mid-script produced a truncated transcript: the
   * sections that had not printed yet would parse as empty and be published as
   * "no images, no containers, nothing to reclaim". That is worse than saying
   * nothing, so a timeout is reported as a failed read and the store keeps its
   * last-good section.
   */
  if (result.timedOut) return null
  return parseDockerOutput(result.stdout)
}
