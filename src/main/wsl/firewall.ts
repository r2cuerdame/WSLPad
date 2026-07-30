import type { FirewallInfo } from '@shared/types'
import { runHostCommand, type HostCommandRunner } from './windows-ports'

/**
 * The firewall layer WSL traffic really crosses (issue #25). Packets to and
 * from the WSL virtual machine are filtered by a Hyper-V firewall that the
 * Windows Defender Firewall UI never shows: it is on by default, it blocks
 * inbound by default, and it is the usual reason a listener that both Linux
 * and Windows report is still refused from another machine.
 *
 * Everything here is a HOST read and strictly read-only: WSLPad never creates
 * a rule, never opens a port and never changes a default action (goal.md §2.2).
 */

/** WSL's VM creator id — the same fixed GUID on every machine. */
export const WSL_VM_CREATOR_ID = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'

const POWERSHELL = 'powershell.exe'
const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

/** One PowerShell start costs the better part of a second; bound it hard. */
const FIREWALL_TIMEOUT_MS = 8000

/**
 * Firewall policy is edited by hand, never by the second, while every read
 * pays that full PowerShell start. Each answer — readable or not — is reused
 * for this long so the 15 s medium tier does not spawn four shells a minute.
 */
const DEFAULT_TTL_MS = 60000

/**
 * The Hyper-V firewall does not exist before Windows 11 22H2 with a recent WSL.
 * The script emits this itself so the common "older build" case arrives as
 * plain English, and — the point of the whole file — as unknown rather than
 * as an absent firewall that would read like "nothing is being blocked".
 */
export const NO_HYPERV_LAYER =
  'The Hyper-V firewall cmdlets are missing on this Windows build, so this layer could not be read'

/** Output that parsed to nothing at all; still unknown, never "not blocking". */
export const UNREADABLE = 'The Hyper-V firewall answered nothing that could be read'

/**
 * Six positional lines: enabled, inbound, outbound, loopback, rule count and
 * an error. Values are .NET enum names and a plain count, so nothing here is
 * localized; no table is formatted and no header is printed, which is what
 * makes a translated Windows produce byte-identical output.
 */
const SCRIPT = [
  `$id='${WSL_VM_CREATOR_ID}'`,
  "$o=@('','','','','','')",
  '$c=Get-Command Get-NetFirewallHyperVVMSetting -ErrorAction SilentlyContinue',
  `if($null -eq $c){$o[5]='${NO_HYPERV_LAYER}'}`,
  'if($null -ne $c){try{' +
    '$s=Get-NetFirewallHyperVVMSetting -PolicyStore ActiveStore -Name $id -ErrorAction Stop;' +
    '$o[0]=[string]$s.Enabled;' +
    '$o[1]=[string]$s.DefaultInboundAction;' +
    '$o[2]=[string]$s.DefaultOutboundAction;' +
    '$o[3]=[string]$s.LoopbackEnabled' +
    "}catch{$o[5]=($_.Exception.Message -replace '\\s+',' ')}}",
  '$r=Get-Command Get-NetFirewallHyperVRule -ErrorAction SilentlyContinue',
  'if($null -ne $r){$o[4]=[string]@(' +
    'Get-NetFirewallHyperVRule -VMCreatorId $id -ErrorAction SilentlyContinue' +
    ').Count}',
  '$o -join [char]10'
].join('\n')

/** 'True' / 'False' from a .NET enum; NotConfigured and blanks stay unknown. */
function parseBool(text: string): boolean | null {
  const value = text.trim().toLowerCase()
  if (value === 'true') return true
  return value === 'false' ? false : null
}

/** Actions are surfaced verbatim ("Block", "Allow", "NotConfigured"). */
function parseAction(text: string): string | null {
  const value = text.trim()
  return value === '' ? null : value
}

function parseCount(text: string): number | null {
  const value = text.trim()
  if (!/^\d+$/.test(value)) return null
  const count = Number.parseInt(value, 10)
  return Number.isSafeInteger(count) ? count : null
}

/** Every field unknown, with the reason attached — the only failure shape. */
export function unknownFirewall(error: string): FirewallInfo {
  return {
    enabled: null,
    defaultInbound: null,
    defaultOutbound: null,
    loopbackEnabled: null,
    ruleCount: null,
    error
  }
}

/**
 * Parse the six positional lines. Anything unparseable degrades to null on its
 * own field: an unreadable rule count must never turn a known Block into an
 * Allow, and an output that carried no field at all is a failed read, not a
 * firewall with nothing configured.
 */
export function parseFirewallOutput(text: string): FirewallInfo {
  const lines = text.replace(/\r/g, '').split('\n')
  const at = (index: number): string => lines[index] ?? ''
  // The message is flattened by the script, but a stray line cannot be lost.
  const error = lines.slice(5).join(' ').trim()
  const info: FirewallInfo = {
    enabled: parseBool(at(0)),
    defaultInbound: parseAction(at(1)),
    defaultOutbound: parseAction(at(2)),
    loopbackEnabled: parseBool(at(3)),
    ruleCount: parseCount(at(4)),
    error: error === '' ? null : error
  }
  const nothingRead =
    info.enabled === null &&
    info.defaultInbound === null &&
    info.defaultOutbound === null &&
    info.loopbackEnabled === null &&
    info.ruleCount === null
  if (nothingRead && info.error === null) return unknownFirewall(UNREADABLE)
  return info
}

export interface FirewallCollector {
  /** Never rejects: an unreadable firewall is a FirewallInfo full of nulls. */
  collect(): Promise<FirewallInfo>
}

export interface FirewallCollectorOptions {
  /** Windows console tool runner; the real spawn by default. */
  run?: HostCommandRunner
  ttlMs?: number
  now?: () => number
}

export function createFirewallCollector(options: FirewallCollectorOptions = {}): FirewallCollector {
  const run = options.run ?? runHostCommand
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? Date.now
  let cached: FirewallInfo | null = null
  let cachedAt = 0
  let inFlight: Promise<FirewallInfo> | null = null

  const read = async (): Promise<FirewallInfo> => {
    try {
      const args = [...POWERSHELL_ARGS, SCRIPT]
      return parseFirewallOutput(await run(POWERSHELL, args, FIREWALL_TIMEOUT_MS))
    } catch (err) {
      // A spawn failure or a timeout is still an answer: state unknown.
      return unknownFirewall(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    async collect(): Promise<FirewallInfo> {
      if (cached !== null && now() - cachedAt < ttlMs) return cached
      // Overlapping tiers must never start two shells for the same answer.
      if (inFlight !== null) return inFlight
      const pending = read()
      inFlight = pending
      try {
        const info = await pending
        cached = info
        cachedAt = now()
        return info
      } finally {
        inFlight = null
      }
    }
  }
}
