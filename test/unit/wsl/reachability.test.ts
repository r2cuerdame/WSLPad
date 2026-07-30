import { describe, expect, it } from 'vitest'
import type { FirewallInfo, PortInfo } from '@shared/types'
import {
  applyReachability,
  classifyBindAddress,
  classifyReachability,
  inboundPolicy,
  normalizeNetworkingMode
} from '../../../src/main/wsl/reachability'

function port(over: Partial<PortInfo> = {}): PortInfo {
  return {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    port: 8080,
    pid: 100,
    processName: 'node',
    listening: true,
    localhostUrl: 'http://localhost:8080',
    windowsBound: true,
    windowsProcess: 'wslrelay.exe',
    reachability: 'unknown',
    reachabilityReason: null,
    ...over
  }
}

function firewall(over: Partial<FirewallInfo> = {}): FirewallInfo {
  return {
    enabled: true,
    defaultInbound: 'Block',
    defaultOutbound: 'Allow',
    loopbackEnabled: true,
    ruleCount: 3,
    error: null,
    ...over
  }
}

const BLOCK = firewall()
const ALLOW = firewall({ defaultInbound: 'Allow' })
/** Read failed: every field null, exactly what the collector returns. */
const UNREAD = firewall({
  enabled: null,
  defaultInbound: null,
  defaultOutbound: null,
  loopbackEnabled: null,
  ruleCount: null,
  error: 'nope'
})

describe('classifyBindAddress', () => {
  it('treats every spelling of "any" as a wildcard', () => {
    for (const address of ['0.0.0.0', '::', '[::]', '*', '::ffff:0.0.0.0']) {
      expect(classifyBindAddress(address), address).toBe('wildcard')
    }
  })

  it('recognizes loopback in both families and through the v4-mapped form', () => {
    for (const address of ['127.0.0.1', '127.0.0.53', '::1', '[::1]', '::ffff:127.0.0.1']) {
      expect(classifyBindAddress(address), address).toBe('loopback')
    }
  })

  it('calls anything else a concrete address, zone index and all', () => {
    for (const address of ['172.28.1.5', '192.168.1.10', '[fe80::1%eth0]', '10.0.0.1']) {
      expect(classifyBindAddress(address), address).toBe('address')
    }
  })
})

describe('normalizeNetworkingMode', () => {
  it('accepts the two modes in any casing and nothing else', () => {
    expect(normalizeNetworkingMode('NAT')).toBe('nat')
    expect(normalizeNetworkingMode(' Mirrored ')).toBe('mirrored')
    expect(normalizeNetworkingMode('bridged')).toBe('unknown')
    expect(normalizeNetworkingMode('')).toBe('unknown')
    expect(normalizeNetworkingMode(null)).toBe('unknown')
  })
})

describe('inboundPolicy', () => {
  it('reads a switched-off layer as allowing and an unreadable one as unknown', () => {
    expect(inboundPolicy(null)).toBe('unknown')
    expect(inboundPolicy(UNREAD)).toBe('unknown')
    expect(inboundPolicy(firewall({ enabled: false, defaultInbound: 'Block' }))).toBe('allowed')
    expect(inboundPolicy(firewall({ enabled: null, defaultInbound: 'Block' }))).toBe('unknown')
  })

  it('reads the default action and refuses to guess at anything else', () => {
    expect(inboundPolicy(BLOCK)).toBe('blocked')
    expect(inboundPolicy(ALLOW)).toBe('allowed')
    expect(inboundPolicy(firewall({ defaultInbound: 'NotConfigured' }))).toBe('unknown')
    expect(inboundPolicy(firewall({ defaultInbound: null }))).toBe('unknown')
  })
})

