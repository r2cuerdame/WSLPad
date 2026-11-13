import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { chmod, lstat, readFile, readdir, readlink, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WINDOWS_ROOT } from '@shared/constants'
import type { FileOpProgress } from '@shared/types'
import { createWindowsFs, type WindowsFs } from '../../../src/main/explorer/windows'
import { createFixtureWindowsFs } from '../../../src/main/wsl/fixture/windows'
import { ExplorerError } from '../../../src/main/wsl/contracts'

const IS_WINDOWS = process.platform === 'win32'

let root = ''
let trashed: string[] = []
let fs: WindowsFs

/** No electron import must happen, so both electron-backed hooks are injected. */
const deps = {
  getPath: (name: string): string => join(root, 'known', name),
  trashItem: async (path: string): Promise<void> => {
    trashed.push(path)
  }
}

function dir(...parts: string[]): string {
  const p = join(root, ...parts)
  mkdirSync(p, { recursive: true })
  return p
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'NO_ERROR'
  } catch (err) {
    if (err instanceof ExplorerError) return err.code
    return `NOT_EXPLORER_ERROR: ${String(err)}`
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for op')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function runOp(start: () => Promise<string>): Promise<FileOpProgress[]> {
  const events: FileOpProgress[] = []
  const off = fs.onProgress((p) => events.push(p))
  try {
    const opId = await start()
    await waitFor(() => events.some((e) => e.opId === opId && e.status !== 'running'))
    return events.filter((e) => e.opId === opId)
  } finally {
    off()
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wslpad-winfs-'))
  trashed = []
  fs = createWindowsFs(deps)
})

