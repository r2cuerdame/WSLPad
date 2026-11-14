import type { FileOpProgress, FileOpStatus } from '@shared/types'
import { ExplorerError, type DistroRunner } from '../wsl/contracts'
import { assertValidLinuxPath, shellQuote } from '../wsl/escape'
import { nextCopyName } from './copy-name'
import { EXIT_EEXIST, explorerErrorFromResult } from './listing'
import {
  isInsideLinux,
  isLinuxRoot,
  joinLinuxPath,
  linuxBasename,
  normalizeLinuxPath,
  parentLinuxPath
} from './path-convert'

/** Copies of large trees can far exceed the hidden-query timeout. */
export const FILE_OP_TIMEOUT_MS = 10 * 60 * 1000

/** Shared context for background file operations run via the op registry. */
export interface OpContext {
  runner: DistroRunner
  emit(progress: FileOpProgress): void
  isCancelled(): boolean
}

const NAME_FORBIDDEN_RE = /[/\\\0\n]/

export function isValidFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !NAME_FORBIDDEN_RE.test(name) &&
    name !== '.' &&
    name !== '..'
  )
}

/** EEXIST guard shared by create/copy/move — -L catches broken symlinks too. */
export const existsGuard = (quotedPath: string): string =>
  `if [ -e ${quotedPath} ] || [ -L ${quotedPath} ]; then exit ${EXIT_EEXIST}; fi`

export async function makeDirectory(
  runner: DistroRunner,
  distro: string,
  path: string
): Promise<void> {
  assertValidLinuxPath(path)
  const q = shellQuote(path)
  const result = await runner.runInDistro(distro, `${existsGuard(q)}; mkdir -p ${q}`)
  if (result.code !== 0 || result.timedOut) throw explorerErrorFromResult(path, result)
}

export async function createEmptyFile(
  runner: DistroRunner,
  distro: string,
  path: string
): Promise<void> {
  assertValidLinuxPath(path)
  const q = shellQuote(path)
  const result = await runner.runInDistro(distro, `${existsGuard(q)}; : > ${q}`)
  if (result.code !== 0 || result.timedOut) throw explorerErrorFromResult(path, result)
}

export async function renameEntry(
  runner: DistroRunner,
  distro: string,
  path: string,
  newName: string
): Promise<void> {
  assertValidLinuxPath(path)
  if (isLinuxRoot(path)) throw new ExplorerError('UNKNOWN', path, `Refusing to rename ${path}`)
  if (!isValidFileName(newName)) {
    throw new ExplorerError('UNKNOWN', path, `Invalid file name: ${JSON.stringify(newName)}`)
  }
  if (linuxBasename(path) === newName) return
  const target = joinLinuxPath(parentLinuxPath(path), newName)
  const qs = shellQuote(path)
  const qt = shellQuote(target)
  const result = await runner.runInDistro(distro, `${existsGuard(qt)}; mv ${qs} ${qt}`)
  if (result.code !== 0 || result.timedOut) {
    throw explorerErrorFromResult(result.code === EXIT_EEXIST ? target : path, result)
  }
}

function parseSameFolderProbe(stdout: string): { isDirectory: boolean; existing: Set<string> } {
  const parts = stdout.split('\0')
  const isDirectory = parts[0] === 'd'
  const existing = new Set(parts.slice(1).filter((name) => name.length > 0))
  return { isDirectory, existing }
}

async function copySameFolderItem(
  runner: DistroRunner,
  distro: string,
  source: string,
  destDir: string,
  batchCreated: Set<string>
): Promise<string | null> {
  const qs = shellQuote(source)
  const qDir = shellQuote(destDir)
  // `-H` follows a symlinked destDir; `-L` ensures symlinks to directories keep their name stem.
  const probeScript =
    `if [ -d ${qs} ] && [ ! -L ${qs} ]; then printf 'd\\0'; else printf 'f\\0'; fi; ` +
    `LC_ALL=C find -H ${qDir} -mindepth 1 -maxdepth 1 -printf '%f\\0'`
  const probeResult = await runner.runInDistro(distro, probeScript, {
    timeoutMs: FILE_OP_TIMEOUT_MS,
    nulDelimited: true
  })
  if (probeResult.code !== 0 || probeResult.timedOut) {
    return explorerErrorFromResult(destDir, probeResult).message
  }
  const { isDirectory, existing } = parseSameFolderProbe(probeResult.stdout)
  for (const created of batchCreated) existing.add(created)

  const baseName = linuxBasename(source)
  let candidate = nextCopyName(baseName, isDirectory, existing)
  for (let attempt = 0; attempt < 2; attempt++) {
    const dest = joinLinuxPath(destDir, candidate.name)
    const qd = shellQuote(dest)
    const script = `${existsGuard(qd)}; cp -a ${qs} ${qd}`
    const result = await runner.runInDistro(distro, script, {
      timeoutMs: FILE_OP_TIMEOUT_MS
    })
    if (result.code === 0 && !result.timedOut) {
      batchCreated.add(candidate.name)
      return null
    }
    if (result.code === EXIT_EEXIST && !result.timedOut && attempt === 0) {
      existing.add(candidate.name)
      candidate = nextCopyName(baseName, isDirectory, existing, candidate.index + 1)
      continue
    }
    return explorerErrorFromResult(result.code === EXIT_EEXIST ? dest : source, result).message
  }
  return null
}

