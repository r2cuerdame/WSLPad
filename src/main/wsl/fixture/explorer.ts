/**
 * In-memory ExplorerBackend for fixture mode (goal.md §18.4).
 * Models a small Ubuntu-24.04 world with a permission-denied sample (/root),
 * a root-owned read-only file (/etc/wsl.conf), symlinks (one broken) and a
 * freedesktop-style trash. All timestamps are fixed so output is deterministic.
 */
import type { FileEntry, FileOpProgress, FileStat, TextFileContent } from '@shared/types'
import { ExplorerError, type ExplorerBackend, type ExplorerListOpts } from '../contracts'
import { assertValidLinuxPath, isValidDistroName, isValidLinuxPath } from '../escape'
import {
  FIXTURE_HOME,
  FIXTURE_NEW_MTIME,
  FIXTURE_SEED_MTIME,
  FIXTURE_TRASH_DATE,
  FIXTURE_UBUNTU,
  FIXTURE_USER,
  toUncPath
} from './data'

export interface FsNode {
  name: string
  type: 'file' | 'directory' | 'symlink'
  owner: string
  group: string
  permissions: string
  permissionsOctal: string
  writable: boolean
  readable: boolean
  mtime: string
  atime: string
  inode: number
  content: string | null
  children: Map<string, FsNode> | null
  symlinkTarget: string | null
}

interface NodeOpts {
  owner?: string
  group?: string
  permissions?: string
  permissionsOctal?: string
  writable?: boolean
  readable?: boolean
  mtime?: string
}

const FAKE_PRIVATE_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
  'Zml4dHVyZS1ub3QtYS1yZWFsLWtleQ==\n' +
  '-----END OPENSSH PRIVATE KEY-----\n'

const HERMES_CONFIG_JSON = JSON.stringify(
  {
    mcpServers: {
      filesystem: { command: 'hermes-mcp-fs' },
      search: { command: 'hermes-mcp-search' },
      git: { command: 'hermes-mcp-git' },
      web: { command: 'hermes-mcp-web' }
    }
  },
  null,
  2
)

const GATEWAY_LOG =
  '2024-06-01T10:00:00Z INFO gateway listening on 127.0.0.1:8790\n' +
  '2024-06-01T10:00:01Z INFO 4 MCP servers registered\n'

/** Deterministic in-memory tree shared by the fixture explorer and console. */
export class FixtureFilesystem {
  readonly root: FsNode
  private inodeCounter = 0

