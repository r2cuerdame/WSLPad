import { describe, expect, it } from 'vitest'
import type { PortInfo, WindowsPortInfo } from '@shared/types'
import {
  correlatePorts,
  createWindowsPortCollector,
  parseNetstat,
  parseTasklistCsv,
  type HostCommandRunner
} from '../../../src/main/wsl/windows-ports'

/** Korean Windows: the header and the section title are localized. */
const NETSTAT_OUTPUT = [
  '',
  '활성 연결',
  '',
  '  프로토콜  로컬 주소              외부 주소              상태             PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1044',
  '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       7100',
  '  TCP    192.168.0.10:52344     140.82.112.4:443       ESTABLISHED     9312',
  '  TCP    [::]:445               [::]:0                 LISTENING       4',
  '  TCP    [::1]:49670            [::1]:49671            ESTABLISHED     6200',
  '  UDP    0.0.0.0:5353           *:*                                    2244',
  '  UDP    [::1]:1900             *:*                                    7160',
  '  not a row at all',
  '  TCP    0.0.0.0:22'
].join('\r\n')

const TASKLIST_OUTPUT = [
  '"System Idle Process","0","Services","0","8 K"',
  '"svchost.exe","1044","Services","0","12,345 K"',
  '"wslrelay.exe","7100","Console","1","5,000 K"',
  '"","2244","Services","0","1 K"',
  'garbage',
  '"mDNSResponder.exe","2244","Services","0","2,000 K"'
].join('\r\n')

function wslPort(over: Partial<PortInfo> = {}): PortInfo {
  return {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    port: 8080,
    pid: 100,
    processName: 'node',
    listening: true,
    localhostUrl: 'http://localhost:8080',
    windowsBound: null,
    windowsProcess: null,
    ...over
  }
}

function winPort(over: Partial<WindowsPortInfo> = {}): WindowsPortInfo {
  return {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    port: 8080,
    pid: 7100,
    processName: 'wslrelay.exe',
    listening: true,
    localhostUrl: 'http://localhost:8080',
    fromWsl: false,
    ...over
  }
}

function makeRunner(
  netstat: () => string,
  tasklist: () => string
): { run: HostCommandRunner; calls: string[] } {
  const calls: string[] = []
  const run: HostCommandRunner = async (file) => {
    calls.push(file)
    return file === 'netstat' ? netstat() : tasklist()
  }
  return { run, calls }
}

describe('parseNetstat', () => {
  it('keeps only listeners and parses them positionally', () => {
    const ports = parseNetstat(NETSTAT_OUTPUT)
    expect(ports.map((p) => p.port)).toEqual([135, 8080, 445, 5353, 1900])

    expect(ports[0]).toEqual({
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      port: 135,
      pid: 1044,
      processName: null,
      listening: true,
      localhostUrl: 'http://localhost:135',
      fromWsl: false
    })
    expect(ports[1]).toMatchObject({ port: 8080, pid: 7100, localhostUrl: 'http://localhost:8080' })
    // bracketed host → v6 protocol, brackets kept like the Linux collector
    expect(ports[2]).toMatchObject({ protocol: 'tcp6', localAddress: '[::]', port: 445, pid: 4 })
    // UDP rows have no STATE column and count as listening; never an http URL
    expect(ports[3]).toMatchObject({ protocol: 'udp', port: 5353, pid: 2244, localhostUrl: null })
    expect(ports[4]).toMatchObject({ protocol: 'udp6', localAddress: '[::1]', port: 1900 })
  })

  it('keeps listeners whose STATE word is localized', () => {
    const german = [
      '  TCP    0.0.0.0:3000           0.0.0.0:0              ABHÖREN         9312',
      '  TCP    10.0.0.5:50505         93.184.216.34:80       HERGESTELLT     4444'
    ].join('\n')
    const ports = parseNetstat(german)
    expect(ports).toHaveLength(1)
    expect(ports[0]).toMatchObject({ port: 3000, pid: 9312, listening: true })
  })

  it('skips garbage, empty input and malformed endpoints', () => {
    expect(parseNetstat('')).toEqual([])
    expect(parseNetstat('garbage')).toEqual([])
    expect(parseNetstat('  TCP    0.0.0.0:99999   0.0.0.0:0   LISTENING   4')).toEqual([])
    expect(parseNetstat('  RAW    0.0.0.0:80      0.0.0.0:0   LISTENING   4')).toEqual([])
    expect(parseNetstat('  TCP    *:*             0.0.0.0:0   LISTENING   4')).toEqual([])
  })

  it('leaves the pid null when netstat was run without -o', () => {
    const ports = parseNetstat('  TCP    0.0.0.0:135   0.0.0.0:0   LISTENING')
    expect(ports).toHaveLength(1)
    expect(ports[0].pid).toBeNull()
  })
})

