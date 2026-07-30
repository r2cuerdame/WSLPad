import { describe, expect, it } from 'vitest'
import {
  DIR_SIZE_CHILD_CAP,
  buildDirSizesScript,
  collectDirSizes,
  parseDuOutput,
  parseDuPartials
} from '../../../src/main/explorer/dir-sizes'
import type { FileEntry } from '../../../src/shared/types'
import { MockRunner, ok, timedOut } from './mock-runner'

const DIR = '/home/dev'

function child(name: string, type: FileEntry['type'] = 'directory'): FileEntry {
  return {
    name,
    path: `${DIR}/${name}`,
    type,
    sizeBytes: type === 'directory' ? null : 10,
    mtime: null,
    owner: 'dev',
    group: 'dev',
    permissions: 'rwxr-xr-x',
    permissionsOctal: '755',
    isHidden: name.startsWith('.'),
    symlinkTarget: null,
    targetType: null
  }
}

const CHILDREN = [child('projects'), child('.cache'), child('notes.md', 'file')]

const du = (lines: Array<[number, string]>): string =>
  lines.map(([bytes, path]) => `${bytes}\t${path}`).join('\n') + '\n'

describe('buildDirSizesScript', () => {
  it('measures every child in one du call, quoted and one-filesystem', () => {
    const script = buildDirSizesScript(['/home/dev/a b', "/home/dev/o'brien"])
    expect(script).toBe("LC_ALL=C du -s -x --block-size=1 -- '/home/dev/a b' '/home/dev/o'\\''brien'")
    expect(script.split('du -s').length - 1).toBe(1)
  })
})

describe('parseDuOutput', () => {
  it('keeps paths verbatim and drops lines it cannot read', () => {
    const sizes = parseDuOutput(du([[4096, '/home/dev/a']]) + 'garbage\n\n' + '12\t/home/dev/b\n')
    expect(sizes.get('/home/dev/a')).toBe(4096)
    expect(sizes.get('/home/dev/b')).toBe(12)
    expect(sizes.size).toBe(2)
  })
})

describe('parseDuPartials', () => {
  it('finds the paths du could not fully read', () => {
    const stderr =
      "du: cannot read directory '/home/dev/projects/secret': Permission denied\n" +
      "du: cannot access '/home/dev/gone': No such file or directory\n"
    expect([...parseDuPartials(stderr)]).toEqual(['/home/dev/projects/secret', '/home/dev/gone'])
  })
})

describe('collectDirSizes', () => {
  it('returns the children sorted largest first with a total', async () => {
    const runner = new MockRunner().on((script) =>
      script.startsWith('LC_ALL=C du')
        ? ok(
            du([
              [4096, `${DIR}/.cache`],
              [1_048_576, `${DIR}/projects`],
              [512, `${DIR}/notes.md`]
            ])
          )
        : undefined
    )
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, { children: CHILDREN })

    expect(result.entries.map((e) => e.name)).toEqual(['projects', '.cache', 'notes.md'])
    expect(result.entries[0]).toMatchObject({ sizeBytes: 1_048_576, isDirectory: true })
    expect(result.entries[2]).toMatchObject({ sizeBytes: 512, isDirectory: false })
    expect(result.totalBytes).toBe(1_048_576 + 4096 + 512)
    expect(result.skipped).toBe(0)
    expect(result.error).toBeNull()
  })

  it('leaves an unmeasured child null and sorts it last, never zero', async () => {
    const runner = new MockRunner().on(() => ok(du([[900, `${DIR}/projects`]])))
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, { children: CHILDREN })

    expect(result.entries.map((e) => e.name)).toEqual(['projects', '.cache', 'notes.md'])
    expect(result.entries[1].sizeBytes).toBeNull()
    expect(result.entries[2].sizeBytes).toBeNull()
    expect(result.totalBytes).toBe(900)
  })

  it('marks a child du could only partly read as a floor', async () => {
    const runner = new MockRunner().on(() =>
      ok(
        du([[4096, `${DIR}/projects`]]),
        1,
        "du: cannot read directory '/home/dev/projects/vault': Permission denied\n"
      )
    )
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, { children: [child('projects')] })

    expect(result.entries[0]).toMatchObject({ sizeBytes: 4096, partial: true })
    expect(result.error).toBeNull()
  })

  it('reports nothing rather than zeroes when du fails outright', async () => {
    const runner = new MockRunner().on(() => ok('', 1, 'du: command not found'))
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, { children: CHILDREN })

    expect(result.entries).toEqual([])
    expect(result.totalBytes).toBeNull()
    expect(result.error).toBe('du: command not found')
  })

  it('reports a timeout as an error and not as an empty directory', async () => {
    const runner = new MockRunner().on(() => timedOut())
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, { children: CHILDREN })

    expect(result.entries).toEqual([])
    expect(result.error).toContain(DIR)
  })

  it('measures an empty directory as zero, which is an answer', async () => {
    const runner = new MockRunner()
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, { children: [] })

    expect(result.entries).toEqual([])
    expect(result.totalBytes).toBe(0)
    expect(runner.calls).toEqual([])
  })

  it('caps the children it measures and says how many it skipped', async () => {
    const many = Array.from({ length: DIR_SIZE_CHILD_CAP + 7 }, (_, i) => child(`d${i}`))
    const runner = new MockRunner().on(() => ok(du([[10, `${DIR}/d0`]])))
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, { children: many })

    expect(result.entries).toHaveLength(DIR_SIZE_CHILD_CAP)
    expect(result.skipped).toBe(7)
  })

  it('lists a child whose name holds a tab as unmeasured instead of guessing', async () => {
    const tabbed = child('two\tnames')
    const runner = new MockRunner().on(() => ok(du([[10, `${DIR}/projects`]])))
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, {
      children: [child('projects'), tabbed]
    })

    expect(runner.calls[0].script).not.toContain('\t')
    expect(result.entries.map((e) => e.name)).toEqual(['projects'])
    expect(result.skipped).toBe(1)
  })

  it('reports no numbers at all once the run was cancelled', async () => {
    let cancelled = false
    const runner = new MockRunner().on(() => {
      cancelled = true
      return ok(du([[10, `${DIR}/projects`]]))
    })
    const result = await collectDirSizes(runner, 'Ubuntu', DIR, {
      children: CHILDREN,
      isCancelled: () => cancelled
    })

    expect(result.cancelled).toBe(true)
    expect(result.entries).toEqual([])
    expect(result.totalBytes).toBeNull()
  })

  it('lists the directory itself when the caller has no listing', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('find ') ? ok(`d|755|dev|dev|4096|1700000000|projects|\n`) : undefined))
      .on((script) => (script.startsWith('LC_ALL=C du') ? ok(du([[64, `${DIR}/projects`]])) : undefined))
    const result = await collectDirSizes(runner, 'Ubuntu', DIR)

    expect(result.entries.map((e) => e.name)).toEqual(['projects'])
    expect(result.entries[0].sizeBytes).toBe(64)
  })
})