  constructor() {
    this.root = this.dir('/', { owner: 'root', group: 'root', writable: false })
    const home = this.attach(
      this.root,
      this.dir('home', { owner: 'root', group: 'root', writable: false })
    )
    const dev = this.attach(home, this.dir('dev'))

    const projects = this.attach(dev, this.dir('projects'))
    const demo = this.attach(projects, this.dir('wslpad-demo'))
    this.attach(demo, this.file('README.md', '# wslpad-demo\n\nFixture sample project.\n'))
    const src = this.attach(demo, this.dir('src'))
    this.attach(src, this.file('index.ts', "console.log('wslpad-demo fixture')\n"))
    const git = this.attach(demo, this.dir('.git'))
    this.attach(git, this.file('HEAD', 'ref: refs/heads/main\n'))

    this.attach(dev, this.file('notes.md', '# Fixture notes\n\nDeterministic sample file.\n'))

    const hermes = this.attach(dev, this.dir('.hermes'))
    this.attach(hermes, this.file('config.json', HERMES_CONFIG_JSON + '\n'))
    const logs = this.attach(hermes, this.dir('logs'))
    this.attach(logs, this.file('gateway.log', GATEWAY_LOG))

    const ssh = this.attach(
      dev,
      this.dir('.ssh', { permissions: 'rwx------', permissionsOctal: '700' })
    )
    this.attach(
      ssh,
      this.file('id_ed25519', FAKE_PRIVATE_KEY, {
        permissions: 'rw-------',
        permissionsOctal: '600'
      })
    )

    this.attach(dev, this.link('link-to-projects', '/home/dev/projects'))
    this.attach(dev, this.link('broken-link', '/nonexistent'))

    this.attach(dev, this.file('.bashrc', '# fixture bashrc\n'))
    this.attach(dev, this.file('.profile', '# fixture profile\n'))
    this.attach(dev, this.file('.zshrc', '# fixture zshrc\n'))
    this.attach(dev, this.dir('.config'))
    this.attach(dev, this.dir('.cache'))
    const local = this.attach(dev, this.dir('.local'))
    const localBin = this.attach(local, this.dir('bin'))
    this.attach(
      localBin,
      this.file('hermes', '#!/bin/sh\n# fixture hermes launcher\n', {
        permissions: 'rwxr-xr-x',
        permissionsOctal: '755'
      })
    )
    this.attach(local, this.dir('share'))

    const etc = this.attach(
      this.root,
      this.dir('etc', { owner: 'root', group: 'root', writable: false })
    )
    this.attach(
      etc,
      this.file('wsl.conf', '[boot]\nsystemd=true\n', {
        owner: 'root',
        group: 'root',
        writable: false
      })
    )
    this.attach(
      etc,
      this.file('fstab', '# fixture fstab\n', { owner: 'root', group: 'root', writable: false })
    )
    this.attach(
      etc,
      this.file('environment', 'EDITOR=vim\n', { owner: 'root', group: 'root', writable: false })
    )

    this.attach(
      this.root,
      this.dir('root', {
        owner: 'root',
        group: 'root',
        permissions: 'rwx------',
        permissionsOctal: '700',
        writable: false,
        readable: false
      })
    )

    const usr = this.attach(
      this.root,
      this.dir('usr', { owner: 'root', group: 'root', writable: false })
    )
    const usrLocal = this.attach(
      usr,
      this.dir('local', { owner: 'root', group: 'root', writable: false })
    )
    this.attach(usrLocal, this.dir('bin', { owner: 'root', group: 'root', writable: false }))

    const mnt = this.attach(
      this.root,
      this.dir('mnt', { owner: 'root', group: 'root', writable: false })
    )
    const driveC = this.attach(
      mnt,
      this.dir('c', { permissions: 'rwxrwxrwx', permissionsOctal: '777' })
    )
    const users = this.attach(
      driveC,
      this.dir('Users', { permissions: 'rwxrwxrwx', permissionsOctal: '777' })
    )
    this.attach(users, this.dir('dev', { permissions: 'rwxrwxrwx', permissionsOctal: '777' }))
  }

  dir(name: string, opts: NodeOpts = {}): FsNode {
    return this.node(name, 'directory', opts, null, new Map(), null)
  }

  file(name: string, content: string, opts: NodeOpts = {}): FsNode {
    return this.node(
      name,
      'file',
      { permissions: 'rw-r--r--', permissionsOctal: '644', ...opts },
      content,
      null,
      null
    )
  }

  link(name: string, target: string, opts: NodeOpts = {}): FsNode {
    return this.node(
      name,
      'symlink',
      { permissions: 'rwxrwxrwx', permissionsOctal: '777', ...opts },
      null,
      null,
      target
    )
  }

  private node(
    name: string,
    type: FsNode['type'],
    opts: NodeOpts,
    content: string | null,
    children: Map<string, FsNode> | null,
    symlinkTarget: string | null
  ): FsNode {
    const mtime = opts.mtime ?? FIXTURE_SEED_MTIME
    return {
      name,
      type,
      owner: opts.owner ?? FIXTURE_USER,
      group: opts.group ?? FIXTURE_USER,
      permissions: opts.permissions ?? 'rwxr-xr-x',
      permissionsOctal: opts.permissionsOctal ?? '755',
      writable: opts.writable ?? true,
      readable: opts.readable ?? true,
      mtime,
      atime: mtime,
      inode: ++this.inodeCounter,
      content,
      children,
      symlinkTarget
    }
  }

  attach(parent: FsNode, child: FsNode): FsNode {
    parent.children?.set(child.name, child)
    return child
  }

  cloneNode(source: FsNode, newName?: string): FsNode {
    const copy = this.node(
      newName ?? source.name,
      source.type,
      {
        owner: source.owner,
        group: source.group,
        permissions: source.permissions,
        permissionsOctal: source.permissionsOctal,
        writable: source.writable,
        readable: source.readable,
        mtime: FIXTURE_NEW_MTIME
      },
      source.content,
      source.children ? new Map() : null,
      source.symlinkTarget
    )
    if (source.children) {
      for (const child of source.children.values()) this.attach(copy, this.cloneNode(child))
    }
    return copy
  }

