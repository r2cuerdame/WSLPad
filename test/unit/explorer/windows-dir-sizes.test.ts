import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWindowsFs, type WindowsFs } from '../../../src/main/explorer/windows'

/**
 * Permission failures for the Windows pane's size measurement (issue #312).
 * The test double denies chosen paths instead of changing ACLs on the host,
 * so the run never needs elevation and never leaves a locked folder behind.
 */
const denied = vi.hoisted(() => ({ lstat: new Set<string>(), opendir: new Set<string>() }))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  const refuse = (call: string, path: unknown): NodeJS.ErrnoException =>
    Object.assign(new Error(`EACCES: permission denied, ${call} '${String(path)}'`), {
      code: 'EACCES'
    })
  return {
    ...actual,
    lstat: vi.fn(async (path: Parameters<typeof actual.lstat>[0], ...rest: unknown[]) => {
      if (denied.lstat.has(String(path))) throw refuse('lstat', path)
      return (actual.lstat as (...args: unknown[]) => unknown)(path, ...rest)
    }),
    opendir: vi.fn(async (path: Parameters<typeof actual.opendir>[0], ...rest: unknown[]) => {
      if (denied.opendir.has(String(path))) throw refuse('opendir', path)
      return (actual.opendir as (...args: unknown[]) => unknown)(path, ...rest)
    })
  }
})

let root = ''
let fs: WindowsFs

function dir(...parts: string[]): string {
  const p = join(root, ...parts)
  mkdirSync(p, { recursive: true })
  return p
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wslpad-winsizes-'))
  fs = createWindowsFs({ getPath: (name) => join(root, 'known', name), trashItem: async () => undefined })
})

beforeEach(() => {
  denied.lstat.clear()
  denied.opendir.clear()
})

afterAll(() => {
  fs.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('createWindowsFs — dirSizes with unreadable entries', () => {
  it('lists unreadable children as unmeasured, keeps floors, and sorts unknowns last', async () => {
    const base = dir('mixed')
    writeFileSync(join(base, 'readable.txt'), '12345')
    writeFileSync(join(base, 'locked.txt'), 'never read')
    writeFileSync(join(dir('mixed', 'closed'), 'inside.bin'), Buffer.alloc(7))
    const open = dir('mixed', 'open')
    writeFileSync(join(open, 'a.txt'), Buffer.alloc(11))
    writeFileSync(join(open, 'hidden.txt'), Buffer.alloc(13))
    writeFileSync(join(dir('mixed', 'open', 'sub'), 'b.txt'), Buffer.alloc(3))
    dir('mixed', 'empty')

    denied.lstat.add(join(base, 'locked.txt'))
    denied.opendir.add(join(base, 'closed'))
    denied.lstat.add(join(open, 'hidden.txt'))
    denied.opendir.add(join(open, 'sub'))

    const result = await fs.dirSizes(base, 'size-denied')

    expect(result.entries.map((e) => [e.name, e.sizeBytes, e.partial])).toEqual([
      // opened, but part of it could not be read: what was read is a floor
      ['open', 11, true],
      ['readable.txt', 5, false],
      // a real empty folder is an answer
      ['empty', 0, false],
      // never opened, or its own metadata unreadable: unknown, not 0 bytes
      ['closed', null, false],
      ['locked.txt', null, false]
    ])
    expect(result.entries.find((e) => e.name === 'locked.txt')?.isDirectory).toBe(false)
    expect(result.entries.find((e) => e.name === 'closed')?.isDirectory).toBe(true)
    expect(result.totalBytes).toBe(16)
    expect(result.cancelled).toBe(false)
    expect(result.error).toBeNull()
  })

  it('has no total when every child went unmeasured, unlike an empty folder', async () => {
    const base = dir('all-locked')
    writeFileSync(join(base, 'locked.txt'), 'x')
    dir('all-locked', 'closed')
    denied.lstat.add(join(base, 'locked.txt'))
    denied.opendir.add(join(base, 'closed'))

    const locked = await fs.dirSizes(base, 'size-all-locked')
    expect(locked.entries.map((e) => [e.name, e.sizeBytes, e.partial])).toEqual([
      ['closed', null, false],
      ['locked.txt', null, false]
    ])
    expect(locked.totalBytes).toBeNull()
    expect(locked.error).toBeNull()

    const empty = await fs.dirSizes(dir('really-empty'), 'size-really-empty')
    expect(empty.entries).toEqual([])
    expect(empty.totalBytes).toBe(0)
  })

  it('still reports a folder it cannot open at all as an error with no total', async () => {
    const base = dir('root-locked')
    writeFileSync(join(base, 'a.txt'), 'abc')
    denied.opendir.add(base)

    const result = await fs.dirSizes(base, 'size-root-locked')
    expect(result.entries).toEqual([])
    expect(result.totalBytes).toBeNull()
    expect(result.error).toContain(base)
  })
})
