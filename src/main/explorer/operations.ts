import type { FileOpProgress, FileOpStatus } from '@shared/types'
import { ExplorerError, type DistroRunner } from '../wsl/contracts'
import { assertValidLinuxPath, shellQuote } from '../wsl/escape'
import { EXIT_EEXIST, explorerErrorFromResult } from './listing'
import { joinLinuxPath, linuxBasename, parentLinuxPath } from './path-convert'

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
  if (!isValidFileName(newName)) {
    throw new ExplorerError('UNKNOWN', path, `Invalid file name: ${JSON.stringify(newName)}`)
  }
  const target = joinLinuxPath(parentLinuxPath(path), newName)
  const qs = shellQuote(path)
  const qt = shellQuote(target)
  const result = await runner.runInDistro(distro, `${existsGuard(qt)}; mv ${qs} ${qt}`)
  if (result.code !== 0 || result.timedOut) {
    throw explorerErrorFromResult(result.code === EXIT_EEXIST ? target : path, result)
  }
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
  const totalItems = sources.length
  let doneItems = 0
  const errors: string[] = []
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
  for (const source of sources) {
    if (ctx.isCancelled()) {
      emit('cancelled', null)
      return
    }
    emit('running', source)
    try {
      assertValidLinuxPath(source)
      const dest = joinLinuxPath(destDir, linuxBasename(source))
      const qd = shellQuote(dest)
      const script = `${existsGuard(qd)}; ${move ? 'mv' : 'cp -a'} ${shellQuote(source)} ${qd}`
      const result = await ctx.runner.runInDistro(distro, script, {
        timeoutMs: FILE_OP_TIMEOUT_MS
      })
      if (result.code !== 0 || result.timedOut) {
        errors.push(explorerErrorFromResult(result.code === EXIT_EEXIST ? dest : source, result).message)
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
    doneItems++
    emit('running', source)
  }
  emit(errors.length > 0 ? 'error' : 'done', null, errors.length > 0 ? errors.join('; ') : null)
}

/** Permanent delete — only invoked after the renderer confirmed (goal.md §7.4). */
export async function removeEntries(
  runner: DistroRunner,
  distro: string,
  paths: string[]
): Promise<void> {
  for (const path of paths) {
    assertValidLinuxPath(path)
    if (path === '/') throw new ExplorerError('UNKNOWN', path, 'Refusing to remove /')
    const result = await runner.runInDistro(distro, `rm -rf ${shellQuote(path)}`, {
      timeoutMs: FILE_OP_TIMEOUT_MS
    })
    if (result.code !== 0 || result.timedOut) throw explorerErrorFromResult(path, result)
  }
}
