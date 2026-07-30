import { describe, expect, it } from 'vitest'
import { WslNotAvailableError } from '../../../../src/main/wsl/contracts'
import { collectPorts, parseSs } from '../../../../src/main/wsl/ports'
import { fakeRunner, ok } from './helpers'

const SS_OUTPUT = [
  'udp   UNCONN 0      0          127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=412,fd=13))',
  'udp   UNCONN 0      0                0.0.0.0:68        0.0.0.0:*',
  'tcp   LISTEN 0      4096           127.0.0.1:8080      0.0.0.0:*    users:(("node",pid=1234,fd=22))',
  'tcp   LISTEN 0      511                 [::]:80             [::]:*  users:(("nginx",pid=99,fd=6),("nginx",pid=100,fd=6))',
  'udp   UNCONN 0      0      [fe80::1]%eth0:546              [::]:*',
  'tcp   ESTAB  0      0           172.29.112.5:34567   140.82.112.4:443 users:(("curl",pid=777,fd=5))',
  'tcp   LISTEN 0      128              0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=88,fd=3))'
].join('\n')

describe('parseSs', () => {
  it('parses protocols, addresses, pids and listening state', () => {
    const ports = parseSs(SS_OUTPUT)
    expect(ports).toHaveLength(7)

    expect(ports[0]).toEqual({
      protocol: 'udp',
      localAddress: '127.0.0.53%lo',
      port: 53,
      pid: 412,
      processName: 'systemd-resolve',
      listening: true,
      localhostUrl: null,
      windowsBound: null,
      windowsProcess: null,
      reachability: 'unknown',
      reachabilityReason: null
    })

    // no users field → null pid/process
    expect(ports[1]).toMatchObject({ pid: null, processName: null, listening: true })

    // listening tcp ≥ 80 gets a clickable localhost URL
    expect(ports[2]).toMatchObject({
      protocol: 'tcp',
      port: 8080,
      pid: 1234,
      processName: 'node',
      listening: true,
      localhostUrl: 'http://localhost:8080',
      windowsBound: null,
      windowsProcess: null
    })

    // bracketed local address → v6; first users entry wins
    expect(ports[3]).toMatchObject({
      protocol: 'tcp6',
      localAddress: '[::]',
      port: 80,
      pid: 99,
      localhostUrl: 'http://localhost:80',
      windowsBound: null,
      windowsProcess: null
    })

    expect(ports[4]).toMatchObject({ protocol: 'udp6', port: 546 })

    // non-LISTEN tcp → not listening, no URL
    expect(ports[5]).toMatchObject({ listening: false, localhostUrl: null, port: 34567 })

    // listening tcp below 80 → no URL
    expect(ports[6]).toMatchObject({ port: 22, listening: true, localhostUrl: null })
  })

  it('skips malformed lines and empty input', () => {
    expect(parseSs('')).toEqual([])
    expect(parseSs('garbage')).toEqual([])
    expect(parseSs('tcp LISTEN 0 0')).toEqual([])
    expect(parseSs('raw UNCONN 0 0 0.0.0.0:1 0.0.0.0:*')).toEqual([])
    expect(parseSs('tcp LISTEN 0 0 0.0.0.0:* 0.0.0.0:*')).toEqual([])
    expect(parseSs('tcp LISTEN 0 0 0.0.0.0:99999 0.0.0.0:*')).toEqual([])
  })

  it('survives huge input', () => {
    const huge = Array.from(
      { length: 50000 },
      (_, i) =>
        `tcp   LISTEN 0 128 127.0.0.1:${(i % 60000) + 1024} 0.0.0.0:* users:(("srv",pid=${i + 1},fd=3))`
    ).join('\n')
    expect(parseSs(huge)).toHaveLength(50000)
  })
})

describe('collectPorts', () => {
  it('parses runner output', async () => {
    const runner = fakeRunner(() => ok(SS_OUTPUT))
    const ports = await collectPorts(runner, 'Ubuntu-24.04')
    expect(ports).toHaveLength(7)
    expect(runner.calls[0]).toContain('ss -tulnpH')
  })

  it('returns [] when the runner fails', async () => {
    const runner = fakeRunner(() => {
      throw new Error('boom')
    })
    expect(await collectPorts(runner, 'Ubuntu-24.04')).toEqual([])
  })

  it('passes WslNotAvailableError through', async () => {
    const runner = fakeRunner(() => {
      throw new WslNotAvailableError()
    })
    await expect(collectPorts(runner, 'Ubuntu-24.04')).rejects.toBeInstanceOf(WslNotAvailableError)
  })
})
