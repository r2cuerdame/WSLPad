import { describe, expect, it } from 'vitest'
import {
  createFirewallCollector,
  parseFirewallOutput,
  unknownFirewall,
  NO_HYPERV_LAYER,
  UNREADABLE,
  WSL_VM_CREATOR_ID
} from '../../../src/main/wsl/firewall'
import type { HostCommandRunner } from '../../../src/main/wsl/windows-ports'

/** Byte-for-byte what powershell.exe printed on a Windows 11 machine. */
const REAL_OUTPUT = 'True\nBlock\nAllow\nTrue\n4\n\r\n'

interface Call {
  file: string
  args: string[]
  timeoutMs: number
}

function makeRunner(answer: () => string): { run: HostCommandRunner; calls: Call[] } {
  const calls: Call[] = []
  const run: HostCommandRunner = async (file, args, timeoutMs) => {
    calls.push({ file, args, timeoutMs })
    return answer()
  }
  return { run, calls }
}

describe('parseFirewallOutput', () => {
  it('reads the six positional lines of a real machine', () => {
    expect(parseFirewallOutput(REAL_OUTPUT)).toEqual({
      enabled: true,
      defaultInbound: 'Block',
      defaultOutbound: 'Allow',
      loopbackEnabled: true,
      ruleCount: 4,
      error: null
    })
  })

  it('keeps the actions verbatim and takes no meaning from their text', () => {
    const info = parseFirewallOutput('False\nAllow\nBlock\nFalse\n0\n')
    expect(info).toEqual({
      enabled: false,
      defaultInbound: 'Allow',
      defaultOutbound: 'Block',
      loopbackEnabled: false,
      ruleCount: 0,
      error: null
    })
  })

  it('leaves NotConfigured booleans unknown while keeping the action string', () => {
    const info = parseFirewallOutput('True\nNotConfigured\nAllow\nNotConfigured\n2\n')
    expect(info.loopbackEnabled).toBeNull()
    expect(info.defaultInbound).toBe('NotConfigured')
    expect(info.enabled).toBe(true)
  })

  it('degrades one unreadable field without touching the others', () => {
    const info = parseFirewallOutput('True\nBlock\nAllow\nTrue\nnot a number\n')
    expect(info.ruleCount).toBeNull()
    expect(info.defaultInbound).toBe('Block')
    expect(info.error).toBeNull()

    const negative = parseFirewallOutput('True\nBlock\nAllow\nTrue\n-3\n')
    expect(negative.ruleCount).toBeNull()
  })

  it('reads an absent Hyper-V layer as unknown, never as a firewall that is off', () => {
    const info = parseFirewallOutput(`\n\n\n\n\n${NO_HYPERV_LAYER}\n`)
    expect(info).toEqual(unknownFirewall(NO_HYPERV_LAYER))
    expect(info.enabled).toBeNull()
    expect(info.defaultInbound).toBeNull()
  })

  it('keeps an error that arrived on more than one line', () => {
    const info = parseFirewallOutput('\n\n\n\n\nAccess is denied.\nRun as administrator.')
    expect(info.error).toBe('Access is denied. Run as administrator.')
  })

  it('reports output that carried no field at all as unreadable', () => {
    expect(parseFirewallOutput('')).toEqual(unknownFirewall(UNREADABLE))
    expect(parseFirewallOutput('\r\n')).toEqual(unknownFirewall(UNREADABLE))
    expect(parseFirewallOutput('some unexpected banner')).toEqual(unknownFirewall(UNREADABLE))
  })

  it('survives a partial read: a known state plus a rule error', () => {
    const info = parseFirewallOutput('True\nBlock\nAllow\nTrue\n\nrule query failed')
    expect(info.ruleCount).toBeNull()
    expect(info.defaultInbound).toBe('Block')
    expect(info.error).toBe('rule query failed')
  })
})

describe('createFirewallCollector', () => {
  it('asks powershell for the WSL VM creator id without a profile', async () => {
    const { run, calls } = makeRunner(() => REAL_OUTPUT)
    const info = await createFirewallCollector({ run }).collect()

    expect(info.defaultInbound).toBe('Block')
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('powershell.exe')
    expect(calls[0].args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command'
    ])
    const script = calls[0].args[5]
    expect(script).toContain(WSL_VM_CREATOR_ID)
    expect(script).toContain('Get-NetFirewallHyperVVMSetting')
    expect(script).toContain('Get-NetFirewallHyperVRule')
    // Read-only: nothing in the script may change firewall state.
    expect(script).not.toContain('Set-Net')
    expect(script).not.toContain('New-Net')
    expect(calls[0].timeoutMs).toBeGreaterThan(0)
  })

  it('reuses the answer inside the ttl and reads again after it', async () => {
    let now = 1000
    const { run, calls } = makeRunner(() => REAL_OUTPUT)
    const collector = createFirewallCollector({ run, ttlMs: 60000, now: () => now })

    await collector.collect()
    now = 50000
    await collector.collect()
    expect(calls).toHaveLength(1)

    now = 61001
    await collector.collect()
    expect(calls).toHaveLength(2)
  })

  it('never starts two shells for two overlapping polls', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: string[] = []
    const run: HostCommandRunner = async (file) => {
      calls.push(file)
      await gate
      return REAL_OUTPUT
    }
    const collector = createFirewallCollector({ run })

    const both = Promise.all([collector.collect(), collector.collect()])
    release()
    const [first, second] = await both

    expect(calls).toHaveLength(1)
    expect(first).toEqual(second)
  })

  it('turns a spawn failure into unknown instead of rejecting', async () => {
    const { run } = makeRunner(() => {
      throw new Error('powershell.exe timed out after 8000ms')
    })
    const info = await createFirewallCollector({ run }).collect()

    expect(info).toEqual(unknownFirewall('powershell.exe timed out after 8000ms'))
    expect(info.enabled).toBeNull()
  })

  it('caches a failure too, so a machine without the layer is not re-asked', async () => {
    let now = 0
    let attempts = 0
    const run: HostCommandRunner = async () => {
      attempts += 1
      throw new Error('nope')
    }
    const collector = createFirewallCollector({ run, ttlMs: 60000, now: () => now })

    await collector.collect()
    now = 30000
    await collector.collect()
    expect(attempts).toBe(1)

    now = 90000
    await collector.collect()
    expect(attempts).toBe(2)
  })
})
