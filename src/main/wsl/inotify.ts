/**
 * The kernel watch ceiling (goal.md §6.2.4).
 *
 * When a file watcher runs out of inotify watches the kernel returns ENOSPC,
 * and every tool in the chain prints it as "no space left on device" — vite,
 * webpack, tsc --watch and VS Code all die naming a disk that is not full.
 * The real limit is two numbers in /proc, and no WSL tool shows them.
 *
 * Consumption is deliberately not reported: counting watches means reading
 * /proc/<pid>/fdinfo for every process, which an ordinary user cannot do. The
 * count that came back would be 0, and 0 here would be a lie (goal.md §2.4).
 */
import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import { RECOMMENDED_WATCHES } from '@shared/inotify'
import type { InotifyInfo } from '@shared/types'
import type { DistroRunner } from './contracts'
import { assertValidDistroName, shellQuote } from './escape'
import { SECTION_MARKER, splitSections } from './system'

/** Where the raise lands: a file of its own, so re-running it is idempotent. */
export const SYSCTL_DROPIN = '/etc/sysctl.d/99-inotify-watches.conf'

/**
 * Markers go BETWEEN probes, never before the first one: splitSections keys
 * off the marker, so a leading one inserts an empty section 0 and shifts every
 * reading one place — which reads as "the first value is unknown and the
 * second holds the first one's number". Same join as every other collector.
 */
export const INOTIFY_SCRIPT = [
  'cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || true',
  'cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null || true'
].join(`\nprintf '\\n${SECTION_MARKER}\\n'\n`)

function count(section: string | undefined): number | null {
  const first = section?.split('\n').find((l) => l.trim() !== '')
  if (first === undefined) return null
  const text = first.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number.parseInt(text, 10)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Raising the ceiling needs root, and `sudo` needs a password that a distro
 * set up by an installer or an agent often nobody knows. `wsl -u root` is the
 * host asking the guest, so it needs no password at all (0.4.1). Built here
 * and carried on the snapshot, like the Zone.Identifier cleanup command —
 * prepared in the Console, never run.
 */
export function raiseWatchesCommand(distro: string, watches = RECOMMENDED_WATCHES): string {
  const inner =
    `echo fs.inotify.max_user_watches=${watches} > ${SYSCTL_DROPIN} && ` +
    `sysctl -p ${SYSCTL_DROPIN}`
  return `wsl.exe -d ${shellQuote(distro)} -u root sh -c ${shellQuote(inner)}`
}

export function parseInotify(stdout: string, distro: string): InotifyInfo {
  return {
    maxUserWatches: count(splitSections(stdout)[0]),
    maxUserInstances: count(splitSections(stdout)[1]),
    raiseCommand: raiseWatchesCommand(distro)
  }
}

export async function collectInotify(
  runner: DistroRunner,
  distro: string
): Promise<InotifyInfo | null> {
  assertValidDistroName(distro)
  try {
    const res = await runner.runInDistro(distro, INOTIFY_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
    return parseInotify(res.stdout, distro)
  } catch {
    return null
  }
}
