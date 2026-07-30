import { describe, expect, it } from 'vitest'
import { createRealExplorerBackend } from '../../../src/main/explorer/backend'
import {
  createEmptyFile,
  isValidFileName,
  makeDirectory,
  removeEntries,
  renameEntry
} from '../../../src/main/explorer/operations'
import { captureProgress, fail, MockRunner, ok } from './mock-runner'

describe('isValidFileName', () => {
  it('accepts ordinary and hostile-but-legal names', () => {
    expect(isValidFileName('file.txt')).toBe(true)
    expect(isValidFileName("a'b $(x).txt")).toBe(true)
    expect(isValidFileName('한글 파일')).toBe(true)
  })

  it('rejects separators, control chars and dot entries', () => {
    expect(isValidFileName('a/b')).toBe(false)
    expect(isValidFileName('a\\b')).toBe(false)
    expect(isValidFileName('a\nb')).toBe(false)
    expect(isValidFileName('.')).toBe(false)
    expect(isValidFileName('..')).toBe(false)
    expect(isValidFileName('')).toBe(false)
  })
})

describe('makeDirectory', () => {
  it('guards EEXIST before mkdir -p with quoted paths', async () => {
    const runner = new MockRunner()
    await makeDirectory(runner, 'Ubuntu', '/home/u/new dir')
    const script = runner.calls[0].script
    expect(script).toContain("if [ -e '/home/u/new dir' ] || [ -L '/home/u/new dir' ]")
    expect(script).toContain('exit 41')
    expect(script).toContain("mkdir -p '/home/u/new dir'")
  })

  it('maps the EEXIST guard exit', async () => {
    const runner = new MockRunner().on(() => fail(41))
    await expect(makeDirectory(runner, 'Ubuntu', '/home/u/x')).rejects.toMatchObject({
      code: 'EEXIST'
    })
  })
})

describe('createEmptyFile', () => {
  it('creates via : > with an EEXIST guard', async () => {
    const runner = new MockRunner()
    await createEmptyFile(runner, 'Ubuntu', "/home/u/a'b $(x).txt")
    const script = runner.calls[0].script
    expect(script).toContain(": > '/home/u/a'\\''b $(x).txt'")
    expect(script).toContain('exit 41')
  })
})

describe('renameEntry', () => {
  it('moves within the same directory with a target EEXIST guard', async () => {
    const runner = new MockRunner()
    await renameEntry(runner, 'Ubuntu', '/home/u/old name', "new'name")
    const script = runner.calls[0].script
    expect(script).toContain("if [ -e '/home/u/new'\\''name' ]")
    expect(script).toContain("mv '/home/u/old name' '/home/u/new'\\''name'")
  })

  it('rejects names containing path separators without shell calls', async () => {
    const runner = new MockRunner()
    await expect(renameEntry(runner, 'Ubuntu', '/home/u/x', 'a/b')).rejects.toMatchObject({
      code: 'UNKNOWN'
    })
    expect(runner.calls).toHaveLength(0)
  })

  it('surfaces EEXIST when the target already exists', async () => {
    const runner = new MockRunner().on(() => fail(41))
    await expect(renameEntry(runner, 'Ubuntu', '/home/u/x', 'y')).rejects.toMatchObject({
      code: 'EEXIST',
      path: '/home/u/y'
    })
  })
})

describe('copyMove via backend op registry', () => {
  it('copies items sequentially with quoted cp -a and reports done', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { events, done } = captureProgress(backend)
    const opId = await backend.copyMove(
      'Ubuntu',
      ["/src/a'b $(x).txt", '/src/plain.txt'],
      '/dest',
      false
    )
    const final = await done
    expect(final).toMatchObject({ opId, kind: 'copy', status: 'done', doneItems: 2, totalItems: 2 })
    const scripts = runner.calls.map((c) => c.script)
    expect(scripts[0]).toContain("cp -a '/src/a'\\''b $(x).txt' '/dest/a'\\''b $(x).txt'")
    expect(scripts[1]).toContain("cp -a '/src/plain.txt' '/dest/plain.txt'")
    expect(events.some((e) => e.status === 'running' && e.currentItem === '/src/plain.txt')).toBe(
      true
    )
    expect(events.every((e) => e.totalBytes === null && e.doneBytes === null)).toBe(true)
  })

  it('uses mv when moving', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.copyMove('Ubuntu', ['/src/f'], '/dest', true)
    const final = await done
    expect(final.kind).toBe('move')
    expect(runner.calls[0].script).toContain("mv '/src/f' '/dest/f'")
  })

  it('records per-item EEXIST conflicts and continues', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes("'/dest/clash.txt'") ? fail(41) : undefined
    )
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.copyMove('Ubuntu', ['/src/clash.txt', '/src/fine.txt'], '/dest', false)
    const final = await done
    expect(final.status).toBe('error')
    expect(final.error).toContain('EEXIST')
    expect(final.doneItems).toBe(2)
    expect(runner.calls).toHaveLength(2)
  })

  it('honors cancel between items', async () => {
    const runner = new MockRunner().on(async (script) => {
      if (!script.includes('cp -a')) return undefined
      await new Promise((resolve) => setTimeout(resolve, 20))
      return ok('')
    })
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.copyMove('Ubuntu', ['/src/a', '/src/b', '/src/c'], '/dest', false)
    await backend.cancelOp(opId)
    const final = await done
    expect(final.status).toBe('cancelled')
    expect(runner.calls.length).toBeLessThan(3)
  })

  it('rejects invalid destinations up front', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    await expect(backend.copyMove('Ubuntu', ['/src/a'], 'relative', false)).rejects.toThrow()
    expect(runner.calls).toHaveLength(0)
  })
})

describe('removeEntries', () => {
  it('runs rm -rf per quoted item', async () => {
    const runner = new MockRunner()
    await removeEntries(runner, 'Ubuntu', ["/home/u/a'b", '/home/u/dir'])
    expect(runner.calls[0].script).toBe("rm -rf '/home/u/a'\\''b'")
    expect(runner.calls[1].script).toBe("rm -rf '/home/u/dir'")
  })

  it('maps permission failures', async () => {
    const runner = new MockRunner().on(() => fail(1, "rm: cannot remove '/x': Permission denied"))
    await expect(removeEntries(runner, 'Ubuntu', ['/x'])).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('refuses to remove /', async () => {
    const runner = new MockRunner()
    await expect(removeEntries(runner, 'Ubuntu', ['/'])).rejects.toThrow('Refusing')
    expect(runner.calls).toHaveLength(0)
  })
})
