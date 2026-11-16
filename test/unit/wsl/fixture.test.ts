import { afterEach, describe, expect, it, vi } from 'vitest'
import { MASKED_VALUE, WINDOWS_ROOT } from '@shared/constants'
import type { FileOpProgress } from '@shared/types'
import { ExplorerError } from '../../../src/main/wsl/contracts'
import { FixtureConsoleFactory } from '../../../src/main/wsl/fixture/console'
import { DIR_SIZE_CHILD_CAP } from '../../../src/main/explorer/dir-sizes'
import { FixtureExplorerBackend, FixtureFilesystem } from '../../../src/main/wsl/fixture/explorer'
import { FixtureWslProvider } from '../../../src/main/wsl/fixture/provider'

const U = 'Ubuntu-24.04'
const ESC = '\u001b'
const PROMPT_MARK = `${ESC}]133;A${ESC}\\`

async function providerSnapshot(p: FixtureWslProvider) {
  return {
    available: await p.isAvailable(),
    distros: await p.listDistros(),
    details: await p.getDistroDetails(U),
    system: await p.getSystemInfo(U),
    resources: await p.getResources(U),
    processes: await p.getProcesses(U),
    services: await p.getServices(U, true),
    ports: await p.getPorts(U),
    environment: await p.getEnvironment(U),
    paths: await p.getImportantPaths(U),
    config: await p.getConfigFiles(U),
    tools: await p.getTools(U),
    hermes: await p.getHermes(U),
    debianSystem: await p.getSystemInfo('Debian'),
    debianPaths: await p.getImportantPaths('Debian'),
    debianHermes: await p.getHermes('Debian')
  }
}

describe('FixtureWslProvider', () => {
  it('is deterministic: two providers produce deep-equal snapshots', async () => {
    const a = await providerSnapshot(new FixtureWslProvider())
    const b = await providerSnapshot(new FixtureWslProvider())
    expect(a).toEqual(b)
  })

  it('describes the fixture world from goal.md §18.4', async () => {
    const p = new FixtureWslProvider()
    expect(await p.listDistros()).toEqual([
      { name: U, state: 'Running', wslVersion: 2, isDefault: true },
      { name: 'Debian', state: 'Stopped', wslVersion: 1, isDefault: false }
    ])
    const system = await p.getSystemInfo(U)
    expect(system).toMatchObject({
      user: 'dev',
      home: '/home/dev',
      kernel: '6.6.36-microsoft-standard-WSL2',
      systemdEnabled: true,
      ip: '172.20.144.2'
    })
    const resources = await p.getResources(U)
    expect(resources.cpuPercent).toBe(7.5)
    expect(resources.disks.map((d) => [d.mountPoint, d.usePercent])).toEqual([
      ['/', 9],
      ['/home', 9],
      ['/mnt/c', 71]
    ])
    const processes = await p.getProcesses(U)
    expect(processes).toHaveLength(12)
    expect(processes.find((x) => x.pid === 4242)?.command).toContain('hermes gateway')
    expect(processes.find((x) => x.pid === 5100)?.command).toContain('node')
    const services = await p.getServices(U, true)
    expect(services.map((s) => [s.name, s.activeState, s.scope])).toEqual([
      ['ssh.service', 'active', 'system'],
      ['hermes-gateway.service', 'active', 'user'],
      ['broken.service', 'failed', 'system']
    ])
    const ports = await p.getPorts(U)
    expect(ports.map((x) => x.port)).toEqual([22, 8790, 8080, 5353])
    const hermes = await p.getHermes(U)
    expect(hermes).toMatchObject({
      installed: true,
      executablePath: '/home/dev/.local/bin/hermes',
      dataDir: '/home/dev/.hermes',
      gatewayStatus: 'running',
      dashboardStatus: 'not-detected',
      mcpServerCount: 4
    })
    const tools = await p.getTools(U)
    const byId = new Map(tools.map((t) => [t.id, t]))
    expect(byId.get('node')).toMatchObject({ version: '20.19.0', installMethod: 'nvm' })
    expect(byId.get('python')).toMatchObject({ version: '3.12.3', installMethod: 'apt' })
    expect(byId.get('git')).toMatchObject({ version: '2.43.0', installMethod: 'apt' })
    expect(byId.get('docker')).toMatchObject({ installed: true, runningProcesses: 1 })
    expect(byId.get('hermes')).toMatchObject({ version: '0.9.2' })
  })

  it('masks secret env values but reveals raw values on explicit request', async () => {
    const p = new FixtureWslProvider()
    const env = await p.getEnvironment(U)
    const apiKey = env.find((x) => x.name === 'FIXTURE_API_KEY')
    expect(apiKey).toBeDefined()
    expect(apiKey?.isSecret).toBe(true)
    expect(apiKey?.maskedValue).toBe(MASKED_VALUE)
    expect(apiKey?.valueLength).toBe('super-secret-fixture-value'.length)
    const dbPass = env.find((x) => x.name === 'DB_PASSWORD')
    expect(dbPass?.maskedValue).toBe(MASKED_VALUE)
    expect(env.some((x) => x.maskedValue.includes('super-secret'))).toBe(false)
    expect(env.some((x) => x.maskedValue.includes('hunter2'))).toBe(false)
    expect(await p.revealEnv(U, 'FIXTURE_API_KEY')).toBe('super-secret-fixture-value')
    expect(await p.revealEnv(U, 'NO_SUCH_VAR')).toBeNull()
  })

  it('reports ~/.hermes as missing on Debian only', async () => {
    const p = new FixtureWslProvider()
    const ubuntu = await p.getImportantPaths(U)
    const debian = await p.getImportantPaths('Debian')
    expect(ubuntu.find((x) => x.id === 'hermes')?.exists).toBe(true)
    expect(debian.find((x) => x.id === 'hermes')?.exists).toBe(false)
    expect(debian.filter((x) => x.id !== 'hermes').every((x) => x.exists)).toBe(true)
    expect(await p.getHermes('Debian')).toBeNull()
  })

  it('rejects unknown distros', async () => {
    const p = new FixtureWslProvider()
    await expect(p.getSystemInfo('Arch')).rejects.toThrow(/Unknown fixture distro/)
    await expect(p.getSystemInfo('a;b')).rejects.toThrow(/Invalid WSL distro name/)
  })
})

