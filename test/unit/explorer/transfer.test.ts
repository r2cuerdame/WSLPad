import { describe, expect, it } from 'vitest'
import { createRealExplorerBackend } from '../../../src/main/explorer/backend'
import { resolveWindowsPath } from '../../../src/main/explorer/transfer'
import { captureProgress, fail, MockRunner, ok } from './mock-runner'

describe('resolveWindowsPath', () => {
  it('maps drive paths without shell calls', async () => {
    const runner = new MockRunner()
    expect(await resolveWindowsPath(runner, 'Ubuntu', 'C:\\Users\\u\\f.txt')).toBe(
      '/mnt/c/Users/u/f.txt'
    )
    expect(runner.calls).toHaveLength(0)
  })

  it('maps same-distro UNC paths directly', async () => {
    const runner = new MockRunner()
    expect(
      await resolveWindowsPath(runner, 'Ubuntu', '\\\\wsl.localhost\\Ubuntu\\home\\u\\f')
    ).toBe('/home/u/f')
    expect(runner.calls).toHaveLength(0)
  })

  it('falls back to wslpath -u for unmappable shapes', async () => {
    const runner = new MockRunner().on((script) =>
      script.startsWith('wslpath -u') ? ok('/mnt/z/share/f.txt\n') : undefined
    )
    expect(await resolveWindowsPath(runner, 'Ubuntu', 'Z:relative')).toBe('/mnt/z/share/f.txt')
    expect(runner.calls[0].script).toBe("wslpath -u 'Z:relative'")
  })

  it('throws not mappable when wslpath fails too', async () => {
    const runner = new MockRunner().on(() => fail(1, 'wslpath: invalid path'))
    await expect(resolveWindowsPath(runner, 'Ubuntu', 'bogus')).rejects.toMatchObject({
      code: 'UNKNOWN'
    })
  })
})

describe('importFromWindows', () => {
  it('converts, sizes and copies each item with progress bytes', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('du -sb') ? ok('42\n') : undefined))
      .on((script) => (script.includes('cp -a') ? ok('') : undefined))
    const backend = createRealExplorerBackend(runner)
    const { events, done } = captureProgress(backend)
    const opId = await backend.importFromWindows('Ubuntu', ['C:\\Users\\u\\file.txt'], '/home/u/in')
    const final = await done
    expect(final).toMatchObject({
      opId,
      kind: 'import',
      status: 'done',
      totalItems: 1,
      doneItems: 1,
      totalBytes: 42,
      doneBytes: 42
    })
    const scripts = runner.calls.map((c) => c.script)
    expect(scripts[0]).toContain("stat -Lc %s '/mnt/c/Users/u/file.txt'")
    expect(scripts[1]).toContain("cp -a '/mnt/c/Users/u/file.txt' '/home/u/in/file.txt'")
    expect(scripts[1]).toContain("if [ -e '/home/u/in/file.txt' ]")
    expect(events.some((e) => e.currentItem === 'C:\\Users\\u\\file.txt')).toBe(true)
  })

  it('records unmappable items and keeps going', async () => {
    const runner = new MockRunner()
      .on((script) => (script.startsWith('wslpath -u') ? fail(1) : undefined))
      .on((script) => (script.includes('du -sb') ? ok('7\n') : undefined))
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.importFromWindows('Ubuntu', ['bogus', 'C:\\ok.txt'], '/home/u')
    const final = await done
    expect(final.status).toBe('error')
    expect(final.error).toContain('not mappable')
    expect(final.doneItems).toBe(2)
    expect(runner.calls.some((c) => c.script.includes("cp -a '/mnt/c/ok.txt'"))).toBe(true)
  })

  it('reports destination conflicts as EEXIST item errors', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('du -sb') ? ok('7\n') : undefined))
      .on((script) => (script.includes('cp -a') ? fail(41) : undefined))
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.importFromWindows('Ubuntu', ['C:\\clash.txt'], '/home/u')
    const final = await done
    expect(final.status).toBe('error')
    expect(final.error).toContain('EEXIST')
  })

  it('quotes hostile windows-derived names in the copy script', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('du -sb') ? ok('1\n') : undefined
    )
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.importFromWindows('Ubuntu', ["C:\\a'b $(x).txt"], '/home/u')
    await done
    const copy = runner.calls.find((c) => c.script.includes('cp -a'))
    expect(copy?.script).toContain("cp -a '/mnt/c/a'\\''b $(x).txt' '/home/u/a'\\''b $(x).txt'")
  })
})

describe('exportToWindows', () => {
  it('maps the destination and copies with du-based totals for dirs', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('du -sb') ? ok('4096\n') : undefined))
      .on((script) => (script.includes('cp -a') ? ok('') : undefined))
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.exportToWindows('Ubuntu', ['/home/u/proj'], 'C:\\Backup')
    const final = await done
    expect(final).toMatchObject({ kind: 'export', status: 'done', totalBytes: 4096 })
    const sizeScript = runner.calls[0].script
    expect(sizeScript).toContain("du -sb '/home/u/proj'")
    const copy = runner.calls[1].script
    expect(copy).toContain("cp -a '/home/u/proj' '/mnt/c/Backup/proj'")
  })

  it('maps a same-distro UNC destination straight back to a linux path', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('du -sb') ? ok('1\n') : undefined
    )
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.exportToWindows('Ubuntu', ['/home/u/f'], '\\\\wsl.localhost\\Ubuntu\\tmp')
    await done
    const copy = runner.calls.find((c) => c.script.includes('cp -a'))
    expect(copy?.script).toContain("cp -a '/home/u/f' '/tmp/f'")
    expect(runner.calls.some((c) => c.script.startsWith('wslpath'))).toBe(false)
  })

  it('tolerates drvfs preserve-permission warnings from cp -a', async () => {
    const runner = new MockRunner()
      .on((script) => (script.includes('du -sb') ? ok('9\n') : undefined))
      .on((script) =>
        script.includes('cp -a')
          ? fail(1, "cp: failed to preserve ownership for '/mnt/c/B/f': Operation not permitted")
          : undefined
      )
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.exportToWindows('Ubuntu', ['/home/u/f'], 'C:\\B')
    const final = await done
    expect(final.status).toBe('done')
    expect(final.doneBytes).toBe(9)
  })

  it('fails the whole op when the destination is unmappable', async () => {
    const runner = new MockRunner().on((script) =>
      script.startsWith('wslpath -u') ? fail(1) : undefined
    )
    const backend = createRealExplorerBackend(runner)
    const { events, done } = captureProgress(backend)
    await backend.exportToWindows('Ubuntu', ['/home/u/f'], 'nonsense')
    const final = await done
    expect(final.status).toBe('error')
    expect(final.error).toContain('not mappable')
    expect(events.every((e) => !e.currentItem?.includes('cp'))).toBe(true)
  })

  it('honors cancel between items', async () => {
    const runner = new MockRunner().on(async (script) => {
      if (!script.includes('du -sb')) return undefined
      await new Promise((resolve) => setTimeout(resolve, 20))
      return ok('1\n')
    })
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.exportToWindows('Ubuntu', ['/a', '/b', '/c'], 'C:\\B')
    await backend.cancelOp(opId)
    const final = await done
    expect(final.status).toBe('cancelled')
  })
})
