import { spawnSync } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { decodeWslOutput } from '../../../src/main/wsl/runner'
import {
  buildTrashBatchScript,
  buildTrashInfo,
  formatDeletionDate,
  resolveTrashCollision,
  trashEntries
} from '../../../src/main/explorer/trash'
import { fail, MockRunner, ok } from './mock-runner'

describe('buildTrashInfo', () => {
  it('produces the freedesktop trashinfo block with local time', () => {
    const date = new Date(2026, 6, 30, 9, 5, 3)
    expect(buildTrashInfo('/home/u/config.json', date)).toBe(
      '[Trash Info]\nPath=/home/u/config.json\nDeletionDate=2026-07-30T09:05:03\n'
    )
  })

  it('zero-pads date components', () => {
    expect(formatDeletionDate(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05')
  })
})

describe('resolveTrashCollision', () => {
  it('keeps free names', () => {
    expect(resolveTrashCollision('file.txt', new Set())).toBe('file.txt')
  })

  it('inserts the counter before the extension (name.2.ext style)', () => {
    expect(resolveTrashCollision('file.txt', new Set(['file.txt']))).toBe('file.2.txt')
    expect(resolveTrashCollision('file.txt', new Set(['file.txt', 'file.2.txt']))).toBe(
      'file.3.txt'
    )
  })

  it('appends the counter for extensionless and dotfile names', () => {
    expect(resolveTrashCollision('file', new Set(['file']))).toBe('file.2')
    expect(resolveTrashCollision('.bashrc', new Set(['.bashrc']))).toBe('.bashrc.2')
  })

  it('splits at the last dot for multi-extension names', () => {
    expect(resolveTrashCollision('archive.tar.gz', new Set(['archive.tar.gz']))).toBe(
      'archive.tar.2.gz'
    )
  })
})

describe('buildTrashBatchScript', () => {
  const date = new Date(2026, 6, 30, 9, 5, 3)

  it('writes the info file before moving and quotes hostile paths', () => {
    const script = buildTrashBatchScript('/home/u/.local/share/Trash', [
      { sourcePath: "/home/u/a'b.txt", trashName: "a'b.txt", date }
    ])
    const infoIdx = script.indexOf('.trashinfo')
    const mvIdx = script.indexOf('mv ')
    expect(infoIdx).toBeGreaterThan(-1)
    expect(mvIdx).toBeGreaterThan(infoIdx)
    expect(script).toContain("'/home/u/.local/share/Trash/info/a'\\''b.txt.trashinfo'")
    expect(script).toContain(
      "mv '/home/u/a'\\''b.txt' '/home/u/.local/share/Trash/files/a'\\''b.txt'"
    )
    expect(script).toContain("'[Trash Info]'")
    expect(script).toContain("'Path=/home/u/a'\\''b.txt'")
    expect(script).toContain("'DeletionDate=2026-07-30T09:05:03'")
  })

  it('cleans up the info file and marks the item index on failure', () => {
    const script = buildTrashBatchScript('/t', [
      { sourcePath: '/a', trashName: 'a', date },
      { sourcePath: '/b', trashName: 'b', date }
    ])
    expect(script).toContain("rm -f '/t/info/a.trashinfo'; echo 'WSLPAD_FAIL:0' 1>&2")
    expect(script).toContain("rm -f '/t/info/b.trashinfo'; echo 'WSLPAD_FAIL:1' 1>&2")
  })
})

describe('trashEntries', () => {
  const now = () => new Date(2026, 6, 30, 9, 5, 3)
  const inspected = (...entries: Array<[string, string]>) =>
    ok(['WSLPAD_TRASH_INSPECT', ...entries.flat(), ''].join('\0'))

  it.each([false, true])(
    'keeps distinct entries reached through symlink/.. (reverse: %s)',
    async (reverse) => {
      const linked = '/home/u/link/../file.txt'
      const local = '/home/u/file.txt'
      const paths = reverse ? [local, linked] : [linked, local]
      const runner = new MockRunner().on((script) =>
        script.includes('WSLPAD_TRASH_INSPECT')
          ? inspected(
              ...paths.map((path): [string, string] => [
                'o',
                path === linked ? '/outside' : '/home/u'
              ])
            )
          : undefined
      )

      await trashEntries(runner, 'Ubuntu', paths, '/home/u', now)

      const batch = runner.calls[runner.calls.length - 1].script
      expect(batch.match(/\bmv '/g)).toHaveLength(2)
      expect(batch).toContain("mv '/home/u/link/../file.txt' ")
      expect(batch).toContain("mv '/home/u/file.txt' ")
      expect(batch).toContain("'/home/u/.local/share/Trash/files/file.2.txt'")
    }
  )

  it.each([false, true])(
    'moves a selected child before its directory symlink (parent first: %s)',
    async (parentFirst) => {
      const link = '/home/u/link'
      const child = '/home/u/link/child.txt'
      const paths = parentFirst ? [link, child] : [child, link]
      const runner = new MockRunner().on((script) =>
        script.includes('WSLPAD_TRASH_INSPECT')
          ? inspected(
              ...paths.map((path): [string, string] => [
                'o',
                path === link ? '/home/u' : '/outside'
              ])
            )
          : undefined
      )

      await trashEntries(runner, 'Ubuntu', paths, '/home/u', now)

      const batch = runner.calls[runner.calls.length - 1].script
      expect(batch.match(/\bmv '/g)).toHaveLength(2)
      expect(batch.indexOf("mv '/home/u/link/child.txt' ")).toBeLessThan(
        batch.indexOf("mv '/home/u/link' ")
      )
      expect(runner.calls[0].script).toContain("[ -d '/home/u/link' ] && [ ! -L '/home/u/link' ]")
      expect(runner.calls[0].opts?.nulDelimited).toBe(true)
    }
  )

  it('keeps a selected descendant reached through an intermediate directory link', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('WSLPAD_TRASH_INSPECT')
        ? inspected(['d', '/home/u'], ['o', '/outside'])
        : undefined
    )
    await trashEntries(
      runner,
      'Ubuntu',
      ['/home/u/folder', '/home/u/folder/link/file.txt'],
      '/home/u',
      now
    )
    const batch = runner.calls[runner.calls.length - 1].script
    expect(batch.match(/\bmv '/g)).toHaveLength(2)
    expect(batch.indexOf("mv '/home/u/folder/link/file.txt' ")).toBeLessThan(
      batch.indexOf("mv '/home/u/folder' ")
    )
  })

  it('still de-duplicates .. spellings when their physical parent and basename match', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('WSLPAD_TRASH_INSPECT')
        ? inspected(['o', '/home/u/docs'], ['o', '/home/u/docs'])
        : undefined
    )
    await trashEntries(
      runner,
      'Ubuntu',
      ['/home/u/docs/sub/../file.txt', '/home/u/docs/file.txt'],
      '/home/u',
      now
    )
    const batch = runner.calls[runner.calls.length - 1].script
    expect(batch.match(/\bmv '/g)).toHaveLength(1)
  })

  it('creates trash dirs, avoids collisions against files/ and info/', async () => {
    const runner = new MockRunner()
      .on((script) =>
        script.includes('mkdir -p') ? ok('config.json\nconfig.json.trashinfo\nother\n') : undefined
      )
      .on((script) => (script.includes('WSLPAD_FAIL') ? ok('') : undefined))
    await trashEntries(runner, 'Ubuntu', ['/home/u/config.json'], '/home/u', now)
    const listScript = runner.calls[0].script
    expect(listScript).toContain(
      "mkdir -p '/home/u/.local/share/Trash/files' '/home/u/.local/share/Trash/info'"
    )
    const batch = runner.calls[1].script
    expect(batch).toContain(
      "mv '/home/u/config.json' '/home/u/.local/share/Trash/files/config.2.json'"
    )
    expect(batch).toContain("'/home/u/.local/share/Trash/info/config.2.json.trashinfo'")
    expect(batch).toContain("'Path=/home/u/config.json'")
  })

  it('assigns distinct names for same-basename batch items', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('mkdir -p') ? ok('') : undefined
    )
    await trashEntries(runner, 'Ubuntu', ['/a/x.txt', '/b/x.txt'], '/home/u', now)
    const batch = runner.calls[1].script
    expect(batch).toContain("'/home/u/.local/share/Trash/files/x.txt'")
    expect(batch).toContain("'/home/u/.local/share/Trash/files/x.2.txt'")
  })

  it('trashes a path given twice once, without a false ENOENT', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('mkdir -p') ? ok('') : undefined
    )
    await trashEntries(
      runner,
      'Ubuntu',
      ['/a/x.txt', '/a/x.txt', '/b/x.txt', '/a/x.txt'],
      '/home/u',
      now
    )
    expect(runner.calls).toHaveLength(2)
    const batch = runner.calls[1].script
    expect(batch.match(/^printf /gm)).toHaveLength(2)
    expect(batch.split("mv '/a/x.txt' ")).toHaveLength(2)
    expect(batch).toContain("mv '/a/x.txt' '/home/u/.local/share/Trash/files/x.txt'")
    // The other directory's x.txt still gets its own name; the duplicate did
    // not use up x.2.txt or push it to x.3.txt.
    expect(batch).toContain("mv '/b/x.txt' '/home/u/.local/share/Trash/files/x.2.txt'")
    expect(batch).not.toContain('x.3.txt')
    expect(batch).not.toContain('WSLPAD_FAIL:2')
  })

  it.each([false, true])(
    'moves a real parent directory with its descendants (parent first: %s)',
    async (parentFirst) => {
      const paths = parentFirst
        ? ['/home/u/docs', '/home/u/docs/sub/file.txt', '/home/u/docs/other.txt']
        : ['/home/u/docs/sub/file.txt', '/home/u/docs', '/home/u/docs/other.txt']
      const runner = new MockRunner().on((script) =>
        script.includes('WSLPAD_TRASH_INSPECT')
          ? parentFirst
            ? inspected(['d', '/home/u'], ['o', '/home/u/docs/sub'], ['o', '/home/u/docs'])
            : inspected(['o', '/home/u/docs/sub'], ['d', '/home/u'], ['o', '/home/u/docs'])
          : undefined
      )
      await trashEntries(runner, 'Ubuntu', paths, '/home/u', now)

      expect(runner.calls).toHaveLength(3)
      const batch = runner.calls[2].script
      expect(batch.match(/\bmv '/g)).toHaveLength(1)
      expect(batch).toContain("mv '/home/u/docs' '/home/u/.local/share/Trash/files/docs'")
      expect(batch).not.toContain('/home/u/docs/sub/file.txt')
      expect(batch).not.toContain('/home/u/docs/other.txt')
    }
  )

  it('rejects an inspection failure before creating trash directories or moving files', async () => {
    const runner = new MockRunner().on(() => fail(40, 'WSLPAD_FAIL:1'))
    await expect(
      trashEntries(runner, 'Ubuntu', ['/home/u/docs', '/home/u/docs/gone'], '/home/u', now)
    ).rejects.toMatchObject({ code: 'ENOENT', path: '/home/u/docs/gone' })
    expect(runner.calls).toHaveLength(1)
    expect(runner.calls[0].script).not.toContain('mkdir')
    expect(runner.calls[0].script).not.toContain('mv ')
  })

  it('rejects incomplete inspection records instead of dropping selected entries', async () => {
    const runner = new MockRunner().on(() => ok('WSLPAD_TRASH_INSPECT\0d\0'))
    await expect(
      trashEntries(runner, 'Ubuntu', ['/home/u/docs', '/home/u/docs/a'], '/home/u', now)
    ).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(runner.calls).toHaveLength(1)
  })

  it('refuses a root directory reached through symlink/.. before any mutation', async () => {
    const runner = new MockRunner().on(() => inspected(['d', '/outside'], ['o', '/home/u']))
    await expect(
      trashEntries(runner, 'Ubuntu', ['/home/u/link/..', '/home/u/file.txt'], '/home/u', now)
    ).rejects.toMatchObject({ code: 'UNKNOWN', path: '/home/u/link/..' })
    expect(runner.calls).toHaveLength(1)
  })

  it.each([
    '/home/u/.local/share/Trash',
    '/home/u/.local/share/Trash/files/a',
    '/home/u/.local/share/Trash/info/../files/a',
    '//home/u/.local/share/Trash/./files/a'
  ])('refuses to trash the trash directory or an entry inside it: %s', async (path) => {
    const runner = new MockRunner()
    await expect(trashEntries(runner, 'Ubuntu', [path], '/home/u', now)).rejects.toMatchObject({
      code: 'UNKNOWN',
      path
    })
    expect(runner.calls).toHaveLength(0)
  })

  it('moves paths only once when their spellings normalize to the same target', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('mkdir -p') ? ok('') : undefined
    )
    await trashEntries(runner, 'Ubuntu', ['//home/u/./a.txt', '/home/u/a.txt'], '/home/u', now)

    expect(runner.calls).toHaveLength(2)
    const batch = runner.calls[1].script
    expect(batch.match(/\bmv '/g)).toHaveLength(1)
    expect(batch).toContain("mv '//home/u/./a.txt' '/home/u/.local/share/Trash/files/a.txt'")
  })

  it.each([
    ['/home/u/docs/', '/home/u/docs'],
    ['/home/u/docs', '/home/u/docs//']
  ])('trashes a directory once for trailing-slash duplicates: %s, %s', async (first, second) => {
    const runner = new MockRunner().on((script) =>
      script.includes('mkdir -p') ? ok('') : undefined
    )
    await trashEntries(runner, 'Ubuntu', [first, second], '/home/u', now)

    const batch = runner.calls[1].script
    expect(batch.match(/\bmv '/g)).toHaveLength(1)
    expect(batch).toContain(`mv '${first}' '/home/u/.local/share/Trash/files/docs'`)
  })

  it('refuses a mixed batch before moving a valid source when another source is inside trash', async () => {
    const runner = new MockRunner()
    await expect(
      trashEntries(
        runner,
        'Ubuntu',
        ['/home/u/keep.txt', '/home/u/.local/share/Trash/files/a'],
        '/home/u',
        now
      )
    ).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(runner.calls).toHaveLength(0)
  })

  it('names the failed item by its place in the de-duplicated batch', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('mkdir -p') ? ok('') : undefined))
      .on((script) =>
        script.includes('WSLPAD_FAIL')
          ? ok('', 0, "mv: cannot move '/b': Permission denied\nWSLPAD_FAIL:1")
          : undefined
      )
    await expect(
      trashEntries(runner, 'Ubuntu', ['/a', '/a', '/b'], '/home/u', now)
    ).rejects.toMatchObject({ code: 'EACCES', path: '/b' })
  })

  it('throws a mapped error when an item fails', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('mkdir -p') ? ok('') : undefined))
      .on((script) =>
        script.includes('WSLPAD_FAIL')
          ? ok('', 0, "mv: cannot move '/x': Permission denied\nWSLPAD_FAIL:0")
          : undefined
      )
    await expect(trashEntries(runner, 'Ubuntu', ['/x'], '/home/u', now)).rejects.toMatchObject({
      code: 'EACCES',
      path: '/x'
    })
  })

  it('fails when the trash dirs cannot be created', async () => {
    const runner = new MockRunner().on(() => fail(43, 'Permission denied'))
    await expect(trashEntries(runner, 'Ubuntu', ['/x'], '/home/u', now)).rejects.toMatchObject({
      code: 'EACCES'
    })
  })

  it.each(['/', '//', '///', '/./'])('refuses to trash %s without a shell call', async (root) => {
    const runner = new MockRunner()
    await expect(trashEntries(runner, 'Ubuntu', [root], '/home/u', now)).rejects.toThrow(
      `Refusing to trash ${root}`
    )
    expect(runner.calls).toHaveLength(0)
  })

  it('refuses the whole batch when one item is the root', async () => {
    const runner = new MockRunner()
    await expect(
      trashEntries(runner, 'Ubuntu', ['/home/u/a', '///'], '/home/u', now)
    ).rejects.toThrow('Refusing to trash ///')
    expect(runner.calls).toHaveLength(0)
  })

  it('still trashes a top-level entry', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('mkdir -p') ? ok('') : undefined
    )
    await trashEntries(runner, 'Ubuntu', ['/scratch'], '/home/u', now)
    expect(runner.calls[1].script).toContain(
      "mv '/scratch' '/home/u/.local/share/Trash/files/scratch'"
    )
  })
})

