import { describe, expect, it, vi } from 'vitest'
import {
  UNREADABLE,
  createPortProxyCollector,
  judgeRules,
  parsePortProxy,
  repairCommand
} from '../../../src/main/wsl/portproxy'

/** Captured from a Korean Windows: only the heading is translated. */
const KOREAN_TABLE = [
  '',
  'ipv4에서 수신 대기:         ipv4에 연결:',
  '',
  '주소            포트        주소            포트',
  '--------------- ----------  --------------- ----------',
  '0.0.0.0         8080        172.20.128.7    8080',
  '127.0.0.1       5173        172.20.144.2    5173',
  ''
].join('\n')

describe('parsePortProxy', () => {
  it('reads rules off a localized table by their shape, not by column names', () => {
    expect(parsePortProxy(KOREAN_TABLE)).toEqual([
      {
        listenAddress: '0.0.0.0',
        listenPort: 8080,
        connectAddress: '172.20.128.7',
        connectPort: 8080,
        verdict: 'unknown'
      },
      {
        listenAddress: '127.0.0.1',
        listenPort: 5173,
        connectAddress: '172.20.144.2',
        connectPort: 5173,
        verdict: 'unknown'
      }
    ])
  })

  it('reads the English table identically', () => {
    const english = KOREAN_TABLE.replace('ipv4에서 수신 대기:', 'Listen on ipv4:')
      .replace('ipv4에 연결:', 'Connect to ipv4:')
      .replace('주소            포트        주소            포트', 'Address Port Address Port')
    expect(parsePortProxy(english)).toHaveLength(2)
  })

  it('normalises the wildcard listen address netsh prints', () => {
    const rules = parsePortProxy('*               8080        172.20.144.2    8080')
    expect(rules[0].listenAddress).toBe('0.0.0.0')
  })

  it('keeps headings, rules and junk out of the result', () => {
    expect(parsePortProxy('')).toEqual([])
    expect(parsePortProxy('--------------- ----------  --------------- ----------')).toEqual([])
    expect(parsePortProxy('Address Port Address Port')).toEqual([])
    // Four columns, but not two addresses and two ports.
    expect(parsePortProxy('a b c d')).toEqual([])
    expect(parsePortProxy('0.0.0.0 99999 172.20.144.2 8080')).toEqual([])
  })
})

describe('judgeRules', () => {
  const rule = (connectAddress: string): ReturnType<typeof parsePortProxy>[number] => ({
    listenAddress: '0.0.0.0',
    listenPort: 8080,
    connectAddress,
    connectPort: 8080,
    verdict: 'unknown'
  })

  it('calls a rule live only when it points at the address in force', () => {
    expect(judgeRules([rule('172.20.144.2')], '172.20.144.2')[0].verdict).toBe('live')
  })

  it('calls a rule stale when it points at an address this distro no longer has', () => {
    // The classic: right until the next WSL restart reassigned the address.
    expect(judgeRules([rule('172.20.128.7')], '172.20.144.2')[0].verdict).toBe('stale')
  })

  it('does not call a deliberate loopback forward broken', () => {
    expect(judgeRules([rule('127.0.0.1')], '172.20.144.2')[0].verdict).toBe('elsewhere')
    expect(judgeRules([rule('0.0.0.0')], '172.20.144.2')[0].verdict).toBe('elsewhere')
  })

  it('claims nothing when the distro address is unknown', () => {
    // A working rule reported as dead would send the user to fix what works.
    expect(judgeRules([rule('172.20.128.7')], null)[0].verdict).toBe('unknown')
  })
})

describe('repairCommand', () => {
  it('repoints the rule and changes nothing else', () => {
    const command = repairCommand(
      {
        listenAddress: '0.0.0.0',
        listenPort: 8080,
        connectAddress: '172.20.128.7',
        connectPort: 8080,
        verdict: 'stale'
      },
      '172.20.144.2'
    )
    expect(command).toContain('listenaddress=0.0.0.0')
    expect(command).toContain('listenport=8080')
    expect(command).toContain('connectaddress=172.20.144.2')
    expect(command).toContain('connectport=8080')
    // set, never add or delete: the rule is repointed, not recreated.
    expect(command).toContain('portproxy set v4tov4')
    expect(command).not.toMatch(/\b(add|delete|reset)\b/)
  })
})

describe('createPortProxyCollector', () => {
  it('reads the table read-only and judges it against the distro address', async () => {
    const calls: Array<[string, string[]]> = []
    const run = vi.fn(async (file: string, args: string[]) => {
      calls.push([file, args])
      return KOREAN_TABLE
    })
    const collector = createPortProxyCollector({ run })

    const info = await collector.collect('172.20.144.2')

    // Absolute path, so a netsh.exe next to the app cannot be picked up first.
    expect(calls[0][0]).toMatch(/System32.netsh\.exe$/i)
    expect(calls[0][1]).toEqual(['interface', 'portproxy', 'show', 'v4tov4'])
    expect(info.distroIp).toBe('172.20.144.2')
    expect(info.rules.map((r) => r.verdict)).toEqual(['stale', 'live'])
  })

  it('reuses the table but re-judges it: the rules are stable, the address is not', async () => {
    const run = vi.fn(async () => KOREAN_TABLE)
    let time = 0
    const collector = createPortProxyCollector({ run, ttlMs: 1000, now: () => time })

    const first = await collector.collect('172.20.128.7')
    time = 500
    const second = await collector.collect('172.20.144.2')

    expect(run).toHaveBeenCalledTimes(1)
    expect(first.rules[0].verdict).toBe('live')
    expect(second.rules[0].verdict).toBe('stale')
  })

  it('reports why the table could not be read instead of "no rules"', async () => {
    const run = vi.fn(async () => {
      throw new Error('netsh is not on PATH')
    })
    const info = await createPortProxyCollector({ run }).collect('172.20.144.2')

    expect(info.rules).toEqual([])
    expect(info.error).toContain(UNREADABLE)
    expect(info.error).toContain('netsh is not on PATH')
  })
})

describe('a failed read keeps the last good table', () => {
  it('does not report an empty table for a minute after one netsh failure', async () => {
    let fail = false
    const run = vi.fn(async () => {
      if (fail) throw new Error('netsh vanished')
      return KOREAN_TABLE
    })
    let time = 0
    const collector = createPortProxyCollector({ run, ttlMs: 10, now: () => time })

    const first = await collector.collect('172.20.144.2')
    expect(first.rules).toHaveLength(2)

    fail = true
    time = 100
    const second = await collector.collect('172.20.144.2')
    // Still the rules last read: reporting none would say "you have no
    // forwarding rules", which is a different fact entirely.
    expect(second.rules).toHaveLength(2)
    expect(second.error).toContain(UNREADABLE)
  })
})
