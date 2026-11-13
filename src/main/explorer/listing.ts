import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { FileEntry, FileEntryType, FileStat } from '@shared/types'
import {
  ExplorerError,
  type DistroRunner,
  type ExplorerErrorCode,
  type RunOptions,
  type RunResult
} from '../wsl/contracts'
import { assertValidLinuxPath, shellQuote, shellQuoteAll } from '../wsl/escape'
import { convertLinuxToWindows, joinLinuxPath, linuxBasename } from './path-convert'

// ---------------------------------------------------------------------------
// Reserved exit codes: scripts signal typed failures without stderr parsing.
// ---------------------------------------------------------------------------

export const EXIT_ENOENT = 40
export const EXIT_EEXIST = 41
export const EXIT_EISDIR = 42
export const EXIT_EACCES = 43
export const EXIT_UNKNOWN = 44
export const EXIT_ENOTDIR = 45

const EXIT_CODE_MAP: Record<number, ExplorerErrorCode> = {
  [EXIT_ENOENT]: 'ENOENT',
  [EXIT_EEXIST]: 'EEXIST',
  [EXIT_EISDIR]: 'EISDIR',
  [EXIT_EACCES]: 'EACCES',
  [EXIT_UNKNOWN]: 'UNKNOWN',
  [EXIT_ENOTDIR]: 'ENOTDIR'
}

function sniffStderr(stderr: string): ExplorerErrorCode {
  if (/permission denied/i.test(stderr)) return 'EACCES'
  if (/no such file or directory/i.test(stderr)) return 'ENOENT'
  if (/not a directory/i.test(stderr)) return 'ENOTDIR'
  if (/is a directory/i.test(stderr)) return 'EISDIR'
  if (/file exists/i.test(stderr)) return 'EEXIST'
  return 'UNKNOWN'
}

/** Map a failed RunResult to a structured ExplorerError (goal.md §14). */
export function explorerErrorFromResult(path: string, result: RunResult): ExplorerError {
  const detail = { stderr: result.stderr || undefined }
  if (result.timedOut) return new ExplorerError('TIMEOUT', path, `TIMEOUT: ${path}`, detail)
  const code =
    (result.code === null ? undefined : EXIT_CODE_MAP[result.code]) ?? sniffStderr(result.stderr)
  return new ExplorerError(code, path, `${code}: ${path}`, detail)
}

// ---------------------------------------------------------------------------
// GNU find based listing (goal.md §7.3)
// ---------------------------------------------------------------------------

// Names and link targets may both contain '|', so '|' cannot end the name.
// The path below the find root (%P) is printed with its depth (%d) and a '/'
// before the target instead: path components never contain '/', so the
// depth-th '/' is the one boundary a name or target cannot fake (issue #181).
// Both may hold newlines too, so a record ends with NUL, the one byte neither
// can contain; `head -z` counts complete search hits without counting newlines
// embedded in a name or link target (issue #185).
const FIND_FMT = '%y|%m|%u|%g|%s|%T@|%d|%P/%l\\0\\n'

/** The runner keeps FIND_FMT's NULs and any CR inside a name. */
const FIND_RUN_OPTS: RunOptions = { timeoutMs: RUNNER_SLOW_TIMEOUT_MS, nulDelimited: true }

const TYPE_MAP: Record<string, FileEntryType> = { d: 'directory', f: 'file', l: 'symlink' }

/** Symbolic permission string for a 3–4 digit octal mode, incl. suid/sgid/sticky. */
export function octalToRwx(octal: string): string {
  const digits = octal.replace(/[^0-7]/g, '')
  if (digits.length === 0) return '---------'
  const padded = digits.slice(-4).padStart(4, '0')
  const special = Number.parseInt(padded[0], 8)
  const specialMask = [4, 2, 1]
  const specialChar = ['s', 's', 't']
  let out = ''
  for (let i = 0; i < 3; i++) {
    const bits = Number.parseInt(padded[i + 1], 8)
    out += bits & 4 ? 'r' : '-'
    out += bits & 2 ? 'w' : '-'
    if (special & specialMask[i]) out += bits & 1 ? specialChar[i] : specialChar[i].toUpperCase()
    else out += bits & 1 ? 'x' : '-'
  }
  return out
}

interface ParsedFindLine {
  type: FileEntryType
  octal: string
  owner: string
  group: string
  size: number | null
  mtime: string | null
  name: string
  relPath: string
  linkTarget: string | null
}

function epochToIso(raw: string): string | null {
  const seconds = Number.parseFloat(raw)
  return Number.isFinite(seconds) ? new Date(Math.round(seconds * 1000)).toISOString() : null
}