describe('trashEntries with a local POSIX shell', () => {
  // Git's existing sh on Windows exercises the generated scripts without
  // starting a WSL distribution. Each case owns only this temporary tree.
  const linuxPath = (path: string): string =>
    path
      .replace(/\\/g, '/')
      .replace(/^([A-Za-z]):/, (_, drive: string) => '/' + drive.toLowerCase())
  const shellRunner = (): MockRunner => {
    let shell = 'sh'
    if (process.platform === 'win32') {
      const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true })
      if (git.status === 0) {
        const candidate = resolve(git.stdout.trim(), '../../../usr/bin/sh.exe')
        if (existsSync(candidate)) shell = candidate
      }
    }
    return new MockRunner().on((script, call) => {
      // Windows also supplies a different find.exe; use POSIX utilities here.
      const result = spawnSync(shell, ['-c', 'PATH=/usr/bin:/bin:$PATH\n' + script], {
        timeout: 10000,
        windowsHide: true
      })
      if (result.error) throw result.error
      return ok(
        decodeWslOutput(result.stdout, 'utf8', call.opts?.nulDelimited),
        result.status ?? 1,
        decodeWslOutput(result.stderr, 'utf8')
      )
    })
  }

  it('trashes both distinct files when .. traverses a directory link', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wslpad-trash-dotdot-'))
    try {
      const home = join(base, 'home')
      const outside = join(base, 'outside')
      mkdirSync(home)
      mkdirSync(join(outside, 'sub'), { recursive: true })
      symlinkSync(join(outside, 'sub'), join(home, 'link'), 'dir')
      writeFileSync(join(outside, 'file.txt'), 'outside')
      writeFileSync(join(home, 'file.txt'), 'local')
      symlinkSync(join(outside, 'file.txt'), join(home, 'alias.txt'), 'file')
      await trashEntries(
        shellRunner(),
        'test',
        [
          linuxPath(home) + '/link/../file.txt',
          linuxPath(home) + '/file.txt',
          linuxPath(home) + '/alias.txt'
        ],
        linuxPath(home)
      )
      const files = join(home, '.local', 'share', 'Trash', 'files')
      expect(readFileSync(join(files, 'file.txt'), 'utf8')).toBe('outside')
      expect(readFileSync(join(files, 'file.2.txt'), 'utf8')).toBe('local')
      expect(lstatSync(join(files, 'alias.txt')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(outside, 'file.txt'))).toBe(false)
      expect(existsSync(join(home, 'file.txt'))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it.each([false, true])(
    'keeps real directory contents and unrelated files (parent first: %s)',
    async (parentFirst) => {
      const base = mkdtempSync(join(tmpdir(), 'wslpad-trash-directory-'))
      try {
        const home = join(base, 'home')
        const docs = join(home, 'docs')
        mkdirSync(join(docs, 'sub'), { recursive: true })
        writeFileSync(join(docs, 'sub', 'file.txt'), 'nested')
        writeFileSync(join(home, 'other.txt'), 'unrelated')
        const parent = linuxPath(docs)
        const child = parent + '/sub/file.txt'
        await trashEntries(
          shellRunner(),
          'test',
          [...(parentFirst ? [parent, child] : [child, parent]), linuxPath(home) + '/other.txt'],
          linuxPath(home)
        )
        const files = join(home, '.local', 'share', 'Trash', 'files')
        expect(readFileSync(join(files, 'docs', 'sub', 'file.txt'), 'utf8')).toBe('nested')
        expect(readFileSync(join(files, 'other.txt'), 'utf8')).toBe('unrelated')
        expect(existsSync(join(files, 'file.txt'))).toBe(false)
        expect(existsSync(docs)).toBe(false)
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }
  )

  it.each([false, true])(
    'trashes a child and its directory link (parent first: %s)',
    async (parentFirst) => {
      const base = mkdtempSync(join(tmpdir(), 'wslpad-trash-link-'))
      try {
        const home = join(base, 'home')
        const outside = join(base, 'outside')
        mkdirSync(home)
        mkdirSync(outside)
        symlinkSync(outside, join(home, 'link'), 'dir')
        writeFileSync(join(outside, 'child.txt'), 'selected')
        const link = linuxPath(home) + '/link'
        const child = link + '/child.txt'
        await trashEntries(
          shellRunner(),
          'test',
          parentFirst ? [link, child] : [child, link],
          linuxPath(home)
        )
        const files = join(home, '.local', 'share', 'Trash', 'files')
        expect(readFileSync(join(files, 'child.txt'), 'utf8')).toBe('selected')
        expect(lstatSync(join(files, 'link')).isSymbolicLink()).toBe(true)
        expect(existsSync(join(outside, 'child.txt'))).toBe(false)
        expect(existsSync(join(home, 'link'))).toBe(false)
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }
  )
})
