import { describe, expect, it } from 'vitest'
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

  it('refuses to trash /', async () => {
    const runner = new MockRunner()
    await expect(trashEntries(runner, 'Ubuntu', ['/'], '/home/u', now)).rejects.toThrow('Refusing')
    expect(runner.calls).toHaveLength(0)
  })
})
