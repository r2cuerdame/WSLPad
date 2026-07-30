import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { DiskImageInfo } from '@shared/types'
import type { DistroRunner } from './contracts'
import { parseDfP } from './resources'
import { runHostCommand, type HostCommandRunner } from './windows-ports'

/**
 * Where a distro really lives on the Windows disk (microsoft/WSL#4699). `df`
 * inside the distro reports the ext4 maximum, not the bytes ext4.vhdx occupies
 * on NTFS, and most users cannot even find the file. Everything here is a HOST
 * read: registry, file stat, fsutil. Nothing compacts or converts the image —
 * that stays a command the user runs themselves (goal.md §2.2).
 */

const LXSS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'
const REG_TIMEOUT_MS = 5000
const FSUTIL_TIMEOUT_MS = 8000
/** Only the local ext4 mount, so the fast timeout is enough (no /mnt/c stall). */
const DF_SCRIPT = 'df -P -B1 / 2>/dev/null || true'

/** `    BasePath    REG_SZ    C:\\…` — four spaces, but stay tolerant. */
const REG_VALUE_RE = /^\s+(\S.*?)\s{2,}REG_[A-Z_]+\s{2,}(.*)$/

export interface LxssEntry {
  distro: string
  basePath: string | null
  /** Image name WSL itself recorded; better than guessing a file name. */
  vhdFileName: string | null
  /** 1 for the WSL 1 layout (files straight on NTFS, no image at all). */
  version: number | null
}

