import type { TrashEntry } from '@shared/types'
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

/**
 * The spec stores Path as a URI component, so anything outside the unreserved
 * set is percent-encoded. `/` is kept literal — every other trash
 * implementation writes it that way, and an encoded one reads as gibberish in
 * `cat`. encodeURIComponent already leaves `.-_~!*'()` alone.
 */
export function encodeTrashPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Reverse of the above; a value that will not decode is taken literally. */
export function decodeTrashPath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function buildTrashInfo(originalPath: string, date: Date): string {
  return (
    `[Trash Info]\nPath=${encodeTrashPath(originalPath)}\n` +
    `DeletionDate=${formatDeletionDate(date)}\n`
  )
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

// ---------------------------------------------------------------------------
// Reading the trash back out, and putting things back (issue #23)
// ---------------------------------------------------------------------------

const ITEM = '###WSLPAD_TRASH_ITEM'
const FIELD = '###WSLPAD_TRASH_FIELD'

/**
 * One record per .trashinfo, each field on its own line behind a marker so a
 * path containing a newline cannot be mistaken for the next record. Sizes come
 * from the trashed copy, which is the only thing left to measure.
 */
export function buildTrashListScript(trashDir: string): string {
  const info = shellQuote(`${trashDir}/info`)
  const files = shellQuote(`${trashDir}/files`)
  // Interpolated rather than written inline: a `\n` inside a template literal
  // is a real newline, which would end up inside printf's format string.
  const nl = String.raw`\n`
  return `[ -d ${info} ] || exit 0
for f in ${info}/*.trashinfo; do
  [ -f "$f" ] || continue
  n=\${f##*/}
  n=\${n%.trashinfo}
  p=$(sed -n 's/^Path=//p' "$f" | head -n 1)
  d=$(sed -n 's/^DeletionDate=//p' "$f" | head -n 1)
  t=${files}/"$n"
  k=other
  [ -d "$t" ] && k=dir
  [ -f "$t" ] && k=file
  [ -e "$t" ] || k=missing
  s=$(du -sb "$t" 2>/dev/null | cut -f1)
  echo '${ITEM}'
  echo '${FIELD}'; printf '%s${nl}' "$n"
  echo '${FIELD}'; printf '%s${nl}' "$p"
  echo '${FIELD}'; printf '%s${nl}' "$d"
  echo '${FIELD}'; printf '%s${nl}' "$k"
  echo '${FIELD}'; printf '%s${nl}' "$s"
done
:`
}

/**
 * A record is only kept when it has a name and an original path: an entry
 * whose .trashinfo says nothing cannot be restored anywhere, and listing it
 * with a blank destination would invite exactly that.
 */
export function parseTrashList(stdout: string): TrashEntry[] {
  const entries: TrashEntry[] = []
  for (const block of stdout.replace(/\r/g, '').split(ITEM).slice(1)) {
    const fields = block
      .split(FIELD)
      .slice(1)
      .map((f) => f.replace(/^\n/, '').replace(/\n$/, ''))
    const [trashName, rawPath, deletedAt, kind, size] = fields
    if (!trashName || !rawPath) continue
    entries.push({
      trashName,
      originalPath: decodeTrashPath(rawPath),
      deletedAt: deletedAt === undefined || deletedAt === '' ? null : deletedAt,
      type: kind === 'dir' ? 'directory' : kind === 'file' ? 'file' : 'other',
      // A record whose file is gone is still worth showing — with its size
      // unknown, not zero, and its state visible.
      present: kind !== 'missing',
      sizeBytes: size !== undefined && /^\d+$/.test(size) ? Number.parseInt(size, 10) : null
    })
  }
  // Newest first: the thing just deleted by mistake is the thing being looked for.
  return entries.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
}

export async function listTrash(
  runner: DistroRunner,
  distro: string,
  homeDir: string
): Promise<TrashEntry[]> {
  const trashDir = `${homeDir.replace(/\/+$/, '')}/.local/share/Trash`
  const result = await runner.runInDistro(distro, buildTrashListScript(trashDir), {
    timeoutMs: FILE_OP_TIMEOUT_MS
  })
  if (result.timedOut) throw explorerErrorFromResult(trashDir, result)
  return parseTrashList(result.stdout)
}

/**
 * Put one entry back. The destination comes from the parsed record and is
 * validated here rather than in the shell, and an existing file at the
 * destination stops the restore: overwriting during an undo would destroy the
 * very thing the user is trying to recover.
 */
export function buildRestoreScript(trashDir: string, entry: TrashEntry): string {
  assertValidLinuxPath(entry.originalPath)
  const src = shellQuote(`${trashDir}/files/${entry.trashName}`)
  const info = shellQuote(`${trashDir}/info/${entry.trashName}.trashinfo`)
  const dest = shellQuote(entry.originalPath)
  const parent = shellQuote(entry.originalPath.replace(/\/[^/]*$/, '') || '/')
  return `[ -e ${src} ] || { echo ${shellQuote(`WSLPAD_MISSING`)} 1>&2; exit 1; }
[ -e ${dest} ] && { echo ${shellQuote(`WSLPAD_EXISTS`)} 1>&2; exit 1; }
mkdir -p ${parent} || exit 1
mv ${src} ${dest} || exit 1
rm -f ${info}`
}

export async function restoreFromTrash(
  runner: DistroRunner,
  distro: string,
  homeDir: string,
  trashNames: readonly string[]
): Promise<void> {
  if (trashNames.length === 0) return
  const trashDir = `${homeDir.replace(/\/+$/, '')}/.local/share/Trash`
  // Re-read rather than trusting a name from the renderer: the record on disk
  // is what says where the file belongs.
  const entries = await listTrash(runner, distro, homeDir)
  for (const name of trashNames) {
    const entry = entries.find((e) => e.trashName === name)
    if (entry === undefined) {
      throw new ExplorerError('ENOENT', name, `Nothing in the trash is called ${name}`)
    }
    const result = await runner.runInDistro(distro, buildRestoreScript(trashDir, entry), {
      timeoutMs: FILE_OP_TIMEOUT_MS
    })
    if (result.stderr.includes('WSLPAD_EXISTS')) {
      throw new ExplorerError(
        'EEXIST',
        entry.originalPath,
        `${entry.originalPath} already exists — restoring would overwrite it`
      )
    }
    if (result.stderr.includes('WSLPAD_MISSING')) {
      throw new ExplorerError(
        'ENOENT',
        entry.originalPath,
        `The trashed copy of ${entry.originalPath} is gone`
      )
    }
    if (result.timedOut || result.code !== 0) {
      throw explorerErrorFromResult(entry.originalPath, result)
    }
  }
}