  normalizePath(path: string): string {
    const segs: string[] = []
    for (const part of path.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        segs.pop()
        continue
      }
      segs.push(part)
    }
    return '/' + segs.join('/')
  }

  /** Resolve symlink chains with a depth guard; null when broken or cyclic. */
  resolveLink(node: FsNode | null): FsNode | null {
    let current = node
    for (let depth = 0; current && current.type === 'symlink'; depth++) {
      if (depth > 8 || !current.symlinkTarget) return null
      current = this.getNode(current.symlinkTarget, false)
    }
    return current
  }

  getNode(path: string, followFinal = true): FsNode | null {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return this.root
    let node: FsNode | null = this.root
    for (const seg of normalized.slice(1).split('/')) {
      node = this.resolveLink(node)
      if (!node || node.type !== 'directory' || !node.children) return null
      node = node.children.get(seg) ?? null
      if (!node) return null
    }
    return followFinal ? this.resolveLink(node) : node
  }

  getWithParent(path: string): { parent: FsNode | null; node: FsNode | null; name: string } {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return { parent: null, node: this.root, name: '/' }
    const idx = normalized.lastIndexOf('/')
    const parentPath = idx === 0 ? '/' : normalized.slice(0, idx)
    const name = normalized.slice(idx + 1)
    const parentRaw = this.getNode(parentPath, true)
    const parent = parentRaw?.type === 'directory' ? parentRaw : null
    return { parent, node: parent?.children?.get(name) ?? null, name }
  }
}

export class FixtureExplorerBackend implements ExplorerBackend {
  readonly fs: FixtureFilesystem
  private progressListeners = new Set<(p: FileOpProgress) => void>()
  private opCounter = 0

  constructor(fs: FixtureFilesystem = new FixtureFilesystem()) {
    this.fs = fs
  }

  private ensureDistro(distro: string, path: string): void {
    if (!isValidDistroName(distro)) {
      throw new ExplorerError('UNKNOWN', path, `Invalid distro name: ${JSON.stringify(distro)}`)
    }
    if (distro !== FIXTURE_UBUNTU) {
      throw new ExplorerError('UNKNOWN', path, `Fixture distro ${distro} is not running`)
    }
  }

  private accessDenied(path: string, node: FsNode): ExplorerError {
    return new ExplorerError('EACCES', path, `Permission denied: ${path}`, {
      owner: node.owner,
      permissions: node.permissions,
      user: FIXTURE_USER
    })
  }

  private joinPath(base: string, name: string): string {
    return (base === '/' ? '' : base) + '/' + name
  }

  private entry(path: string, node: FsNode): FileEntry {
    let targetType: 'file' | 'directory' | null = null
    if (node.type === 'symlink' && node.symlinkTarget) {
      const target = this.fs.resolveLink(node)
      targetType =
        target?.type === 'directory' ? 'directory' : target?.type === 'file' ? 'file' : null
    }
    return {
      name: node.name,
      path,
      type: node.type,
      sizeBytes: node.type === 'file' ? Buffer.byteLength(node.content ?? '', 'utf8') : null,
      mtime: node.mtime,
      owner: node.owner,
      group: node.group,
      permissions: node.permissions,
      permissionsOctal: node.permissionsOctal,
      isHidden: node.name.startsWith('.'),
      symlinkTarget: node.symlinkTarget,
      targetType
    }
  }

  private requireDir(path: string): FsNode {
    const raw = this.fs.getNode(path, false)
    if (!raw) throw new ExplorerError('ENOENT', path, `No such file or directory: ${path}`)
    const node = this.fs.resolveLink(raw)
    if (!node) throw new ExplorerError('ENOENT', path, `Broken symbolic link: ${path}`)
    if (node.type !== 'directory') {
      throw new ExplorerError('ENOTDIR', path, `Not a directory: ${path}`)
    }
    if (!node.readable) throw this.accessDenied(path, node)
    return node
  }

  private emit(progress: FileOpProgress): void {
    queueMicrotask(() => {
      for (const cb of this.progressListeners) cb(progress)
    })
  }