describe('parseTasklistCsv', () => {
  it('maps pid to image name and ignores blank names and garbage', () => {
    const names = parseTasklistCsv(TASKLIST_OUTPUT)
    expect(names.get(1044)).toBe('svchost.exe')
    expect(names.get(7100)).toBe('wslrelay.exe')
    expect(names.get(2244)).toBe('mDNSResponder.exe')
    expect(names.get(0)).toBe('System Idle Process')
    expect(names.size).toBe(4)
  })

  it('returns an empty map for empty or unparsable output', () => {
    expect(parseTasklistCsv('').size).toBe(0)
    expect(parseTasklistCsv('ERROR: access denied').size).toBe(0)
  })
})

describe('createWindowsPortCollector', () => {
  it('resolves process names with a single cached tasklist call', async () => {
    const { run, calls } = makeRunner(
      () => NETSTAT_OUTPUT,
      () => TASKLIST_OUTPUT
    )
    const collector = createWindowsPortCollector(run)

    const first = await collector.collect()
    expect(first.map((p) => p.processName)).toEqual([
      'svchost.exe',
      'wslrelay.exe',
      null,
      'mDNSResponder.exe',
      null
    ])

    await collector.collect()
    expect(calls).toEqual(['netstat', 'tasklist', 'netstat'])
  })

  it('refreshes the name cache when an unknown pid shows up', async () => {
    let netstat = NETSTAT_OUTPUT
    let tasklist = TASKLIST_OUTPUT
    const { run, calls } = makeRunner(
      () => netstat,
      () => tasklist
    )
    const collector = createWindowsPortCollector(run)
    await collector.collect()

    netstat = '  TCP    0.0.0.0:9000   0.0.0.0:0   LISTENING   4321'
    tasklist = TASKLIST_OUTPUT + '\r\n"newapp.exe","4321","Console","1","1 K"'
    const second = await collector.collect()
    expect(second[0].processName).toBe('newapp.exe')
    expect(calls).toEqual(['netstat', 'tasklist', 'netstat', 'tasklist'])
  })

  it('keeps ports with null names when tasklist fails', async () => {
    const { run } = makeRunner(
      () => NETSTAT_OUTPUT,
      () => {
        throw new Error('access denied')
      }
    )
    const ports = await createWindowsPortCollector(run).collect()
    expect(ports).toHaveLength(5)
    expect(ports.every((p) => p.processName === null)).toBe(true)
  })

  it('rejects when netstat itself fails', async () => {
    const { run } = makeRunner(
      () => {
        throw new Error('netstat timed out')
      },
      () => TASKLIST_OUTPUT
    )
    await expect(createWindowsPortCollector(run).collect()).rejects.toThrow('netstat timed out')
  })
})

describe('correlatePorts', () => {
  it('matches on port within a protocol family, never on process name', () => {
    const result = correlatePorts(
      [wslPort(), wslPort({ protocol: 'udp', port: 5353, localhostUrl: null })],
      [
        winPort({ protocol: 'tcp6', localAddress: '[::]' }),
        winPort({ protocol: 'tcp', port: 5353 })
      ]
    )
    expect(result.ports[0]).toMatchObject({ windowsBound: true, windowsProcess: 'wslrelay.exe' })
    // udp never matches a tcp listener on the same number
    expect(result.ports[1]).toMatchObject({ windowsBound: false, windowsProcess: null })
    expect(result.windowsPorts.map((w) => w.fromWsl)).toEqual([true, false])
  })

  it('reports unknown, not unbound, when the Windows table could not be read', () => {
    const result = correlatePorts([wslPort(), wslPort({ port: 22 })], null)
    expect(result.ports.every((p) => p.windowsBound === null)).toBe(true)
    expect(result.ports.every((p) => p.windowsProcess === null)).toBe(true)
    expect(result.windowsPorts).toEqual([])
  })

  it('marks every WSL port unbound when Windows has no listeners', () => {
    const result = correlatePorts([wslPort()], [])
    expect(result.ports[0].windowsBound).toBe(false)
    expect(result.windowsPorts).toEqual([])
  })

  it('prefers a named Windows owner and ignores non-listening WSL sockets', () => {
    const result = correlatePorts(
      [wslPort({ listening: false })],
      [winPort({ processName: null, pid: null }), winPort()]
    )
    expect(result.ports[0].windowsProcess).toBe('wslrelay.exe')
    expect(result.windowsPorts.every((w) => !w.fromWsl)).toBe(true)
  })
})
