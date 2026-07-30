import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { FileEntry, FileEntryType, FileStat } from '@shared/types'
import {
  ExplorerError,
  type DistroRunner,
  type ExplorerErrorCode,
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

const FIND_FMT = '%y|%m|%u|%g|%s|%T@|%f|%l\\n'
const FIND_PATH_FMT = '%y|%m|%u|%g|%s|%T@|%p|%l\\n'

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
  nameField: string
  linkTarget: string | null
}

function epochToIso(raw: string): string | null {
  const seconds = Number.parseFloat(raw)
  return Number.isFinite(seconds) ? new Date(Math.round(seconds * 1000)).toISOString() : null
}

function parseFindLine(line: string): ParsedFindLine | null {
  const parts = line.split('|')
  if (parts.length < 8) return null
  const type = TYPE_MAP[parts[0]] ?? 'other'
  let nameField: string
  let linkTarget: string | null
  if (type === 'symlink') {
    nameField = parts[6]
    linkTarget = parts.slice(7).join('|') || null
  } else {
    // %l is empty for non-links, so the last field is empty; pipes inside the
    // name re-join across the middle fields.
    nameField = parts.slice(6, -1).join('|')
    linkTarget = null
  }
  if (!nameField) return null
  const size = Number.parseInt(parts[4], 10)
  return {
    type,
    octal: parts[1],
    owner: parts[2],
    group: parts[3],
    size: Number.isFinite(size) ? size : null,
    mtime: epochToIso(parts[5]),
    nameField,
    linkTarget
  }
}

function toEntry(name: string, path: string, parsed: ParsedFindLine): FileEntry {
  return {
    name,
    path,
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

/** Parse `find -printf '%y|%m|%u|%g|%s|%T@|%f|%l\n'` output for one directory. */
export function parseFindListing(dirPath: string, text: string): FileEntry[] {
  const out: FileEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const parsed = parseFindLine(line)
    if (!parsed) continue
    out.push(toEntry(parsed.nameField, joinLinuxPath(dirPath, parsed.nameField), parsed))
  }
  return out
}

/** Variant for search results printed with %p (full path) instead of %f. */
export function parseFindPathListing(text: string): FileEntry[] {
  const out: FileEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const parsed = parseFindLine(line)
    if (!parsed) continue
    out.push(toEntry(linuxBasename(parsed.nameField), parsed.nameField, parsed))
  }
  return out
}

const dirGuard = (quoted: string): string =>
  `if [ ! -e ${quoted} ]; then exit ${EXIT_ENOENT}; fi; ` +
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
  const script = `${dirGuard(q)}; find ${q} -mindepth 1 -maxdepth 1 -printf '${FIND_FMT}'`
  const result = await runner.runInDistro(distro, script, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS })
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
  const script = `${dirGuard(q)}; find ${q} -mindepth 1 -maxdepth 1 -type d -printf '${FIND_FMT}'`
  const result = await runner.runInDistro(distro, script, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS })
  if (result.timedOut || (result.code !== 0 && !result.stdout)) {
    throw explorerErrorFromResult(dirPath, result)
  }
  return parseFindListing(dirPath, result.stdout)
}

const STAT_FMT = '%F|%a|%U|%G|%s|%Y|%X|%i'

export async function statPath(
  runner: DistroRunner,
  distro: string,
  path: string
): Promise<FileStat> {
  assertValidLinuxPath(path)
  const q = shellQuote(path)
  const script = [
    `if [ ! -e ${q} ] && [ ! -L ${q} ]; then exit ${EXIT_ENOENT}; fi`,
    `stat -c '${STAT_FMT}' ${q} || exit ${EXIT_UNKNOWN}`,
    `if [ -L ${q} ]; then printf 'L|%s\\n' "$(readlink ${q})"; ` +
      `if [ -d ${q} ]; then echo 'T|d'; elif [ -e ${q} ]; then echo 'T|f'; else echo 'T|x'; fi; fi`
  ].join('\n')
  const result = await runner.runInDistro(distro, script)
  if (result.code !== 0 || result.timedOut) throw explorerErrorFromResult(path, result)
  const lines = result.stdout.split('\n').filter((l) => l.length > 0)
  const fields = (lines[0] ?? '').split('|')
  if (fields.length < 8) {
    throw new ExplorerError('UNKNOWN', path, `Unexpected stat output for ${path}`, {
      stderr: result.stderr || undefined
    })
  }
  const [typeName, octal, owner, group, sizeStr, mtimeStr, atimeStr, inodeStr] = fields
  const type: FileEntryType = typeName.includes('directory')
    ? 'directory'
    : typeName.includes('symbolic link')
      ? 'symlink'
      : typeName.includes('regular')
        ? 'file'
        : 'other'
  let symlinkTarget: string | null = null
  let targetType: 'file' | 'directory' | null = null
  for (const line of lines.slice(1)) {
    if (line.startsWith('L|')) symlinkTarget = line.slice(2) || null
    else if (line === 'T|d') targetType = 'directory'
    else if (line === 'T|f') targetType = 'file'
  }
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
  const script =
    `${dirGuard(q)}; find ${q} -mindepth 1 -maxdepth 4 -iname ${pattern} ` +
    `-printf '${FIND_PATH_FMT}' 2>/dev/null | head -200`
  const result = await runner.runInDistro(distro, script, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS })
  if (result.timedOut || (result.code !== 0 && !result.stdout)) {
    throw explorerErrorFromResult(dirPath, result)
  }
  return parseFindPathListing(result.stdout)
}
