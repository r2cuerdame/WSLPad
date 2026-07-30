import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { chmod, readFile, readdir } from 'fs/promises'
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

  it('routes trash through the injected trashItem', async () => {
    const base = dir('trash')
    const file = join(base, 'bin-me.txt')
    writeFileSync(file, 'x')
    trashed = []
    await fs.trash([file])
    expect(trashed).toEqual([file])
  })
})

describe('createWindowsFs — copy and move', () => {
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
})
