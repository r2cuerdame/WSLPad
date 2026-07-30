import { RUNNER_TIMEOUT_MS } from '@shared/constants'
import type { SystemInfo } from '@shared/types'
import { WslNotAvailableError, type DistroRunner } from './contracts'

/** Section separator emitted between the outputs of the single system script. */
export const SECTION_MARKER = '===WSLPAD==='

export interface SystemCollectResult {
  system: SystemInfo
  /** /etc/os-release PRETTY_NAME, consumed by DistroDetails.osName */
  osName: string | null
}

// One round-trip into the distro: each probe is separated by a marker line so a
// single failing probe cannot corrupt the neighbours. cmd.exe interop is
// deliberately avoided (it is slow and may be disabled); the Windows profile is
// guessed from /mnt/c/Users instead.
const SYSTEM_SCRIPT = [
  'uname -r 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'hostname 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'id -un 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'printf %s\\\\n "$HOME"',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'getent passwd "$(id -un 2>/dev/null)" 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'cat /proc/uptime 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'if [ -d /run/systemd/system ]; then echo yes; else echo no; fi',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'hostname -I 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'cat /etc/os-release 2>/dev/null || true',
  `printf '\\n${SECTION_MARKER}\\n'`,
  'for d in /mnt/c/Users/*/; do [ -d "$d" ] || continue; b=${d%/}; b=${b##*/}; ' +
    "case \"$b\" in Public|Default*|'All Users') ;; *) " +
    'printf %s\\\\n "/mnt/c/Users/$b"; break ;; esac; done'
].join('\n')

/** Split marker-separated script output into raw sections. */
export function splitSections(text: string): string[] {
  const sections: string[] = []
  let current: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === SECTION_MARKER) {
      sections.push(current.join('\n'))
      current = []
    } else {
      current.push(line)
    }
  }
  sections.push(current.join('\n'))
  return sections
}

function firstLine(section: string | undefined): string | null {
  if (section === undefined) return null
  for (const line of section.split('\n')) {
    const t = line.trim()
    if (t) return t
  }
  return null
}

/** Parse /etc/os-release style KEY=value lines into a map, unquoting values. */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value.replace(/\\(["'\\$`])/g, '$1')
  }
  return out
}

function emptySystemInfo(): SystemInfo {
  return {
    kernel: null,
    hostname: null,
    user: null,
    home: null,
    shell: null,
    uptimeSeconds: null,
    systemdEnabled: null,
    ip: null,
    windowsUserProfileLinux: null
  }
}

/** Parse the marker-separated SYSTEM_SCRIPT output into SystemInfo + osName. */
export function parseSystemInfo(text: string): SystemCollectResult {
  const s = splitSections(text)
  const kernel = firstLine(s[0])
  const hostname = firstLine(s[1])
  const user = firstLine(s[2])
  const homeLine = firstLine(s[3])
  const passwdLine = firstLine(s[4])
  const uptimeLine = firstLine(s[5])
  const systemdLine = firstLine(s[6])
  const ipLine = firstLine(s[7])
  const osRelease = parseOsRelease(s[8] ?? '')
  const profileLine = firstLine(s[9])

  let home = homeLine !== null && homeLine.startsWith('/') ? homeLine : null
  let shell: string | null = null
  if (passwdLine !== null) {
    const fields = passwdLine.split(':')
    if (fields.length >= 7 && fields[6].startsWith('/')) shell = fields[6]
    if (home === null && fields.length >= 6 && fields[5].startsWith('/')) home = fields[5]
  }

  let uptimeSeconds: number | null = null
  if (uptimeLine !== null) {
    const v = Number.parseFloat(uptimeLine.split(/\s+/)[0])
    if (Number.isFinite(v) && v >= 0) uptimeSeconds = Math.floor(v)
  }

  const systemdEnabled = systemdLine === 'yes' ? true : systemdLine === 'no' ? false : null

  let ip: string | null = null
  if (ipLine !== null) {
    const token = ipLine.split(/\s+/)[0]
    const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(token)
    const isV6 = /^[0-9A-Fa-f:]+$/.test(token) && token.includes(':')
    if (isV4 || isV6) ip = token
  }

  const windowsUserProfileLinux =
    profileLine !== null && profileLine.startsWith('/mnt/') ? profileLine : null

  return {
    system: {
      kernel,
      hostname,
      user,
      home,
      shell,
      uptimeSeconds,
      systemdEnabled,
      ip,
      windowsUserProfileLinux
    },
    osName: osRelease['PRETTY_NAME'] ?? null
  }
}

export async function collectSystemInfo(
  runner: DistroRunner,
  distro: string
): Promise<SystemCollectResult> {
  try {
    const res = await runner.runInDistro(distro, SYSTEM_SCRIPT, { timeoutMs: RUNNER_TIMEOUT_MS })
    return parseSystemInfo(res.stdout)
  } catch (err) {
    if (err instanceof WslNotAvailableError) throw err
    return { system: emptySystemInfo(), osName: null }
  }
}