  private doneProgress(
    opId: string,
    kind: FileOpProgress['kind'],
    items: number,
    currentItem: string | null
  ): FileOpProgress {
    return {
      opId,
      kind,
      status: 'done',
      totalItems: items,
      doneItems: items,
      totalBytes: null,
      doneBytes: null,
      currentItem,
      error: null
    }
  }

  async homeDir(distro: string): Promise<string> {
    this.ensureDistro(distro, FIXTURE_HOME)
    return FIXTURE_HOME
  }

  async list(distro: string, path: string, opts: ExplorerListOpts = {}): Promise<FileEntry[]> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const base = this.fs.normalizePath(path)
    const node = this.requireDir(base)
    const entries: FileEntry[] = []
    for (const child of node.children?.values() ?? []) {
      if (!opts.showHidden && child.name.startsWith('.')) continue
      entries.push(this.entry(this.joinPath(base, child.name), child))
    }
    entries.sort((a, b) => {
      const ad = a.type === 'directory' ? 0 : 1
      const bd = b.type === 'directory' ? 0 : 1
      if (ad !== bd) return ad - bd
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    return entries
  }

  async tree(distro: string, path: string): Promise<FileEntry[]> {
    const entries = await this.list(distro, path, { showHidden: true })
    return entries.filter((e) => e.type === 'directory')
  }

  async stat(distro: string, path: string): Promise<FileStat> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const base = this.fs.normalizePath(path)
    const node = this.fs.getNode(base, false)
    if (!node) throw new ExplorerError('ENOENT', base, `No such file or directory: ${base}`)
    return {
      ...this.entry(base, node),
      inode: node.inode,
      atime: node.atime,
      windowsPath: toUncPath(distro, base)
    }
  }

  async mkdir(distro: string, path: string): Promise<void> {
    this.createChild(distro, path, 'directory')
  }

  async createFile(distro: string, path: string): Promise<void> {
    this.createChild(distro, path, 'file')
  }

  private createChild(distro: string, path: string, type: 'file' | 'directory'): void {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const { parent, node, name } = this.fs.getWithParent(path)
    if (!parent) throw new ExplorerError('ENOENT', path, `No such directory for: ${path}`)
    if (node) throw new ExplorerError('EEXIST', path, `Already exists: ${path}`)
    if (!parent.writable) throw this.accessDenied(path, parent)
    const created =
      type === 'directory'
        ? this.fs.dir(name, { mtime: FIXTURE_NEW_MTIME })
        : this.fs.file(name, '', { mtime: FIXTURE_NEW_MTIME })
    this.fs.attach(parent, created)
  }

