import { describe, expect, it, vi } from 'vitest'
import type { DistroRunner, RunResult } from '../../../src/main/wsl/contracts'
import { runNetworkCheck } from '../../../src/main/wsl/network-check'
import { makeSnapshot } from '../state/helpers'

const result = (stdout: string, code = 0): RunResult => ({
  stdout,
  stderr: '',
  code,
  timedOut: false
})

function runner(): DistroRunner {
  return {
    runWsl: vi.fn(async () => result('')),
    runInDistro: vi.fn(async (_distro: string, script: string) => {
      if (script.includes('wslpad-ok')) return result('wslpad-ok\n')
      if (script.includes('example.com')) return result('93.184.216.34 STREAM example.com\n')
      return result('default via 172.20.0.1 dev eth0\n')
    }),
    disposeAll: vi.fn(async () => undefined)
  }
}

describe('runNetworkCheck', () => {
  it('checks both operating systems and an optional localhost port on demand', async () => {
    const r = runner()
    const checked = await runNetworkCheck(makeSnapshot(), 5173, {
      runner: r,
      lookupHost: async () => ({ address: '93.184.216.34' }),
      connectLocalhost: async (port) => `Connected to 127.0.0.1:${port}`
    })

    expect(checked.targetPort).toBe(5173)
    expect(checked.probes.map((probe) => probe.id)).toEqual([
      'distro',
      'wsl-dns',
      'windows-dns',
      'default-route',
      'windows-localhost'
    ])
    expect(checked.probes.every((probe) => probe.status === 'pass')).toBe(true)
    expect(r.runInDistro).toHaveBeenCalledTimes(3)
  })

  it('does not wake a stopped distribution', async () => {
    const r = runner()
    const snapshot = makeSnapshot({
      distros: [{ name: 'Ubuntu-24.04', state: 'Stopped', wslVersion: 2, isDefault: true }]
    })
    const checked = await runNetworkCheck(snapshot, null, {
      runner: r,
      lookupHost: async () => ({ address: '93.184.216.34' })
    })

    expect(r.runInDistro).not.toHaveBeenCalled()
    expect(checked.probes.find((probe) => probe.id === 'distro')?.status).toBe('unknown')
    expect(checked.probes.find((probe) => probe.id === 'windows-dns')?.status).toBe('pass')
  })

  it('surfaces DNS failures without throwing away the other probes', async () => {
    const checked = await runNetworkCheck(makeSnapshot(), null, {
      runner: runner(),
      lookupHost: async () => {
        throw new Error('DNS server unavailable')
      }
    })
    const windowsDns = checked.probes.find((probe) => probe.id === 'windows-dns')
    expect(windowsDns?.status).toBe('fail')
    expect(windowsDns?.detail).toContain('DNS server unavailable')
    expect(checked.probes.find((probe) => probe.id === 'distro')?.status).toBe('pass')
  })
})