describe('classifyReachability — facts that beat every rule', () => {
  it('calls a socket that is not accepting connections unreachable', () => {
    const verdict = classifyReachability(port({ listening: false }), 'mirrored', ALLOW)
    expect(verdict.reachability).toBe('unreachable')
    expect(verdict.reason).toMatch(/not accepting connections/)
  })

  it('answers unknown while the effective networking mode is unknown', () => {
    for (const mode of [null, '', 'bridged']) {
      const verdict = classifyReachability(port(), mode, ALLOW)
      expect(verdict.reachability, String(mode)).toBe('unknown')
      expect(verdict.reason).toMatch(/networking mode/)
    }
  })
})

describe('classifyReachability — NAT', () => {
  const nat = (
    p: Partial<PortInfo>,
    f: FirewallInfo | null
  ): ReturnType<typeof classifyReachability> => classifyReachability(port(p), 'nat', f)

  it('carries a guest loopback bind to Windows when Windows really holds the port', () => {
    const verdict = nat({ localAddress: '127.0.0.1', windowsBound: true }, BLOCK)
    expect(verdict.reachability).toBe('windows-only')
    expect(verdict.reason).toMatch(/localhost forwarding/)
  })

  it('keeps a guest loopback bind inside the distro when nothing forwards it', () => {
    const verdict = nat({ localAddress: '127.0.0.1', windowsBound: false }, ALLOW)
    expect(verdict.reachability).toBe('loopback-only')
  })

  it('answers unknown for a loopback bind while the Windows table is unreadable', () => {
    const verdict = nat({ localAddress: '127.0.0.1', windowsBound: null }, ALLOW)
    expect(verdict.reachability).toBe('unknown')
    expect(verdict.reason).toMatch(/Windows listener table/)
  })

  it('reaches the network only when the port is forwarded and inbound is allowed', () => {
    expect(nat({ windowsBound: true }, ALLOW).reachability).toBe('lan')
    expect(nat({ windowsBound: true }, firewall({ enabled: false })).reachability).toBe('lan')
  })

  it('stops a forwarded wildcard at this PC while inbound is blocked by default', () => {
    const verdict = nat({ windowsBound: true }, BLOCK)
    expect(verdict.reachability).toBe('windows-only')
    expect(verdict.reason).toMatch(/blocks inbound/)
  })

  it('keeps an unforwarded wildcard inside the distro when inbound is blocked', () => {
    const verdict = nat({ windowsBound: false }, BLOCK)
    expect(verdict.reachability).toBe('loopback-only')
    expect(verdict.reason).toMatch(/nothing on the Windows side forwards port 8080/)
  })

  it('lets this PC reach an unforwarded wildcard over NAT when inbound is allowed', () => {
    expect(nat({ windowsBound: false }, ALLOW).reachability).toBe('windows-only')
  })

  it('never decides a wildcard while an input is missing', () => {
    expect(nat({ windowsBound: true }, null).reachability).toBe('unknown')
    expect(nat({ windowsBound: true }, UNREAD).reachability).toBe('unknown')
    expect(nat({ windowsBound: false }, null).reachability).toBe('unknown')
    expect(nat({ windowsBound: null }, ALLOW).reachability).toBe('unknown')
  })

  it('never puts a bind to a NAT address on the network, forwarded or not', () => {
    const allowed = nat({ localAddress: '172.28.1.5', windowsBound: true }, ALLOW)
    expect(allowed.reachability).toBe('windows-only')
    expect(allowed.reason).toMatch(/NAT network/)

    const blocked = nat({ localAddress: '172.28.1.5', windowsBound: true }, BLOCK)
    expect(blocked.reachability).toBe('loopback-only')

    expect(nat({ localAddress: '172.28.1.5' }, null).reachability).toBe('unknown')
  })
})

