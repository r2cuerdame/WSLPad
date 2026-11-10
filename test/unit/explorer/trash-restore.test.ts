import { describe, expect, it } from 'vitest'
import {
  buildRestoreScript,
  buildTrashListScript,
  buildTrashInfo,
  decodeTrashPath,
  encodeTrashPath,
  listTrash,
  parseTrashList,
  restoreFromTrash
} from '../../../src/main/explorer/trash'
import { fail, MockRunner, ok } from './mock-runner'

const record = (fields: string[]): string =>
  '###WSLPAD_TRASH_ITEM\n' + fields.map((f) => `###WSLPAD_TRASH_FIELD\n${f}\n`).join('')

describe('the trashinfo Path field', () => {
  it('is percent-encoded, as the spec says and other trash tools expect', () => {
    // Without this, an entry made by WSLPad and read by another file manager
    // disagrees about where the file came from.
    expect(buildTrashInfo('/home/u/my report (final).txt', new Date(2026, 0, 1))).toContain(
      'Path=/home/u/my%20report%20(final).txt'
    )
    // Slashes stay literal: every implementation writes them that way.
    expect(encodeTrashPath('/a/b/c')).toBe('/a/b/c')
  })

  it('round-trips anything a filename can hold', () => {
    for (const path of ['/home/u/파일.txt', '/home/u/a b#c?d.txt', '/home/u/100 done.md']) {
      expect(decodeTrashPath(encodeTrashPath(path))).toBe(path)
    }
  })

  it('takes a value it cannot decode literally rather than throwing', () => {
    // A stray percent sign from another tool must not break the listing.
    expect(decodeTrashPath('/home/u/50%.txt')).toBe('/home/u/50%.txt')
  })
})

describe('parseTrashList', () => {
  it('reads a record into an entry', () => {
    const entries = parseTrashList(
      record(['notes.md', '/home/dev/notes.md', '2026-07-31T10:00:00', 'file', '412'])
    )
    expect(entries).toEqual([
      {
        trashName: 'notes.md',
        originalPath: '/home/dev/notes.md',
        deletedAt: '2026-07-31T10:00:00',
        type: 'file',
        present: true,
        sizeBytes: 412
      }
    ])
  })

  it('decodes the original path', () => {
    const entries = parseTrashList(
      record(['a.txt', '/home/dev/my%20file.txt', '2026-07-31T10:00:00', 'file', '1'])
    )
    expect(entries[0].originalPath).toBe('/home/dev/my file.txt')
  })

  it('shows a record whose file is gone, with an unknown size', () => {
    // The .trashinfo outliving its file is a real state; hiding it would make
    // the listing disagree with the directory.
    const entries = parseTrashList(
      record(['x', '/home/dev/x', '2026-07-31T10:00:00', 'missing', ''])
    )
    expect(entries[0].present).toBe(false)
    expect(entries[0].sizeBytes).toBeNull()
  })

  it('drops a record that says nothing about where the file came from', () => {
    // With no original path there is nowhere to restore it to, and offering
    // the row would invite exactly that.
    expect(parseTrashList(record(['x', '', '2026-07-31T10:00:00', 'file', '1']))).toEqual([])
  })

  it('puts the newest deletion first', () => {
    const text =
      record(['old', '/a', '2026-07-01T10:00:00', 'file', '1']) +
      record(['new', '/b', '2026-07-31T10:00:00', 'file', '1'])
    expect(parseTrashList(text).map((e) => e.trashName)).toEqual(['new', 'old'])
  })

  it('survives a path containing a newline', () => {
    // Fields are marker-delimited for this reason: a filename may hold one.
    const entries = parseTrashList(
      record(['weird', '/home/dev/two%0Alines.txt', '2026-07-31T10:00:00', 'file', '1'])
    )
    expect(entries[0].originalPath).toBe('/home/dev/two\nlines.txt')
  })
})

describe('buildTrashListScript', () => {
  it('counts a broken symlink in trash as present instead of missing', () => {
    const script = buildTrashListScript('/home/dev/.local/share/Trash')
    expect(script).toContain('{ [ -e "$t" ] || [ -L "$t" ]; } || k=missing')
  })
})

describe('buildRestoreScript', () => {
  const entry = {
    trashName: 'notes.md',
    originalPath: '/home/dev/docs/notes.md',
    deletedAt: '2026-07-31T10:00:00',
    type: 'file' as const,
    present: true,
    sizeBytes: 10
  }

  it('refuses to overwrite whatever is at the destination', () => {
    const script = buildRestoreScript('/home/dev/.local/share/Trash', entry)
    // The whole point of an undo is that it destroys nothing.
    expect(script).toContain('WSLPAD_EXISTS')
    expect(script.indexOf('WSLPAD_EXISTS')).toBeLessThan(script.indexOf('mv '))
  })

  it('recognizes a broken symlink in trash and protects a broken symlink destination', () => {
    const script = buildRestoreScript('/home/dev/.local/share/Trash', entry)
    expect(script).toContain(
      "{ [ -e '/home/dev/.local/share/Trash/files/notes.md' ] || [ -L '/home/dev/.local/share/Trash/files/notes.md' ]; }"
    )
    expect(script).toContain(
      "{ [ -e '/home/dev/docs/notes.md' ] || [ -L '/home/dev/docs/notes.md' ]; } && { echo 'WSLPAD_EXISTS'"
    )
  })

  it('recreates the folder the file came from, and clears the record after', () => {
    const script = buildRestoreScript('/home/dev/.local/share/Trash', entry)
    expect(script).toContain('mkdir -p')
    expect(script).toContain('/home/dev/docs')
    expect(script).toContain('rm -f')
    expect(script).toContain('notes.md.trashinfo')
  })

  it('refuses a record whose original path is not an absolute path', () => {
    expect(() => buildRestoreScript('/t', { ...entry, originalPath: 'relative/path' })).toThrow()
  })
})

