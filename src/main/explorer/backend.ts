import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { FileOpKind, FileOpProgress } from '@shared/types'
import {
  ExplorerError,
  type DistroRunner,
  type ExplorerBackend,
  type ExplorerListOpts
} from '../wsl/contracts'
import { assertValidLinuxPath, shellQuote } from '../wsl/escape'
import { readTextFile, writeTextFile } from './editor'
import { listDirectory, listTree, searchDirectory, statPath } from './listing'
import {
  createEmptyFile,
  makeDirectory,
  removeEntries,
  renameEntry,
  runCopyMove,
  type OpContext
} from './operations'
import { convertLinuxToWindows, convertWindowsToLinux } from './path-convert'
import { trashEntries } from './trash'
import { runExport, runImport } from './transfer'

/**
 * Real explorer backend over the Hidden Runner (goal.md §7, §9). Every path
 * reaches the shell through shellQuote(); nothing here ever appears in the
 * user Console transcript.
 */
export function createRealExplorerBackend(runner: DistroRunner): ExplorerBackend {
  const emitter = new EventEmitter()
  const ops = new Map<string, { cancelled: boolean }>()
  const homeCache = new Map<string, string>()

  const startOp = (
    kind: FileOpKind,
    run: (ctx: OpContext, opId: string) => Promise<void>
  ): string => {
    const opId = randomUUID()
    ops.set(opId, { cancelled: false })
    const ctx: OpContext = {
      runner,
      emit: (p) => emitter.emit('progress', p),
      isCancelled: () => ops.get(opId)?.cancelled ?? false
    }
    void run(ctx, opId)
      .catch((err: unknown) => {
        const progress: FileOpProgress = {
          opId,
          kind,
          status: 'error',
          totalItems: null,
          doneItems: null,
          totalBytes: null,
          doneBytes: null,
          currentItem: null,
          error: err instanceof Error ? err.message : String(err)
        }
        emitter.emit('progress', progress)
      })
      .finally(() => ops.delete(opId))
    return opId
  }

  const homeDir = async (distro: string): Promise<string> => {
    const cached = homeCache.get(distro)
    if (cached !== undefined) return cached
    const result = await runner.runInDistro(distro, 'echo "$HOME"')
    const home = result.stdout.trim()
    if (result.code !== 0 || !home.startsWith('/')) {
      throw new ExplorerError('UNKNOWN', '~', `Could not resolve $HOME in ${distro}`, {
        stderr: result.stderr || undefined
      })
    }
    homeCache.set(distro, home)
    return home
  }

  return {
    homeDir,

    list: (distro, path, opts?: ExplorerListOpts) =>
      listDirectory(runner, distro, path, opts?.showHidden ?? true),

    tree: (distro, path) => listTree(runner, distro, path),

    stat: (distro, path) => statPath(runner, distro, path),

    mkdir: (distro, path) => makeDirectory(runner, distro, path),

    createFile: (distro, path) => createEmptyFile(runner, distro, path),

    rename: (distro, path, newName) => renameEntry(runner, distro, path, newName),

    copyMove: async (distro, sources, destDir, move) => {
      assertValidLinuxPath(destDir)
      for (const source of sources) assertValidLinuxPath(source)
      return startOp(move ? 'move' : 'copy', (ctx, opId) =>
        runCopyMove(ctx, opId, distro, sources, destDir, move)
      )
    },

    trash: async (distro, paths) => {
      const home = await homeDir(distro)
      await trashEntries(runner, distro, paths, home)
    },

    remove: (distro, paths) => removeEntries(runner, distro, paths),

    readText: (distro, path, maxBytes) => readTextFile(runner, distro, path, maxBytes),

    writeText: (distro, path, content) => writeTextFile(runner, distro, path, content),

    importFromWindows: async (distro, windowsPaths, destDir) => {
      assertValidLinuxPath(destDir)
      return startOp('import', (ctx, opId) => runImport(ctx, opId, distro, windowsPaths, destDir))
    },

    exportToWindows: async (distro, paths, windowsDir) => {
      for (const path of paths) assertValidLinuxPath(path)
      return startOp('export', (ctx, opId) => runExport(ctx, opId, distro, paths, windowsDir))
    },

    cancelOp: async (opId) => {
      const op = ops.get(opId)
      if (op) op.cancelled = true
    },

    search: (distro, path, query) => searchDirectory(runner, distro, path, query),

    convertPath: async (distro, input, to) => {
      if (input.includes('\0') || input.includes('\n')) {
        throw new ExplorerError('UNKNOWN', input, `Path is not mappable: ${JSON.stringify(input)}`)
      }
      if (to === 'windows') {
        try {
          return convertLinuxToWindows(distro, input)
        } catch {
          throw new ExplorerError('UNKNOWN', input, `Path is not mappable: ${input}`)
        }
      }
      const direct = convertWindowsToLinux(distro, input)
      if (direct !== null) return direct
      // Pure table cannot map it (e.g. substituted network drive) — ask wslpath.
      const result = await runner.runInDistro(distro, `wslpath -u ${shellQuote(input)}`)
      const mapped = result.stdout.trim()
      if (result.code === 0 && mapped.startsWith('/')) return mapped
      throw new ExplorerError('UNKNOWN', input, `Path is not mappable: ${input}`)
    },

    onProgress: (cb) => {
      emitter.on('progress', cb)
      return () => emitter.off('progress', cb)
    }
  }
}