/**
 * Sequential per-item copy/move (never sudo). Conflicts are recorded per item
 * as EEXIST and the remaining items still run; cancel is honored between items.
 */
export async function runCopyMove(
  ctx: OpContext,
  opId: string,
  distro: string,
  sources: string[],
  destDir: string,
  move: boolean
): Promise<void> {
  const kind = move ? 'move' : 'copy'
  const uniqueSources = [...new Set(sources)]
  const totalItems = uniqueSources.length
  let doneItems = 0
  const errors: string[] = []
  const normalizedDestDir = normalizeLinuxPath(destDir)
  const batchCreated = new Set<string>()
  const emit = (status: FileOpStatus, currentItem: string | null, error: string | null = null) =>
    ctx.emit({
      opId,
      kind,
      status,
      totalItems,
      doneItems,
      totalBytes: null,
      doneBytes: null,
      currentItem,
      error
    })
  for (const source of uniqueSources) {
    if (ctx.isCancelled()) {
      emit('cancelled', null)
      return
    }
    emit('running', source)
    try {
      assertValidLinuxPath(source)
      if (isLinuxRoot(source)) {
        throw new ExplorerError('UNKNOWN', source, `Refusing to ${kind} ${source}`)
      }
      // cp -a into its own subtree recurses until the timeout or a full disk.
      if (isInsideLinux(destDir, source)) {
        throw new ExplorerError('UNKNOWN', source, `Cannot ${kind} ${source} into itself`)
      }
      const normalizedSource = normalizeLinuxPath(source)
      if (parentLinuxPath(normalizedSource) === normalizedDestDir) {
        if (!move) {
          const error = await copySameFolderItem(
            ctx.runner,
            distro,
            normalizedSource,
            normalizedDestDir,
            batchCreated
          )
          if (error) errors.push(error)
        }
      } else {
        const dest = joinLinuxPath(destDir, linuxBasename(source))
        const qd = shellQuote(dest)
        const script = `${existsGuard(qd)}; ${move ? 'mv' : 'cp -a'} ${shellQuote(source)} ${qd}`
        const result = await ctx.runner.runInDistro(distro, script, {
          timeoutMs: FILE_OP_TIMEOUT_MS
        })
        if (result.code !== 0 || result.timedOut) {
          errors.push(
            explorerErrorFromResult(result.code === EXIT_EEXIST ? dest : source, result).message
          )
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
    doneItems++
    emit('running', source)
  }
  emit(errors.length > 0 ? 'error' : 'done', null, errors.length > 0 ? errors.join('; ') : null)
}

/**
 * Permanent delete — only invoked after the renderer confirmed (goal.md §7.4).
 * The whole batch is checked before the first rm: a batch that names the root
 * is refused as a whole rather than after deleting its other items.
 */
export async function removeEntries(
  runner: DistroRunner,
  distro: string,
  paths: string[]
): Promise<void> {
  const uniquePaths = [...new Set(paths)]
  for (const path of uniquePaths) {
    assertValidLinuxPath(path)
    if (isLinuxRoot(path)) throw new ExplorerError('UNKNOWN', path, `Refusing to remove ${path}`)
  }
  for (const path of uniquePaths) {
    const result = await runner.runInDistro(distro, `rm -rf ${shellQuote(path)}`, {
      timeoutMs: FILE_OP_TIMEOUT_MS
    })
    if (result.code !== 0 || result.timedOut) throw explorerErrorFromResult(path, result)
  }
}
