import { describe, expect, it } from 'vitest'
import type { DashboardSnapshot, PortInfo, PortProxyRule, ProcessInfo } from '@shared/types'
import { describeOwnership, portOwnership } from '@shared/port-ownership'
import { makeDashboard } from '../mcp/fixture'

const listener = (over: Partial<PortInfo> = {}): PortInfo => ({
  protocol: 'tcp',
  localAddress: '0.0.0.0',
  port: 3000,
  pid: 1234,
  processName: 'node',
  listening: true,
  localhostUrl: 'http://127.0.0.1:3000',
  windowsBound: true,
  windowsProcess: 'wslrelay.exe',
  reachability: 'windows-only',
  reachabilityReason: null,
  ...over
})

function dashWith(over: Partial<DashboardSnapshot>): DashboardSnapshot {
  return { ...makeDashboard(), ...over }
}

describe('portOwnership', () => {
  it('gathers the four scattered pieces into one answer', () => {
    const process: ProcessInfo = {
      pid: 1234,
      user: 'dev',
      cpuPercent: 1,
      memPercent: 1,
      elapsedSeconds: 10,
      command: 'node server.js',
      executablePath: '/usr/bin/node'
    }
    const rule: PortProxyRule = {
      listenAddress: '0.0.0.0',
      listenPort: 3000,
      connectAddress: '172.20.144.2',
      connectPort: 3000,
      verdict: 'live'
    }
    const dash = dashWith({
      ports: [listener()],
      processes: [process],
      windowsPorts: [
        {
          protocol: 'tcp',
          localAddress: '0.0.0.0',
          port: 3000,
          pid: 999,
          processName: 'wslrelay.exe',
          listening: true,
          localhostUrl: 'http://127.0.0.1:3000',
          fromWsl: true
        }
      ],
      portProxy: { rules: [rule], distroIp: '172.20.144.2', error: null }
    })

    const own = portOwnership(dash, 3000)
    expect(own.linux?.processName).toBe('node')
    expect(own.process?.command).toBe('node server.js')
    expect(own.windows?.processName).toBe('wslrelay.exe')
    expect(own.forwarding).toEqual([rule])
    expect(own.reachableFromWindows).toBe(true)
  })

  it('says nothing is listening rather than nothing is known', () => {
    const own = portOwnership(dashWith({ ports: [], windowsPorts: [] }), 9999)
    expect(own.linux).toBeNull()
    expect(own.windows).toBeNull()
    // No listener is not "unreachable": there is nothing there to reach.
    expect(own.reachableFromWindows).toBeNull()
    expect(describeOwnership(own)).toContain('Nothing is listening')
  })

  it('keeps reachability unknown when the Windows table could not be read', () => {
    const own = portOwnership(dashWith({ ports: [listener({ windowsBound: null })] }), 3000)
    expect(own.reachableFromWindows).toBeNull()
    expect(describeOwnership(own)).toContain('unknown')
  })

  it('attributes a port held only on the Windows side to Windows', () => {
    const own = portOwnership(
      dashWith({
        ports: [],
        windowsPorts: [
          {
            protocol: 'tcp',
            localAddress: '0.0.0.0',
            port: 445,
            pid: 4,
            processName: 'System',
            listening: true,
            localhostUrl: null,
            fromWsl: false
          }
        ]
      }),
      445
    )
    expect(own.linux).toBeNull()
    expect(describeOwnership(own)).toContain('Windows side')
    expect(describeOwnership(own)).toContain('System')
  })

  it('prefers a listening socket but still names a holder in another state', () => {
    const dash = dashWith({
      ports: [
        listener({ listening: false, processName: 'old' }),
        listener({ listening: true, processName: 'current' })
      ]
    })
    expect(portOwnership(dash, 3000).linux?.processName).toBe('current')

    const onlyClosed = dashWith({ ports: [listener({ listening: false, processName: 'old' })] })
    expect(portOwnership(onlyClosed, 3000).linux?.processName).toBe('old')
  })

  it('finds a forwarding rule that mentions the port on either side', () => {
    const rule: PortProxyRule = {
      listenAddress: '0.0.0.0',
      listenPort: 8080,
      connectAddress: '172.20.144.2',
      connectPort: 3000,
      verdict: 'live'
    }
    const dash = dashWith({ portProxy: { rules: [rule], distroIp: '172.20.144.2', error: null } })
    expect(portOwnership(dash, 3000).forwarding).toEqual([rule])
    expect(portOwnership(dash, 8080).forwarding).toEqual([rule])
    expect(portOwnership(dash, 1234).forwarding).toEqual([])
  })

  it('never starts anything: the answer comes from what was already collected', () => {
    // The whole point of the tool. If this ever needs a runner, the design
    // has changed and this test should be the thing that says so.
    expect(portOwnership.length).toBe(2)
  })
})