function parseFindLine(line: string): ParsedFindLine | null {
  const parts = line.split('|')
  if (parts.length < 8) return null
  const depth = Number(parts[6])
  if (!Number.isInteger(depth) || depth < 1) return null
  // Pipes after the seven fixed fields belong to the path or target; only the
  // depth-th '/' separates them.
  const segments = parts.slice(7).join('|').split('/')
  if (segments.length <= depth) return null
  const components = segments.slice(0, depth)
  if (components.some((c) => !c)) return null
  const type = TYPE_MAP[parts[0]] ?? 'other'
  // %l is empty for non-links, so only a symlink can carry a target.
  const target = segments.slice(depth).join('/')
  const size = Number.parseInt(parts[4], 10)
  return {
    type,
    octal: parts[1],
    owner: parts[2],
    group: parts[3],
    size: Number.isFinite(size) ? size : null,
    mtime: epochToIso(parts[5]),
    name: components[depth - 1],
    relPath: components.join('/'),
    linkTarget: type === 'symlink' ? target || null : null
  }
}

function toEntry(rootPath: string, parsed: ParsedFindLine): FileEntry {
  const name = parsed.name
  return {
    name,
    path: joinLinuxPath(rootPath, parsed.relPath),
    type: parsed.type,
    sizeBytes: parsed.type === 'directory' ? null : parsed.size,
    mtime: parsed.mtime,
    owner: parsed.owner,
    group: parsed.group,
    permissions: octalToRwx(parsed.octal),
    permissionsOctal: parsed.octal,
    isHidden: name.startsWith('.'),
    symlinkTarget: parsed.linkTarget,
    targetType: null
  }
}

/**
 * Split find output into records. Whatever follows the last NUL was cut off by
 * `head` or the output cap, so it is dropped rather than listed under a
 * truncated name. Text without any NUL comes from a runner that strips them and
 * leaves newline-terminated lines: those still parse, only a name holding a
 * newline stays unreadable.
 */
function findRecords(text: string): string[] {
  if (!text.includes('\0')) return text.split('\n')
  const records = text.split('\0')
  records.pop()
  // Each record after the first starts with the newline of the previous one's end.
  return records.map((record) => (record.startsWith('\n') ? record.slice(1) : record))
}

/**
 * Parse `find <root> -printf '%y|%m|%u|%g|%s|%T@|%d|%P/%l\0\n'` output — one
 * directory, or nested search hits — into entries with paths under `rootPath`.
 */
export function parseFindListing(rootPath: string, text: string): FileEntry[] {
  const out: FileEntry[] = []
  for (const record of findRecords(text)) {
    if (!record) continue
    const parsed = parseFindLine(record)
    if (!parsed) continue
    out.push(toEntry(rootPath, parsed))
  }
  return out
}

const dirGuard = (quoted: string): string =>
  `LC_ALL=C stat -L -- ${quoted} >/dev/null || exit $?; ` +
  `if [ ! -d ${quoted} ]; then exit ${EXIT_ENOTDIR}; fi`

async function resolveSymlinkTargets(
  runner: DistroRunner,
  distro: string,
  entries: FileEntry[]
): Promise<void> {
  const links = entries.filter((e) => e.type === 'symlink')
  if (links.length === 0) return
  const script =
    `for p in ${shellQuoteAll(links.map((l) => l.path))}; do ` +
    `if [ -d "$p" ]; then echo d; elif [ -e "$p" ]; then echo f; else echo x; fi; done`
  const result = await runner.runInDistro(distro, script)
  if (result.code !== 0 || result.timedOut) return
  const kinds = result.stdout.split('\n').filter((l) => l.length > 0)
  links.forEach((link, i) => {
    link.targetType = kinds[i] === 'd' ? 'directory' : kinds[i] === 'f' ? 'file' : null
  })
}

export async function listDirectory(
  runner: DistroRunner,
  distro: string,
  dirPath: string,
  showHidden: boolean
): Promise<FileEntry[]> {
  assertValidLinuxPath(dirPath)
  const q = shellQuote(dirPath)
  const script = `${dirGuard(q)}; LC_ALL=C find -H ${q} -mindepth 1 -maxdepth 1 -printf '${FIND_FMT}'`
  const result = await runner.runInDistro(distro, script, FIND_RUN_OPTS)
  // find exits non-zero when single entries are unreadable but still lists the
  // rest — only treat it as fatal when nothing came back at all.
  if (result.timedOut || (result.code !== 0 && !result.stdout)) {
    throw explorerErrorFromResult(dirPath, result)
  }
  let entries = parseFindListing(dirPath, result.stdout)
  if (!showHidden) entries = entries.filter((e) => !e.isHidden)
  await resolveSymlinkTargets(runner, distro, entries)
  return entries
}

/** Immediate subdirectories only — lazy folder tree (goal.md §15). */
export async function listTree(
  runner: DistroRunner,
  distro: string,
  dirPath: string
): Promise<FileEntry[]> {
  assertValidLinuxPath(dirPath)
  const q = shellQuote(dirPath)
  // -H follows a symlink when the requested tree root is itself a link, while
  // -type l includes child links so their targets can be checked below.
  const script = `${dirGuard(q)}; LC_ALL=C find -H ${q} -mindepth 1 -maxdepth 1 '(' -type d -o -type l ')' -printf '${FIND_FMT}'`
  const result = await runner.runInDistro(distro, script, FIND_RUN_OPTS)
  if (result.timedOut || (result.code !== 0 && !result.stdout)) {
    throw explorerErrorFromResult(dirPath, result)
  }
  const entries = parseFindListing(dirPath, result.stdout)
  await resolveSymlinkTargets(runner, distro, entries)
  return entries.filter(
    (e) => e.type === 'directory' || (e.type === 'symlink' && e.targetType === 'directory')
  )
}

