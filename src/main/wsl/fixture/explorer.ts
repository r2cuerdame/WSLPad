/**
 * In-memory ExplorerBackend for fixture mode (goal.md §18.4).
 * Models a small Ubuntu-24.04 world with a permission-denied sample (/root),
 * a root-owned read-only file (/etc/wsl.conf), symlinks (one broken) and a
 * freedesktop-style trash. All timestamps are fixed so output is deterministic.
 */
import type {
  DirSizeEntry,
  DirSizeResult,
  FileEntry,
  FileOpProgress,
  FileStat,
  TrashEntry,
  TextFileContent
} from '@shared/types'
import { WINDOWS_ROOT } from '@shared/constants'
import { DIR_SIZE_CHILD_CAP } from '../../explorer/dir-sizes'
import {
  convertLinuxToWindows,
  convertWindowsToLinux,
  isInsideLinux,
  isLinuxRoot
} from '../../explorer/path-convert'
import { sanitizeSearchQuery } from '../../explorer/listing'
import { ExplorerError, type ExplorerBackend, type ExplorerListOpts } from '../contracts'
import { assertValidLinuxPath, isValidDistroName } from '../escape'
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

  /** Resolve an existing path while following each symlink before later `..` components. */
  resolvePath(path: string): string | null {
    const pending = path.split('/').filter((part) => part.length > 0)
    const resolved: string[] = []
    let linksFollowed = 0

    while (pending.length > 0) {
      const part = pending.shift()!
      const currentPath = resolved.length === 0 ? '/' : `/${resolved.join('/')}`
      const current = this.getNode(currentPath, true)
      if (!current || current.type !== 'directory') return null
      if (part === '.') continue
      if (part === '..') {
        resolved.pop()
        continue
      }

      const node = current.children?.get(part)
      if (!node) return null
      if (node.type === 'symlink') {
        if (++linksFollowed > 40 || !node.symlinkTarget) return null
        if (node.symlinkTarget.startsWith('/')) resolved.length = 0
        pending.unshift(...node.symlinkTarget.split('/').filter((segment) => segment.length > 0))
      } else {
        resolved.push(part)
      }
    }

    const resolvedPath = resolved.length === 0 ? '/' : `/${resolved.join('/')}`
    const node = this.getNode(resolvedPath, true)
    if (!node || (path.endsWith('/') && node.type !== 'directory')) return null
    return resolvedPath
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

  /**
   * Same guard as the real backend: any spelling of the root (`//`, `/./`) is
   * refused by name rather than failing as a false ENOENT, because the root
   * has no parent to look it up in.
   */
  private refuseRoot(path: string, verb: string): void {
    if (isLinuxRoot(path)) throw new ExplorerError('UNKNOWN', path, `Refusing to ${verb} ${path}`)
  }

  /**
   * Same contract as removeEntries/trashEntries: every path is checked before
   * the first one is touched, so a batch naming the root is refused as a whole
   * instead of after the items in front of it are already gone. A path given
   * twice is handled once.
   */
  private checkBatch(paths: readonly string[], verb: string): string[] {
    const unique = [...new Set(paths)]
    for (const path of unique) {
      assertValidLinuxPath(path)
      this.refuseRoot(path, verb)
    }
    return unique
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
    return entries.filter(
      (e) => e.type === 'directory' || (e.type === 'symlink' && e.targetType === 'directory')
    )
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

  async resolvePath(distro: string, path: string): Promise<string> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const resolved = this.fs.resolvePath(path)
    if (resolved === null) throw new ExplorerError('ENOENT', path, `No such file or directory: ${path}`)
    return resolved
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
    // Existence first: the root has a node but no parent, and is EEXIST like
    // the real backend's existsGuard reports it, not a false ENOENT.
    if (node) throw new ExplorerError('EEXIST', path, `Already exists: ${path}`)
    if (!parent) throw new ExplorerError('ENOENT', path, `No such directory for: ${path}`)
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
    this.refuseRoot(path, 'rename')
    if (/[/\\\0\n]/.test(newName) || newName === '' || newName === '.' || newName === '..') {
      throw new ExplorerError('UNKNOWN', path, `Invalid file name: ${JSON.stringify(newName)}`)
    }
    const { parent, node, name } = this.fs.getWithParent(path)
    if (!parent || !node)
      throw new ExplorerError('ENOENT', path, `No such file or directory: ${path}`)
    // Same name is a no-op, as renameEntry skips the mv; the entry itself must
    // not read as an existing target.
    if (name === newName) return
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
    const uniqueSources = this.checkBatch(sources, move ? 'move' : 'copy')
    const destBase = this.fs.normalizePath(destDir)
    const dest = this.requireDir(destBase)
    if (!dest.writable) throw this.accessDenied(destBase, dest)
    // Same order as the Windows backends: a source that contains the
    // destination refuses the whole batch before the items in front of it
    // are copied or moved away.
    const srcBases = uniqueSources.map((source) => this.fs.normalizePath(source))
    for (const srcBase of srcBases) {
      if (isInsideLinux(destBase, srcBase)) {
        throw new ExplorerError(
          'UNKNOWN',
          srcBase,
          `Cannot ${move ? 'move' : 'copy'} ${srcBase} into itself`
        )
      }
    }
    let last: string | null = null
    for (const srcBase of srcBases) {
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
    this.emit(this.doneProgress(opId, move ? 'move' : 'copy', uniqueSources.length, last))
    return opId
  }

  async trash(distro: string, paths: string[]): Promise<void> {
    this.ensureDistro(distro, paths[0] ?? FIXTURE_HOME)
    const uniquePaths = this.checkBatch(paths, 'trash')
    const files = this.ensureTrashDir('files')
    const info = this.ensureTrashDir('info')
    for (const path of uniquePaths) {
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

  async listTrash(distro: string): Promise<TrashEntry[]> {
    this.ensureDistro(distro, FIXTURE_HOME)
    const files = this.ensureTrashDir('files')
    const info = this.ensureTrashDir('info')
    const entries: TrashEntry[] = []
    for (const [name, node] of info.children ?? []) {
      if (!name.endsWith('.trashinfo')) continue
      const trashName = name.slice(0, -'.trashinfo'.length)
      const content = node.content ?? ''
      const originalPath = /^Path=(.*)$/m.exec(content)?.[1] ?? ''
      if (originalPath === '') continue
      const trashed = files.children?.get(trashName) ?? null
      entries.push({
        trashName,
        originalPath,
        deletedAt: /^DeletionDate=(.*)$/m.exec(content)?.[1] ?? null,
        type: trashed === null ? 'other' : trashed.type === 'directory' ? 'directory' : 'file',
        present: trashed !== null,
        sizeBytes: trashed?.content?.length ?? null
      })
    }
    return entries.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
  }

  async restoreTrash(distro: string, trashNames: string[]): Promise<void> {
    this.ensureDistro(distro, FIXTURE_HOME)
    const files = this.ensureTrashDir('files')
    const info = this.ensureTrashDir('info')
    const entries = await this.listTrash(distro)
    const uniqueNames = [...new Set(trashNames)]
    const plannedChildren = new Map<FsNode, Map<string, FsNode>>()
    const plannedChild = (parent: FsNode, name: string): FsNode | null =>
      parent.children?.get(name) ?? plannedChildren.get(parent)?.get(name) ?? null
    const resolveDir = (path: string): FsNode => {
      let current: FsNode | null = this.fs.root
      const normalized = this.fs.normalizePath(path)
      const segments = normalized === '/' ? [] : normalized.slice(1).split('/')
      for (const segment of segments) {
        current = this.fs.resolveLink(current)
        if (!current) throw new ExplorerError('ENOENT', path, `No such directory: ${path}`)
        if (current.type !== 'directory' || !current.children) {
          throw new ExplorerError('ENOTDIR', path, `Not a directory: ${path}`)
        }
        if (!current.readable) throw this.accessDenied(path, current)
        current = plannedChild(current, segment)
        if (!current) throw new ExplorerError('ENOENT', path, `No such directory: ${path}`)
      }
      current = this.fs.resolveLink(current)
      if (!current) throw new ExplorerError('ENOENT', path, `No such directory: ${path}`)
      if (current.type !== 'directory' || !current.children) {
        throw new ExplorerError('ENOTDIR', path, `Not a directory: ${path}`)
      }
      if (!current.readable) throw this.accessDenied(path, current)
      return current
    }
    const toRestore = uniqueNames.map((trashName) => {
      const entry = entries.find((e) => e.trashName === trashName)
      if (entry === undefined) {
        throw new ExplorerError('ENOENT', trashName, `Nothing in the trash is called ${trashName}`)
      }
      const node = files.children?.get(trashName)
      if (node === undefined) {
        throw new ExplorerError('ENOENT', entry.originalPath, 'The trashed copy is gone')
      }
      const dest = this.fs.normalizePath(entry.originalPath)
      const parentPath = dest.replace(/\/[^/]*$/, '') || '/'
      const parent = resolveDir(parentPath)
      if (!parent.writable) throw this.accessDenied(dest, parent)
      const name = dest.slice(dest.lastIndexOf('/') + 1)
      if (plannedChild(parent, name) !== null) {
        throw new ExplorerError('EEXIST', dest, `${dest} already exists`)
      }
      let children = plannedChildren.get(parent)
      if (!children) {
        children = new Map()
        plannedChildren.set(parent, children)
      }
      children.set(name, node)
      return { trashName, node, dest, parent }
    })

    for (const { trashName, node, dest, parent } of toRestore) {
      files.children?.delete(trashName)
      node.name = dest.slice(dest.lastIndexOf('/') + 1)
      this.fs.attach(parent, node)
      info.children?.delete(`${trashName}.trashinfo`)
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

    // Normalize before deduplicating: different valid spellings can name the same node.
    const uniquePaths = [
      ...new Set(this.checkBatch(paths, 'remove').map((path) => this.fs.normalizePath(path)))
    ]

    // Validate every target before deleting any of them, so a later error cannot
    // leave the earlier items permanently removed.
    const targets = uniquePaths.map((base) => {
      const { parent, node, name } = this.fs.getWithParent(base)
      if (!parent || !node)
        throw new ExplorerError('ENOENT', base, `No such file or directory: ${base}`)
      if (!parent.writable) throw this.accessDenied(base, parent)
      return { base, parent, name }
    })

    // Removing a selected directory already removes every selected descendant.
    const topLevelTargets = targets.filter(
      ({ base }) => !uniquePaths.some((candidate) => base.startsWith(`${candidate}/`))
    )
    for (const { parent, name } of topLevelTargets) parent.children?.delete(name)
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
    // Same as the real backend: a path given twice is imported once.
    const uniqueWindowsPaths = [...new Set(windowsPaths)]
    // Reject roots across the whole batch before any fixture file is created.
    for (const windowsPath of uniqueWindowsPaths) {
      if (windowsPath === WINDOWS_ROOT) {
        throw new ExplorerError(
          'UNKNOWN',
          windowsPath,
          'Refusing to use the This PC virtual root'
        )
      }
      if (/^[A-Za-z]:[\\/]*$/.test(windowsPath)) {
        throw new ExplorerError(
          'UNKNOWN',
          windowsPath,
          `Refusing to import drive root ${windowsPath}`
        )
      }
      const linuxPath = convertWindowsToLinux(distro, windowsPath)
      if (linuxPath !== null && isLinuxRoot(linuxPath)) {
        throw new ExplorerError('UNKNOWN', linuxPath, `Refusing to import ${linuxPath}`)
      }
    }
    const dest = this.requireDir(this.fs.normalizePath(destDir))
    if (!dest.writable) throw this.accessDenied(destDir, dest)
    let last: string | null = null
    for (const windowsPath of uniqueWindowsPaths) {
      const name = windowsPath.split(/[\\/]/).filter(Boolean).pop() ?? 'imported'
      const node = this.fs.file(name, `fixture import of ${windowsPath}\n`, {
        mtime: FIXTURE_NEW_MTIME
      })
      this.fs.attach(dest, node)
      last = name
    }
    const opId = `fixture-op-${++this.opCounter}`
    this.emit(this.doneProgress(opId, 'import', uniqueWindowsPaths.length, last))
    return opId
  }

  async exportToWindows(distro: string, paths: string[], windowsDir: string): Promise<string> {
    this.ensureDistro(distro, paths[0] ?? FIXTURE_HOME)
    const uniquePaths = this.checkBatch(paths, 'export')
    for (const path of uniquePaths) {
      const node = this.fs.getNode(this.fs.normalizePath(path), false)
      if (!node) throw new ExplorerError('ENOENT', path, `No such file or directory: ${path}`)
    }
    const opId = `fixture-op-${++this.opCounter}`
    this.emit(this.doneProgress(opId, 'export', uniquePaths.length, windowsDir))
    return opId
  }

  async cancelOp(_opId: string): Promise<void> {
    // Fixture operations complete instantly, so there is never anything to cancel.
  }

  async dirSizes(distro: string, path: string, _token: string): Promise<DirSizeResult> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const base = this.fs.normalizePath(path)
    const dir = this.requireDir(base)
    const children = [...(dir.children?.values() ?? [])]
    const measured = children.slice(0, DIR_SIZE_CHILD_CAP)
    const skipped = children.length - measured.length
    let total: number | null = measured.length === 0 && children.length === 0 ? 0 : null
    const entries: DirSizeEntry[] = []
    for (const child of measured) {
      const childPath = this.joinPath(base, child.name)
      // An unreadable subtree measures as unknown here exactly as du would.
      const size = child.readable ? this.subtreeBytes(child) : null
      if (size !== null) total = (total ?? 0) + size
      entries.push({
        name: child.name,
        path: childPath,
        isDirectory: child.type === 'directory',
        sizeBytes: size,
        partial: false
      })
    }
    entries.sort((a, b) => {
      if (a.sizeBytes === null && b.sizeBytes === null) return a.name.localeCompare(b.name)
      if (a.sizeBytes === null) return 1
      if (b.sizeBytes === null) return -1
      return b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name)
    })
    return { path: base, entries, totalBytes: total, skipped, cancelled: false, error: null }
  }

  /** Apparent bytes of a node and everything under it; symlinks count as 0. */
  private subtreeBytes(node: FsNode): number {
    if (node.type === 'file') return Buffer.byteLength(node.content ?? '', 'utf8')
    if (node.type !== 'directory') return 0
    let sum = 0
    for (const child of node.children?.values() ?? []) sum += this.subtreeBytes(child)
    return sum
  }

  async search(distro: string, path: string, query: string): Promise<FileEntry[]> {
    this.ensureDistro(distro, path)
    assertValidLinuxPath(path)
    const q = sanitizeSearchQuery(query).toLowerCase()
    if (!q) return []
    const results: FileEntry[] = []
    const walk = (base: string, node: FsNode, depth: number): void => {
      if (results.length >= 200 || depth > 4 || !node.children) return
      for (const child of node.children.values()) {
        if (results.length >= 200) return
        const childPath = this.joinPath(base, child.name)
        if (child.name.toLowerCase().includes(q)) {
          results.push(this.entry(childPath, child))
        }
        // Skip symlinks (cycle safety) and unreadable dirs like /root.
        if (child.type === 'directory' && child.readable) walk(childPath, child, depth + 1)
      }
    }
    const start = this.fs.normalizePath(path)
    walk(start, this.requireDir(start), 1)
    return results
  }

  async convertPath(distro: string, input: string, to: 'windows' | 'linux'): Promise<string> {
    this.ensureDistro(distro, '/')
    if (input === WINDOWS_ROOT) {
      throw new ExplorerError('UNKNOWN', input, 'Refusing to convert the This PC virtual root')
    }
    if (input.includes('\0') || input.includes('\n')) {
      throw new ExplorerError(
        'UNKNOWN',
        input,
        `Path is not mappable: ${JSON.stringify(input)}`
      )
    }
    if (to === 'windows') {
      try {
        return convertLinuxToWindows(distro, input)
      } catch {
        throw new ExplorerError('UNKNOWN', input, `Path is not mappable: ${input}`)
      }
    }
    const mapped = convertWindowsToLinux(distro, input)
    if (mapped !== null) {
      return mapped
    }
    throw new ExplorerError('UNKNOWN', input, `Path is not mappable: ${input}`)
  }

  onProgress(cb: (p: FileOpProgress) => void): () => void {
    this.progressListeners.add(cb)
    return () => {
      this.progressListeners.delete(cb)
    }
  }
}