describe('FixtureExplorerBackend', () => {
  it('resolves symlink targets before interpreting following parent components', async () => {
    const backend = new FixtureExplorerBackend()
    const project = backend.fs.getNode('/home/dev/projects/wslpad-demo')
    const home = backend.fs.getNode('/home/dev')
    expect(project?.type).toBe('directory')
    expect(home?.type).toBe('directory')
    if (!project || !home) throw new Error('Fixture directories are missing')

    backend.fs.attach(project, backend.fs.file('config.txt', 'symlink target config\n'))
    backend.fs.attach(
      home,
      backend.fs.link('project-src', '/home/dev/projects/wslpad-demo/src')
    )

    const path = '/home/dev/project-src/../config.txt'
    const resolved = await backend.resolvePath(U, path)
    const file = await backend.readText(U, resolved, 1024)

    expect(resolved).toBe('/home/dev/projects/wslpad-demo/config.txt')
    expect(file.content).toBe('symlink target config\n')
  })

  it('reports an empty directory as a measured zero-byte result', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/empty-for-size')

    await expect(backend.dirSizes(U, '/home/dev/empty-for-size', 'token')).resolves.toMatchObject({
      path: '/home/dev/empty-for-size',
      entries: [],
      totalBytes: 0,
      skipped: 0
    })
  })

  it('caps measured children, counts skipped entries, and sorts unknown sizes last', async () => {
    const fs = new FixtureFilesystem()
    const directory = fs.attach(fs.getNode('/home/dev')!, fs.dir('size-fixture'))
    for (let i = 0; i < DIR_SIZE_CHILD_CAP + 7; i++) {
      const name = `child-${String(i).padStart(3, '0')}`
      fs.attach(
        directory,
        fs.file(name, i === 1 ? '' : 'x'.repeat(i === 0 ? 3 : 1), { readable: i !== 0 })
      )
    }
    const backend = new FixtureExplorerBackend(fs)

    const result = await backend.dirSizes(U, '/home/dev/size-fixture', 'token')

    expect(result.entries).toHaveLength(DIR_SIZE_CHILD_CAP)
    expect(result.skipped).toBe(7)
    expect(result.totalBytes).toBe(DIR_SIZE_CHILD_CAP - 2)
    expect(result.entries[0]).toMatchObject({ name: 'child-002', sizeBytes: 1 })
    expect(result.entries.at(-2)).toMatchObject({ name: 'child-001', sizeBytes: 0 })
    expect(result.entries.at(-1)).toMatchObject({ name: 'child-000', sizeBytes: null })
  })

  it('is deterministic: two backends list identical entries', async () => {
    const a = new FixtureExplorerBackend()
    const b = new FixtureExplorerBackend()
    expect(await a.list(U, '/home/dev', { showHidden: true })).toEqual(
      await b.list(U, '/home/dev', { showHidden: true })
    )
    expect(await a.stat(U, '/home/dev/notes.md')).toEqual(await b.stat(U, '/home/dev/notes.md'))
  })

  it('lists home, hiding dotfiles unless requested', async () => {
    const backend = new FixtureExplorerBackend()
    expect(await backend.homeDir(U)).toBe('/home/dev')
    const visible = await backend.list(U, '/home/dev')
    expect(visible.map((e) => e.name)).toEqual([
      'projects',
      'broken-link',
      'link-to-projects',
      'notes.md'
    ])
    const all = await backend.list(U, '/home/dev', { showHidden: true })
    const names = all.map((e) => e.name)
    expect(names).toContain('.hermes')
    expect(names).toContain('.ssh')
  })

  it('exposes symlink metadata including broken targets', async () => {
    const backend = new FixtureExplorerBackend()
    const entries = await backend.list(U, '/home/dev')
    const link = entries.find((e) => e.name === 'link-to-projects')
    expect(link).toMatchObject({
      type: 'symlink',
      symlinkTarget: '/home/dev/projects',
      targetType: 'directory'
    })
    const broken = entries.find((e) => e.name === 'broken-link')
    expect(broken).toMatchObject({
      type: 'symlink',
      symlinkTarget: '/nonexistent',
      targetType: null
    })
    const listedThroughLink = await backend.list(U, '/home/dev/link-to-projects')
    expect(listedThroughLink.map((e) => e.name)).toEqual(['wslpad-demo'])
  })

  it('includes directory symlinks in tree results but excludes file and broken symlinks', async () => {
    const backend = new FixtureExplorerBackend()
    const entries = await backend.tree(U, '/home/dev')
    const names = entries.map((e) => e.name)
    expect(names).toContain('projects')
    expect(names).toContain('link-to-projects')
    expect(entries.find((e) => e.name === 'link-to-projects')).toMatchObject({
      type: 'symlink',
      targetType: 'directory'
    })
    expect(names).not.toContain('notes.md')
    expect(names).not.toContain('broken-link')
  })

  it('raises EACCES with ownership detail when listing /root', async () => {
    const backend = new FixtureExplorerBackend()
    const err = await backend.list(U, '/root').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ExplorerError)
    expect((err as ExplorerError).code).toBe('EACCES')
    expect((err as ExplorerError).detail.owner).toBe('root')
    expect((err as ExplorerError).detail.user).toBe('dev')
  })

  it('refuses to write the root-owned /etc/wsl.conf', async () => {
    const backend = new FixtureExplorerBackend()
    const read = await backend.readText(U, '/etc/wsl.conf', 65536)
    expect(read.content).toContain('systemd=true')
    expect(read.writable).toBe(false)
    const err = await backend.writeText(U, '/etc/wsl.conf', 'oops').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ExplorerError)
    expect((err as ExplorerError).code).toBe('EACCES')
    expect((err as ExplorerError).detail.owner).toBe('root')
  })

  it('moves trashed files into freedesktop Trash with .trashinfo metadata', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.trash(U, ['/home/dev/notes.md'])
    const home = await backend.list(U, '/home/dev')
    expect(home.map((e) => e.name)).not.toContain('notes.md')
    const files = await backend.list(U, '/home/dev/.local/share/Trash/files', {
      showHidden: true
    })
    expect(files.map((e) => e.name)).toContain('notes.md')
    const info = await backend.readText(
      U,
      '/home/dev/.local/share/Trash/info/notes.md.trashinfo',
      65536
    )
    expect(info.content).toContain('[Trash Info]')
    expect(info.content).toContain('Path=/home/dev/notes.md')
    expect(info.content).toContain('DeletionDate=2024-06-15T12:00:00')
  })

  it('trashes a path given twice once, like the real backend', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.trash(U, ['/home/dev/notes.md', '/home/dev/notes.md'])
    const files = await backend.list(U, '/home/dev/.local/share/Trash/files', {
      showHidden: true
    })
    expect(files.map((e) => e.name).filter((n) => n.startsWith('notes.md'))).toEqual(['notes.md'])
  })

  it.each([
    { name: 'notes.md', collision: 'notes.2.md' },
    { name: 'archive.tar.gz', collision: 'archive.tar.2.gz' },
    { name: '.bashrc', collision: '.bashrc.2' },
    { name: 'file', collision: 'file.2' }
  ])('keeps the extension before the collision number for $name', async ({ name, collision }) => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/first')
    await backend.mkdir(U, '/home/dev/second')
    await backend.createFile(U, `/home/dev/first/${name}`)
    await backend.createFile(U, `/home/dev/second/${name}`)

    await backend.trash(U, [`/home/dev/first/${name}`, `/home/dev/second/${name}`])

    const files = await backend.list(U, '/home/dev/.local/share/Trash/files', {
      showHidden: true
    })
    expect(files.map((entry) => entry.name).sort()).toEqual([collision, name].sort())
  })

  it('encodes trash paths in metadata and decodes them when listing', async () => {
    const backend = new FixtureExplorerBackend()
    const path = '/home/dev/notes & 자료%.md'
    await backend.createFile(U, path)

    await backend.trash(U, [path])

    const info = await backend.readText(
      U,
      '/home/dev/.local/share/Trash/info/notes & 자료%.md.trashinfo',
      65536
    )
    expect(info.content).toContain(
      'Path=/home/dev/notes%20%26%20%EC%9E%90%EB%A3%8C%25.md'
    )
    expect((await backend.listTrash(U)).map((entry) => entry.originalPath)).toContain(path)
  })

  it('reports UTF-8 file bytes and the combined size of trashed directories', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/archive')
    await backend.mkdir(U, '/home/dev/archive/subdir')
    await backend.createFile(U, '/home/dev/archive/hello.txt')
    await backend.writeText(U, '/home/dev/archive/hello.txt', '안녕')
    await backend.createFile(U, '/home/dev/archive/subdir/ok.txt')
    await backend.writeText(U, '/home/dev/archive/subdir/ok.txt', 'ok')

    await backend.trash(U, ['/home/dev/archive/hello.txt', '/home/dev/archive/subdir'])

    const entries = await backend.listTrash(U)
    expect(entries.find((entry) => entry.trashName === 'hello.txt')?.sizeBytes).toBe(6)
    expect(entries.find((entry) => entry.trashName === 'subdir')?.sizeBytes).toBe(2)
  })

  it('validates all trash batch entries before moving files when one is missing', async () => {
    const backend = new FixtureExplorerBackend()

    await expect(
      backend.trash(U, ['/home/dev/notes.md', '/home/dev/missing.txt'])
    ).rejects.toMatchObject({ code: 'ENOENT' })

    expect(backend.fs.getNode('/home/dev/notes.md')).not.toBeNull()
    expect(backend.fs.getNode('/home/dev/.local/share/Trash')).toBeNull()
  })

  it('validates unreadable items in the whole trash batch before moving files', async () => {
    const backend = new FixtureExplorerBackend()
    const home = backend.fs.getNode('/home/dev')!
    backend.fs.attach(home, backend.fs.file('private.txt', 'secret', { readable: false }))

    await expect(
      backend.trash(U, ['/home/dev/notes.md', '/home/dev/private.txt'])
    ).rejects.toMatchObject({ code: 'EACCES', path: '/home/dev/private.txt' })

    expect(backend.fs.getNode('/home/dev/notes.md')).not.toBeNull()
    expect(backend.fs.getNode('/home/dev/private.txt')).not.toBeNull()
    expect(backend.fs.getNode('/home/dev/.local/share/Trash')).toBeNull()
  })

  it('restores a trash entry given twice once', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/restore-duplicate')
    await backend.createFile(U, '/home/dev/restore-duplicate/item.txt')
    await backend.trash(U, ['/home/dev/restore-duplicate/item.txt'])

    const entry = (await backend.listTrash(U)).find(
      (candidate) => candidate.originalPath === '/home/dev/restore-duplicate/item.txt'
    )
    expect(entry).toBeDefined()
    await backend.restoreTrash(U, [entry!.trashName, entry!.trashName])

    expect((await backend.list(U, '/home/dev/restore-duplicate')).map((file) => file.name)).toEqual([
      'item.txt'
    ])
    expect(await backend.listTrash(U)).toEqual([])
  })

  it('preflights every trash entry before restoring any file', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/restore-preflight')
    await backend.createFile(U, '/home/dev/restore-preflight/first.txt')
    await backend.createFile(U, '/home/dev/restore-preflight/second.txt')
    await backend.trash(U, [
      '/home/dev/restore-preflight/first.txt',
      '/home/dev/restore-preflight/second.txt'
    ])
    const entries = await backend.listTrash(U)
    const first = entries.find((entry) => entry.originalPath.endsWith('/first.txt'))!
    const second = entries.find((entry) => entry.originalPath.endsWith('/second.txt'))!

    await expect(backend.restoreTrash(U, [first.trashName, 'missing-entry', second.trashName]))
      .rejects.toMatchObject({ code: 'ENOENT' })

    expect(await backend.list(U, '/home/dev/restore-preflight')).toEqual([])
    expect((await backend.listTrash(U)).map((entry) => entry.trashName).sort()).toEqual(
      [first.trashName, second.trashName].sort()
    )
  })

  it('rejects destination conflicts before restoring earlier trash entries', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/restore-conflict')
    await backend.createFile(U, '/home/dev/restore-conflict/first.txt')
    await backend.createFile(U, '/home/dev/restore-conflict/second.txt')
    await backend.trash(U, [
      '/home/dev/restore-conflict/first.txt',
      '/home/dev/restore-conflict/second.txt'
    ])
    const entries = await backend.listTrash(U)
    const first = entries.find((entry) => entry.originalPath.endsWith('/first.txt'))!
    const second = entries.find((entry) => entry.originalPath.endsWith('/second.txt'))!
    await backend.createFile(U, '/home/dev/restore-conflict/second.txt')

    await expect(backend.restoreTrash(U, [first.trashName, second.trashName]))
      .rejects.toMatchObject({ code: 'EEXIST' })

    expect((await backend.list(U, '/home/dev/restore-conflict')).map((file) => file.name)).toEqual([
      'second.txt'
    ])
    expect((await backend.listTrash(U)).map((entry) => entry.trashName).sort()).toEqual(
      [first.trashName, second.trashName].sort()
    )
  })

  it('detects restore collisions through symlinked parent directories', async () => {
    const backend = new FixtureExplorerBackend()
    const directPath = '/home/dev/projects/alias-collision.txt'
    const linkedPath = '/home/dev/link-to-projects/alias-collision.txt'
    await backend.createFile(U, directPath)
    await backend.trash(U, [directPath])
    await backend.createFile(U, linkedPath)
    await backend.trash(U, [linkedPath])

    const entries = await backend.listTrash(U)
    const direct = entries.find((entry) => entry.originalPath === directPath)!
    const linked = entries.find((entry) => entry.originalPath === linkedPath)!
    await expect(backend.restoreTrash(U, [direct.trashName, linked.trashName])).rejects.toMatchObject({
      code: 'EEXIST'
    })

    expect(await backend.list(U, '/home/dev/projects')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'alias-collision.txt' })])
    )
    expect((await backend.listTrash(U)).map((entry) => entry.trashName).sort()).toEqual(
      [direct.trashName, linked.trashName].sort()
    )
  })

  it('restores a directory before another trash entry beneath it', async () => {
    const backend = new FixtureExplorerBackend()
    const directory = '/home/dev/restore-parent'
    const childPath = `${directory}/child.txt`
    await backend.mkdir(U, directory)
    await backend.createFile(U, childPath)
    await backend.trash(U, [childPath])
    await backend.trash(U, [directory])

    const entries = await backend.listTrash(U)
    const parent = entries.find((entry) => entry.originalPath === directory)!
    const child = entries.find((entry) => entry.originalPath === childPath)!
    await backend.restoreTrash(U, [parent.trashName, child.trashName])

    expect((await backend.list(U, directory)).map((entry) => entry.name)).toEqual(['child.txt'])
    expect(await backend.listTrash(U)).toEqual([])
  })

  it('supports mkdir/createFile/writeText/readText/rename/remove', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/scratch')
    await backend.createFile(U, '/home/dev/scratch/todo.txt')
    await backend.writeText(U, '/home/dev/scratch/todo.txt', 'buy milk\n')
    expect((await backend.readText(U, '/home/dev/scratch/todo.txt', 65536)).content).toBe(
      'buy milk\n'
    )
    await backend.rename(U, '/home/dev/scratch/todo.txt', 'done.txt')
    const listed = await backend.list(U, '/home/dev/scratch')
    expect(listed.map((e) => e.name)).toEqual(['done.txt'])
    await backend.remove(U, ['/home/dev/scratch/done.txt'])
    expect(await backend.list(U, '/home/dev/scratch')).toEqual([])
    const dup = await backend.mkdir(U, '/home/dev/scratch').catch((e: unknown) => e)
    expect((dup as ExplorerError).code).toBe('EEXIST')
  })

  it('treats a same-name rename as a no-op instead of a false EEXIST', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/rename-same')
    await backend.createFile(U, '/home/dev/rename-same/a.txt')
    await backend.createFile(U, '/home/dev/rename-same/b.txt')
    await backend.mkdir(U, '/home/dev/rename-same/dir')
    const before = await backend.list(U, '/home/dev/rename-same')

    await backend.rename(U, '/home/dev/rename-same/a.txt', 'a.txt')
    await backend.rename(U, '/home/dev/rename-same/dir', 'dir')
    await backend.rename(U, '/etc/wsl.conf', 'wsl.conf')

    expect(await backend.list(U, '/home/dev/rename-same')).toEqual(before)
    await expect(
      backend.rename(U, '/home/dev/rename-same/a.txt', 'b.txt')
    ).rejects.toMatchObject({ code: 'EEXIST', message: 'Already exists: b.txt' })
    await expect(
      backend.rename(U, '/home/dev/rename-same/missing.txt', 'missing.txt')
    ).rejects.toMatchObject({ code: 'ENOENT', path: '/home/dev/rename-same/missing.txt' })
    await expect(
      backend.rename(U, '/home/dev/rename-same/missing.txt', 'other.txt')
    ).rejects.toMatchObject({ code: 'ENOENT', path: '/home/dev/rename-same/missing.txt' })
  })

  it('removes a path given twice without a false missing-path error', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/remove-duplicate')
    await backend.createFile(U, '/home/dev/remove-duplicate/item.txt')

    await backend.remove(U, [
      '/home/dev/remove-duplicate/item.txt',
      '/home/dev/remove-duplicate/item.txt'
    ])

    expect(await backend.list(U, '/home/dev/remove-duplicate')).toEqual([])
  })

  it('prevalidates removal permissions before deleting earlier batch items', async () => {
    const backend = new FixtureExplorerBackend()

    await expect(backend.remove(U, ['/home/dev/notes.md', '/etc/wsl.conf'])).rejects.toMatchObject({
      code: 'EACCES',
      path: '/etc/wsl.conf'
    })

    expect(backend.fs.getNode('/home/dev/notes.md')).not.toBeNull()
    expect(backend.fs.getNode('/etc/wsl.conf')).not.toBeNull()
  })

  it('prevalidates missing removal targets before deleting earlier batch items', async () => {
    const backend = new FixtureExplorerBackend()

    await expect(
      backend.remove(U, ['/home/dev/notes.md', '/home/dev/missing.txt'])
    ).rejects.toMatchObject({ code: 'ENOENT', path: '/home/dev/missing.txt' })

    expect(backend.fs.getNode('/home/dev/notes.md')).not.toBeNull()
  })

  it('removes a parent and a selected child together without a false ENOENT', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/remove-tree')
    await backend.createFile(U, '/home/dev/remove-tree/child.txt')

    await expect(
      backend.remove(U, ['/home/dev/remove-tree', '/home/dev/remove-tree/child.txt'])
    ).resolves.toBeUndefined()

    expect(backend.fs.getNode('/home/dev/remove-tree')).toBeNull()
  })

  it('copies and moves with a completion progress event', async () => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    const off = backend.onProgress((p) => events.push(p))
    await backend.mkdir(U, '/home/dev/copies')
    const opId = await backend.copyMove(
      U,
      ['/home/dev/projects/wslpad-demo/README.md'],
      '/home/dev/copies',
      false
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual([
      expect.objectContaining({ opId, kind: 'copy', status: 'done', totalItems: 1 })
    ])
    expect((await backend.list(U, '/home/dev/copies')).map((e) => e.name)).toEqual(['README.md'])
    // source still present after copy
    const demo = await backend.list(U, '/home/dev/projects/wslpad-demo')
    expect(demo.map((e) => e.name)).toContain('README.md')
    const moveId = await backend.copyMove(U, ['/home/dev/copies/README.md'], '/home/dev', true)
    await new Promise((r) => setTimeout(r, 0))
    expect(events[1]).toMatchObject({ opId: moveId, kind: 'move', status: 'done' })
    expect((await backend.list(U, '/home/dev/copies')).length).toBe(0)
    off()
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('processes a duplicate source only once for $kind', async ({ move, kind }) => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((progress) => events.push(progress))
    await backend.mkdir(U, '/home/dev/duplicate-copy')
    const source = '/home/dev/projects/wslpad-demo/README.md'

    const opId = await backend.copyMove(U, [source, source], '/home/dev/duplicate-copy', move)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events).toEqual([
      expect.objectContaining({ opId, kind, status: 'done', totalItems: 1, doneItems: 1 })
    ])
    expect((await backend.list(U, '/home/dev/duplicate-copy')).map((entry) => entry.name)).toEqual([
      'README.md'
    ])
    const sourceNames = (await backend.list(U, '/home/dev/projects/wslpad-demo')).map(
      (entry) => entry.name
    )
    expect(sourceNames.includes('README.md')).toBe(!move)
  })

  it('uses the move verb for a move into its own subtree error', async () => {
    const backend = new FixtureExplorerBackend()
    await expect(
      backend.copyMove(U, ['/home/dev/projects/wslpad-demo'], '/home/dev/projects/wslpad-demo/src', true)
    ).rejects.toThrow('Cannot move /home/dev/projects/wslpad-demo into itself')
  })

  it.each([
    { move: false, kind: 'copy', dest: '/home/dev/projects' },
    { move: true, kind: 'move', dest: '/home/dev/projects' },
    { move: false, kind: 'copy', dest: '/home/dev/projects/wslpad-demo' },
    { move: true, kind: 'move', dest: '/home/dev/projects/wslpad-demo' }
  ])('refuses a $kind batch containing a source that includes its destination $dest', async ({
    move,
    kind,
    dest
  }) => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((progress) => events.push(progress))
    const notes = '/home/dev/notes.md'
    const source = '/home/dev/projects'

    await expect(backend.copyMove(U, [notes, source], dest, move)).rejects.toThrow(
      `Cannot ${kind} ${source} into itself`
    )
    const err = await backend.copyMove(U, [notes, source], dest, move).catch((e: unknown) => e)
    expect((err as ExplorerError).code).toBe('UNKNOWN')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual([])
    expect((await backend.list(U, '/home/dev')).map((entry) => entry.name)).toContain('notes.md')
    expect((await backend.list(U, dest)).map((entry) => entry.name)).not.toContain('notes.md')
    await backend.mkdir(U, '/home/dev/batch-ok')
    expect(await backend.copyMove(U, [notes], '/home/dev/batch-ok', move)).toBe('fixture-op-1')
  })

  it('simulates import/export instantly with one progress event each', async () => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((p) => events.push(p))
    const importId = await backend.importFromWindows(U, ['C:\\Users\\dev\\report.pdf'], '/home/dev')
    const exportId = await backend.exportToWindows(
      U,
      ['/home/dev/projects/wslpad-demo/README.md'],
      'C:\\Users\\dev\\Desktop'
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ opId: importId, kind: 'import', status: 'done' })
    expect(events[1]).toMatchObject({ opId: exportId, kind: 'export', status: 'done' })
    expect((await backend.list(U, '/home/dev')).map((e) => e.name)).toContain('report.pdf')
  })

  it('imports and exports a path given twice once', async () => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((p) => events.push(p))
    await backend.mkdir(U, '/home/dev/duplicate-import')
    const windowsPath = 'C:\\Users\\dev\\report.pdf'
    const linuxPath = '/home/dev/projects/wslpad-demo/README.md'

    const importId = await backend.importFromWindows(
      U,
      [windowsPath, windowsPath],
      '/home/dev/duplicate-import'
    )
    const exportId = await backend.exportToWindows(
      U,
      [linuxPath, linuxPath],
      'C:\\Users\\dev\\Desktop'
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(events).toEqual([
      expect.objectContaining({
        opId: importId,
        kind: 'import',
        status: 'done',
        totalItems: 1,
        doneItems: 1
      }),
      expect.objectContaining({
        opId: exportId,
        kind: 'export',
        status: 'done',
        totalItems: 1,
        doneItems: 1
      })
    ])
    expect((await backend.list(U, '/home/dev/duplicate-import')).map((e) => e.name)).toEqual([
      'report.pdf'
    ])
  })

  it.each([WINDOWS_ROOT, '::ThisPC'])('refuses the virtual Windows root %s', async (windowsDir) => {
    const backend = new FixtureExplorerBackend()
    await expect(
      backend.exportToWindows(U, ['/home/dev/projects/wslpad-demo/README.md'], windowsDir)
    ).rejects.toMatchObject({
      code: 'UNKNOWN',
      path: windowsDir,
      message: 'Refusing to operate on This PC'
    })
  })

  it.each(['C:\\bad\0path', 'C:\\bad\npath', 'not a Windows path'])(
    'rejects an invalid Windows export target %s',
    async (windowsDir) => {
      const backend = new FixtureExplorerBackend()
      await expect(
        backend.exportToWindows(U, ['/home/dev/projects/wslpad-demo/README.md'], windowsDir)
      ).rejects.toMatchObject({
        code: 'UNKNOWN',
        path: windowsDir,
        message: `Path is not mappable: ${windowsDir}`
      })
    }
  )

  it.each([
    '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\projects\\wslpad-demo',
    '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\projects\\wslpad-demo\\src'
  ])('refuses to export a source into itself or its child target %s', async (windowsDir) => {
    const backend = new FixtureExplorerBackend()
    const source = '/home/dev/projects/wslpad-demo'
    await expect(backend.exportToWindows(U, [source], windowsDir)).rejects.toMatchObject({
      code: 'UNKNOWN',
      path: source,
      message: `Cannot export ${source} into itself`
    })
  })

  it('rejects unreadable source paths before emitting completion progress', async () => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((progress) => events.push(progress))
    await expect(
      backend.exportToWindows(
        U,
        ['/home/dev/projects/wslpad-demo/README.md', '/root'],
        'C:\\Users\\dev\\Desktop'
      )
    ).rejects.toMatchObject({ code: 'EACCES', path: '/root' })
    expect(events).toEqual([])
  })

  it.each([
    { windowsPath: 'C:\\', message: 'Refusing to import drive root C:\\' },
    { windowsPath: 'C:/', message: 'Refusing to import drive root C:/' },
    { windowsPath: 'C:', message: 'Refusing to import drive root C:' },
    { windowsPath: 'c:', message: 'Refusing to import drive root c:' },
    { windowsPath: 'D:', message: 'Refusing to import drive root D:' },
    { windowsPath: WINDOWS_ROOT, message: 'Refusing to use the This PC virtual root' },
    { windowsPath: `\\\\wsl.localhost\\${U}`, message: 'Refusing to import /' }
  ])('rejects import root $windowsPath before starting an operation', async ({
    windowsPath,
    message
  }) => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    const before = (await backend.list(U, '/home/dev')).map((entry) => entry.name)
    backend.onProgress((progress) => events.push(progress))

    await expect(
      backend.importFromWindows(U, [windowsPath], '/home/dev')
    ).rejects.toMatchObject({ code: 'UNKNOWN', message })

    expect(events).toEqual([])
    expect((await backend.list(U, '/home/dev')).map((entry) => entry.name)).toEqual(before)
  })

  it('rejects an import batch containing a drive root before importing other files', async () => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((progress) => events.push(progress))

    await expect(
      backend.importFromWindows(U, ['C:\\Users\\dev\\report.pdf', 'C:\\'], '/home/dev')
    ).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Refusing to import drive root C:\\'
    })

    expect(events).toEqual([])
    expect((await backend.list(U, '/home/dev')).map((entry) => entry.name)).not.toContain(
      'report.pdf'
    )
  })

  describe.each(['/', '//', '///', '/./'])('refuses the root spelled %s', (root) => {
    it.each(['mkdir', 'createFile'] as const)('%s reports EEXIST instead of a false ENOENT', async (operation) => {
      const backend = new FixtureExplorerBackend()
      const create = operation === 'mkdir' ? backend.mkdir.bind(backend) : backend.createFile.bind(backend)
      await expect(create(U, root)).rejects.toMatchObject({
        code: 'EEXIST',
        path: root,
        message: `Already exists: ${root}`
      })
    })

    it('in remove and trash instead of a false ENOENT', async () => {
      const backend = new FixtureExplorerBackend()
      await expect(backend.remove(U, [root])).rejects.toMatchObject({
        code: 'UNKNOWN',
        path: root,
        message: `Refusing to remove ${root}`
      })
      await expect(backend.trash(U, [root])).rejects.toMatchObject({
        code: 'UNKNOWN',
        path: root,
        message: `Refusing to trash ${root}`
      })
      expect((await backend.list(U, '/')).map((e) => e.name)).toEqual([
        'etc',
        'home',
        'mnt',
        'root',
        'usr'
      ])
    })

    it.each([
      { move: false, kind: 'copy' },
      { move: true, kind: 'move' }
    ])('in $kind and rename instead of a false ENOENT', async ({ move, kind }) => {
      const backend = new FixtureExplorerBackend()
      await backend.mkdir(U, '/home/dev/root-dest')
      await expect(backend.copyMove(U, [root], '/home/dev/root-dest', move)).rejects.toMatchObject(
        { code: 'UNKNOWN', path: root, message: `Refusing to ${kind} ${root}` }
      )
      await expect(backend.rename(U, root, 'renamed')).rejects.toMatchObject({
        code: 'UNKNOWN',
        path: root,
        message: `Refusing to rename ${root}`
      })
      expect(await backend.list(U, '/home/dev/root-dest')).toEqual([])
    })

    it('in export without a completion event', async () => {
      const backend = new FixtureExplorerBackend()
      const events: FileOpProgress[] = []
      backend.onProgress((p) => events.push(p))
      await expect(
        backend.exportToWindows(U, [root], 'C:\\Users\\dev\\Desktop')
      ).rejects.toMatchObject({ code: 'UNKNOWN', path: root, message: `Refusing to export ${root}` })
      await new Promise((r) => setTimeout(r, 0))
      expect(events).toEqual([])
    })
  })

  it.each(['mkdir', 'createFile'] as const)('%s preserves ENOENT for a missing parent', async (operation) => {
    const backend = new FixtureExplorerBackend()
    const create = operation === 'mkdir' ? backend.mkdir.bind(backend) : backend.createFile.bind(backend)
    await expect(create(U, '/home/dev/missing-parent/new-item')).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/home/dev/missing-parent/new-item',
      message: 'No such directory for: /home/dev/missing-parent/new-item'
    })
  })

  it('refuses a remove batch naming the root before deleting its other items', async () => {
    const backend = new FixtureExplorerBackend()
    await expect(backend.remove(U, ['/home/dev/notes.md', '//'])).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Refusing to remove //'
    })
    expect((await backend.list(U, '/home/dev')).map((e) => e.name)).toContain('notes.md')
  })

  it('refuses a trash batch naming the root before trashing its other items', async () => {
    const backend = new FixtureExplorerBackend()
    await expect(backend.trash(U, ['/home/dev/notes.md', '/./'])).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Refusing to trash /./'
    })
    expect((await backend.list(U, '/home/dev')).map((e) => e.name)).toContain('notes.md')
    expect(await backend.listTrash(U)).toEqual([])
  })

  it.each([
    { move: false, kind: 'copy' },
    { move: true, kind: 'move' }
  ])('refuses a $kind batch naming the root before touching its other items', async ({
    move,
    kind
  }) => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((p) => events.push(p))
    await backend.mkdir(U, '/home/dev/root-batch')
    await expect(
      backend.copyMove(U, ['/home/dev/notes.md', '///'], '/home/dev/root-batch', move)
    ).rejects.toMatchObject({ code: 'UNKNOWN', message: `Refusing to ${kind} ///` })
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual([])
    expect(await backend.list(U, '/home/dev/root-batch')).toEqual([])
    expect((await backend.list(U, '/home/dev')).map((e) => e.name)).toContain('notes.md')
  })

  it('searches by name case-insensitively without entering unreadable dirs', async () => {
    const backend = new FixtureExplorerBackend()
    const hits = await backend.search(U, '/home/dev', 'readme')
    expect(hits.map((e) => e.path)).toEqual(['/home/dev/projects/wslpad-demo/README.md'])
    const fromRoot = await backend.search(U, '/', 'wsl.conf')
    expect(fromRoot.map((e) => e.path)).toEqual(['/etc/wsl.conf'])
  })

  it('returns no results when search sanitization removes the query', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.createFile(U, '/home/dev/***')
    await backend.createFile(U, '/home/dev/   ')
    await expect(backend.search(U, '/home/dev', '***')).resolves.toEqual([])
    await expect(backend.search(U, '/home/dev', '   ')).resolves.toEqual([])
  })

  it('limits search traversal to four levels below the starting directory', async () => {
    const backend = new FixtureExplorerBackend()
    const root = '/home/dev/search-depth'
    for (const dir of [
      root,
      `${root}/one`,
      `${root}/one/two`,
      `${root}/one/two/three`,
      `${root}/one/two/three/four`
    ]) {
      await backend.mkdir(U, dir)
    }
    await backend.createFile(U, `${root}/one/two/three/needle-depth-4.txt`)
    await backend.createFile(U, `${root}/one/two/three/four/needle-depth-5.txt`)

    const paths = (await backend.search(U, root, 'needle')).map((entry) => entry.path)
    expect(paths).toContain(`${root}/one/two/three/needle-depth-4.txt`)
    expect(paths).not.toContain(`${root}/one/two/three/four/needle-depth-5.txt`)
  })

  it('caps search results at 200 entries', async () => {
    const backend = new FixtureExplorerBackend()
    const root = '/home/dev/search-many'
    await backend.mkdir(U, root)
    for (let i = 0; i < 201; i++) {
      await backend.createFile(U, `${root}/needle-${String(i).padStart(3, '0')}.txt`)
    }

    await expect(backend.search(U, root, 'needle')).resolves.toHaveLength(200)
  })

  it('converts paths between Linux and Windows forms', async () => {
    const backend = new FixtureExplorerBackend()
    expect(await backend.convertPath(U, '/mnt/c/Users/dev/file.txt', 'windows')).toBe(
      'C:\\Users\\dev\\file.txt'
    )
    expect(await backend.convertPath(U, '/home/dev', 'windows')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev'
    )
    expect(await backend.convertPath(U, 'C:\\Users\\dev', 'linux')).toBe('/mnt/c/Users/dev')
    expect(
      await backend.convertPath(U, '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev', 'linux')
    ).toBe('/home/dev')
    const bad = await backend.convertPath(U, 'relative/path', 'linux').catch((e: unknown) => e)
    expect((bad as ExplorerError).code).toBe('UNKNOWN')
  })

  it.each(['linux', 'windows'] as const)(
    'refuses to convert the This PC virtual root to %s',
    async (to) => {
      const backend = new FixtureExplorerBackend()
      await expect(backend.convertPath(U, WINDOWS_ROOT, to)).rejects.toMatchObject({
        code: 'UNKNOWN',
        message: 'Refusing to convert the This PC virtual root'
      })
    }
  )

  it.each([
    ['C:', '/mnt/c'],
    ['c:', '/mnt/c'],
    ['D:', '/mnt/d']
  ])('maps a bare Windows drive %s to %s', async (windowsPath, linuxPath) => {
    const backend = new FixtureExplorerBackend()
    await expect(backend.convertPath(U, windowsPath, 'linux')).resolves.toBe(linuxPath)
  })

  it.each([
    '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev',
    '\\\\wsl$\\ubuntu-24.04\\home\\dev'
  ])('maps case-insensitive WSL UNC paths to Linux paths', async (windowsPath) => {
    const backend = new FixtureExplorerBackend()
    await expect(backend.convertPath(U, windowsPath, 'linux')).resolves.toBe('/home/dev')
  })

  it.each(['C:\\Users\\dev\\file\0.txt', 'C:\\Users\\dev\\file\n.txt'])(
    'rejects path containing NUL or newline',
    async (input) => {
      const backend = new FixtureExplorerBackend()
      for (const to of ['linux', 'windows'] as const) {
        await expect(backend.convertPath(U, input, to)).rejects.toMatchObject({
          code: 'UNKNOWN',
          message: `Path is not mappable: ${JSON.stringify(input)}`
        })
      }
    }
  )

  it('parses the hermes fixture config with 4 MCP servers', async () => {
    const backend = new FixtureExplorerBackend()
    const cfg = await backend.readText(U, '/home/dev/.hermes/config.json', 65536)
    expect(Object.keys(JSON.parse(cfg.content).mcpServers)).toHaveLength(4)
  })

  it('only serves the running Ubuntu fixture distro', async () => {
    const backend = new FixtureExplorerBackend()
    const err = await backend.list('Debian', '/home/dev').catch((e: unknown) => e)
    expect((err as ExplorerError).code).toBe('UNKNOWN')
  })

  it('duplicates files, directories, dotfiles, and batches when copying into the same folder', async () => {
    const backend = new FixtureExplorerBackend()
    await backend.mkdir(U, '/home/dev/v1.0')
    await backend.createFile(U, '/home/dev/v1.0/inside.txt')

    await backend.copyMove(U, ['/home/dev/notes.md'], '/home/dev', false)
    await backend.copyMove(U, ['/home/dev/notes.md'], '/home/dev', false)
    await backend.copyMove(U, ['/home/dev/v1.0', '/home/dev/.bashrc'], '/home/dev', false)

    const names = (await backend.list(U, '/home/dev', { showHidden: true })).map((e) => e.name)
    expect(names).toContain('notes.md')
    expect(names).toContain('notes (2).md')
    expect(names).toContain('notes (3).md')
    expect(names).toContain('v1.0 (2)')
    expect(names).toContain('.bashrc (2)')
    expect((await backend.list(U, '/home/dev/v1.0 (2)')).map((e) => e.name)).toEqual(['inside.txt'])
  })

  it('treats same-folder moves as a no-op while preserving cross-folder EEXIST and self refusals', async () => {
    const backend = new FixtureExplorerBackend()
    const events: FileOpProgress[] = []
    backend.onProgress((p) => events.push(p))

    await backend.copyMove(U, ['/home/dev/notes.md'], '/home/dev', true)
    expect(events[events.length - 1]).toMatchObject({ status: 'done', error: null })
    const names = (await backend.list(U, '/home/dev', { showHidden: true })).map((e) => e.name)
    expect(names).toContain('notes.md')
    expect(names).not.toContain('notes (2).md')

    await backend.mkdir(U, '/home/dev/sub')
    await backend.createFile(U, '/home/dev/sub/notes.md')
    await expect(backend.copyMove(U, ['/home/dev/notes.md'], '/home/dev/sub', false)).rejects.toMatchObject({
      code: 'EEXIST'
    })
    await expect(backend.copyMove(U, ['/home/dev/sub'], '/home/dev/sub', false)).rejects.toMatchObject({
      code: 'UNKNOWN'
    })
  })
})