  async rename(distro: string, path: string, newName: string): Promise<void> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    if (/[/\\\0\n]/.test(newName) || newName === '' || newName === '.' || newName === '..') {
      throw new ExplorerError('UNKNOWN', path, `Invalid file name: ${JSON.stringify(newName)}`)
    }
    const { parent, node, name } = this.fs.getWithParent(path)
    if (!parent || !node)
      throw new ExplorerError('ENOENT', path, `No such file or directory: ${path}`)
    if (!parent.writable) throw this.accessDenied(path, parent)
    if (parent.children?.has(newName)) {
      throw new ExplorerError('EEXIST', path, `Already exists: ${newName}`)
    }
    parent.children?.delete(name)
    node.name = newName
    node.mtime = FIXTURE_NEW_MTIME
    this.fs.attach(parent, node)
  }

  async copyMove(
    distro: string,
    sources: string[],
    destDir: string,
    move: boolean
  ): Promise<string> {
    this.ensureDistro(distro, destDir)
    assertValidLinuxPath(destDir)
    const destBase = this.fs.normalizePath(destDir)
    const dest = this.requireDir(destBase)
    if (!dest.writable) throw this.accessDenied(destBase, dest)
    let last: string | null = null
    for (const source of sources) {
      assertValidLinuxPath(source)
      const srcBase = this.fs.normalizePath(source)
      if (destBase === srcBase || destBase.startsWith(srcBase + '/')) {
        throw new ExplorerError('UNKNOWN', srcBase, `Cannot copy ${srcBase} into itself`)
      }
      const { parent, node, name } = this.fs.getWithParent(srcBase)
      if (!parent || !node) {
        throw new ExplorerError('ENOENT', srcBase, `No such file or directory: ${srcBase}`)
      }
      if (dest.children?.has(name)) {
        throw new ExplorerError('EEXIST', this.joinPath(destBase, name), `Already exists: ${name}`)
      }
      if (move) {
        if (!parent.writable) throw this.accessDenied(srcBase, parent)
        parent.children?.delete(name)
        this.fs.attach(dest, node)
      } else {
        this.fs.attach(dest, this.fs.cloneNode(node))
      }
      last = srcBase
    }
    const opId = `fixture-op-${++this.opCounter}`
    this.emit(this.doneProgress(opId, move ? 'move' : 'copy', sources.length, last))
    return opId
  }

  async trash(distro: string, paths: string[]): Promise<void> {
    this.ensureDistro(distro, paths[0] ?? FIXTURE_HOME)
    const files = this.ensureTrashDir('files')
    const info = this.ensureTrashDir('info')
    for (const path of paths) {
      assertValidLinuxPath(path)
      const base = this.fs.normalizePath(path)
      const { parent, node, name } = this.fs.getWithParent(base)
      if (!parent || !node)
        throw new ExplorerError('ENOENT', base, `No such file or directory: ${base}`)
      if (!parent.writable) throw this.accessDenied(base, parent)
      let unique = name
      for (let n = 2; files.children?.has(unique); n++) unique = `${name}.${n}`
      parent.children?.delete(name)
      node.name = unique
      this.fs.attach(files, node)
      const infoContent = `[Trash Info]\nPath=${base}\nDeletionDate=${FIXTURE_TRASH_DATE}\n`
      this.fs.attach(
        info,
        this.fs.file(`${unique}.trashinfo`, infoContent, { mtime: FIXTURE_NEW_MTIME })
      )
    }
  }

  private ensureTrashDir(leaf: 'files' | 'info'): FsNode {
    const share = this.requireDir('/home/dev/.local/share')
    let trash = share.children?.get('Trash') ?? null
    if (!trash) trash = this.fs.attach(share, this.fs.dir('Trash', { mtime: FIXTURE_NEW_MTIME }))
    let dir = trash.children?.get(leaf) ?? null
    if (!dir) dir = this.fs.attach(trash, this.fs.dir(leaf, { mtime: FIXTURE_NEW_MTIME }))
    return dir
  }

  async remove(distro: string, paths: string[]): Promise<void> {
    this.ensureDistro(distro, paths[0] ?? FIXTURE_HOME)
    for (const path of paths) {
      assertValidLinuxPath(path)
      const base = this.fs.normalizePath(path)
      const { parent, node, name } = this.fs.getWithParent(base)
      if (!parent || !node)
        throw new ExplorerError('ENOENT', base, `No such file or directory: ${base}`)
      if (!parent.writable) throw this.accessDenied(base, parent)
      parent.children?.delete(name)
    }
  }

  async readText(distro: string, path: string, maxBytes: number): Promise<TextFileContent> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const base = this.fs.normalizePath(path)
    const node = this.fs.getNode(base, true)
    if (!node) throw new ExplorerError('ENOENT', base, `No such file or directory: ${base}`)
    if (node.type === 'directory')
      throw new ExplorerError('EISDIR', base, `Is a directory: ${base}`)
    if (!node.readable) throw this.accessDenied(base, node)
    const content = node.content ?? ''
    if (content.includes('\0')) throw new ExplorerError('BINARY', base, `Binary file: ${base}`)
    const sizeBytes = Buffer.byteLength(content, 'utf8')
    const truncated = sizeBytes > maxBytes
    return {
      content: truncated
        ? Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8')
        : content,
      encoding: 'utf-8',
      truncated,
      sizeBytes,
      writable: node.writable
    }
  }

  async writeText(distro: string, path: string, content: string): Promise<void> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const base = this.fs.normalizePath(path)
    const existing = this.fs.getNode(base, true)
    if (existing) {
      if (existing.type === 'directory') {
        throw new ExplorerError('EISDIR', base, `Is a directory: ${base}`)
      }
      if (!existing.writable) throw this.accessDenied(base, existing)
      existing.content = content
      existing.mtime = FIXTURE_NEW_MTIME
      return
    }
    const { parent, name } = this.fs.getWithParent(base)
    if (!parent) throw new ExplorerError('ENOENT', base, `No such directory for: ${base}`)
    if (!parent.writable) throw this.accessDenied(base, parent)
    this.fs.attach(parent, this.fs.file(name, content, { mtime: FIXTURE_NEW_MTIME }))
  }

  async importFromWindows(
    distro: string,
    windowsPaths: string[],
    destDir: string
  ): Promise<string> {
    this.ensureDistro(distro, destDir)
    assertValidLinuxPath(destDir)
    const dest = this.requireDir(this.fs.normalizePath(destDir))
    if (!dest.writable) throw this.accessDenied(destDir, dest)
    let last: string | null = null
    for (const windowsPath of windowsPaths) {
      const name = windowsPath.split(/[\\/]/).filter(Boolean).pop() ?? 'imported'
      const node = this.fs.file(name, `fixture import of ${windowsPath}\n`, {
        mtime: FIXTURE_NEW_MTIME
      })
      this.fs.attach(dest, node)
      last = name
    }
    const opId = `fixture-op-${++this.opCounter}`
    this.emit(this.doneProgress(opId, 'import', windowsPaths.length, last))
    return opId
  }

  async exportToWindows(distro: string, paths: string[], windowsDir: string): Promise<string> {
    this.ensureDistro(distro, paths[0] ?? FIXTURE_HOME)
    for (const path of paths) {
      assertValidLinuxPath(path)
      const node = this.fs.getNode(this.fs.normalizePath(path), false)
      if (!node) throw new ExplorerError('ENOENT', path, `No such file or directory: ${path}`)
    }
    const opId = `fixture-op-${++this.opCounter}`
    this.emit(this.doneProgress(opId, 'export', paths.length, windowsDir))
    return opId
  }

  async cancelOp(_opId: string): Promise<void> {
    // Fixture operations complete instantly, so there is never anything to cancel.
  }

  async search(distro: string, path: string, query: string): Promise<FileEntry[]> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const q = query.toLowerCase()
    const results: FileEntry[] = []
    const walk = (base: string, node: FsNode): void => {
      if (results.length >= 1000 || !node.children) return
      for (const child of node.children.values()) {
        const childPath = this.joinPath(base, child.name)
        if (q.length > 0 && child.name.toLowerCase().includes(q)) {
          results.push(this.entry(childPath, child))
        }
        // Skip symlinks (cycle safety) and unreadable dirs like /root.
        if (child.type === 'directory' && child.readable) walk(childPath, child)
      }
    }
    const start = this.fs.normalizePath(path)
    walk(start, this.requireDir(start))
    return results
  }

  async convertPath(distro: string, input: string, to: 'windows' | 'linux'): Promise<string> {
    this.ensureDistro(distro, '/')
    if (to === 'windows') {
      if (!isValidLinuxPath(input)) {
        throw new ExplorerError('UNKNOWN', input, `Cannot convert path: ${input}`)
      }
      const normalized = this.fs.normalizePath(input)
      const drive = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(normalized)
      if (drive) {
        const rest = (drive[2] ?? '').replace(/\//g, '\\')
        return `${drive[1].toUpperCase()}:${rest === '' ? '\\' : rest}`
      }
      return toUncPath(distro, normalized)
    }
    const driveMatch = /^([A-Za-z]):[\\/](.*)$/.exec(input)
    if (driveMatch) {
      const rest = driveMatch[2].replace(/\\/g, '/')
      return this.fs.normalizePath(`/mnt/${driveMatch[1].toLowerCase()}/${rest}`)
    }
    const uncPrefix = `\\\\wsl.localhost\\${distro}`
    if (input.startsWith(uncPrefix)) {
      const rest = input.slice(uncPrefix.length).replace(/\\/g, '/')
      return this.fs.normalizePath(rest === '' ? '/' : rest)
    }
    throw new ExplorerError('UNKNOWN', input, `Cannot convert path: ${input}`)
  }

  onProgress(cb: (p: FileOpProgress) => void): () => void {
    this.progressListeners.add(cb)
    return () => {
      this.progressListeners.delete(cb)
    }
  }
}
