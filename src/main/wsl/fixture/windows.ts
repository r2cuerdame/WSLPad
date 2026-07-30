/**
 * Deterministic in-memory WindowsFs for WSLPAD_FIXTURE_MODE=1 (goal.md §18.4).
 * Two drives, a user profile with a hidden file, a binary download and a
 * read-only C:\Windows\System32. Every timestamp is a fixed ISO stamp and every
 * opId is a counter, so repeated runs are byte-identical (no Date.now anywhere).
 */
import { WINDOWS_ROOT } from '@shared/constants'
import type {
  FileEntry,
  FileEntryType,
  FileOpProgress,
  FileOpStatus,
  FileStat,
  TextFileContent,
  WindowsPlace
} from '@shared/types'
import { ExplorerError, type ExplorerListOpts } from '../contracts'
import type { WindowsFs } from '../../explorer/windows'
import { FIXTURE_NEW_MTIME, FIXTURE_SEED_MTIME, FIXTURE_WINDOWS_USERPROFILE } from './data'

const GB = 1024 * 1024 * 1024

const DRIVE_SIZES: Record<string, { totalBytes: number; freeBytes: number }> = {
  C: { totalBytes: 500 * GB, freeBytes: 145 * GB },
  D: { totalBytes: 1024 * GB, freeBytes: 800 * GB }
}

/** MZ header with embedded NUL bytes so readText rejects it as binary. */
const SETUP_EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00])

interface WinNode {
  name: string
  type: 'file' | 'directory'
  content: Buffer | null
  children: Map<string, WinNode> | null
  mtime: string
  writable: boolean
  inode: number
}

interface ParsedPath {
  drive: string
  segments: string[]
}

function parseWinPath(path: string): ParsedPath | null {
  const match = /^([A-Za-z]):[\\/]?(.*)$/.exec(path)
  if (!match || path.includes('\0') || path.includes('\n')) return null
  const segments: string[] = []
  for (const part of match[2].split(/[\\/]+/)) {
    if (!part || part === '.') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    segments.push(part)
  }
  return { drive: match[1].toUpperCase(), segments }
}

function formatPath(drive: string, segments: string[]): string {
  return `${drive}:\\` + segments.join('\\')
}

class FixtureWindowsFs implements WindowsFs {
  private readonly drives = new Map<string, WinNode>()
  private readonly recycle: Array<{ originalPath: string; node: WinNode }> = []
  private readonly listeners = new Set<(p: FileOpProgress) => void>()
  private opCounter = 0
  private inodeCounter = 0

  constructor() {
    const c = this.dir('C:')
    this.drives.set('C', c)
    const users = this.attach(c, this.dir('Users'))
    const dev = this.attach(users, this.dir('dev'))
    this.attach(dev, this.dir('Desktop'))
    const documents = this.attach(dev, this.dir('Documents'))
    this.attach(documents, this.file('notes.txt', 'Windows fixture notes\n'))
    const downloads = this.attach(dev, this.dir('Downloads'))
    this.attach(downloads, this.file('setup.exe', SETUP_EXE))
    const projects = this.attach(dev, this.dir('projects'))
    const demo = this.attach(projects, this.dir('demo'))
    this.attach(demo, this.file('README.md', '# demo\n\nWindows fixture project.\n'))
    this.attach(dev, this.file('.hidden-config', 'hidden=true\n'))

    const windows = this.attach(c, this.dir('Windows', false))
    this.attach(windows, this.dir('System32', false))

    const d = this.dir('D:')
    this.drives.set('D', d)
    const media = this.attach(d, this.dir('Media'))
    this.attach(media, this.file('clip.mp4', 'fixture media clip\n'))
  }

  // --- tree construction ---------------------------------------------------

  private dir(name: string, writable = true): WinNode {
    return {
      name,
      type: 'directory',
      content: null,
      children: new Map(),
      mtime: FIXTURE_SEED_MTIME,
      writable,
      inode: ++this.inodeCounter
    }
  }

  private file(name: string, content: string | Buffer, writable = true): WinNode {
    return {
      name,
      type: 'file',
      content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
      children: null,
      mtime: FIXTURE_SEED_MTIME,
      writable,
      inode: ++this.inodeCounter
    }
  }

