/**
 * Deterministic in-memory WindowsFs for WSLPAD_FIXTURE_MODE=1 (goal.md §18.4).
 * Two drives, a user profile with a hidden file, a binary download, a
 * read-only C:\Windows\System32 and one NTFS junction (D:\Library\Media ->
 * D:\Media). Every timestamp is a fixed ISO stamp and every opId is a
 * counter, so repeated runs are byte-identical (no Date.now anywhere).
 */
import { WINDOWS_ROOT } from '@shared/constants'
import type {
  FileEntry,
  FileEntryType,
  DirSizeResult,
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

/** Junction chains longer than this resolve to nothing, like a dangling link. */
const MAX_JUNCTION_HOPS = 8

function isInside(child: string, parent: string): boolean {
  const normalizedChild = child.toLowerCase()
  const normalizedParent = parent.toLowerCase()
  const prefix = normalizedParent.endsWith('\\') ? normalizedParent : `${normalizedParent}\\`
  return normalizedChild === normalizedParent || normalizedChild.startsWith(prefix)
}

interface WinNode {
  name: string
  /** A junction names a directory elsewhere and has no children of its own. */
  type: 'file' | 'directory' | 'junction'
  content: Buffer | null
  children: Map<string, WinNode> | null
  /** Junction target as an absolute Windows path; null for anything else. */
  target: string | null
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
    const library = this.attach(d, this.dir('Library'))
    this.attach(library, this.file('playlist.m3u', '#EXTM3U\n'))
    this.attach(library, this.junction('Media', 'D:\\Media'))
  }

  // --- tree construction ---------------------------------------------------

  private dir(name: string, writable = true): WinNode {
    return {
      name,
      type: 'directory',
      content: null,
      children: new Map(),
      target: null,
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
      target: null,
      mtime: FIXTURE_SEED_MTIME,
      writable,
      inode: ++this.inodeCounter
    }
  }

  private junction(name: string, target: string): WinNode {
    return {
      name,
      type: 'junction',
      content: null,
      children: null,
      target,
      mtime: FIXTURE_SEED_MTIME,
      writable: true,
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
      target: node.target,
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

  /**
   * Junctions part-way along the path are always crossed, as Windows does. The
   * last name is only resolved with `follow` — stat() describes the link itself.
   */
  private nodeAt(path: string, follow = false, hops = 0): { node: WinNode | null; normalized: string } {
    const { drive, segments } = this.parse(path)
    let node: WinNode | null = this.drives.get(drive) ?? null
    for (const segment of segments) {
      node = this.resolve(node, hops)
      if (!node || node.type !== 'directory' || !node.children) return { node: null, normalized: formatPath(drive, segments) }
      node = node.children.get(segment.toLowerCase()) ?? null
    }
    return { node: follow ? this.resolve(node, hops) : node, normalized: formatPath(drive, segments) }
  }

  /** What a junction points at; null when it dangles or chains too deep. */
  private resolve(node: WinNode | null, hops = 0): WinNode | null {
    if (node?.type !== 'junction') return node
    if (node.target === null || hops >= MAX_JUNCTION_HOPS) return null
    try {
      return this.resolve(this.nodeAt(node.target, false, hops + 1).node, hops + 1)
    } catch {
      return null
    }
  }

  private withParent(path: string): { parent: WinNode | null; node: WinNode | null; name: string; normalized: string } {
    const { drive, segments } = this.parse(path)
    const normalized = formatPath(drive, segments)
    if (segments.length === 0) {
      return { parent: null, node: this.drives.get(drive) ?? null, name: `${drive}:`, normalized }
    }
    const parentPath = formatPath(drive, segments.slice(0, -1))
    const name = segments[segments.length - 1]
    const parent = this.nodeAt(parentPath, true).node
    return {
      parent: parent?.type === 'directory' ? parent : null,
      node: parent?.children?.get(name.toLowerCase()) ?? null,
      name,
      normalized
    }
  }

  /**
   * Same contract as normalizeBatch in WindowsFs: every path is parsed and
   * checked before the first one is touched, so a drive root or unparseable
   * path refuses the whole batch instead of leaving the items in front of it
   * already gone, and a path given twice is handled once rather than failing
   * the second time with a false ENOENT/EEXIST. Windows names are
   * case-insensitive, so "notes.txt" and "NOTES.TXT" are the same path; the
   * first spelling given is the one kept.
   */
  private normalizeBatch(paths: readonly string[], refusal: string): string[] {
    const unique = new Map<string, string>()
    for (const path of paths) {
      const { drive, segments } = this.parse(path)
      const formatted = formatPath(drive, segments)
      const key = formatted.toLowerCase()
      if (!unique.has(key)) unique.set(key, formatted)
    }
    const normalized = [...unique.values()]
    for (const p of normalized) {
      // formatPath only ends in a separator for a drive root ("C:\").
      if (p.endsWith('\\')) throw new ExplorerError('UNKNOWN', p, `${refusal} ${p}`)
    }
    return normalized
  }

  /**
   * Every target is resolved and checked before the first one is touched, so a
   * missing or read-only item anywhere in the batch refuses the whole batch
   * instead of leaving the items in front of it already gone. An item that a
   * selected real directory takes with it, or that a second path reaches
   * through a junction, is dropped rather than failing with a false ENOENT. A
   * junction only unlinks its own name, so items picked through it still go.
   */
  private mutationTargets(paths: readonly string[], verb: 'trash' | 'remove') {
    const targets = this.normalizeBatch(paths, `Refusing to ${verb}`).map((path) => {
      const { parent, node, name, normalized } = this.withParent(path)
      if (!parent || !node) {
        throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
      }
      if (!parent.writable) {
        throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
      }
      return { parent, node, name, normalized }
    })

    return targets.filter(
      (target, index) =>
        targets.findIndex((other) => other.node === target.node) === index &&
        !targets.some((other) => other.node.type === 'directory' && this.holds(other.node, target.node))
    )
  }

  /** Whether `node` sits somewhere below `dir` without crossing a junction. */
  private holds(dir: WinNode, node: WinNode): boolean {
    for (const child of dir.children?.values() ?? []) {
      if (child === node || (child.type === 'directory' && this.holds(child, node))) return true
    }
    return false
  }

  private requireDir(path: string): { node: WinNode; normalized: string } {
    const { node, normalized } = this.nodeAt(path, true)
    if (!node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    if (node.type !== 'directory') {
      throw new ExplorerError('ENOTDIR', normalized, `ENOTDIR: ${normalized}`)
    }
    return { node, normalized }
  }

  /**
   * Bytes held by a node and everything below it. A junction counts for
   * nothing, so a link back up the tree is never walked.
   */
  private sizeOf(node: WinNode): number {
    if (node.type === 'junction') return 0
    if (node.type === 'file') return node.content?.length ?? 0
    let sum = 0
    for (const child of node.children?.values() ?? []) sum += this.sizeOf(child)
    return sum
  }

  private join(base: string, name: string): string {
    return base.endsWith('\\') ? base + name : `${base}\\${name}`
  }

  private entry(path: string, node: WinNode): FileEntry {
    const type: FileEntryType = node.type === 'junction' ? 'symlink' : node.type
    const target = node.type === 'junction' ? this.resolve(node) : null
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
      symlinkTarget: node.target,
      targetType: target?.type === 'directory' ? 'directory' : target?.type === 'file' ? 'file' : null
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
    return entries.filter((e) => e.type === 'directory' || (e.type === 'symlink' && e.targetType === 'directory'))
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
    // Existence first: a drive root has a node but no parent, and is EEXIST
    // like WindowsFs reports it, not a false ENOENT.
    if (node) throw new ExplorerError('EEXIST', normalized, `EEXIST: ${normalized}`)
    if (!parent) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
    const created = type === 'directory' ? this.dir(name) : this.file(name, '')
    created.mtime = FIXTURE_NEW_MTIME
    this.attach(parent, created)
  }

  async rename(path: string, newName: string): Promise<void> {
    const { parent, node, name, normalized } = this.withParent(path)
    // formatPath only ends in a separator for a drive root ("C:\"); refused
    // before the new name is judged, in the same order as WindowsFs.
    if (normalized.endsWith('\\')) {
      throw new ExplorerError('UNKNOWN', normalized, `Refusing to rename drive root ${normalized}`)
    }
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
    const kind = move ? 'move' : 'copy'
    const srcs = this.normalizeBatch(sources, `Refusing to ${kind} drive root`)
    const { node: dest, normalized: destPath } = this.requireDir(destDir)
    if (!dest.writable) throw new ExplorerError('EACCES', destPath, `EACCES: ${destPath}`)
    for (const source of srcs) {
      if (isInside(destPath, source)) {
        throw new ExplorerError('UNKNOWN', source, `Cannot ${kind} ${source} into itself`)
      }
    }
    const opId = `fixture-win-op-${++this.opCounter}`
    const totalItems = srcs.length
    let doneItems = 0
    // Sized up front, directories recursively, so the first event already
    // carries the whole batch and doneBytes only grows as items complete.
    const sizes = srcs.map((source) => {
      const { node } = this.withParent(source)
      return node ? this.sizeOf(node) : 0
    })
    const totalBytes = sizes.reduce((sum, size) => sum + size, 0)
    let doneBytes = 0
    const errors: string[] = []
    const emit = (status: FileOpStatus, currentItem: string | null, error: string | null = null) =>
      this.emit({
        opId,
        kind,
        status,
        totalItems,
        doneItems,
        totalBytes,
        doneBytes,
        currentItem,
        error
      })
    for (const [index, source] of srcs.entries()) {
      const { parent, node, name, normalized } = this.withParent(source)
      try {
        if (!parent || !node) throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
        if (dest.children?.has(name.toLowerCase())) {
          const conflict = this.join(destPath, name)
          throw new ExplorerError('EEXIST', conflict, `EEXIST: ${conflict}`)
        }
        if (move) {
          if (!parent.writable) throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
          parent.children?.delete(name.toLowerCase())
          node.mtime = FIXTURE_NEW_MTIME
          this.attach(dest, node)
        } else {
          this.attach(dest, this.clone(node))
        }
        doneBytes += sizes[index]
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
    for (const { parent, node, name, normalized } of this.mutationTargets(paths, 'trash')) {
      parent.children?.delete(name.toLowerCase())
      this.recycle.push({ originalPath: normalized, node })
    }
  }

  async remove(paths: string[]): Promise<void> {
    for (const { parent, name } of this.mutationTargets(paths, 'remove')) {
      parent.children?.delete(name.toLowerCase())
    }
  }

  async readText(path: string, maxBytes: number): Promise<TextFileContent> {
    const { node, normalized } = this.nodeAt(path, true)
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
      // A junction is never overwritten as if it were a file.
      if (node.type !== 'file') {
        throw new ExplorerError('EISDIR', normalized, `EISDIR: ${normalized}`)
      }
      if (!node.writable || (parent !== null && !parent.writable)) {
        throw new ExplorerError('EACCES', normalized, `EACCES: ${normalized}`)
      }
      node.content = Buffer.from(content, 'utf8')
      node.mtime = FIXTURE_NEW_MTIME
      return
    }
    if (!parent) {
      // A file standing where the folder should be is ENOTDIR, as WindowsFs
      // reports it, not a missing folder.
      const { drive, segments } = this.parse(normalized)
      if (this.nodeAt(formatPath(drive, segments.slice(0, -1)), true).node) {
        throw new ExplorerError('ENOTDIR', normalized, `ENOTDIR: ${normalized}`)
      }
      throw new ExplorerError('ENOENT', normalized, `ENOENT: ${normalized}`)
    }
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

  async dirSizes(path: string, _token: string): Promise<DirSizeResult> {
    // "This PC" holds drives, not files — the same empty answer as WindowsFs.
    if (path === WINDOWS_ROOT) {
      return { path: WINDOWS_ROOT, entries: [], totalBytes: 0, skipped: 0, cancelled: false, error: null }
    }
    // requireDir follows a junction root, like stat() in WindowsFs; junctions
    // below it count for nothing, so a link back up the tree is never walked.
    const { node, normalized } = this.requireDir(path)
    const children = [...(node.children?.values() ?? [])].filter((child) => child.type !== 'junction')
    const entries = children.map((child) => {
      return {
        name: child.name,
        path: this.join(normalized, child.name),
        isDirectory: child.type === 'directory',
        sizeBytes: this.sizeOf(child),
        partial: false
      }
    }).sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || a.name.localeCompare(b.name))
    return { path: normalized, entries, totalBytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0), skipped: 0, cancelled: false, error: null }
  }

  async cancelDirSizes(_token: string): Promise<void> {
    // The deterministic fixture completes size walks synchronously.
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