const STAT_FMT = '%A\\0%a\\0%U\\0%G\\0%s\\0%Y\\0%X\\0%i\\0'

export async function statPath(
  runner: DistroRunner,
  distro: string,
  path: string
): Promise<FileStat> {
  assertValidLinuxPath(path)
  const q = shellQuote(path)
  const script = [
    `LC_ALL=C stat --printf '${STAT_FMT}' -- ${q} || exit $?`,
    `if [ -L ${q} ]; then LC_ALL=C readlink -z -- ${q} || exit $?; ` +
      `if [ -d ${q} ]; then printf 'd\\0'; elif [ -e ${q} ]; then printf 'f\\0'; else printf 'x\\0'; fi; fi`
  ].join('\n')
  const result = await runner.runInDistro(distro, script, { nulDelimited: true })
  if (result.code !== 0 || result.timedOut) throw explorerErrorFromResult(path, result)
  const fields = result.stdout.split('\0')
  const isLink = fields[0]?.startsWith('l')
  if (!result.stdout.endsWith('\0') || fields.length !== (isLink ? 11 : 9)) {
    throw new ExplorerError('UNKNOWN', path, `Unexpected stat output for ${path}`, {
      stderr: result.stderr || undefined
    })
  }
  const [mode, octal, owner, group, sizeStr, mtimeStr, atimeStr, inodeStr] = fields
  const type: FileEntryType =
    mode[0] === 'd' ? 'directory' : mode[0] === 'l' ? 'symlink' : mode[0] === '-' ? 'file' : 'other'
  // Link targets are opaque: newlines and pipes are legal filename characters.
  const symlinkTarget = isLink ? fields[8] : null
  const targetType =
    isLink && fields[9] === 'd' ? 'directory' : isLink && fields[9] === 'f' ? 'file' : null
  const name = linuxBasename(path)
  const size = Number.parseInt(sizeStr, 10)
  const inode = Number.parseInt(inodeStr, 10)
  return {
    name,
    path,
    type,
    sizeBytes: type === 'directory' || !Number.isFinite(size) ? null : size,
    mtime: epochToIso(mtimeStr),
    owner,
    group,
    permissions: octalToRwx(octal),
    permissionsOctal: octal,
    isHidden: name.startsWith('.'),
    symlinkTarget,
    targetType,
    inode: Number.isFinite(inode) ? inode : null,
    atime: epochToIso(atimeStr),
    windowsPath: convertLinuxToWindows(distro, path)
  }
}

/** Resolve an existing path inside the distro using its actual filesystem semantics. */
export async function resolveRealPath(
  runner: DistroRunner,
  distro: string,
  path: string
): Promise<string> {
  assertValidLinuxPath(path)
  const q = shellQuote(path)
  const result = await runner.runInDistro(distro, `LC_ALL=C realpath -z -e -- ${q}`, {
    nulDelimited: true
  })
  if (result.code !== 0 || result.timedOut) throw explorerErrorFromResult(path, result)
  if (!result.stdout.endsWith('\0')) {
    throw new ExplorerError('UNKNOWN', path, `Unexpected realpath output for ${path}`)
  }
  const resolvedPath = result.stdout.slice(0, -1)
  if (!resolvedPath.startsWith('/')) {
    throw new ExplorerError('UNKNOWN', path, `Unexpected realpath output for ${path}`)
  }
  return resolvedPath
}

/** Strip glob/path metacharacters so the query stays a plain -iname substring. */
export function sanitizeSearchQuery(query: string): string {
  return query.replace(/[/\\*?[\]\0\r\n]/g, '').trim()
}

export async function searchDirectory(
  runner: DistroRunner,
  distro: string,
  dirPath: string,
  query: string
): Promise<FileEntry[]> {
  assertValidLinuxPath(dirPath)
  const sanitized = sanitizeSearchQuery(query)
  if (!sanitized) return []
  const q = shellQuote(dirPath)
  const pattern = shellQuote(`*${sanitized}*`)
  // -H follows the requested root if navigation landed on a directory symlink.
  const script =
    `${dirGuard(q)}; LC_ALL=C find -H ${q} -mindepth 1 -maxdepth 4 -iname ${pattern} ` +
    `-printf '${FIND_FMT}' 2>/dev/null | head -z -n 200`
  const result = await runner.runInDistro(distro, script, FIND_RUN_OPTS)
  if (result.timedOut || (result.code !== 0 && !result.stdout)) {
    throw explorerErrorFromResult(dirPath, result)
  }
  const entries = parseFindListing(dirPath, result.stdout)
  await resolveSymlinkTargets(runner, distro, entries)
  return entries
}