  private attach(parent: WinNode, child: WinNode): WinNode {
    parent.children?.set(child.name.toLowerCase(), child)
    return child
  }

  private clone(node: WinNode, name = node.name): WinNode {
    const copy: WinNode = {
      name,
      type: node.type,
      content: node.content === null ? null : Buffer.from(node.content),
      children: node.children ? new Map() : null,
      mtime: FIXTURE_NEW_MTIME,
      writable: node.writable,
      inode: ++this.inodeCounter
    }
    if (node.children) {
      for (const child of node.children.values()) this.attach(copy, this.clone(child))
    }
    return copy
  }

  // --- lookup --------------------------------------------------------------

  private parse(path: string): ParsedPath {
    const parsed = parseWinPath(path)
    if (!parsed || !this.drives.has(parsed.drive)) {
      throw new ExplorerError('ENOENT', path, `ENOENT: ${path}`)
    }
    return parsed
  }

  private nodeAt(path: string): { node: WinNode | null; normalized: string } {
    const { drive, segments } = this.parse(path)
    let node: WinNode | null = this.drives.get(drive) ?? null
    for (const segment of segments) {
      if (!node || node.type !== 'directory' || !node.children) return { node: null, normalized: formatPath(drive, segments) }
      node = node.children.get(segment.toLowerCase()) ?? null
    }
    return { node, normalized: formatPath(drive, segments) }
  }

  private withParent(path: string): { parent: WinNode | null; node: WinNode | null; name: string; normalized: string } {
    const { drive, segments } = this.parse(path)
    const normalized = formatPath(drive, segments)
    if (segments.length === 0) {
      return { parent: null, node: this.drives.get(drive) ?? null, name: `${drive}:`, normalized }
    }
    const parentPath = formatPath(drive, segments.slice(0, -1))
    const name = segments[segments.length - 1]
    const parent = this.nodeAt(parentPath).node
    return {
      parent: parent?.type === 'directory' ? parent : null,
      node: parent?.children?.get(name.toLowerCase()) ?? null,
      name,
      normalized
    }
  }