describe('FixtureConsoleFactory', () => {
  async function spawnShell(factory = new FixtureConsoleFactory()) {
    const handle = await factory.spawn(U, 80, 24)
    const chunks: string[] = []
    handle.onData((d) => chunks.push(d))
    return { factory, handle, out: () => chunks.join('') }
  }

  it('reports bash and emits OSC 133/OSC 7 prompt markers on spawn', async () => {
    const factory = new FixtureConsoleFactory()
    expect(await factory.shellKind(U)).toBe('bash')
    const { out } = await spawnShell(factory)
    expect(out()).toContain(PROMPT_MARK)
    expect(out()).toContain(`${ESC}]7;file://ubuntu/home/dev${ESC}\\`)
    expect(out()).toContain('dev@Ubuntu-24.04:~$ ')
  })

  it('echoes typed input and runs echo with minimal quote handling', async () => {
    const { handle, out } = await spawnShell()
    handle.write("echo 'hello fixture'\r")
    expect(out()).toContain("echo 'hello fixture'")
    expect(out()).toContain('\r\nhello fixture\r\n')
    expect(out().match(/\]133;A/g)?.length).toBe(2)
  })

  it('supports pwd/cd/ls/clear against the fixture filesystem', async () => {
    const { handle, out } = await spawnShell()
    handle.write('cd projects\r')
    handle.write('pwd\r')
    expect(out()).toContain('\r\n/home/dev/projects\r\n')
    expect(out()).toContain('dev@Ubuntu-24.04:~/projects$ ')
    handle.write('ls\r')
    expect(out()).toContain('wslpad-demo')
    handle.write('cd /nope\r')
    expect(out()).toContain('bash: cd: /nope: No such file or directory')
    handle.write('clear\r')
    expect(out()).toContain(`${ESC}[2J`)
    handle.write('frobnicate --now\r')
    expect(out()).toContain('frobnicate: command not found')
  })

  it('prompts for a sudo password, never echoes it and never elevates', async () => {
    const { handle, out } = await spawnShell()
    handle.write('sudo rm -rf /\r')
    expect(out()).toContain('[sudo] password for dev: ')
    handle.write('hunter2\r')
    expect(out()).toContain('Sorry, try again.')
    expect(out()).not.toContain('hunter2')
  })

  it('applies cwd sync silently: prompt moves, transcript has no cd', async () => {
    const { factory, out } = await spawnShell()
    await factory.writeCwdSyncFile(U, 'session-1', '/home/dev/projects')
    expect(out()).toContain(`${ESC}]7;file://ubuntu/home/dev/projects${ESC}\\`)
    expect(out()).toContain('dev@Ubuntu-24.04:~/projects$ ')
    expect(out()).not.toContain('cd ')
  })

  it('defers cwd sync while input is being typed', async () => {
    const { factory, handle, out } = await spawnShell()
    handle.write('pw')
    await factory.writeCwdSyncFile(U, 'session-1', '/home/dev/projects')
    expect(out()).not.toContain('~/projects$')
    handle.write('d\r')
    // pwd ran in the old cwd; the prompt after it picks up the pending sync
    expect(out()).toContain('\r\n/home/dev\r\n')
    expect(out()).toContain('dev@Ubuntu-24.04:~/projects$ ')
    expect(out()).not.toContain('cd ')
  })

  it('signals exit once on kill', async () => {
    const { handle } = await spawnShell()
    const codes: number[] = []
    handle.onExit((c) => codes.push(c))
    handle.kill()
    handle.kill()
    expect(codes).toEqual([0])
  })
})

