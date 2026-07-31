import type { DiskConsumerInfo, DiskConsumersInfo } from '@shared/types'
import type { DistroRunner } from './contracts'

/**
 * What is actually filling the disk image (issue #66).
 *
 * The Disk card already shows the gap between what ext4.vhdx holds on Windows
 * and what Linux still uses — microsoft/WSL#4699, the most-reacted issue in the
 * WSL tracker. It does not say what is *in* that gap, and neither does anything
 * else: `df` reports the virtual maximum, and `du /` walks for minutes.
 *
 * So this asks about the places that are actually to blame, by name. Bounded:
 * a fixed list of known caches, one `du` each, one timeout for the lot. It is
 * deliberately not exhaustive — the Explorer measures any directory on demand
 * — and it says so rather than presenting a total as the whole story.
 *
 * Read-only. Every cleanup is prepared for the Console (goal.md §2.2); several
 * need root, and WSLPad never types a sudo password.
 */

const MARKER = 'WSLPAD_DU'
const BEGIN = `###${MARKER}_BEGIN`
const END = `###${MARKER}_END`

/**
 * The usual suspects, in the order they are worth explaining. `path` may use
 * `$HOME`; the shell expands it, so a distro with an unusual home still works.
 */
export interface ConsumerSpec {
  id: string
  path: string
  /** Prepared in the Console, never run. null when there is nothing safe to offer. */
  cleanup: string | null
  /** True when the cleanup needs root — the UI says so before it is copied. */
  needsRoot: boolean
}

export const CONSUMER_SPECS: readonly ConsumerSpec[] = [
  // Debian/Ubuntu keeps every .deb it ever downloaded unless told otherwise.
  { id: 'apt-cache', path: '/var/cache/apt', cleanup: 'sudo apt clean', needsRoot: true },
  // dnf/yum equivalent, so a Fedora distro is not silently unexplained.
  { id: 'dnf-cache', path: '/var/cache/dnf', cleanup: 'sudo dnf clean all', needsRoot: true },
  // The systemd journal grows to a fraction of the disk by default and never
  // shrinks on its own.
  {
    id: 'journal',
    path: '/var/log/journal',
    cleanup: 'sudo journalctl --vacuum-size=200M',
    needsRoot: true
  },
  { id: 'logs', path: '/var/log', cleanup: null, needsRoot: false },
  // Build caches: pip, npm, cargo, go and friends all live here.
  { id: 'user-cache', path: '$HOME/.cache', cleanup: null, needsRoot: false },
  { id: 'snap', path: '/var/lib/snapd', cleanup: null, needsRoot: false },
  { id: 'docker', path: '/var/lib/docker', cleanup: 'docker system prune', needsRoot: false },
  // WSLPad's own doing, and invisible until now.
  { id: 'trash', path: '$HOME/.local/share/Trash', cleanup: null, needsRoot: false },
  { id: 'tmp', path: '/tmp', cleanup: null, needsRoot: false }
]

/**
 * One `du -sb` per suspect, each already cheap because these are leaf caches
 * rather than the whole tree. `-x` keeps the walk on this filesystem, so a
 * bind-mounted Windows drive under one of them cannot turn a bounded read into
 * an unbounded one.
 */
export function buildConsumersScript(specs: readonly ConsumerSpec[] = CONSUMER_SPECS): string {
  const lines = [
    'if command -v timeout >/dev/null 2>&1; then t="timeout 20"; else t=""; fi',
    `echo "${BEGIN}"`
  ]
  for (const spec of specs) {
    lines.push(
      `p="${spec.path}"`,
      'if [ -d "$p" ]; then',
      // A du that fails or times out prints nothing, and the row stays unknown
      // rather than becoming a zero.
      '  s=$($t du -sxb "$p" 2>/dev/null | cut -f1)',
      `  printf '%s|%s|%s\\n' '${spec.id}' "$p" "$s"`,
      'else',
      `  printf '%s|%s|missing\\n' '${spec.id}' "$p"`,
      'fi'
    )
  }
  lines.push(`echo "${END}"`, ':')
  return lines.join('\n')
}

function section(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const from = lines.findIndex((l) => l.trim() === BEGIN)
  if (from < 0) return ''
  const rest = lines.slice(from + 1)
  const to = rest.findIndex((l) => l.trim() === END)
  return (to < 0 ? rest : rest.slice(0, to)).join('\n')
}

/** `id|path|bytes` — `missing` for a path that is not there, empty for unknown. */
export function parseConsumers(
  stdout: string,
  specs: readonly ConsumerSpec[] = CONSUMER_SPECS
): DiskConsumerInfo[] {
  const byId = new Map(specs.map((s) => [s.id, s]))
  const out: DiskConsumerInfo[] = []
  for (const line of section(stdout).split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split('|')
    if (parts.length < 3) continue
    const spec = byId.get(parts[0])
    if (spec === undefined) continue
    const path = parts.slice(1, -1).join('|')
    const size = parts[parts.length - 1].trim()
    if (size === 'missing') {
      out.push({
        id: spec.id,
        path,
        exists: false,
        bytes: null,
        cleanup: null,
        needsRoot: false,
        containedIn: null
      })
      continue
    }
    out.push({
      id: spec.id,
      path,
      exists: true,
      bytes: /^\d+$/.test(size) ? Number.parseInt(size, 10) : null,
      cleanup: spec.cleanup,
      needsRoot: spec.needsRoot,
      containedIn: null
    })
  }
  // Biggest first; an unknown size sorts last rather than as zero.
  return markNesting(out.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1)))
}

/**
 * `/var/log/journal` is measured separately because it is the actionable half
 * of `/var/log`, but its bytes are already inside it. Marking the containment
 * keeps both rows on screen while the total counts each byte once.
 */
export function markNesting(consumers: DiskConsumerInfo[]): DiskConsumerInfo[] {
  const present = consumers.filter((c) => c.exists)
  return consumers.map((c) => {
    if (!c.exists) return c
    const parent =
      present.find((other) => other.id !== c.id && c.path.startsWith(`${other.path}/`)) ?? null
    return { ...c, containedIn: parent?.id ?? null }
  })
}

/**
 * Only sums what was actually measured, and says whether anything was left
 * out. A total that quietly skipped an unreadable cache reads as the whole
 * story when it is not.
 */
export function measuredTotal(consumers: readonly DiskConsumerInfo[]): {
  bytes: number
  partial: boolean
} {
  let bytes = 0
  let partial = false
  for (const c of consumers) {
    if (!c.exists) continue
    // Counted already as part of whatever contains it.
    if (c.containedIn !== null) continue
    if (c.bytes === null) partial = true
    else bytes += c.bytes
  }
  return { bytes, partial }
}

export async function collectDiskConsumers(
  runner: DistroRunner,
  distro: string
): Promise<DiskConsumersInfo | null> {
  let result
  try {
    result = await runner.runInDistro(distro, buildConsumersScript(), { timeoutMs: 30_000 })
  } catch {
    return null
  }
  // A cut-off read says nothing about sizes; the caller keeps its last answer.
  if (result.timedOut) return null

  const consumers = parseConsumers(result.stdout)
  if (consumers.length === 0) return null
  const total = measuredTotal(consumers)
  return { consumers, measuredBytes: total.bytes, partial: total.partial }
}