  private requireDir(path: string): { node: WinNode; normalized: string } {
    const { node, normalized } = this.nodeAt(path)
    if (!node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    if (node.type !== 'directory') {
      throw new ExplorerError('ENOTDIR', normalized, `ENOTDIR: ${normalized}`)
    }
    return { node, normalized }
  }

  private join(base: string, name: string): string {
    return base.endsWith('\\') ? base + name : `${base}\\${name}`
  }

  private entry(path: string, node: WinNode): FileEntry {
    const type: FileEntryType = node.type
    return {
      name: node.name,
      path,
      type,
      sizeBytes: type === 'directory' ? null : (node.content?.length ?? 0),
      mtime: node.mtime,
      owner: null,
      group: null,
      permissions: null,
      permissionsOctal: null,
      isHidden: node.name.startsWith('.'),
      symlinkTarget: null,
      targetType: null
    }
  }

  private sorted(entries: FileEntry[]): FileEntry[] {
    return entries.sort((a, b) => {
      const ad = a.type === 'directory' ? 0 : 1
      const bd = b.type === 'directory' ? 0 : 1
      if (ad !== bd) return ad - bd
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
  }

  private driveEntries(): FileEntry[] {
    return [...this.drives.keys()].map((letter) => ({
      name: `${letter}:`,
      path: `${letter}:\\`,
      type: 'directory' as FileEntryType,
      sizeBytes: null,
      mtime: FIXTURE_SEED_MTIME,
      owner: null,
      group: null,
      permissions: null,
      permissionsOctal: null,
      isHidden: false,
      symlinkTarget: null,
      targetType: null
    }))
  }

  private emit(progress: FileOpProgress): void {
    queueMicrotask(() => {
      for (const cb of this.listeners) cb(progress)
    })
  }

  // --- WindowsFs -----------------------------------------------------------

  async places(): Promise<WindowsPlace[]> {
    const out: WindowsPlace[] = []
    for (const letter of this.drives.keys()) {
      const size = DRIVE_SIZES[letter]
      out.push({
        id: `drive-${letter}`,
        label: `${letter}:`,
        path: `${letter}:\\`,
        kind: 'drive',
        totalBytes: size?.totalBytes ?? null,
        freeBytes: size?.freeBytes ?? null
      })
    }
    const folders: ReadonlyArray<{ id: string; label: string; path: string }> = [
      { id: 'profile', label: 'dev', path: FIXTURE_WINDOWS_USERPROFILE },
      { id: 'desktop', label: 'Desktop', path: `${FIXTURE_WINDOWS_USERPROFILE}\\Desktop` },
      { id: 'documents', label: 'Documents', path: `${FIXTURE_WINDOWS_USERPROFILE}\\Documents` },
      { id: 'downloads', label: 'Downloads', path: `${FIXTURE_WINDOWS_USERPROFILE}\\Downloads` }
    ]
    for (const folder of folders) {
      out.push({ ...folder, kind: 'folder', totalBytes: null, freeBytes: null })
    }
    return out
  }

  async home(): Promise<string> {
    return FIXTURE_WINDOWS_USERPROFILE
  }

  async list(path: string, opts: ExplorerListOpts = {}): Promise<FileEntry[]> {
    if (path === WINDOWS_ROOT) return this.driveEntries()
    const { node, normalized } = this.requireDir(path)
    const entries: FileEntry[] = []
    for (const child of node.children?.values() ?? []) {
      entries.push(this.entry(this.join(normalized, child.name), child))
    }
    const showHidden = opts.showHidden ?? true
    return this.sorted(showHidden ? entries : entries.filter((e) => !e.isHidden))
  }

  async tree(path: string): Promise<FileEntry[]> {
    if (path === WINDOWS_ROOT) return this.driveEntries()
    const entries = await this.list(path, { showHidden: true })
    return entries.filter((e) => e.type === 'directory')
  }

  async stat(path: string): Promise<FileStat> {
    if (path === WINDOWS_ROOT) {
      return {
        name: WINDOWS_ROOT,
        path: WINDOWS_ROOT,
        type: 'directory',
        sizeBytes: null,
        mtime: null,
        owner: null,
        group: null,
        permissions: null,
        permissionsOctal: null,
        isHidden: false,
        symlinkTarget: null,
        targetType: null,
        inode: null,
        atime: null,
        windowsPath: null
      }
    }
    const { node, normalized } = this.nodeAt(path)
    if (!node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    return {
      ...this.entry(normalized, node),
      inode: node.inode,
      atime: node.mtime,
      windowsPath: normalized
    }
  }

  async mkdir(path: string): Promise<void> {
    this.createChild(path, 'directory')
  }

  async createFile(path: string): Promise<void> {
    this.createChild(path, 'file')
  }

  private createChild(path: string, type: 'file' | 'directory'): void {
    const { parent, node, name, normalized } = this.withParent(path)
    if (!parent) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    if (node) throw new ExplorerError('EEXIST', normalized, `EEXIST: ${normalized}`)
    if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
    const created = type === 'directory' ? this.dir(name) : this.file(name, '')
    created.mtime = FIXTURE_NEW_MTIME
    this.attach(parent, created)
  }

  async rename(path: string, newName: string): Promise<void> {
    const { parent, node, name, normalized } = this.withParent(path)
    if (/[/\\\0\n]/.test(newName) || newName === '' || newName === '.' || newName === '..') {
      throw new ExplorerError('UNKNOWN', normalized, `Invalid file name: ${JSON.stringify(newName)}`)
    }
    if (!parent || !node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
    if (newName.toLowerCase() !== name.toLowerCase() && parent.children?.has(newName.toLowerCase())) {
      throw new ExplorerError('EEXIST', normalized, `EEXIST: ${newName}`)
    }
    parent.children?.delete(name.toLowerCase())
    node.name = newName
    node.mtime = FIXTURE_NEW_MTIME
    this.attach(parent, node)
  }

  async copyMove(sources: string[], destDir: string, move: boolean): Promise<string> {
    const { node: dest, normalized: destPath } = this.requireDir(destDir)
    if (!dest.writable) throw new ExplorerError('EACCES', destPath, `EACCES: ${destPath}`)
    const kind = move ? 'move' : 'copy'
    const opId = `fixture-win-op-${++this.opCounter}`
    const totalItems = sources.length
    let doneItems = 0
    let totalBytes = 0
    const errors: string[] = []
    const emit = (status: FileOpStatus, currentItem: string | null, error: string | null = null) =>
      this.emit({
        opId,
        kind,
        status,
        totalItems,
        doneItems,
        totalBytes,
        doneBytes: totalBytes,
        currentItem,
        error
      })
    for (const source of sources) {
      const { parent, node, name, normalized } = this.withParent(source)
      try {
        if (!parent || !node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
        if (normalized.toLowerCase() === destPath.toLowerCase() ||
            destPath.toLowerCase().startsWith(normalized.toLowerCase() + '\\')) {
          throw new ExplorerError('UNKNOWN', normalized, `Cannot copy ${normalized} into itself`)
        }
        if (dest.children?.has(name.toLowerCase())) {
          const conflict = this.join(destPath, name)
          throw new ExplorerError('EEXIST', conflict, `EEXIST: ${conflict}`)
        }
        totalBytes += node.content?.length ?? 0
        if (move) {
          if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
          parent.children?.delete(name.toLowerCase())
          node.mtime = FIXTURE_NEW_MTIME
          this.attach(dest, node)
        } else {
          this.attach(dest, this.clone(node))
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
      doneItems++
      emit('running', normalized)
    }
    emit(errors.length > 0 ? 'error' : 'done', null, errors.length > 0 ? errors.join('; ') : null)
    return opId
  }

  async trash(paths: string[]): Promise<void> {
    for (const path of paths) {
      const { parent, node, name, normalized } = this.withParent(path)
      if (!parent || !node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
      if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
      parent.children?.delete(name.toLowerCase())
      this.recycle.push({ originalPath: normalized, node })
    }
  }

  async remove(paths: string[]): Promise<void> {
    for (const path of paths) {
      const { parent, node, name, normalized } = this.withParent(path)
      if (!parent || !node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
      if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
      parent.children?.delete(name.toLowerCase())
    }
  }

  async readText(path: string, maxBytes: number): Promise<TextFileContent> {
    const { node, normalized } = this.nodeAt(path)
    if (!node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    if (node.type === 'directory') {
      throw new ExplorerError('EISDIR', normalized, `EISDIR: ${normalized}`)
    }
    const buf = node.content ?? Buffer.alloc(0)
    if (buf.subarray(0, 8000).includes(0)) {
      throw new ExplorerError('BINARY', normalized, `Not a text file: ${normalized}`)
    }
    const sizeBytes = buf.length
    const truncated = sizeBytes > maxBytes
    return {
      content: buf.subarray(0, Math.min(sizeBytes, maxBytes)).toString('utf8'),
      encoding: 'utf-8',
      truncated,
      sizeBytes,
      writable: node.writable
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    const { parent, node, name, normalized } = this.withParent(path)
    if (node) {
      if (node.type === 'directory') {
        throw new ExplorerError('EISDIR', normalized, `EISDIR: ${normalized}`)
      }
      if (!node.writable || (parent !== null && !parent.writable)) {
        throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
      }
      node.content = Buffer.from(content, 'utf8')
      node.mtime = FIXTURE_NEW_MTIME
      return
    }
    if (!parent) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
    const created = this.file(name, content)
    created.mtime = FIXTURE_NEW_MTIME
    this.attach(parent, created)
  }

  async search(path: string, query: string): Promise<FileEntry[]> {
    const needle = query.trim().toLowerCase()
    if (!needle || path === WINDOWS_ROOT) return []
    const { node, normalized } = this.requireDir(path)
    const results: FileEntry[] = []
    const walk = (base: string, dir: WinNode, depth: number): void => {
      if (results.length >= 200 || depth > 4 || !dir.children) return
      for (const child of dir.children.values()) {
        if (results.length >= 200) return
        const childPath = this.join(base, child.name)
        if (child.name.toLowerCase().includes(needle)) results.push(this.entry(childPath, child))
        if (child.type === 'directory') walk(childPath, child, depth + 1)
      }
    }
    walk(normalized, node, 1)
    return results
  }

  async cancelOp(_opId: string): Promise<void> {
    // Fixture operations complete synchronously, so there is never anything to cancel.
  }

  onProgress(cb: (p: FileOpProgress) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}

export function createFixtureWindowsFs(): WindowsFs {
  return new FixtureWindowsFs()
}
