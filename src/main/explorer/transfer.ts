import { RUNNER_SLOW_TIMEOUT_MS } from '@shared/constants'
import type { FileOpStatus } from '@shared/types'
import { ExplorerError, type DistroRunner } from '../wsl/contracts'
import { assertValidLinuxPath, shellQuote } from '../wsl/escape'
import { EXIT_EEXIST, explorerErrorFromResult } from './listing'
import { existsGuard, FILE_OP_TIMEOUT_MS, type OpContext } from './operations'
import { convertWindowsToLinux, joinLinuxPath, linuxBasename, windowsBasename } from './path-convert'

/**
 * Windows ↔ WSL transfers (goal.md §7.5). Existing destinations are reported
 * as per-item EEXIST errors — the renderer resolves a conflict by confirming
 * with the user, calling remove() on the destination and retrying the item.
 */

/** Map a Windows path into the distro; `wslpath -u` covers drives the pure table cannot. */
export async function resolveWindowsPath(
  runner: DistroRunner,
  distro: string,
  windowsPath: string
): Promise<string> {
  const direct = convertWindowsToLinux(distro, windowsPath)
  if (direct !== null) return direct
  if (!windowsPath.includes('\0') && !windowsPath.includes('\n')) {
    const result = await runner.runInDistro(distro, `wslpath -u ${shellQuote(windowsPath)}`)
    const mapped = result.stdout.trim()
    if (result.code === 0 && mapped.startsWith('/')) return mapped
  }
  throw new ExplorerError(
    'UNKNOWN',
    windowsPath,
    `Path is not mappable into ${distro}: ${windowsPath}`
  )
}

/** Byte size of one item: stat for files, du -sb for directories (slow timeout). */
async function sizeOfPath(
  runner: DistroRunner,
  distro: string,
  linuxPath: string
): Promise<number | null> {
  const q = shellQuote(linuxPath)
  const script = `if [ -d ${q} ]; then du -sb ${q} | cut -f1; else stat -Lc %s ${q}; fi`
  const result = await runner.runInDistro(distro, script, { timeoutMs: RUNNER_SLOW_TIMEOUT_MS })
  if (result.code !== 0 || result.timedOut) return null
  const n = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export async function runImport(
  ctx: OpContext,
  opId: string,
  distro: string,
  windowsPaths: string[],
  destDir: string
): Promise<void> {
  assertValidLinuxPath(destDir)
  const totalItems = windowsPaths.length
  let doneItems = 0
  let totalBytes = 0
  let doneBytes = 0
  const errors: string[] = []
  const emit = (status: FileOpStatus, currentItem: string | null, error: string | null = null) =>
    ctx.emit({
      opId,
      kind: 'import',
      status,
      totalItems,
      doneItems,
      totalBytes,
      doneBytes,
      currentItem,
      error
    })
  for (const windowsPath of windowsPaths) {
    if (ctx.isCancelled()) {
      emit('cancelled', null)
      return
    }
    emit('running', windowsPath)
    try {
      const source = await resolveWindowsPath(ctx.runner, distro, windowsPath)
      const size = await sizeOfPath(ctx.runner, distro, source)
      if (size !== null) {
        totalBytes += size
        emit('running', windowsPath)
      }
      const dest = joinLinuxPath(destDir, windowsBasename(windowsPath))
      const qd = shellQuote(dest)
      const script = `${existsGuard(qd)}; cp -a ${shellQuote(source)} ${qd}`
      const result = await ctx.runner.runInDistro(distro, script, {
        timeoutMs: FILE_OP_TIMEOUT_MS
      })
      if (result.code !== 0 || result.timedOut) {
        errors.push(
          explorerErrorFromResult(result.code === EXIT_EEXIST ? dest : source, result).message
        )
      } else if (size !== null) {
        doneBytes += size
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
    doneItems++
    emit('running', windowsPath)
  }
  emit(errors.length > 0 ? 'error' : 'done', null, errors.length > 0 ? errors.join('; ') : null)
}

export async function runExport(
  ctx: OpContext,
  opId: string,
  distro: string,
  paths: string[],
  windowsDir: string
): Promise<void> {
  const totalItems = paths.length
  let doneItems = 0
  let totalBytes = 0
  let doneBytes = 0
  const errors: string[] = []
  const emit = (status: FileOpStatus, currentItem: string | null, error: string | null = null) =>
    ctx.emit({
      opId,
      kind: 'export',
      status,
      totalItems,
      doneItems,
      totalBytes,
      doneBytes,
      currentItem,
      error
    })
  let destDirLinux: string
  try {
    // A \\wsl.localhost\<same distro>\… destination maps straight back to a
    // Linux path; C:\… maps to /mnt/c/… — either way cp runs in-distro.
    destDirLinux = await resolveWindowsPath(ctx.runner, distro, windowsDir)
  } catch (err) {
    emit('error', null, err instanceof Error ? err.message : String(err))
    return
  }
  for (const path of paths) {
    if (ctx.isCancelled()) {
      emit('cancelled', null)
      return
    }
    emit('running', path)
    try {
      assertValidLinuxPath(path)
      const size = await sizeOfPath(ctx.runner, distro, path)
      if (size !== null) {
        totalBytes += size
        emit('running', path)
      }
      const dest = joinLinuxPath(destDirLinux, linuxBasename(path))
      const qd = shellQuote(dest)
      const script = `${existsGuard(qd)}; cp -a ${shellQuote(path)} ${qd}`
      const result = await ctx.runner.runInDistro(distro, script, {
        timeoutMs: FILE_OP_TIMEOUT_MS
      })
      // drvfs often rejects ownership/mode preservation: the data is copied but
      // cp exits 1 with only "preserving …: Operation not permitted" warnings.
      const preserveWarningsOnly =
        result.code !== 0 &&
        result.stderr.trim().length > 0 &&
        result.stderr
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .every((l) => /preserv|operation not permitted/i.test(l))
      if (result.timedOut || (result.code !== 0 && !preserveWarningsOnly)) {
        errors.push(
          explorerErrorFromResult(result.code === EXIT_EEXIST ? dest : path, result).message
        )
      } else if (size !== null) {
        doneBytes += size
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
    doneItems++
    emit('running', path)
  }
  emit(errors.length > 0 ? 'error' : 'done', null, errors.length > 0 ? errors.join('; ') : null)
}