/** `\\?\C:\dir` → `C:\dir`, `\\?\UNC\srv\s` → `\\srv\s`. */
export function stripExtendedPrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`
  return path.startsWith('\\\\?\\') ? path.slice(4) : path
}

function parseRegDword(text: string): number | null {
  const m = /^0x([0-9a-fA-F]+)$/.exec(text.trim())
  return m === null ? null : Number.parseInt(m[1], 16)
}

/**
 * Parse `reg.exe query <Lxss> /s` into one entry per distro subkey. Value
 * names and the REG_* type token are not localized; the data is read
 * positionally so a translated Windows parses identically.
 */
export function parseLxssRegistry(text: string): LxssEntry[] {
  const entries: LxssEntry[] = []
  let current: Partial<LxssEntry> | null = null

  const flush = (): void => {
    if (current === null) return
    const name = current.distro
    if (name === undefined || name === '') return
    entries.push({
      distro: name,
      basePath: current.basePath ?? null,
      vhdFileName: current.vhdFileName ?? null,
      version: current.version ?? null
    })
  }

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (/^HKEY_/i.test(line.trim())) {
      flush()
      current = {}
      continue
    }
    const m = REG_VALUE_RE.exec(line)
    if (m === null || current === null) continue
    const value = m[2].trim()
    switch (m[1].trim()) {
      case 'DistributionName':
        current.distro = value
        break
      case 'BasePath':
        current.basePath = value === '' ? null : stripExtendedPrefix(value)
        break
      case 'VhdFileName':
        current.vhdFileName = value === '' ? null : value
        break
      case 'Version':
        current.version = parseRegDword(value)
        break
      default:
        break
    }
  }
  flush()
  return entries
}

/** Distro names round-trip exactly, but wsl.exe treats them case-insensitively. */
export function findLxssEntry(entries: LxssEntry[], distro: string): LxssEntry | null {
  const exact = entries.find((e) => e.distro === distro)
  if (exact !== undefined) return exact
  const lower = distro.toLowerCase()
  return entries.find((e) => e.distro.toLowerCase() === lower) ?? null
}

/**
 * Sum `fsutil file queryAllocRanges` output. Each range line carries two hex
 * numbers, offset then length; only the second one is added. Reading them
 * positionally survives a localized "Allocated range" label. Returns null when
 * no range line was found at all — an unusable answer is never a zero.
 */
export function sumAllocatedRanges(text: string): number | null {
  let total = 0
  let found = false
  for (const line of text.split('\n')) {
    const hex = line.match(/0x[0-9a-fA-F]+/g)
    if (hex === null || hex.length < 2) continue
    const length = Number.parseInt(hex[hex.length - 1], 16)
    if (!Number.isSafeInteger(length) || length < 0) continue
    total += length
    found = true
  }
  return found ? total : null
}

/**
 * `fsutil sparse queryflag` answers "This file is (NOT) set as sparse". The
 * sentence is localized, so only the two English forms are trusted; anything
 * else stays unknown instead of turning a translated negative into a yes.
 */
export function parseSparseFlag(text: string): boolean | null {
  const answer = text.trim()
  if (answer === '') return null
  if (/\bnot\b/i.test(answer)) return false
  return /\bset\s+as\s+sparse\b/i.test(answer) ? true : null
}

/**
 * Windows space the image holds that Linux no longer uses. Only a strictly
 * positive difference is reported: a full or freshly compacted image has
 * nothing to reclaim, and ext4 metadata can push `used` above the image size.
 */
export function computeReclaimable(
  vhdxBytes: number | null,
  fsUsedBytes: number | null
): number | null {
  if (vhdxBytes === null || fsUsedBytes === null) return null
  const diff = vhdxBytes - fsUsedBytes
  return diff > 0 ? diff : null
}

export interface DiskHostAccess {
  run: HostCommandRunner
  /** Size in bytes, or null when the path is not a readable file. */
  fileSize(path: string): Promise<number | null>
  /** *.vhdx names in the folder, or null when it cannot be listed. */
  listImages(path: string): Promise<string[] | null>
}

const defaultAccess: DiskHostAccess = {
  run: runHostCommand,
  async fileSize(path: string): Promise<number | null> {
    try {
      const info = await stat(path)
      return info.isFile() ? info.size : null
    } catch {
      return null
    }
  },
  async listImages(path: string): Promise<string[] | null> {
    try {
      return (await readdir(path)).filter((name) => name.toLowerCase().endsWith('.vhdx'))
    } catch {
      return null
    }
  }
}

interface LocatedImage {
  path: string | null
  size: number | null
  error: string | null
}

export interface DiskCollector {
  /** Satisfies WslProvider.getDiskImage once bound to a runner. */
  collect(runner: DistroRunner, distro: string): Promise<DiskImageInfo>
}

export function createDiskCollector(access: Partial<DiskHostAccess> = {}): DiskCollector {
  const { run, fileSize, listImages } = { ...defaultAccess, ...access }

  const readRegistry = async (): Promise<LxssEntry[] | null> => {
    try {
      return parseLxssRegistry(await run('reg.exe', ['query', LXSS_KEY, '/s'], REG_TIMEOUT_MS))
    } catch {
      return null
    }
  }

  const readAllocated = async (path: string, size: number): Promise<number | null> => {
    // The subcommand is queryAllocRanges and it refuses to run without both
    // bounds; length is the logical size, so the whole file is covered.
    const args = ['file', 'queryAllocRanges', 'offset=0', `length=${size}`, path]
    try {
      return sumAllocatedRanges(await run('fsutil', args, FSUTIL_TIMEOUT_MS))
    } catch {
      return null
    }
  }

  const readSparse = async (path: string): Promise<boolean | null> => {
    try {
      return parseSparseFlag(await run('fsutil', ['sparse', 'queryflag', path], FSUTIL_TIMEOUT_MS))
    } catch {
      return null
    }
  }

  const readUsage = async (
    runner: DistroRunner,
    distro: string
  ): Promise<{ totalBytes: number; usedBytes: number } | null> => {
    try {
      const res = await runner.runInDistro(distro, DF_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
      const row = parseDfP(res.stdout).find((r) => r.mountedOn === '/')
      return row === undefined ? null : { totalBytes: row.totalBytes, usedBytes: row.usedBytes }
    } catch {
      // A stopped distro still has a readable image on the Windows side.
      return null
    }
  }

  /** Registry name first, then the ext4.vhdx convention, then a lone *.vhdx. */
  const locateImage = async (base: string, declared: string | null): Promise<LocatedImage> => {
    for (const name of [declared, 'ext4.vhdx']) {
      if (name === null) continue
      const path = join(base, name)
      const size = await fileSize(path)
      if (size !== null) return { path, size, error: null }
    }
    const images = await listImages(base)
    if (images === null) {
      return { path: null, size: null, error: 'The distribution folder could not be read' }
    }
    if (images.length !== 1) {
      const error =
        images.length === 0
          ? 'No .vhdx image in the distribution folder'
          : 'Several .vhdx images in the distribution folder'
      return { path: null, size: null, error }
    }
    const path = join(base, images[0])
    const size = await fileSize(path)
    return { path, size, error: size === null ? 'The image file could not be read' : null }
  }

  return {
    async collect(runner: DistroRunner, distro: string): Promise<DiskImageInfo> {
      const notes: string[] = []
      const [entries, usage] = await Promise.all([readRegistry(), readUsage(runner, distro)])
      const fsSizeBytes = usage?.totalBytes ?? null
      const fsUsedBytes = usage?.usedBytes ?? null
      if (usage === null) notes.push('In-distro usage is unknown (df did not answer)')

      const errorText = (primary: string | null): string | null => {
        const parts = primary === null ? notes : [primary, ...notes]
        return parts.length === 0 ? null : parts.join('; ')
      }

      const info = (over: Partial<DiskImageInfo>, primary: string | null): DiskImageInfo => ({
        distro,
        vhdxPath: null,
        basePath: null,
        vhdxBytes: null,
        allocatedBytes: null,
        sparse: null,
        fsSizeBytes,
        fsUsedBytes,
        reclaimableBytes: null,
        ...over,
        error: errorText(primary)
      })

      if (entries === null) return info({}, 'The WSL registry entries could not be read')
      const entry = findLxssEntry(entries, distro)
      if (entry === null) return info({}, `No registry entry for ${distro}`)
      const basePath = entry.basePath
      if (basePath === null) return info({}, 'The registry entry carries no install folder')
      if (entry.version === 1) {
        return info({ basePath }, 'WSL 1 distributions do not use a virtual disk image')
      }

      const image = await locateImage(basePath, entry.vhdFileName)
      if (image.path === null || image.size === null) {
        return info({ basePath, vhdxPath: image.path }, image.error)
      }

      const [allocatedBytes, sparse] = await Promise.all([
        readAllocated(image.path, image.size),
        readSparse(image.path)
      ])
      if (allocatedBytes === null) notes.push('Size on disk is unknown (fsutil did not answer)')
      if (sparse === null) notes.push('Sparse flag is unknown (fsutil did not answer)')

      return info(
        {
          basePath,
          vhdxPath: image.path,
          vhdxBytes: image.size,
          allocatedBytes,
          sparse,
          reclaimableBytes: computeReclaimable(image.size, fsUsedBytes)
        },
        null
      )
    }
  }
}