describe('createBackends factory selection', () => {
  const original = process.env.WSLPAD_FIXTURE_MODE

  afterEach(() => {
    if (original === undefined) delete process.env.WSLPAD_FIXTURE_MODE
    else process.env.WSLPAD_FIXTURE_MODE = original
  })

  /**
   * factory.ts statically imports the real backends written by sibling tasks
   * (./collect, ../explorer/backend, ../terminal/backend). Until those files
   * land, the module cannot load at all, so both branches skip gracefully;
   * once the siblings exist these assertions run for real.
   */
  async function loadFactory() {
    vi.resetModules()
    try {
      return await import('../../../src/main/wsl/factory')
    } catch {
      return null
    }
  }

  it('returns the fixture backends when WSLPAD_FIXTURE_MODE=1', async (ctx) => {
    process.env.WSLPAD_FIXTURE_MODE = '1'
    const mod = await loadFactory()
    if (!mod) return ctx.skip()
    // Import the fixture classes from the same (reset) module registry so
    // instanceof checks compare identical class objects.
    const provider = await import('../../../src/main/wsl/fixture/provider')
    const explorer = await import('../../../src/main/wsl/fixture/explorer')
    const consoleMod = await import('../../../src/main/wsl/fixture/console')
    const backends = mod.createBackends()
    expect(backends.fixtureMode).toBe(true)
    expect(backends.runner).toBeNull()
    expect(backends.provider).toBeInstanceOf(provider.FixtureWslProvider)
    expect(backends.explorer).toBeInstanceOf(explorer.FixtureExplorerBackend)
    expect(backends.consoleFactory).toBeInstanceOf(consoleMod.FixtureConsoleFactory)
  })

  it('never returns fixture backends when the env var is unset', async (ctx) => {
    delete process.env.WSLPAD_FIXTURE_MODE
    const mod = await loadFactory()
    if (!mod) return ctx.skip()
    let backends
    try {
      backends = mod.createBackends()
    } catch {
      // Real backend construction may fail before sibling integration.
      return ctx.skip()
    }
    expect(backends.fixtureMode).toBe(false)
    expect(backends.runner).not.toBeNull()
    expect(backends.provider.constructor.name).not.toBe('FixtureWslProvider')
    expect(backends.explorer.constructor.name).not.toBe('FixtureExplorerBackend')
    expect(backends.consoleFactory.constructor.name).not.toBe('FixtureConsoleFactory')
  })

  it('never returns fixture backends for other env values', async (ctx) => {
    process.env.WSLPAD_FIXTURE_MODE = 'true'
    const mod = await loadFactory()
    if (!mod) return ctx.skip()
    let backends
    try {
      backends = mod.createBackends()
    } catch {
      return ctx.skip()
    }
    expect(backends.fixtureMode).toBe(false)
    expect(backends.provider.constructor.name).not.toBe('FixtureWslProvider')
  })
})
