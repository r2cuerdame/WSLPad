import { describe, expect, it } from 'vitest'
import { WINDOWS_ROOT } from '@shared/constants'
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

  it('rejects the This PC virtual root without asking wslpath', async () => {
    const runner = new MockRunner()
    await expect(resolveWindowsPath(runner, 'Ubuntu', WINDOWS_ROOT)).rejects.toMatchObject({
      code: 'UNKNOWN'
    })
    expect(runner.calls).toHaveLength(0)
  })
})

describe('convertPath', () => {
  it('rejects the This PC virtual root instead of returning a Linux path', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    await expect(backend.convertPath('Ubuntu', WINDOWS_ROOT, 'linux')).rejects.toMatchObject({
      code: 'UNKNOWN'
    })
    expect(runner.calls).toHaveLength(0)
  })
})

describe('importFromWindows', () => {
  it.each([
    { windowsPath: 'C:\\', message: 'Refusing to import drive root C:\\' },
    { windowsPath: 'C:/', message: 'Refusing to import drive root C:/' },
    { windowsPath: 'C:', message: 'Refusing to import drive root C:' },
    { windowsPath: 'c:', message: 'Refusing to import drive root c:' },
    { windowsPath: 'D:', message: 'Refusing to import drive root D:' },
    { windowsPath: '\\\\wsl.localhost\\Ubuntu', message: 'Refusing to import /' }
  ])('refuses a root source ($windowsPath) without shell commands', async ({ windowsPath, message }) => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.importFromWindows('Ubuntu', [windowsPath], '/home/u/in')
    await expect(done).resolves.toMatchObject({
      opId,
      kind: 'import',
      status: 'error',
      error: expect.stringContaining(message)
    })
    expect(runner.calls).toHaveLength(0)
  })

  it.each(['//', '///'])(
    'refuses a wslpath result of %s before sizing or copying it',
    async (mapped) => {
      const runner = new MockRunner().on((script) =>
        script.startsWith('wslpath -u') ? ok(`${mapped}\n`) : undefined
      )
      const backend = createRealExplorerBackend(runner)
      const { done } = captureProgress(backend)
      const opId = await backend.importFromWindows('Ubuntu', ['Z:odd'], '/home/u/in')
      await expect(done).resolves.toMatchObject({
        opId,
        kind: 'import',
        status: 'error',
        error: expect.stringContaining(`Refusing to import ${mapped}`)
      })
      expect(runner.calls.map((c) => c.script)).toEqual(["wslpath -u 'Z:odd'"])
    }
  )

  it('refuses a same-distro UNC path that folds to the root without shell commands', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.importFromWindows('Ubuntu', ['\\\\wsl.localhost\\Ubuntu\\.'], '/home/u/in')
    await expect(done).resolves.toMatchObject({
      status: 'error',
      error: expect.stringContaining('Refusing to import /.')
    })
    expect(runner.calls).toHaveLength(0)
  })

  it('refuses to import from the This PC virtual root without shell commands', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.importFromWindows('Ubuntu', [WINDOWS_ROOT], '/home/u/in')
    await expect(done).resolves.toMatchObject({
      opId,
      kind: 'import',
      status: 'error',
      error: expect.stringContaining('This PC')
    })
    expect(runner.calls).toHaveLength(0)
  })

  it.each([
    { windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\u\\dir', destDir: '/home/u/dir' },
    { windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\u\\dir', destDir: '/home/u/dir/sub/deep' },
    { windowsPath: 'C:\\Users\\u\\proj', destDir: '/mnt/c/Users/u/proj' },
    { windowsPath: 'C:\\Users\\u\\proj\\', destDir: '/mnt/c/Users/u//proj/./sub' }
  ])('refuses to import $windowsPath into $destDir without shell commands', async (item) => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.importFromWindows('Ubuntu', [item.windowsPath], item.destDir)
    await expect(done).resolves.toMatchObject({
      opId,
      kind: 'import',
      status: 'error',
      doneItems: 1,
      error: expect.stringContaining(`Cannot import ${item.windowsPath} into itself`)
    })
    expect(runner.calls).toHaveLength(0)
  })

  it('still imports into a same-prefix sibling folder', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.importFromWindows('Ubuntu', ['C:\\Users\\u\\proj'], '/mnt/c/Users/u/proj-copy')
    await expect(done).resolves.toMatchObject({ status: 'done', doneItems: 1 })
    const scripts = runner.calls.map((c) => c.script)
    expect(scripts).toContainEqual(
      expect.stringContaining("cp -a '/mnt/c/Users/u/proj' '/mnt/c/Users/u/proj-copy/proj'")
    )
  })

  it('keeps importing the remaining items after a self-containment error', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const unc = '\\\\wsl.localhost\\Ubuntu\\home\\u\\dir'
    await backend.importFromWindows('Ubuntu', [unc, 'C:\\note.txt'], '/home/u/dir/sub')
    const final = await done
    expect(final).toMatchObject({ status: 'error', doneItems: 2, totalItems: 2 })
    expect(final.error).toContain(`Cannot import ${unc} into itself`)
    const scripts = runner.calls.map((c) => c.script)
    expect(scripts.some((s) => s.includes("'/home/u/dir'"))).toBe(false)
    expect(scripts).toContainEqual(
      expect.stringContaining("cp -a '/mnt/c/note.txt' '/home/u/dir/sub/note.txt'")
    )
  })

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

  it('imports a path given twice once, without a false EEXIST', async () => {
    // A real distro answers a second copy to the same destination with the
    // exists guard, because the first one already put the file there.
    const copied = new Set<string>()
    const runner = new MockRunner()
      .on((script) => (script.includes('du -sb') ? ok('7\n') : undefined))
      .on((script) => {
        if (!script.includes('cp -a')) return undefined
        if (copied.has(script)) return fail(41)
        copied.add(script)
        return ok('')
      })
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const source = 'C:\\Users\\u\\file.txt'
    const opId = await backend.importFromWindows('Ubuntu', [source, source], '/home/u/in')
    await expect(done).resolves.toMatchObject({
      opId,
      kind: 'import',
      status: 'done',
      totalItems: 1,
      doneItems: 1,
      totalBytes: 7,
      doneBytes: 7,
      error: null
    })
    const copies = runner.calls.filter((c) => c.script.includes('cp -a'))
    expect(copies).toHaveLength(1)
    expect(copies[0].script).toContain("cp -a '/mnt/c/Users/u/file.txt' '/home/u/in/file.txt'")
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
  it('refuses the This PC virtual destination without shell commands', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.exportToWindows('Ubuntu', ['/home/u/file.txt'], WINDOWS_ROOT)
    await expect(done).resolves.toMatchObject({
      opId,
      kind: 'export',
      status: 'error',
      error: expect.stringContaining('This PC')
    })
    expect(runner.calls).toHaveLength(0)
  })

  it.each(['/', '//', '///', '/./'])(
    'refuses to export %s without sizing or copying it',
    async (root) => {
      const runner = new MockRunner()
      const backend = createRealExplorerBackend(runner)
      const { done } = captureProgress(backend)
      const opId = await backend.exportToWindows('Ubuntu', [root], 'C:\\Backup')
      await expect(done).resolves.toMatchObject({
        opId,
        kind: 'export',
        status: 'error',
        error: expect.stringContaining(`Refusing to export ${root}`)
      })
      expect(runner.calls).toHaveLength(0)
    }
  )

  it('still exports a top-level entry', async () => {
    const runner = new MockRunner().on((script) =>
      script.includes('du -sb') ? ok('5\n') : undefined
    )
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.exportToWindows('Ubuntu', ['/scratch'], 'C:\\Backup')
    await expect(done).resolves.toMatchObject({ status: 'done', doneItems: 1 })
    expect(runner.calls.map((c) => c.script)).toContainEqual(
      expect.stringContaining("cp -a '/scratch' '/mnt/c/Backup/scratch'")
    )
  })

  it.each([
    { path: '/home/u/dir', windowsDir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\dir' },
    { path: '/home/u/dir', windowsDir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\dir\\sub\\deeper' },
    { path: '/mnt/c/proj', windowsDir: 'C:\\proj' },
    { path: '/mnt/c/proj/', windowsDir: 'C:\\proj\\\\sub' }
  ])('refuses to export $path into $windowsDir without shell commands', async (item) => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.exportToWindows('Ubuntu', [item.path], item.windowsDir)
    await expect(done).resolves.toMatchObject({
      opId,
      kind: 'export',
      status: 'error',
      doneItems: 1,
      error: expect.stringContaining(`Cannot export ${item.path} into itself`)
    })
    expect(runner.calls).toHaveLength(0)
  })

  it('still exports into a same-prefix sibling folder', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    await backend.exportToWindows('Ubuntu', ['/mnt/c/proj'], 'C:\\proj-copy')
    await expect(done).resolves.toMatchObject({ status: 'done', doneItems: 1 })
    const scripts = runner.calls.map((c) => c.script)
    expect(scripts).toContainEqual(
      expect.stringContaining("cp -a '/mnt/c/proj' '/mnt/c/proj-copy/proj'")
    )
  })

  it('keeps exporting the remaining items after a self-containment error', async () => {
    const runner = new MockRunner()
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const unc = '\\\\wsl.localhost\\Ubuntu\\home\\u\\dir\\sub'
    await backend.exportToWindows('Ubuntu', ['/home/u/dir', '/home/u/note.txt'], unc)
    const final = await done
    expect(final).toMatchObject({ status: 'error', doneItems: 2, totalItems: 2 })
    expect(final.error).toContain('Cannot export /home/u/dir into itself')
    const scripts = runner.calls.map((c) => c.script)
    expect(scripts.some((s) => s.includes("'/home/u/dir'"))).toBe(false)
    expect(scripts).toContainEqual(
      expect.stringContaining("cp -a '/home/u/note.txt' '/home/u/dir/sub/note.txt'")
    )
  })

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

  it('exports a path given twice once, without a false EEXIST', async () => {
    const copied = new Set<string>()
    const runner = new MockRunner()
      .on((script) => (script.includes('du -sb') ? ok('4096\n') : undefined))
      .on((script) => {
        if (!script.includes('cp -a')) return undefined
        if (copied.has(script)) return fail(41)
        copied.add(script)
        return ok('')
      })
    const backend = createRealExplorerBackend(runner)
    const { done } = captureProgress(backend)
    const opId = await backend.exportToWindows(
      'Ubuntu',
      ['/home/u/proj', '/home/u/proj'],
      'C:\\Backup'
    )
    await expect(done).resolves.toMatchObject({
      opId,
      kind: 'export',
      status: 'done',
      totalItems: 1,
      doneItems: 1,
      totalBytes: 4096,
      doneBytes: 4096,
      error: null
    })
    const copies = runner.calls.filter((c) => c.script.includes('cp -a'))
    expect(copies).toHaveLength(1)
    expect(copies[0].script).toContain("cp -a '/home/u/proj' '/mnt/c/Backup/proj'")
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