describe('listTrash', () => {
  it('reads the records out of the distro', async () => {
    const runner = new MockRunner().on(() =>
      ok(record(['n', '/home/dev/n', '2026-07-31T10:00:00', 'file', '7']))
    )
    const entries = await listTrash(runner, 'Ubuntu', '/home/dev')
    expect(entries).toHaveLength(1)
    expect(runner.calls[0].script).toContain('/home/dev/.local/share/Trash/info')
  })

  it('reports an empty trash as empty, not as an error', async () => {
    const runner = new MockRunner().on(() => ok(''))
    expect(await listTrash(runner, 'Ubuntu', '/home/dev')).toEqual([])
  })
})

describe('restoreFromTrash', () => {
  const listing = record(['notes.md', '/home/dev/notes.md', '2026-07-31T10:00:00', 'file', '7'])
  const listingHandler = (script: string): boolean => script.includes('*.trashinfo')

  it('looks the entry up on disk rather than trusting the caller', async () => {
    const runner = new MockRunner().on((script) => (listingHandler(script) ? ok(listing) : ok('')))
    await restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['notes.md'])

    // The destination comes from the record on disk, never from the renderer.
    expect(runner.calls[1].script).toContain('/home/dev/.local/share/Trash/files/notes.md')
    expect(runner.calls[1].script).toContain('/home/dev/notes.md')
  })

  it('refuses a name that is not in the trash', async () => {
    const runner = new MockRunner().on(() => ok(listing))
    await expect(restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['other'])).rejects.toThrow(
      /Nothing in the trash/
    )
  })

  it('refuses the whole batch before moving anything when one name is not in the trash', async () => {
    // Checking each name only as its turn comes would leave the items in front
    // of the bad one already restored and the rest still in the trash.
    const runner = new MockRunner().on((script) => (listingHandler(script) ? ok(listing) : ok('')))
    await expect(
      restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['notes.md', 'other'])
    ).rejects.toThrow(/Nothing in the trash is called other/)
    expect(runner.calls).toHaveLength(1)
  })

  it('refuses the whole batch before moving anything when one record has no usable destination', async () => {
    const text = listing + record(['bad', 'relative/path', '2026-07-30T10:00:00', 'file', '1'])
    const runner = new MockRunner().on((script) => (listingHandler(script) ? ok(text) : ok('')))
    await expect(
      restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['notes.md', 'bad'])
    ).rejects.toThrow()
    expect(runner.calls).toHaveLength(1)
  })

  it('restores a name given twice once instead of failing on the second', async () => {
    // A real distro answers a second move of the same file with WSLPAD_MISSING,
    // because the first one already put it back.
    const restored = new Set<string>()
    const runner = new MockRunner().on((script) => {
      if (listingHandler(script)) return ok(listing)
      if (restored.has(script)) return fail(1, 'WSLPAD_MISSING\n')
      restored.add(script)
      return ok('')
    })
    await restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['notes.md', 'notes.md'])
    expect(runner.calls).toHaveLength(2)
  })

  it('says the destination is occupied instead of overwriting it', async () => {
    const runner = new MockRunner().on((script) =>
      listingHandler(script) ? ok(listing) : fail(1, 'WSLPAD_EXISTS\n')
    )
    await expect(restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['notes.md'])).rejects.toThrow(
      /already exists/
    )
  })

  it('reports a broken symlink destination as occupied', async () => {
    const runner = new MockRunner().on((script) =>
      listingHandler(script) ? ok(listing) : fail(1, 'WSLPAD_EXISTS\n')
    )
    await expect(restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['notes.md'])).rejects.toThrow(
      /already exists/
    )
    expect(runner.calls[1].script).toContain("[ -L '/home/dev/notes.md' ]")
  })

  it('says the trashed copy is gone rather than reporting success', async () => {
    const runner = new MockRunner().on((script) =>
      listingHandler(script) ? ok(listing) : fail(1, 'WSLPAD_MISSING\n')
    )
    await expect(restoreFromTrash(runner, 'Ubuntu', '/home/dev', ['notes.md'])).rejects.toThrow(
      /is gone/
    )
  })

  it('does nothing at all for an empty selection', async () => {
    const runner = new MockRunner()
    await restoreFromTrash(runner, 'Ubuntu', '/home/dev', [])
    expect(runner.calls).toEqual([])
  })
})
