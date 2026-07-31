import { readFileSync } from 'fs'
import { join } from 'path'
import type { TerminalProfileInfo, TerminalProfilesInfo } from '@shared/types'

/**
 * Which distros Windows Terminal can actually open (issue #63).
 *
 * Windows Terminal generates a profile for every distro it knows about — but
 * only ones it saw at generation time, and only while `Windows.Terminal.Wsl`
 * generation stays enabled. Import a distro, disable the generator, or hide a
 * profile by accident, and the distro is simply missing from the dropdown with
 * nothing to explain it. Asked for repeatedly in the neighbouring GUIs.
 *
 * Read-only in the strongest sense: settings.json is the user's file and this
 * never writes it. A missing profile is offered as JSON to paste (goal.md
 * §2.2) — the whole file has to be edited by hand anyway, because writing it
 * while Windows Terminal is open would lose whatever it saves next.
 */

/**
 * Both generator ids seen in the wild. Windows Terminal used to generate WSL
 * profiles itself (`Windows.Terminal.Wsl`); on current builds the WSL app
 * supplies them and stamps `Microsoft.WSL` instead. Recognising only the older
 * one reports a distro that has a profile as having none — which is what this
 * block exists to detect, so getting it wrong is worse than not looking.
 */
const WSL_SOURCES = new Set(['Windows.Terminal.Wsl', 'Microsoft.WSL'])

/** Settings live in one of three places depending on how Terminal was installed. */
export function settingsCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const local = env.LOCALAPPDATA
  if (local === undefined || local === '') return []
  return [
    join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    join(
      local,
      'Packages',
      'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe',
      'LocalState',
      'settings.json'
    ),
    join(local, 'Microsoft', 'Windows Terminal', 'settings.json')
  ]
}

/**
 * Windows Terminal ships its settings with `//` comments and writes trailing
 * commas, so JSON.parse alone fails on a perfectly normal file. Strings are
 * tracked so a `//` inside a path — `"commandLine": "wsl.exe //?"` — is not
 * mistaken for a comment.
 */
export function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  // Trailing commas, once comments are gone and only outside strings.
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** `wsl.exe -d Ubuntu` / `--distribution "Ubuntu 24.04"` → the distro name. */
export function distroFromCommandLine(commandLine: string | null): string | null {
  if (commandLine === null) return null
  const match = /(?:^|\s)(?:-d|--distribution)\s+("[^"]+"|'[^']+'|\S+)/.exec(commandLine)
  if (match === null) return null
  const raw = match[1]
  const unquoted =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw
  return unquoted === '' ? null : unquoted
}

interface RawProfile {
  name?: unknown
  guid?: unknown
  source?: unknown
  hidden?: unknown
  commandLine?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export function parseTerminalSettings(text: string): {
  profiles: TerminalProfileInfo[]
  defaultProfile: string | null
} {
  const parsed: unknown = JSON.parse(stripJsonComments(text))
  const root = (parsed ?? {}) as Record<string, unknown>
  const defaultProfile = str(root.defaultProfile)

  // `profiles` is either a list or an object with `list` — both shapes ship.
  const profilesNode = root.profiles
  const list = Array.isArray(profilesNode)
    ? profilesNode
    : Array.isArray((profilesNode as Record<string, unknown> | undefined)?.list)
      ? ((profilesNode as Record<string, unknown>).list as unknown[])
      : []

  const profiles: TerminalProfileInfo[] = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const raw = entry as RawProfile
    const name = str(raw.name)
    if (name === null) continue
    const guid = str(raw.guid)
    const source = str(raw.source)
    const commandLine = str(raw.commandLine)
    profiles.push({
      name,
      guid,
      source,
      commandLine,
      // A generated WSL profile is named after its distro and carries no
      // command line; a hand-written one says which distro on the command.
      distro: source !== null && WSL_SOURCES.has(source) ? name : distroFromCommandLine(commandLine),
      hidden: raw.hidden === true,
      isDefault: guid !== null && guid === defaultProfile
    })
  }
  return { profiles, defaultProfile }
}

export interface TerminalProfilesCollector {
  /** Never rejects: an unreadable settings file becomes an info with a reason. */
  collect(): TerminalProfilesInfo
}

export interface TerminalProfilesCollectorOptions {
  candidates?: string[]
  readFile?: (path: string) => string
  ttlMs?: number
  now?: () => number
}

/** Edited by hand, at most a few times a year. One read serves a long while. */
const DEFAULT_TTL_MS = 120_000

export function createTerminalProfilesCollector(
  options: TerminalProfilesCollectorOptions = {}
): TerminalProfilesCollector {
  const candidates = options.candidates ?? settingsCandidates()
  const readFile = options.readFile ?? ((p: string) => readFileSync(p, 'utf8'))
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? Date.now
  let cached: { at: number; info: TerminalProfilesInfo } | null = null

  return {
    collect(): TerminalProfilesInfo {
      if (cached !== null && now() - cached.at < ttlMs) return cached.info

      let lastError: string | null = null
      for (const path of candidates) {
        let text: string
        try {
          text = readFile(path)
        } catch {
          // Not installed at this location; try the next one.
          continue
        }
        try {
          const { profiles, defaultProfile } = parseTerminalSettings(text)
          const info: TerminalProfilesInfo = {
            settingsPath: path,
            installed: true,
            profiles,
            defaultProfile,
            error: null
          }
          cached = { at: now(), info }
          return info
        } catch (err) {
          // The file is there but unreadable as JSON: that is a fact worth
          // reporting, not a reason to claim Terminal is not installed.
          lastError = `${path} could not be parsed: ${err instanceof Error ? err.message : String(err)}`
        }
      }

      const info: TerminalProfilesInfo =
        lastError === null
          ? {
              settingsPath: null,
              installed: false,
              profiles: [],
              defaultProfile: null,
              error: null
            }
          : {
              settingsPath: null,
              // The file exists, so Terminal is installed; what its profiles
              // are is what could not be determined.
              installed: true,
              profiles: [],
              defaultProfile: null,
              error: lastError.slice(0, 400)
            }
      cached = { at: now(), info }
      return info
    }
  }
}

/**
 * Whether this distro can be opened from Windows Terminal. `null` for every
 * answer that is really "we could not tell": no settings read, or a file that
 * would not parse.
 */
export function profileForDistro(
  info: TerminalProfilesInfo | null,
  distro: string
): TerminalProfileInfo | null {
  if (info === null || info.error !== null) return null
  return info.profiles.find((p) => p.distro === distro) ?? null
}
