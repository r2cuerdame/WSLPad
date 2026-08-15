/**
 * Whether Microsoft Defender is scanning the distro image (goal.md §6.2.2).
 *
 * Real-time protection reads every block of ext4.vhdx that WSL touches, and it
 * is the most common reason a WSL filesystem feels slow for no visible reason.
 * Nothing in WSL or in the Defender UI connects the two.
 *
 * The trap this collector exists to avoid: `Get-MpPreference` run without
 * elevation does not fail and does not return an empty list — it returns the
 * literal string "N/A: Must be an administrator to view exclusions" in place of
 * every exclusion. Parsed naively that reads as "one exclusion, and it does not
 * cover you", i.e. a confident wrong answer on every non-elevated machine. So
 * elevation is checked structurally first, and the list stays null unless it
 * was genuinely readable (goal.md §2.4: unknown, never empty).
 *
 * Read-only. Adding an exclusion needs an elevated PowerShell, which this app
 * cannot and must not obtain; the command is offered as text to copy.
 */
import type { DefenderInfo } from '@shared/types'
import { runHostCommand, type HostCommandRunner } from './windows-ports'

const TIMEOUT_MS = 12000

/**
 * IsInRole is a fact about the token, not a string to match, so it survives a
 * localized Windows. Get-MpComputerStatus answers without elevation; the
 * exclusion list only comes back when the token really is elevated.
 */
export const DEFENDER_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$id = [Security.Principal.WindowsIdentity]::GetCurrent()',
  '$admin = ([Security.Principal.WindowsPrincipal]$id).IsInRole(',
  '  [Security.Principal.WindowsBuiltInRole]::Administrator)',
  '$status = $null',
  'try { $status = Get-MpComputerStatus } catch { }',
  '$paths = $null',
  'if ($admin) { try { $paths = @((Get-MpPreference).ExclusionPath) } catch { } }',
  '[pscustomobject]@{',
  '  available = [bool]$status',
  '  elevated = $admin',
  '  realtime = $(if ($status) { [bool]$status.RealTimeProtectionEnabled } else { $null })',
  '  paths = $(if ($null -ne $paths) { @($paths | Where-Object { $_ }) } else { $null })',
  '} | ConvertTo-Json -Compress'
].join('; ')

interface RawDefender {
  available?: unknown
  elevated?: unknown
  realtime?: unknown
  paths?: unknown
}

export function parseDefender(stdout: string): DefenderInfo | null {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let raw: RawDefender
  try {
    raw = JSON.parse(stdout.slice(start, end + 1)) as RawDefender
  } catch {
    return null
  }
  const elevated = raw.elevated === true
  // ConvertTo-Json collapses a one-element array to a scalar, so accept both.
  const list = Array.isArray(raw.paths)
    ? raw.paths
    : typeof raw.paths === 'string'
      ? [raw.paths]
      : null
  return {
    available: raw.available === true,
    elevated,
    realtimeEnabled: typeof raw.realtime === 'boolean' ? raw.realtime : null,
    // Without elevation the list is a placeholder, never data. Refusing it here
    // is the whole point: no exclusion list is unknown, not "none configured".
    exclusionPaths:
      elevated && list !== null ? list.filter((p): p is string => typeof p === 'string') : null
  }
}

export async function collectDefender(
  run: HostCommandRunner = runHostCommand
): Promise<DefenderInfo | null> {
  try {
    const out = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', DEFENDER_SCRIPT],
      TIMEOUT_MS
    )
    return parseDefender(out)
  } catch {
    // No Defender, no PowerShell, policy-blocked — all of them mean unknown.
    return null
  }
}
