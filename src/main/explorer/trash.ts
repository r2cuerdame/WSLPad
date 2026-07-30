import { ExplorerError, type DistroRunner } from '../wsl/contracts'
import { assertValidLinuxPath, shellQuote, shellQuoteAll } from '../wsl/escape'
import { EXIT_EACCES, explorerErrorFromResult } from './listing'
import { FILE_OP_TIMEOUT_MS } from './operations'
import { linuxBasename } from './path-convert'

/**
 * freedesktop.org trash spec (goal.md §7.4): files land in
 * ~/.local/share/Trash/files/<name> with a matching info/<name>.trashinfo so a
 * restore always knows the original path and deletion time.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function formatDeletionDate(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

export function buildTrashInfo(originalPath: string, date: Date): string {
  return `[Trash Info]\nPath=${originalPath}\nDeletionDate=${formatDeletionDate(date)}\n`
}

/** name.ext → name.2.ext, name.3.ext … until the candidate is unused. */
export function resolveTrashCollision(name: string, used: ReadonlySet<string>): string {
  if (!used.has(name)) return name
  const dot = name.lastIndexOf('.')
  const hasExt = dot > 0 && dot < name.length - 1
  const stem = hasExt ? name.slice(0, dot) : name
  const ext = hasExt ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem}.${n}${ext}`
    if (!used.has(candidate)) return candidate
  }
}

export interface TrashBatchItem {
  sourcePath: string
  trashName: string
  date: Date
}

/**
 * One sh script for the whole batch. Each item writes its .trashinfo first so
 * restore metadata always exists, then moves the file; on failure the orphan
 * info file is removed and a WSLPAD_FAIL:<index> marker lands on stderr.
 */
export function buildTrashBatchScript(trashDir: string, items: readonly TrashBatchItem[]): string {
  const parts: string[] = []
  items.forEach((item, i) => {
    const infoPath = `${trashDir}/info/${item.trashName}.trashinfo`
    const filePath = `${trashDir}/files/${item.trashName}`
    const infoLines = buildTrashInfo(item.sourcePath, item.date)
      .split('\n')
      .filter((l) => l.length > 0)
    parts.push(
      `printf '%s\\n' ${shellQuoteAll(infoLines)} > ${shellQuote(infoPath)} && ` +
        `mv ${shellQuote(item.sourcePath)} ${shellQuote(filePath)} || ` +
        `{ rm -f ${shellQuote(infoPath)}; echo ${shellQuote(`WSLPAD_FAIL:${i}`)} 1>&2; }`
    )
  })
  return parts.join('\n')
}

export async function trashEntries(
  runner: DistroRunner,
  distro: string,
  paths: string[],
  homeDir: string,
  now: () => Date = () => new Date()
): Promise<void> {
  if (paths.length === 0) return
  for (const path of paths) {
    assertValidLinuxPath(path)
    if (path === '/') throw new ExplorerError('UNKNOWN', path, 'Refusing to trash /')
  }
  const trashDir = `${homeDir.replace(/\/+$/, '')}/.local/share/Trash`
  const qFiles = shellQuote(`${trashDir}/files`)
  const qInfo = shellQuote(`${trashDir}/info`)
  const listScript =
    `mkdir -p ${qFiles} ${qInfo} || exit ${EXIT_EACCES}; ` +
    `find ${qFiles} ${qInfo} -mindepth 1 -maxdepth 1 -printf '%f\\n'`
  const listResult = await runner.runInDistro(distro, listScript)
  if (listResult.code !== 0 || listResult.timedOut) {
    throw explorerErrorFromResult(trashDir, listResult)
  }
  const used = new Set<string>()
  for (const line of listResult.stdout.split('\n')) {
    if (!line) continue
    used.add(line.endsWith('.trashinfo') ? line.slice(0, -'.trashinfo'.length) : line)
  }
  const date = now()
  const items: TrashBatchItem[] = paths.map((sourcePath) => {
    const trashName = resolveTrashCollision(linuxBasename(sourcePath), used)
    used.add(trashName)
    return { sourcePath, trashName, date }
  })
  const result = await runner.runInDistro(distro, buildTrashBatchScript(trashDir, items), {
    timeoutMs: FILE_OP_TIMEOUT_MS
  })
  if (result.timedOut) throw explorerErrorFromResult(paths[0], result)
  const fail = /WSLPAD_FAIL:(\d+)/.exec(result.stderr)
  if (fail) {
    const failedPath = paths[Number.parseInt(fail[1], 10)] ?? paths[0]
    throw explorerErrorFromResult(failedPath, { ...result, code: 1 })
  }
  if (result.code !== 0) throw explorerErrorFromResult(paths[0], result)
}
