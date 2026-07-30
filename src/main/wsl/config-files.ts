import { accessSync, constants as fsConstants, existsSync } from 'fs'
import { CONFIG_FILE_SPECS, RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { ConfigurationFileInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'
import { assertValidDistroName, shellQuote } from './escape'
import { linuxPathToUnc } from './paths'

function pathExpr(specPath: string): string {
  if (specPath === '~') return '"$HOME"'
  if (specPath.startsWith('~/')) return '"$HOME"' + shellQuote(specPath.slice(1))
  return shellQuote(specPath)
}

export function buildConfigFilesScript(): string {
  return CONFIG_FILE_SPECS.filter((spec) => spec.scope === 'linux')
    .map(
      (spec) =>
        'p=' +
        pathExpr(spec.path) +
        '; e=0; r=0; w=0; ' +
        '[ -e "$p" ] && e=1; [ -r "$p" ] && r=1; [ -w "$p" ] && w=1; ' +
        "printf '%s|%s|%s|%s|%s\\n' " +
        shellQuote(spec.id) +
        ' "$p" "$e" "$r" "$w"'
    )
    .join('\n')
}

export interface ParsedConfigLine {
  id: string
  linuxPath: string
  exists: boolean
  readable: boolean
  writable: boolean
}

/** Parse `id|path|exists|readable|writable` lines emitted by the config script. */
export function parseConfigFiles(text: string): ParsedConfigLine[] {
  const out: ParsedConfigLine[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split('|')
    if (parts.length < 5) continue
    const id = parts[0]
    const writable = parts[parts.length - 1]
    const readable = parts[parts.length - 2]
    const exists = parts[parts.length - 3]
    const linuxPath = parts.slice(1, parts.length - 3).join('|')
    if (!id || !linuxPath.startsWith('/')) continue
    if (!/^[01]$/.test(exists) || !/^[01]$/.test(readable) || !/^[01]$/.test(writable)) continue
    out.push({
      id,
      linuxPath,
      exists: exists === '1',
      readable: readable === '1',
      writable: writable === '1'
    })
  }
  return out
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode)
    return true
  } catch {
    return false
  }
}

/** The Windows-side .wslconfig entry is resolved with node fs, not the runner. */
function windowsConfigInfo(spec: { id: string; label: string }): ConfigurationFileInfo {
  const profile = process.env.USERPROFILE
  if (profile === undefined || profile.length === 0) {
    return {
      id: spec.id,
      label: spec.label,
      scope: 'windows',
      linuxPath: null,
      windowsPath: null,
      exists: null,
      readable: null,
      writable: null
    }
  }
  const windowsPath = profile.replace(/[\\/]+$/, '') + '\\.wslconfig'
  const exists = existsSync(windowsPath)
  return {
    id: spec.id,
    label: spec.label,
    scope: 'windows',
    linuxPath: null,
    windowsPath,
    exists,
    readable: exists && canAccess(windowsPath, fsConstants.R_OK),
    writable: exists && canAccess(windowsPath, fsConstants.W_OK)
  }
}

function linuxConfigInfo(
  spec: { id: string; label: string; path: string },
  parsed: ParsedConfigLine | undefined,
  distro: string
): ConfigurationFileInfo {
  if (parsed !== undefined) {
    return {
      id: spec.id,
      label: spec.label,
      scope: 'linux',
      linuxPath: parsed.linuxPath,
      windowsPath: linuxPathToUnc(distro, parsed.linuxPath),
      exists: parsed.exists,
      readable: parsed.readable,
      writable: parsed.writable
    }
  }
  // Script failed: home-relative paths cannot be resolved, absolute ones can.
  const linuxPath = spec.path.startsWith('~') ? null : spec.path
  return {
    id: spec.id,
    label: spec.label,
    scope: 'linux',
    linuxPath,
    windowsPath: linuxPath === null ? null : linuxPathToUnc(distro, linuxPath),
    exists: null,
    readable: null,
    writable: null
  }
}

export async function collectConfigFiles(
  runner: DistroRunner,
  distro: string
): Promise<ConfigurationFileInfo[]> {
  assertValidDistroName(distro)
  let parsed = new Map<string, ParsedConfigLine>()
  try {
    const res = await runner.runInDistro(distro, buildConfigFilesScript(), {
      timeoutMs: RUNNER_TIMEOUT_MS
    })
    parsed = new Map(parseConfigFiles(res.stdout).map((line) => [line.id, line]))
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
  }
  return CONFIG_FILE_SPECS.map((spec) =>
    spec.scope === 'windows'
      ? windowsConfigInfo(spec)
      : linuxConfigInfo(spec, parsed.get(spec.id), distro)
  )
}