describe('classifyReachability — mirrored', () => {
  const mirrored = (
    p: Partial<PortInfo>,
    f: FirewallInfo | null
  ): ReturnType<typeof classifyReachability> => classifyReachability(port(p), 'mirrored', f)

  it('shares the host loopback, so a loopback bind reaches this PC only', () => {
    const verdict = mirrored({ localAddress: '127.0.0.1', windowsBound: false }, BLOCK)
    expect(verdict.reachability).toBe('windows-only')
    expect(verdict.reason).toMatch(/host loopback/)
  })

  it('cuts even this PC off when loopback traffic to the VM is turned off', () => {
    const off = firewall({ loopbackEnabled: false })
    const verdict = mirrored({ localAddress: '127.0.0.1' }, off)
    expect(verdict.reachability).toBe('loopback-only')
    expect(verdict.reason).toMatch(/loopback traffic/)
  })

  it('puts a wildcard bind on the network when inbound is allowed', () => {
    const verdict = mirrored({ windowsBound: false }, ALLOW)
    expect(verdict.reachability).toBe('lan')
    expect(verdict.reason).toMatch(/host network interfaces/)
  })

  it('ignores the Windows listener table, which never sees a mirrored socket', () => {
    expect(mirrored({ windowsBound: null }, ALLOW).reachability).toBe('lan')
    expect(mirrored({ windowsBound: null }, BLOCK).reachability).toBe('windows-only')
  })

  it('stops a blocked wildcard at this PC, and inside the distro without loopback', () => {
    expect(mirrored({}, BLOCK).reachability).toBe('windows-only')
    const both = firewall({ loopbackEnabled: false })
    expect(mirrored({}, both).reachability).toBe('loopback-only')
  })

  it('treats a mirrored host address exactly like a wildcard', () => {
    expect(mirrored({ localAddress: '192.168.1.10' }, ALLOW).reachability).toBe('lan')
    expect(mirrored({ localAddress: '192.168.1.10' }, BLOCK).reachability).toBe('windows-only')
  })

  it('answers unknown while the firewall is unreadable', () => {
    expect(mirrored({}, null).reachability).toBe('unknown')
    expect(mirrored({}, UNREAD).reachability).toBe('unknown')
    expect(mirrored({}, firewall({ defaultInbound: 'NotConfigured' })).reachability).toBe('unknown')
  })
})

describe('every verdict explains itself', () => {
  it('always carries a non-empty English reason', () => {
    const firewalls: (FirewallInfo | null)[] = [null, UNREAD, BLOCK, ALLOW]
    const addresses = ['0.0.0.0', '127.0.0.1', '172.28.1.5', '[::]']
    for (const mode of ['nat', 'mirrored', 'bridged', null]) {
      for (const f of firewalls) {
        for (const localAddress of addresses) {
          for (const windowsBound of [true, false, null]) {
            const verdict = classifyReachability(port({ localAddress, windowsBound }), mode, f)
            expect(verdict.reason, `${mode}/${localAddress}/${String(windowsBound)}`).toBeTruthy()
            expect((verdict.reason ?? '').trim().length).toBeGreaterThan(20)
          }
        }
      }
    }
  })
})

describe('applyReachability', () => {
  it('recomputes every port and never reads the previous verdict', () => {
    const stale = port({ reachability: 'lan', reachabilityReason: 'from an older poll' })
    const [fresh] = applyReachability([stale], 'nat', BLOCK)

    expect(fresh.reachability).toBe('windows-only')
    expect(fresh.reachabilityReason).not.toBe('from an older poll')
    // the input is left untouched — the store holds it until the next tick
    expect(stale.reachability).toBe('lan')
  })

  it('keeps every other field of the port exactly as it was', () => {
    const [out] = applyReachability([port()], 'nat', ALLOW)
    expect(out).toMatchObject({
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      port: 8080,
      pid: 100,
      processName: 'node',
      windowsBound: true,
      windowsProcess: 'wslrelay.exe'
    })
  })

  it('marks the whole list unknown when the mode was never read', () => {
    const ports = [port(), port({ port: 22, localAddress: '127.0.0.1' })]
    const out = applyReachability(ports, null, ALLOW)
    expect(out.map((p) => p.reachability)).toEqual(['unknown', 'unknown'])
  })

  it('returns an empty list unchanged', () => {
    expect(applyReachability([], 'nat', BLOCK)).toEqual([])
  })
})