afterAll(() => {
  fs.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('createWindowsFs — listing', () => {
  it('maps entries without POSIX metadata and marks dot-prefixed names hidden', async () => {
    const base = dir('list-basic')
    writeFileSync(join(base, 'visible.txt'), 'hello')
    writeFileSync(join(base, '.dotfile'), 'x')
    mkdirSync(join(base, 'sub'))

    const entries = await fs.list(base)
    const byName = new Map(entries.map((e) => [e.name, e]))
    expect([...byName.keys()].sort()).toEqual(['.dotfile', 'sub', 'visible.txt'])

    const file = byName.get('visible.txt')!
    expect(file.type).toBe('file')
    expect(file.path).toBe(join(base, 'visible.txt'))
    expect(file.sizeBytes).toBe(5)
    expect(file.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(file.owner).toBeNull()
    expect(file.group).toBeNull()
    expect(file.permissions).toBeNull()
    expect(file.permissionsOctal).toBeNull()
    expect(file.symlinkTarget).toBeNull()
    expect(file.isHidden).toBe(false)

    expect(byName.get('sub')!.type).toBe('directory')
    expect(byName.get('sub')!.sizeBytes).toBeNull()
    expect(byName.get('.dotfile')!.isHidden).toBe(true)
  })

  it('filters hidden entries only when showHidden is explicitly false', async () => {
    const base = dir('list-hidden-option')
    writeFileSync(join(base, 'shown.txt'), 'a')
    writeFileSync(join(base, '.hidden'), 'b')

    expect((await fs.list(base)).map((e) => e.name).sort()).toEqual(['.hidden', 'shown.txt'])
    expect((await fs.list(base, {})).map((e) => e.name).sort()).toEqual(['.hidden', 'shown.txt'])
    expect((await fs.list(base, { showHidden: true })).length).toBe(2)
    expect((await fs.list(base, { showHidden: false })).map((e) => e.name)).toEqual(['shown.txt'])
  })

  it.runIf(IS_WINDOWS)('marks FILE_ATTRIBUTE_HIDDEN files hidden', async () => {
    const base = dir('list-attribute')
    const hidden = join(base, 'attr-hidden.txt')
    writeFileSync(hidden, 'x')
    writeFileSync(join(base, 'plain.txt'), 'x')
    execFileSync('attrib', ['+h', hidden], { windowsHide: true })

    const entries = await fs.list(base)
    expect(entries.find((e) => e.name === 'attr-hidden.txt')?.isHidden).toBe(true)
    expect(entries.find((e) => e.name === 'plain.txt')?.isHidden).toBe(false)
    expect((await fs.list(base, { showHidden: false })).map((e) => e.name)).toEqual(['plain.txt'])
    execFileSync('attrib', ['-h', hidden], { windowsHide: true })
  })

  it('lists drives for the This PC sentinel', async () => {
    const entries = await fs.list(WINDOWS_ROOT)
    expect(entries.length).toBeGreaterThan(0)
    const c = entries.find((e) => e.name === 'C:')
    expect(c).toBeDefined()
    expect(c!.path).toBe('C:\\')
    expect(c!.type).toBe('directory')
    expect(c!.sizeBytes).toBeNull()
    expect(c!.permissions).toBeNull()
    // tree() shows the same drives so the folder pane can expand from This PC.
    expect((await fs.tree(WINDOWS_ROOT)).map((e) => e.path)).toEqual(entries.map((e) => e.path))
  })

  it('returns only directories from tree()', async () => {
    const base = dir('tree-basic')
    mkdirSync(join(base, 'child'))
    writeFileSync(join(base, 'file.txt'), 'x')
    expect((await fs.tree(base)).map((e) => e.name)).toEqual(['child'])
  })

  it.runIf(IS_WINDOWS)('includes directory symlinks and junctions but excludes file and broken links', async () => {
    const base = dir('tree-links')
    const target = dir('tree-links', 'target')
    const file = join(base, 'target.txt')
    writeFileSync(file, 'x')
    await import('fs/promises').then(({ symlink }) => Promise.all([
      symlink(target, join(base, 'directory-link'), 'junction'),
      symlink(file, join(base, 'file-link'), 'file'),
      symlink(join(base, 'missing'), join(base, 'broken-link'), 'junction')
    ]))

    expect((await fs.tree(base)).map((entry) => [entry.name, entry.type, entry.targetType])).toEqual([
      ['directory-link', 'symlink', 'directory'],
      ['target', 'directory', null]
    ])
  })

  it('maps missing and non-directory paths to typed errors', async () => {
    const base = dir('list-errors')
    const file = join(base, 'plain.txt')
    writeFileSync(file, 'x')
    expect(await codeOf(() => fs.list(join(base, 'nope')))).toBe('ENOENT')
    expect(await codeOf(() => fs.list(file))).toBe('ENOTDIR')
    expect(await codeOf(() => fs.list('/not/a/windows/path'))).toBe('UNKNOWN')
  })

  it('stats a file with inode, atime and its own windows path', async () => {
    const base = dir('stat-basic')
    const file = join(base, 'stat-me.txt')
    writeFileSync(file, 'abcd')
    const info = await fs.stat(file)
    expect(info.name).toBe('stat-me.txt')
    expect(info.type).toBe('file')
    expect(info.sizeBytes).toBe(4)
    expect(info.windowsPath).toBe(file)
    expect(info.atime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(info.permissions).toBeNull()

    const pc = await fs.stat(WINDOWS_ROOT)
    expect(pc.type).toBe('directory')
    expect(pc.path).toBe(WINDOWS_ROOT)
  })
})

describe('createWindowsFs — places and home', () => {
  it('reports drives plus known folders from the injected deps', async () => {
    const profile = dir('known', 'home')
    dir('known', 'desktop')
    dir('known', 'documents')
    // 'downloads' is deliberately absent: missing folders must be skipped.

    const places = await fs.places()
    const drives = places.filter((p) => p.kind === 'drive')
    expect(drives.length).toBeGreaterThan(0)
    const c = drives.find((p) => p.label === 'C:')
    expect(c).toBeDefined()
    expect(c!.path).toBe('C:\\')
    expect(c!.id).toBe('drive-C')
    expect(c!.totalBytes === null || c!.totalBytes > 0).toBe(true)

    const folders = places.filter((p) => p.kind === 'folder')
    expect(folders.map((p) => p.id)).toEqual(['profile', 'desktop', 'documents'])
    expect(folders[0].path).toBe(profile)
    // Labels are raw folder names, never translated.
    expect(folders.map((p) => p.label)).toEqual(['home', 'desktop', 'documents'])
    expect(folders[0].totalBytes).toBeNull()
  })

  it('resolves home from the injected getPath', async () => {
    expect(await fs.home()).toBe(join(root, 'known', 'home'))
  })
})

describe('createWindowsFs — create, rename, remove, trash', () => {
  it('creates directories and reports EEXIST on a duplicate', async () => {
    const base = dir('mkdir')
    const target = join(base, 'created')
    await fs.mkdir(target)
    expect((await fs.list(base)).map((e) => e.name)).toEqual(['created'])
    expect(await codeOf(() => fs.mkdir(target))).toBe('EEXIST')
  })

  it('creates empty files and reports EEXIST on a duplicate', async () => {
    const base = dir('createfile')
    const target = join(base, 'new.txt')
    await fs.createFile(target)
    expect(await readFile(target, 'utf8')).toBe('')
    expect(await codeOf(() => fs.createFile(target))).toBe('EEXIST')
  })

  it('reports EEXIST when createFile targets an existing directory', async () => {
    const target = dir('createfile-existing-directory')

    expect(await codeOf(() => fs.createFile(target))).toBe('EEXIST')
    await expect(fs.createFile(target)).rejects.toMatchObject({
      code: 'EEXIST',
      path: target
    })
  })

  it('reports EEXIST when createFile targets a drive root', async () => {
    expect(await codeOf(() => fs.createFile('C:\\'))).toBe('EEXIST')
    await expect(fs.createFile('C:\\')).rejects.toMatchObject({
      code: 'EEXIST',
      path: 'C:\\'
    })
  })

  it('keeps ENOENT when createFile parent directory is missing', async () => {
    const target = join(root, 'createfile-missing-parent', 'new.txt')

    expect(await codeOf(() => fs.createFile(target))).toBe('ENOENT')
  })

  it('renames within the same directory and refuses conflicts and bad names', async () => {
    const base = dir('rename')
    const original = join(base, 'before.txt')
    writeFileSync(original, 'payload')
    writeFileSync(join(base, 'taken.txt'), 'other')

    await fs.rename(original, 'after.txt')
    expect(await readFile(join(base, 'after.txt'), 'utf8')).toBe('payload')
    expect(await codeOf(() => fs.rename(join(base, 'after.txt'), 'taken.txt'))).toBe('EEXIST')
    expect(await codeOf(() => fs.rename(join(base, 'after.txt'), 'sub\\evil.txt'))).toBe('UNKNOWN')
    expect(await codeOf(() => fs.rename(join(base, 'after.txt'), '..'))).toBe('UNKNOWN')
  })

  it('removes files and trees but refuses a drive root', async () => {
    const base = dir('remove')
    const tree = join(base, 'tree', 'nested')
    mkdirSync(tree, { recursive: true })
    writeFileSync(join(tree, 'deep.txt'), 'x')
    writeFileSync(join(base, 'single.txt'), 'x')

    await fs.remove([join(base, 'tree'), join(base, 'single.txt')])
    expect(await fs.list(base)).toEqual([])
    expect(await codeOf(() => fs.remove(['C:\\']))).toBe('UNKNOWN')
  })

  it.each(['\\\\server\\share', '\\\\server\\share\\'])(
    'refuses to remove the UNC share root %s',
    async (shareRoot) => {
      expect(await codeOf(() => fs.remove([shareRoot]))).toBe('UNKNOWN')
      await expect(fs.remove([shareRoot])).rejects.toThrow('Refusing to remove \\\\server\\share\\')
    }
  )

  it('routes trash through the injected trashItem', async () => {
    const base = dir('trash')
    const file = join(base, 'bin-me.txt')
    writeFileSync(file, 'x')
    trashed = []
    await fs.trash([file])
    expect(trashed).toEqual([file])
  })

  it('trashes duplicate normalized paths once while preserving case-distinct paths', async () => {
    const first = 'C:\\CaseSensitive\\Foo.txt'
    const second = 'C:\\CaseSensitive\\foo.txt'
    trashed = []

    await fs.trash([first, first, second])

    expect(trashed).toEqual([first, second])
  })

  it('refuses to trash a drive root before reaching trashItem', async () => {
    trashed = []
    expect(await codeOf(() => fs.trash(['C:\\']))).toBe('UNKNOWN')
    await expect(fs.trash(['C:\\'])).rejects.toThrow('Refusing to trash C:\\')
    expect(trashed).toEqual([])
  })

  it.each(['\\\\server\\share', '\\\\server\\share\\'])(
    'refuses to trash the UNC share root %s before reaching trashItem',
    async (shareRoot) => {
      trashed = []
      expect(await codeOf(() => fs.trash([shareRoot]))).toBe('UNKNOWN')
      await expect(fs.trash([shareRoot])).rejects.toThrow('Refusing to trash \\\\server\\share\\')
      expect(trashed).toEqual([])
    }
  )

  it.each([
    { bad: 'C:\\', message: 'Refusing to trash C:\\' },
    { bad: '\\\\server\\share', message: 'Refusing to trash \\\\server\\share\\' },
    { bad: '\\\\server\\share\\', message: 'Refusing to trash \\\\server\\share\\' }
  ])('refuses a whole trash batch holding the root $bad before trashing anything', async ({ bad, message }) => {
    const base = dir('trash-batch-root')
    const file = join(base, 'keep-me.txt')
    writeFileSync(file, 'x')
    trashed = []
    expect(await codeOf(() => fs.trash([file, bad]))).toBe('UNKNOWN')
    await expect(fs.trash([file, bad])).rejects.toThrow(message)
    expect(trashed).toEqual([])
  })

  it.each(['relative\\file.txt', 'C:\\bad\0name.txt', 'C:\\bad\nname.txt'])(
    'refuses a whole trash batch holding the invalid path %j before trashing anything',
    async (bad) => {
      const base = dir('trash-batch-invalid')
      const file = join(base, 'keep-me.txt')
      writeFileSync(file, 'x')
      trashed = []
      expect(await codeOf(() => fs.trash([file, bad]))).toBe('UNKNOWN')
      await expect(fs.trash([file, bad])).rejects.toThrow('Not a Windows path')
      expect(trashed).toEqual([])
    }
  )

  it.each(['C:\\', '\\\\server\\share\\', 'relative\\file.txt'])(
    'refuses a whole delete batch holding %j before deleting anything',
    async (bad) => {
      const base = dir('remove-batch')
      const file = join(base, 'keep-me.txt')
      writeFileSync(file, 'x')
      expect(await codeOf(() => fs.remove([file, bad]))).toBe('UNKNOWN')
      expect(await readFile(file, 'utf8')).toBe('x')
    }
  )

  it('removes duplicate normalized paths once', async () => {
    const file = join(dir('remove-duplicates'), 'once.txt')
    writeFileSync(file, 'x')

    await fs.remove([file, file])

    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to rename a drive root', async () => {
    expect(await codeOf(() => fs.rename('C:\\', 'renamed-root'))).toBe('UNKNOWN')
    await expect(fs.rename('C:\\', 'renamed-root')).rejects.toThrow(
      'Refusing to rename drive root C:\\'
    )
  })

  it.each(['\\\\server\\share', '\\\\server\\share\\'])(
    'refuses to rename the UNC share root %s',
    async (shareRoot) => {
      expect(await codeOf(() => fs.rename(shareRoot, 'renamed-root'))).toBe('UNKNOWN')
      await expect(fs.rename(shareRoot, 'renamed-root')).rejects.toThrow(
        'Refusing to rename drive root \\\\server\\share\\'
      )
    }
  )
})

describe('createWindowsFs — copy and move', () => {
  it.each([
    { move: false, message: 'Refusing to copy drive root C:\\' },
    { move: true, message: 'Refusing to move drive root C:\\' }
  ])('refuses a drive-root source before starting a $move operation', async ({ move, message }) => {
    expect(await codeOf(() => fs.copyMove(['C:\\'], root, move))).toBe('UNKNOWN')
    await expect(fs.copyMove(['C:\\'], root, move)).rejects.toThrow(message)
  })

  it.each([
    { shareRoot: '\\\\server\\share', move: false, message: 'Refusing to copy drive root' },
    { shareRoot: '\\\\server\\share\\', move: false, message: 'Refusing to copy drive root' },
    { shareRoot: '\\\\server\\share', move: true, message: 'Refusing to move drive root' },
    { shareRoot: '\\\\server\\share\\', move: true, message: 'Refusing to move drive root' }
  ])('refuses an UNC share-root source before starting a $move operation', async ({ shareRoot, move, message }) => {
    expect(await codeOf(() => fs.copyMove([shareRoot], root, move))).toBe('UNKNOWN')
    await expect(fs.copyMove([shareRoot], root, move)).rejects.toThrow(
      `${message} \\\\server\\share\\`
    )
  })

  it('copies into a destination and keeps the source', async () => {
    const src = dir('copy', 'src')
    const dest = dir('copy', 'dest')
    writeFileSync(join(src, 'a.txt'), 'alpha')

    const events = await runOp(() => fs.copyMove([join(src, 'a.txt')], dest, false))
    const last = events[events.length - 1]
    expect(last.status).toBe('done')
    expect(last.kind).toBe('copy')
    expect(last.totalItems).toBe(1)
    expect(last.doneItems).toBe(1)
    expect(last.totalBytes).toBe(5)
    expect(last.doneBytes).toBe(5)
    expect(events.some((e) => e.status === 'running' && e.currentItem === join(src, 'a.txt'))).toBe(
      true
    )
    expect(await readFile(join(dest, 'a.txt'), 'utf8')).toBe('alpha')
    expect(await readFile(join(src, 'a.txt'), 'utf8')).toBe('alpha')
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('processes a duplicate source only once for $kind', async ({ move, kind }) => {
    const src = dir(`duplicate-${kind}`, 'src')
    const dest = dir(`duplicate-${kind}`, 'dest')
    const source = join(src, 'once.txt')
    writeFileSync(source, 'once')

    const events = await runOp(() => fs.copyMove([source, source], dest, move))

    expect(events.at(-1)).toMatchObject({
      kind,
      status: 'done',
      totalItems: 1,
      doneItems: 1
    })
    expect(await readFile(join(dest, 'once.txt'), 'utf8')).toBe('once')
    if (move) {
      await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      expect(await readFile(source, 'utf8')).toBe('once')
    }
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('deduplicates case and separator variants for $kind', async ({ move, kind }) => {
    const src = dir(`normalized-duplicate-${kind}`, 'src')
    const dest = dir(`normalized-duplicate-${kind}`, 'dest')
    const source = join(src, 'once.txt')
    writeFileSync(source, 'once')

    const events = await runOp(() =>
      fs.copyMove([source, source.toUpperCase(), source.replaceAll('\\', '/')], dest, move)
    )

    expect(events.at(-1)).toMatchObject({
      kind,
      status: 'done',
      totalItems: 1,
      doneItems: 1
    })
    expect(await readFile(join(dest, 'once.txt'), 'utf8')).toBe('once')
    if (move) {
      await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      expect(await readFile(source, 'utf8')).toBe('once')
    }
  })

  it('moves a selected directory and its child as one intact tree when the child comes first', async () => {
    const parent = dir('move-overlap', 'src', 'folder')
    const dest = dir('move-overlap', 'dest')
    const child = join(parent, 'nested.txt')
    writeFileSync(child, 'inside')

    const events = await runOp(() => fs.copyMove([child, parent], dest, true))

    expect(events.at(-1)).toMatchObject({
      kind: 'move',
      status: 'done',
      totalItems: 1,
      doneItems: 1
    })
    expect(await readFile(join(dest, 'folder', 'nested.txt'), 'utf8')).toBe('inside')
    await expect(readFile(child, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(dest, 'nested.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('processes unrelated sources sequentially for $kind', async ({ move, kind }) => {
    const src = dir(`unrelated-${kind}`, 'src')
    const dest = dir(`unrelated-${kind}`, 'dest')
    const first = join(src, 'first.txt')
    const second = join(src, 'second.txt')
    writeFileSync(first, 'first')
    writeFileSync(second, 'second')

    const events = await runOp(() => fs.copyMove([first, second], dest, move))

    expect(events.at(-1)).toMatchObject({
      kind,
      status: 'done',
      totalItems: 2,
      doneItems: 2
    })
    expect(await readFile(join(dest, 'first.txt'), 'utf8')).toBe('first')
    expect(await readFile(join(dest, 'second.txt'), 'utf8')).toBe('second')
    if (move) {
      await expect(readFile(first, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(second, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } else {
      expect(await readFile(first, 'utf8')).toBe('first')
      expect(await readFile(second, 'utf8')).toBe('second')
    }
  })

  it('copies directories recursively', async () => {
    const src = dir('copy-tree', 'src', 'pack', 'inner')
    const dest = dir('copy-tree', 'dest')
    writeFileSync(join(src, 'deep.txt'), 'deep')

    const events = await runOp(() =>
      fs.copyMove([join(root, 'copy-tree', 'src', 'pack')], dest, false)
    )
    expect(events[events.length - 1].status).toBe('done')
    expect(await readFile(join(dest, 'pack', 'inner', 'deep.txt'), 'utf8')).toBe('deep')
  })

  it('moves within the same volume and removes the source', async () => {
    const src = dir('move', 'src')
    const dest = dir('move', 'dest')
    writeFileSync(join(src, 'b.txt'), 'beta')

    const events = await runOp(() => fs.copyMove([join(src, 'b.txt')], dest, true))
    expect(events[events.length - 1].status).toBe('done')
    expect(events[events.length - 1].kind).toBe('move')
    expect(await readFile(join(dest, 'b.txt'), 'utf8')).toBe('beta')
    expect(await fs.list(src)).toEqual([])
  })

  it('never overwrites: an existing destination becomes a per-item EEXIST', async () => {
    const src = dir('copy-conflict', 'src')
    const dest = dir('copy-conflict', 'dest')
    writeFileSync(join(src, 'c.txt'), 'fresh')
    writeFileSync(join(dest, 'c.txt'), 'original')

    const events = await runOp(() => fs.copyMove([join(src, 'c.txt')], dest, false))
    const last = events[events.length - 1]
    expect(last.status).toBe('error')
    expect(last.error).toContain('EEXIST')
    expect(await readFile(join(dest, 'c.txt'), 'utf8')).toBe('original')
  })

  it('rejects a destination inside one of the sources', async () => {
    const src = dir('copy-into-self', 'src')
    const dest = dir('copy-into-self', 'src', 'inner')
    expect(await codeOf(() => fs.copyMove([src], dest, false))).toBe('UNKNOWN')
    expect(await codeOf(() => fs.copyMove([src], src, false))).toBe('UNKNOWN')
    await expect(fs.copyMove([src], dest, false)).rejects.toThrow(`Cannot copy ${src} into itself`)
    await expect(fs.copyMove([src], src, true)).rejects.toThrow(`Cannot move ${src} into itself`)
  })

  it('rejects a destination that is not a directory', async () => {
    const base = dir('copy-bad-dest')
    const file = join(base, 'not-a-dir.txt')
    writeFileSync(file, 'x')
    expect(await codeOf(() => fs.copyMove([file], join(base, 'missing'), false))).toBe('ENOENT')
    expect(await codeOf(() => fs.copyMove([file], file, false))).toBe('ENOTDIR')
  })

  it('stops between items when the op is cancelled', async () => {
    const src = dir('cancel', 'src')
    const dest = dir('cancel', 'dest')
    const sources: string[] = []
    for (let i = 0; i < 8; i++) {
      const p = join(src, `item-${i}.txt`)
      writeFileSync(p, `payload-${i}`)
      sources.push(p)
    }

    const events: FileOpProgress[] = []
    const off = fs.onProgress((p) => events.push(p))
    try {
      const opId = await fs.copyMove(sources, dest, false)
      await fs.cancelOp(opId)
      await waitFor(() => events.some((e) => e.opId === opId && e.status !== 'running'))
      const last = events.filter((e) => e.opId === opId).pop()!
      expect(last.status).toBe('cancelled')
      expect(last.doneItems).toBeLessThan(sources.length)
    } finally {
      off()
    }
    expect((await fs.list(dest)).length).toBeLessThan(sources.length)
  })
})

describe('createWindowsFs — text files', () => {
  it('reads utf-8 content and reports writability', async () => {
    const base = dir('read-utf8')
    const file = join(base, 'note.txt')
    writeFileSync(file, 'héllo wörld\n', 'utf8')
    const result = await fs.readText(file, 1024)
    expect(result.content).toBe('héllo wörld\n')
    expect(result.encoding).toBe('utf-8')
    expect(result.truncated).toBe(false)
    expect(result.sizeBytes).toBe(Buffer.byteLength('héllo wörld\n', 'utf8'))
    expect(result.writable).toBe(true)
  })

  it('falls back to latin1 for invalid utf-8', async () => {
    const base = dir('read-latin1')
    const file = join(base, 'legacy.txt')
    writeFileSync(file, Buffer.from([0x68, 0x69, 0xff]))
    const result = await fs.readText(file, 1024)
    expect(result.encoding).toBe('latin1')
    expect(result.content).toBe('hi\u00ff')
  })

  it('truncates to maxBytes and reports the real size', async () => {
    const base = dir('read-truncate')
    const file = join(base, 'big.txt')
    writeFileSync(file, 'x'.repeat(100))
    const result = await fs.readText(file, 10)
    expect(result.content).toBe('xxxxxxxxxx')
    expect(result.truncated).toBe(true)
    expect(result.sizeBytes).toBe(100)
  })

  it('rejects binary content and directories', async () => {
    const base = dir('read-binary')
    const file = join(base, 'app.bin')
    writeFileSync(file, Buffer.from([0x4d, 0x5a, 0x00, 0x01]))
    expect(await codeOf(() => fs.readText(file, 1024))).toBe('BINARY')
    expect(await codeOf(() => fs.readText(base, 1024))).toBe('EISDIR')
    expect(await codeOf(() => fs.readText(join(base, 'missing.txt'), 1024))).toBe('ENOENT')
  })

  it('reads an empty file without error', async () => {
    const base = dir('read-empty')
    const file = join(base, 'empty.txt')
    writeFileSync(file, '')
    const result = await fs.readText(file, 1024)
    expect(result.content).toBe('')
    expect(result.sizeBytes).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('writes atomically and leaves no temp file behind', async () => {
    const base = dir('write-atomic')
    const file = join(base, 'target.txt')
    writeFileSync(file, 'old')
    await fs.writeText(file, 'new content')
    expect(await readFile(file, 'utf8')).toBe('new content')
    expect(await readdir(base)).toEqual(['target.txt'])

    const created = join(base, 'fresh.txt')
    await fs.writeText(created, 'created')
    expect(await readFile(created, 'utf8')).toBe('created')
    expect((await readdir(base)).filter((n) => n.startsWith('.wslpad-'))).toEqual([])
  })

  it.runIf(IS_WINDOWS)('maps a read-only target to EACCES without touching it', async () => {
    const base = dir('write-readonly')
    const file = join(base, 'locked.txt')
    writeFileSync(file, 'protected')
    await chmod(file, 0o444)
    try {
      expect(await codeOf(() => fs.writeText(file, 'overwritten'))).toBe('EACCES')
      expect(await readFile(file, 'utf8')).toBe('protected')
      expect((await readdir(base)).filter((n) => n.startsWith('.wslpad-'))).toEqual([])
      expect((await fs.readText(file, 1024)).writable).toBe(false)
    } finally {
      await chmod(file, 0o666)
    }
  })

  it('refuses to write over a directory', async () => {
    const base = dir('write-dir')
    expect(await codeOf(() => fs.writeText(base, 'nope'))).toBe('EISDIR')
  })

  it('reports a missing parent folder as ENOENT, not a false EACCES', async () => {
    const base = dir('write-no-parent')
    expect(await codeOf(() => fs.writeText(join(base, 'gone', 'new.txt'), 'nope'))).toBe('ENOENT')
    expect(await readdir(base)).toEqual([])
  })

  it('reports a file standing in for the parent folder as ENOTDIR', async () => {
    const base = dir('write-file-parent')
    const file = join(base, 'plain.txt')
    writeFileSync(file, 'kept')
    expect(await codeOf(() => fs.writeText(join(file, 'new.txt'), 'nope'))).toBe('ENOTDIR')
    expect(await readFile(file, 'utf8')).toBe('kept')
    expect(await readdir(base)).toEqual(['plain.txt'])
  })

  it.runIf(IS_WINDOWS)('still maps a write-denied existing parent folder to EACCES', async () => {
    const base = dir('write-parent-denied')
    const locked = dir('write-parent-denied', 'locked')
    // A folder's read-only bit means nothing to access(W_OK) on Windows, so
    // the ACL denial only surfaces when the temp file is created inside it.
    execFileSync('icacls', [locked, '/deny', '*S-1-1-0:(WD)'], { windowsHide: true, stdio: 'ignore' })
    try {
      expect(await codeOf(() => fs.writeText(join(locked, 'new.txt'), 'nope'))).toBe('EACCES')
    } finally {
      execFileSync('icacls', [locked, '/remove:d', '*S-1-1-0'], { windowsHide: true, stdio: 'ignore' })
    }
    expect(await readdir(locked)).toEqual([])
    expect(await readdir(base)).toEqual(['locked'])
  })

  it.runIf(IS_WINDOWS)('writes through a file symlink to its target and keeps the link', async () => {
    const targets = dir('write-link', 'targets')
    const links = dir('write-link', 'links')
    const target = join(targets, 'real.txt')
    writeFileSync(target, 'old')
    const link = join(links, 'link.txt')
    await symlink(target, link, 'file')
    // A relative link pointing at another link resolves the same way `readlink -f` does.
    await symlink('real.txt', join(targets, 'relative.txt'), 'file')
    const chained = join(links, 'chained.txt')
    await symlink(join(targets, 'relative.txt'), chained, 'file')

    await fs.writeText(link, 'through the link')
    expect(await readFile(target, 'utf8')).toBe('through the link')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readlink(link)).toBe(target)
    expect((await fs.readText(link, 1024)).content).toBe('through the link')

    await fs.writeText(chained, 'through the chain')
    expect(await readFile(target, 'utf8')).toBe('through the chain')
    expect((await lstat(chained)).isSymbolicLink()).toBe(true)
    expect((await lstat(join(targets, 'relative.txt'))).isSymbolicLink()).toBe(true)

    // The temp file is swapped in beside the target, so neither side keeps one.
    expect((await readdir(links)).sort()).toEqual(['chained.txt', 'link.txt'])
    expect((await readdir(targets)).sort()).toEqual(['real.txt', 'relative.txt'])
  })

  it.runIf(IS_WINDOWS)('refuses to write through a directory symlink or junction', async () => {
    const base = dir('write-dir-link')
    const target = dir('write-dir-link', 'target')
    writeFileSync(join(target, 'inside.txt'), 'kept')
    const dirLink = join(base, 'dir-link')
    const junction = join(base, 'junction')
    await symlink(target, dirLink, 'dir')
    await symlink(target, junction, 'junction')

    expect(await codeOf(() => fs.writeText(dirLink, 'nope'))).toBe('EISDIR')
    expect(await codeOf(() => fs.writeText(junction, 'nope'))).toBe('EISDIR')
    expect((await lstat(dirLink)).isSymbolicLink()).toBe(true)
    expect((await lstat(junction)).isSymbolicLink()).toBe(true)
    expect(await readdir(target)).toEqual(['inside.txt'])
    expect((await readdir(base)).sort()).toEqual(['dir-link', 'junction', 'target'])
  })

  it.runIf(IS_WINDOWS)('reports a broken symlink as ENOENT without creating its target', async () => {
    const base = dir('write-broken-link')
    const link = join(base, 'broken.txt')
    await symlink(join(base, 'missing.txt'), link, 'file')

    expect(await codeOf(() => fs.writeText(link, 'nope'))).toBe('ENOENT')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readdir(base)).toEqual(['broken.txt'])
  })

  it.runIf(IS_WINDOWS)('maps an unwritable link target to EACCES and keeps both sides', async () => {
    const base = dir('write-link-denied')
    const locked = dir('write-link-denied', 'locked')
    const target = join(locked, 'real.txt')
    writeFileSync(target, 'protected')
    const link = join(base, 'link.txt')
    await symlink(target, link, 'file')

    // `access(W_OK)` cannot see ACLs on Windows: only the temp file creation
    // beside the target fails, and that must still surface as EACCES.
    execFileSync('icacls', [locked, '/deny', '*S-1-1-0:(WD)'], { windowsHide: true, stdio: 'ignore' })
    try {
      expect(await codeOf(() => fs.writeText(link, 'overwritten'))).toBe('EACCES')
    } finally {
      execFileSync('icacls', [locked, '/remove:d', '*S-1-1-0'], { windowsHide: true, stdio: 'ignore' })
    }
    expect(await readFile(target, 'utf8')).toBe('protected')
    expect(await readdir(locked)).toEqual(['real.txt'])

    await chmod(target, 0o444)
    try {
      expect(await codeOf(() => fs.writeText(link, 'overwritten'))).toBe('EACCES')
      expect(await readFile(target, 'utf8')).toBe('protected')
    } finally {
      await chmod(target, 0o666)
    }
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readdir(base)).toEqual(['link.txt', 'locked'])
  })
})

describe('createWindowsFs — search', () => {
  it('matches names case-insensitively down to four levels', async () => {
    const base = dir('search-depth')
    writeFileSync(join(base, 'Needle-1.txt'), 'x')
    const a = dir('search-depth', 'a')
    writeFileSync(join(a, 'needle-2.txt'), 'x')
    const b = dir('search-depth', 'a', 'b')
    writeFileSync(join(b, 'needle-3.txt'), 'x')
    const c = dir('search-depth', 'a', 'b', 'c')
    writeFileSync(join(c, 'needle-4.txt'), 'x')
    const d = dir('search-depth', 'a', 'b', 'c', 'd')
    writeFileSync(join(d, 'needle-5.txt'), 'x')

    const names = (await fs.search(base, 'NEEDLE')).map((e) => e.name).sort()
    expect(names).toEqual(['Needle-1.txt', 'needle-2.txt', 'needle-3.txt', 'needle-4.txt'])
    expect(await fs.search(base, '   ')).toEqual([])
    // "This PC" is not walkable.
    expect(await fs.search(WINDOWS_ROOT, 'needle')).toEqual([])
  })

  it('caps results at 200', async () => {
    const base = dir('search-cap')
    for (let i = 0; i < 205; i++) writeFileSync(join(base, `capped-${i}.txt`), 'x')
    expect((await fs.search(base, 'capped-')).length).toBe(200)
  })

  it('rejects a missing start with ENOENT instead of an empty result', async () => {
    const base = dir('search-missing')
    expect(await codeOf(() => fs.search(join(base, 'gone'), 'needle'))).toBe('ENOENT')
  })

  it('rejects a file start with ENOTDIR instead of an empty result', async () => {
    const base = dir('search-file')
    const file = join(base, 'needle.txt')
    writeFileSync(file, 'x')
    expect(await codeOf(() => fs.search(file, 'needle'))).toBe('ENOTDIR')
  })

  it.runIf(IS_WINDOWS)('rejects an unreadable start with EACCES but skips unreadable subfolders', async () => {
    const base = dir('search-denied')
    const locked = dir('search-denied', 'locked')
    writeFileSync(join(locked, 'needle-hidden.txt'), 'x')
    writeFileSync(join(base, 'needle-visible.txt'), 'x')

    execFileSync('icacls', [locked, '/deny', '*S-1-1-0:(RD)'], { windowsHide: true, stdio: 'ignore' })
    try {
      expect(await codeOf(() => fs.search(locked, 'needle'))).toBe('EACCES')
      expect((await fs.search(base, 'needle')).map((e) => e.name)).toEqual(['needle-visible.txt'])
    } finally {
      execFileSync('icacls', [locked, '/remove:d', '*S-1-1-0'], { windowsHide: true, stdio: 'ignore' })
    }
  })
})

describe('createFixtureWindowsFs', () => {
  it('is deterministic across instances', async () => {
    const a = createFixtureWindowsFs()
    const b = createFixtureWindowsFs()
    const path = 'C:\\Users\\dev'
    expect(JSON.stringify(await a.list(path))).toBe(JSON.stringify(await b.list(path)))
    expect(JSON.stringify(await a.places())).toBe(JSON.stringify(await b.places()))
    const entry = (await a.list(path)).find((e) => e.name === 'Documents')!
    expect(entry.mtime).toBe('2024-06-01T10:00:00.000Z')
    a.dispose()
    b.dispose()
  })

  it('exposes two drives with fixed capacities and known folders', async () => {
    const fixture = createFixtureWindowsFs()
    const places = await fixture.places()
    expect(places.filter((p) => p.kind === 'drive')).toEqual([
      {
        id: 'drive-C',
        label: 'C:',
        path: 'C:\\',
        kind: 'drive',
        totalBytes: 500 * 1024 ** 3,
        freeBytes: 145 * 1024 ** 3
      },
      {
        id: 'drive-D',
        label: 'D:',
        path: 'D:\\',
        kind: 'drive',
        totalBytes: 1024 * 1024 ** 3,
        freeBytes: 800 * 1024 ** 3
      }
    ])
    expect(places.filter((p) => p.kind === 'folder').map((p) => p.label)).toEqual([
      'dev',
      'Desktop',
      'Documents',
      'Downloads'
    ])
    expect(await fixture.home()).toBe('C:\\Users\\dev')
    expect((await fixture.list(WINDOWS_ROOT)).map((e) => e.path)).toEqual(['C:\\', 'D:\\'])
  })

  it('lists the seeded tree with directories first and hidden filtering', async () => {
    const fixture = createFixtureWindowsFs()
    expect((await fixture.list('C:\\Users\\dev')).map((e) => e.name)).toEqual([
      'Desktop',
      'Documents',
      'Downloads',
      'projects',
      '.hidden-config'
    ])
    expect((await fixture.list('C:\\Users\\dev', { showHidden: false })).map((e) => e.name)).toEqual(
      ['Desktop', 'Documents', 'Downloads', 'projects']
    )
    expect((await fixture.tree('C:\\')).map((e) => e.name)).toEqual(['Users', 'Windows'])
    expect((await fixture.list('D:\\Media')).map((e) => e.name)).toEqual(['clip.mp4'])
    expect((await fixture.readText('C:\\Users\\dev\\Documents\\notes.txt', 4096)).content).toBe(
      'Windows fixture notes\n'
    )
    expect(
      (await fixture.readText('C:\\Users\\dev\\projects\\demo\\README.md', 4096)).content
    ).toContain('# demo')
  })

  it('rejects the binary download and the read-only system directory', async () => {
    const fixture = createFixtureWindowsFs()
    expect(await codeOf(() => fixture.readText('C:\\Users\\dev\\Downloads\\setup.exe', 4096))).toBe(
      'BINARY'
    )
    expect(await codeOf(() => fixture.writeText('C:\\Windows\\System32\\hosts', 'x'))).toBe('EACCES')
    // The parent is described before its permission, in the same order as WindowsFs.
    expect(await codeOf(() => fixture.writeText('C:\\Windows\\missing\\new.txt', 'x'))).toBe('ENOENT')
    expect(
      await codeOf(() => fixture.writeText('C:\\Users\\dev\\Documents\\notes.txt\\new.txt', 'x'))
    ).toBe('ENOTDIR')
    expect(await codeOf(() => fixture.createFile('C:\\Windows\\System32\\evil.dll'))).toBe('EACCES')
    expect(await codeOf(() => fixture.mkdir('C:\\Windows\\System32\\drivers'))).toBe('EACCES')
    expect(await codeOf(() => fixture.list('C:\\Users\\dev\\missing'))).toBe('ENOENT')
    expect(await codeOf(() => fixture.list('Z:\\'))).toBe('ENOENT')
  })

  it('reports EEXIST on duplicate create and supports rename', async () => {
    const fixture = createFixtureWindowsFs()
    await fixture.createFile('C:\\Users\\dev\\Desktop\\todo.txt')
    expect(await codeOf(() => fixture.createFile('C:\\Users\\dev\\Desktop\\todo.txt'))).toBe(
      'EEXIST'
    )
    expect(await codeOf(() => fixture.mkdir('C:\\Users\\dev\\Documents'))).toBe('EEXIST')
    await fixture.rename('C:\\Users\\dev\\Desktop\\todo.txt', 'done.txt')
    expect((await fixture.list('C:\\Users\\dev\\Desktop')).map((e) => e.name)).toEqual(['done.txt'])
  })

  it('emits one progress event per copied item plus a terminal event', async () => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    const opId = await fixture.copyMove(
      ['C:\\Users\\dev\\Documents\\notes.txt', 'C:\\Users\\dev\\projects\\demo'],
      'C:\\Users\\dev\\Desktop',
      false
    )
    expect(opId).toBe('fixture-win-op-1')
    await waitFor(() => events.some((e) => e.status !== 'running'))
    expect(events.filter((e) => e.status === 'running').length).toBe(2)
    const last = events[events.length - 1]
    expect(last.status).toBe('done')
    expect(last.doneItems).toBe(2)
    expect((await fixture.list('C:\\Users\\dev\\Desktop')).map((e) => e.name)).toEqual([
      'demo',
      'notes.txt'
    ])
    // Copy leaves the source in place; the nested tree is cloned too.
    expect((await fixture.list('C:\\Users\\dev\\Documents')).map((e) => e.name)).toEqual([
      'notes.txt'
    ])
    expect((await fixture.list('C:\\Users\\dev\\Desktop\\demo')).map((e) => e.name)).toEqual([
      'README.md'
    ])
  })

  it('moves, trashes and searches', async () => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    await fixture.copyMove(['C:\\Users\\dev\\Documents\\notes.txt'], 'C:\\Users\\dev\\Desktop', true)
    await waitFor(() => events.some((e) => e.status === 'done'))
    expect(await fixture.list('C:\\Users\\dev\\Documents')).toEqual([])

    await fixture.trash(['C:\\Users\\dev\\Desktop\\notes.txt'])
    expect(await fixture.list('C:\\Users\\dev\\Desktop')).toEqual([])

    const hits = await fixture.search('C:\\Users\\dev', 'readme')
    expect(hits.map((e) => e.path)).toEqual(['C:\\Users\\dev\\projects\\demo\\README.md'])
    expect(await fixture.search('C:\\Users\\dev', '')).toEqual([])
    // README.md sits five levels below C:\, past the shared maxDepth of 4.
    expect(await fixture.search('C:\\', 'readme')).toEqual([])
  })

  it('reports a duplicate destination as a per-item EEXIST and keeps the target', async () => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    await fixture.copyMove(['C:\\Users\\dev\\Documents'], 'C:\\Users\\dev', false)
    await waitFor(() => events.some((e) => e.status !== 'running'))
    const last = events[events.length - 1]
    expect(last.status).toBe('error')
    expect(last.error).toContain('EEXIST')
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('processes a duplicate source only once for $kind', async ({ move, kind }) => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    const notes = 'C:\\Users\\dev\\Documents\\notes.txt'
    // The same file spelled three ways normalizes to one source.
    await fixture.copyMove(
      [notes, notes, 'C:/Users/dev/Documents/notes.txt', 'C:\\Users\\dev\\projects\\demo'],
      'C:\\Users\\dev\\Desktop',
      move
    )
    await waitFor(() => events.some((e) => e.status !== 'running'))

    expect(events.filter((e) => e.status === 'running').length).toBe(2)
    expect(events.at(-1)).toMatchObject({
      kind,
      status: 'done',
      totalItems: 2,
      doneItems: 2,
      error: null
    })
    expect((await fixture.list('C:\\Users\\dev\\Desktop')).map((e) => e.name)).toEqual([
      'demo',
      'notes.txt'
    ])
    expect((await fixture.list('C:\\Users\\dev\\Documents')).map((e) => e.name)).toEqual(
      move ? [] : ['notes.txt']
    )
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('treats sources differing only in case as one item for $kind', async ({ move, kind }) => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    const notesBytes = 'Windows fixture notes\n'.length
    // Windows names are case-insensitive: all three spell the same file.
    await fixture.copyMove(
      [
        'C:\\Users\\dev\\Documents\\notes.txt',
        'C:\\Users\\dev\\Documents\\NOTES.TXT',
        'c:/users/DEV/documents/Notes.txt'
      ],
      'C:\\Users\\dev\\Desktop',
      move
    )
    await waitFor(() => events.some((e) => e.status !== 'running'))

    expect(events.filter((e) => e.status === 'running')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      kind,
      status: 'done',
      totalItems: 1,
      doneItems: 1,
      totalBytes: notesBytes,
      doneBytes: notesBytes,
      error: null
    })
    expect((await fixture.list('C:\\Users\\dev\\Desktop')).map((e) => e.name)).toEqual([
      'notes.txt'
    ])
    expect((await fixture.list('C:\\Users\\dev\\Documents')).map((e) => e.name)).toEqual(
      move ? [] : ['notes.txt']
    )
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('sizes a $kind batch up front, directories recursively, and counts bytes as items finish', async ({ move, kind }) => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    const notesBytes = 'Windows fixture notes\n'.length
    const demoBytes = '# demo\n\nWindows fixture project.\n'.length
    // The directory's bytes are its README, the same figure dirSizes reports.
    expect((await fixture.dirSizes('C:\\Users\\dev\\projects', 'size-demo')).entries).toEqual([
      expect.objectContaining({ name: 'demo', sizeBytes: demoBytes })
    ])

    await fixture.copyMove(
      ['C:\\Users\\dev\\Documents\\notes.txt', 'C:\\Users\\dev\\projects\\demo'],
      'C:\\Users\\dev\\Desktop',
      move
    )
    await waitFor(() => events.some((e) => e.status !== 'running'))

    // Every event, the first included, carries the whole batch's total.
    expect(events.map((e) => e.totalBytes)).toEqual([
      notesBytes + demoBytes,
      notesBytes + demoBytes,
      notesBytes + demoBytes
    ])
    expect(events.map((e) => [e.status, e.doneItems, e.doneBytes])).toEqual([
      ['running', 1, notesBytes],
      ['running', 2, notesBytes + demoBytes],
      ['done', 2, notesBytes + demoBytes]
    ])
    expect(events.at(-1)).toMatchObject({ kind, error: null })
  })

  it('leaves the bytes of a failed item out of doneBytes', async () => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    const notesBytes = 'Windows fixture notes\n'.length
    // C:\Users\dev already holds Documents (one notes.txt), so that item is EEXIST.
    await fixture.copyMove(
      ['C:\\Users\\dev\\Documents\\notes.txt', 'C:\\Users\\dev\\Documents'],
      'C:\\Users\\dev',
      false
    )
    await waitFor(() => events.some((e) => e.status !== 'running'))

    expect(events.at(-1)).toMatchObject({
      status: 'error',
      totalItems: 2,
      doneItems: 2,
      totalBytes: notesBytes * 2,
      doneBytes: notesBytes
    })
    expect(events.at(-1)?.error).toContain('EEXIST')
  })

  it.each([
    {
      move: false,
      kind: 'copy',
      dest: 'C:\\Users\\dev\\projects',
      destination: 'C:\\Users\\dev\\projects'
    },
    {
      move: true,
      kind: 'move',
      dest: 'C:\\Users\\dev\\projects',
      destination: 'C:\\Users\\dev\\projects'
    },
    {
      move: false,
      kind: 'copy',
      dest: 'C:\\Users\\dev\\projects\\demo',
      destination: 'C:\\Users\\dev\\projects\\demo'
    },
    {
      move: true,
      kind: 'move',
      dest: 'C:\\Users\\dev\\projects\\demo',
      destination: 'C:\\Users\\dev\\projects\\demo'
    }
  ])('refuses a $kind batch containing a source that includes its destination', async ({
    move,
    kind,
    dest,
    destination
  }) => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((progress) => events.push(progress))
    const notes = 'C:\\Users\\dev\\Documents\\notes.txt'
    const source = 'C:\\Users\\dev\\projects'

    await expect(fixture.copyMove([notes, source], dest, move)).rejects.toThrow(
      `Cannot ${kind} ${source} into itself`
    )
    expect(await codeOf(() => fixture.copyMove([notes, source], dest, move))).toBe('UNKNOWN')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual([])
    expect((await fixture.list('C:\\Users\\dev\\Documents')).map((entry) => entry.name)).toEqual([
      'notes.txt'
    ])
    expect((await fixture.list(destination)).map((entry) => entry.name)).not.toContain('notes.txt')
    expect(await fixture.copyMove([notes], 'C:\\Users\\dev\\Desktop', move)).toBe(
      'fixture-win-op-1'
    )
  })

  it.each([
    { move: false, message: 'Refusing to copy drive root C:\\' },
    { move: true, message: 'Refusing to move drive root C:\\' }
  ])('refuses a batch holding a drive-root source before starting a $move operation', async ({ move, message }) => {
    const fixture = createFixtureWindowsFs()
    const events: FileOpProgress[] = []
    fixture.onProgress((p) => events.push(p))
    const notes = 'C:\\Users\\dev\\Documents\\notes.txt'
    const desktop = 'C:\\Users\\dev\\Desktop'

    expect(await codeOf(() => fixture.copyMove([notes, 'C:\\'], desktop, move))).toBe('UNKNOWN')
    await expect(fixture.copyMove([notes, 'C:\\Users\\..'], desktop, move)).rejects.toThrow(message)
    await expect(fixture.copyMove([notes, 'd:'], desktop, move)).rejects.toThrow(
      `Refusing to ${move ? 'move' : 'copy'} drive root D:\\`
    )

    // Nothing ran: no op was started and the file in front of the root stayed put.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual([])
    expect(await fixture.list(desktop)).toEqual([])
    expect((await fixture.list('C:\\Users\\dev\\Documents')).map((e) => e.name)).toEqual([
      'notes.txt'
    ])
    expect(await fixture.copyMove([notes], desktop, move)).toBe('fixture-win-op-1')
  })

  it.each(['trash', 'remove'] as const)('%ss a path given twice only once', async (verb) => {
    const fixture = createFixtureWindowsFs()
    const notes = 'C:\\Users\\dev\\Documents\\notes.txt'
    const readme = 'C:\\Users\\dev\\projects\\demo\\README.md'

    await fixture[verb]([
      notes,
      readme,
      notes,
      'C:/Users/dev/Documents/notes.txt',
      'C:\\USERS\\DEV\\DOCUMENTS\\NOTES.TXT'
    ])

    expect(await fixture.list('C:\\Users\\dev\\Documents')).toEqual([])
    expect(await fixture.list('C:\\Users\\dev\\projects\\demo')).toEqual([])
    expect(await codeOf(() => fixture.stat(notes))).toBe('ENOENT')
  })

  it.each(['trash', 'remove'] as const)(
    'prevalidates the whole %s batch before changing earlier items',
    async (verb) => {
      const fixture = createFixtureWindowsFs()
      const notes = 'C:\\Users\\dev\\Documents\\notes.txt'
      const denied = 'C:\\Windows\\System32'

      await expect(fixture[verb]([notes, denied])).rejects.toMatchObject({ code: 'EACCES' })

      expect((await fixture.list('C:\\Users\\dev\\Documents')).map((entry) => entry.name)).toEqual([
        'notes.txt'
      ])
    }
  )

  it.each(['trash', 'remove'] as const)(
    'prevalidates missing targets before changing earlier items in a %s batch',
    async (verb) => {
      const fixture = createFixtureWindowsFs()
      const notes = 'C:\\Users\\dev\\Documents\\notes.txt'

      await expect(fixture[verb]([notes, 'C:\\Users\\dev\\Documents\\missing.txt'])).rejects.toMatchObject({
        code: 'ENOENT'
      })

      expect((await fixture.list('C:\\Users\\dev\\Documents')).map((entry) => entry.name)).toEqual([
        'notes.txt'
      ])
    }
  )

  it.each([
    { verb: 'trash' as const, order: 'parent first' },
    { verb: 'trash' as const, order: 'children first' },
    { verb: 'remove' as const, order: 'parent first' },
    { verb: 'remove' as const, order: 'children first' }
  ])('handles parent and child targets together in a $verb batch ($order)', async ({ verb, order }) => {
    const fixture = createFixtureWindowsFs()
    const parent = 'C:\\Users\\dev\\projects'
    const children = [`${parent}\\demo`, `${parent}\\DEMO\\README.md`]
    const batch = order === 'parent first' ? [parent, ...children] : [...children, parent]

    await expect(fixture[verb](batch)).resolves.toBeUndefined()

    await expect(fixture.list(parent)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fixture.list('C:\\Users\\dev')).map((e) => e.name)).not.toContain('projects')
    expect((await fixture.list('C:\\Users\\dev\\Documents')).map((e) => e.name)).toEqual([
      'notes.txt'
    ])
  })

  it.each(['trash', 'remove'] as const)(
    'unlinks a junction and still %ss the item selected through it',
    async (verb) => {
      const fixture = createFixtureWindowsFs()

      await expect(
        fixture[verb](['D:\\Library\\Media', 'D:\\Library\\Media\\clip.mp4'])
      ).resolves.toBeUndefined()

      expect((await fixture.list('D:\\Library')).map((e) => e.name)).toEqual(['playlist.m3u'])
      expect(await fixture.list('D:\\Media')).toEqual([])
    }
  )

  it.each(['trash', 'remove'] as const)(
    'still %ss an item picked through a junction inside a selected directory',
    async (verb) => {
      const fixture = createFixtureWindowsFs()

      await expect(
        fixture[verb](['D:\\Library', 'D:\\Library\\Media\\clip.mp4'])
      ).resolves.toBeUndefined()

      expect((await fixture.list('D:\\')).map((e) => e.name)).toEqual(['Media'])
      expect(await fixture.list('D:\\Media')).toEqual([])
    }
  )

  it.each([
    { verb: 'trash' as const, batch: ['D:\\Media', 'D:\\Library\\Media\\clip.mp4'] },
    { verb: 'trash' as const, batch: ['D:\\Library\\Media\\clip.mp4', 'D:\\Media\\clip.mp4'] },
    { verb: 'remove' as const, batch: ['D:\\Media', 'D:\\Library\\Media\\clip.mp4'] },
    { verb: 'remove' as const, batch: ['D:\\Library\\Media\\clip.mp4', 'D:\\Media\\clip.mp4'] }
  ])('$verb handles an item also reached through a junction once ($batch)', async ({ verb, batch }) => {
    const fixture = createFixtureWindowsFs()

    await expect(fixture[verb](batch)).resolves.toBeUndefined()

    expect(await codeOf(() => fixture.stat('D:\\Media\\clip.mp4'))).toBe('ENOENT')
    expect((await fixture.list('D:\\Library')).map((e) => e.name)).toContain('playlist.m3u')
  })

  it.each(['trash', 'remove'] as const)(
    'deduplicates case-insensitive paths in a %s batch',
    async (verb) => {
      const fixture = createFixtureWindowsFs()
      const notes = 'C:\\Users\\dev\\Documents\\notes.txt'
      const caseVariant = 'C:\\Users\\dev\\Documents\\NOTES.TXT'

      await expect(fixture[verb]([notes, caseVariant])).resolves.toBeUndefined()
      expect(await codeOf(() => fixture.stat(notes))).toBe('ENOENT')
    }
  )

  it.each([
    { verb: 'trash' as const, bad: 'C:\\', message: 'Refusing to trash C:\\' },
    { verb: 'trash' as const, bad: 'D:', message: 'Refusing to trash D:\\' },
    { verb: 'trash' as const, bad: 'C:\\Users\\..', message: 'Refusing to trash C:\\' },
    { verb: 'remove' as const, bad: 'C:\\', message: 'Refusing to remove C:\\' },
    { verb: 'remove' as const, bad: 'D:', message: 'Refusing to remove D:\\' },
    { verb: 'remove' as const, bad: 'C:\\Users\\..', message: 'Refusing to remove C:\\' }
  ])('refuses a whole $verb batch holding the root $bad before touching anything', async ({ verb, bad, message }) => {
    const fixture = createFixtureWindowsFs()
    const notes = 'C:\\Users\\dev\\Documents\\notes.txt'

    expect(await codeOf(() => fixture[verb]([notes, bad]))).toBe('UNKNOWN')
    await expect(fixture[verb]([notes, bad])).rejects.toThrow(message)

    expect((await fixture.list('C:\\Users\\dev\\Documents')).map((e) => e.name)).toEqual([
      'notes.txt'
    ])
  })

  it.each(['trash', 'remove'] as const)(
    'refuses a whole %s batch holding an unparseable path before touching anything',
    async (verb) => {
      const fixture = createFixtureWindowsFs()
      const notes = 'C:\\Users\\dev\\Documents\\notes.txt'

      expect(await codeOf(() => fixture[verb]([notes, 'relative\\file.txt']))).toBe('ENOENT')
      expect(await codeOf(() => fixture[verb]([notes, 'Z:\\missing.txt']))).toBe('ENOENT')

      expect((await fixture.list('C:\\Users\\dev\\Documents')).map((e) => e.name)).toEqual([
        'notes.txt'
      ])
    }
  )

  it.each([
    { bad: 'C:\\', message: 'Refusing to rename drive root C:\\' },
    { bad: 'D:', message: 'Refusing to rename drive root D:\\' },
    { bad: 'C:\\Users\\..', message: 'Refusing to rename drive root C:\\' }
  ])('refuses to rename the drive root $bad instead of a false ENOENT', async ({ bad, message }) => {
    const fixture = createFixtureWindowsFs()

    expect(await codeOf(() => fixture.rename(bad, 'renamed-root'))).toBe('UNKNOWN')
    await expect(fixture.rename(bad, 'renamed-root')).rejects.toThrow(message)
    // Like WindowsFs, the root is refused before the new name is even judged.
    await expect(fixture.rename(bad, '')).rejects.toThrow(message)

    expect((await fixture.list('C:\\')).map((e) => e.name)).toEqual(['Users', 'Windows'])
  })

  it.each([
    { verb: 'mkdir' as const, drive: 'C:\\', message: 'EEXIST: C:\\' },
    { verb: 'mkdir' as const, drive: 'D:', message: 'EEXIST: D:\\' },
    { verb: 'createFile' as const, drive: 'C:\\', message: 'EEXIST: C:\\' },
    { verb: 'createFile' as const, drive: 'D:', message: 'EEXIST: D:\\' }
  ])('reports EEXIST, not a false ENOENT, when $verb names the drive root $drive', async ({ verb, drive, message }) => {
    const fixture = createFixtureWindowsFs()

    expect(await codeOf(() => fixture[verb](drive))).toBe('EEXIST')
    await expect(fixture[verb](drive)).rejects.toThrow(message)
  })

  it('stats entries with a deterministic windows path', async () => {
    const fixture = createFixtureWindowsFs()
    const info = await fixture.stat('C:\\Users\\dev\\Documents\\notes.txt')
    expect(info.windowsPath).toBe('C:\\Users\\dev\\Documents\\notes.txt')
    expect(info.sizeBytes).toBe('Windows fixture notes\n'.length)
    expect(info.owner).toBeNull()
    expect(info.permissions).toBeNull()
    expect(info.atime).toBe('2024-06-01T10:00:00.000Z')
    expect((await fixture.stat(WINDOWS_ROOT)).type).toBe('directory')
  })

  it('measures immediate children recursively without following directory links', async () => {
    const target = dir('sizes', 'target')
    writeFileSync(join(target, 'payload.bin'), Buffer.alloc(17))
    const measured = dir('sizes', 'measured')
    writeFileSync(join(measured, 'small.txt'), '12345')
    const nested = dir('sizes', 'measured', 'nested')
    writeFileSync(join(nested, 'large.txt'), Buffer.alloc(29))
    try {
      const { symlinkSync } = await import('fs')
      symlinkSync(target, join(measured, 'loop'), 'junction')
    } catch {
      // Junction creation may be unavailable on a restricted test account.
    }

    const result = await fs.dirSizes(dir('sizes'), 'size-success')
    expect(result.cancelled).toBe(false)
    expect(result.entries.map(({ name }) => name)).toEqual(['measured', 'target'])
    expect(result.entries[0]).toMatchObject({ name: 'measured', sizeBytes: 34, partial: false })
    expect(result.entries[1]).toMatchObject({ name: 'target', sizeBytes: 17 })
    expect(result.totalBytes).toBe(51)
  })

  it('cancels a large traversal and returns a partial result', async () => {
    const many = dir('sizes-many')
    for (let i = 0; i < 400; i++) writeFileSync(join(many, `f${i}.txt`), 'x')
    const pending = fs.dirSizes(many, 'size-cancel')
    await fs.cancelDirSizes('size-cancel')
    const result = await pending
    expect(result.cancelled).toBe(true)
    expect(result.path).toBe(many)
  })

})

describe('dirSizes — link roots and This PC', () => {
  describe.runIf(IS_WINDOWS)('createWindowsFs', () => {
    it.each(['junction', 'dir'] as const)(
      'measures through a %s root without following the links beneath it',
      async (kind) => {
        const base = dir(`sizes-${kind}-root`)
        const target = dir(`sizes-${kind}-root`, 'target')
        writeFileSync(join(target, 'top.bin'), Buffer.alloc(11))
        const inner = dir(`sizes-${kind}-root`, 'target', 'inner')
        writeFileSync(join(inner, 'deep.bin'), Buffer.alloc(13))
        const outside = dir(`sizes-${kind}-root`, 'outside')
        writeFileSync(join(outside, 'elsewhere.bin'), Buffer.alloc(1000))
        // A link back up the tree would loop, and a sideways one would count
        // bytes that do not live under the measured folder.
        symlinkSync(target, join(inner, 'cycle'), kind)
        symlinkSync(outside, join(target, 'sideways'), kind)
        const link = join(base, 'link')
        symlinkSync(target, link, kind)

        expect(await fs.dirSizes(link, `size-${kind}-root`)).toEqual({
          path: link,
          entries: [
            { name: 'inner', path: join(link, 'inner'), isDirectory: true, sizeBytes: 13, partial: false },
            { name: 'top.bin', path: join(link, 'top.bin'), isDirectory: false, sizeBytes: 11, partial: false }
          ],
          totalBytes: 24,
          skipped: 0,
          cancelled: false,
          error: null
        })
      }
    )

    it('still rejects a link root that names a file or nothing at all', async () => {
      const base = dir('sizes-bad-link-root')
      const file = join(base, 'plain.txt')
      writeFileSync(file, 'x')
      symlinkSync(file, join(base, 'file-link'), 'file')
      symlinkSync(join(base, 'missing'), join(base, 'broken-link'), 'junction')

      expect(await codeOf(() => fs.dirSizes(file, 'size-plain-file'))).toBe('ENOTDIR')
      expect(await codeOf(() => fs.dirSizes(join(base, 'file-link'), 'size-file-link'))).toBe('ENOTDIR')
      expect(await codeOf(() => fs.dirSizes(join(base, 'broken-link'), 'size-broken-link'))).toBe('ENOENT')
    })
  })

  it('answers This PC with an empty, finished measurement instead of a path error', async () => {
    const thisPc = {
      path: WINDOWS_ROOT,
      entries: [],
      totalBytes: 0,
      skipped: 0,
      cancelled: false,
      error: null
    }
    expect(await fs.dirSizes(WINDOWS_ROOT, 'size-this-pc')).toEqual(thisPc)
    expect(await createFixtureWindowsFs().dirSizes(WINDOWS_ROOT, 'size-this-pc')).toEqual(thisPc)
  })

  it('lists the fixture junction as a directory link and browses through it', async () => {
    const fixture = createFixtureWindowsFs()
    expect(
      (await fixture.list('D:\\Library')).map((e) => [e.name, e.type, e.symlinkTarget, e.targetType])
    ).toEqual([
      ['Media', 'symlink', 'D:\\Media', 'directory'],
      ['playlist.m3u', 'file', null, null]
    ])
    expect((await fixture.tree('D:\\Library')).map((e) => e.name)).toEqual(['Media'])
    expect((await fixture.stat('D:\\Library\\Media')).type).toBe('symlink')
    expect((await fixture.list('D:\\Library\\Media')).map((e) => e.path)).toEqual([
      'D:\\Library\\Media\\clip.mp4'
    ])
    expect(await codeOf(() => fixture.readText('D:\\Library\\Media', 4096))).toBe('EISDIR')
  })

  it('measures through the fixture junction root and skips it beneath a measured folder', async () => {
    const fixture = createFixtureWindowsFs()
    const clip = 'fixture media clip\n'.length
    const playlist = '#EXTM3U\n'.length

    expect(await fixture.dirSizes('D:\\Library\\Media', 'size-fixture-junction')).toEqual({
      path: 'D:\\Library\\Media',
      entries: [
        { name: 'clip.mp4', path: 'D:\\Library\\Media\\clip.mp4', isDirectory: false, sizeBytes: clip, partial: false }
      ],
      totalBytes: clip,
      skipped: 0,
      cancelled: false,
      error: null
    })
    // The junction is not an entry of its own folder…
    const library = await fixture.dirSizes('D:\\Library', 'size-fixture-library')
    expect(library.entries.map((e) => [e.name, e.sizeBytes])).toEqual([['playlist.m3u', playlist]])
    expect(library.totalBytes).toBe(playlist)
    // …and adds nothing to the folder above it, so D:\Media is counted once.
    const drive = await fixture.dirSizes('D:\\', 'size-fixture-drive')
    expect(drive.entries.map((e) => [e.name, e.sizeBytes])).toEqual([
      ['Media', clip],
      ['Library', playlist]
    ])
    expect(drive.totalBytes).toBe(clip + playlist)
  })
})
