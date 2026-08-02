import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DiskImageInfo,
  MemoryReconciliation,
  ResourceInfo,
  WslConfigInfo,
  WslPadSnapshot
} from '@shared/types'
import { PROBE_BACKOFF_BASE_MS, PROBE_TRUST_MS } from '@shared/constants'
import { SnapshotStore } from '../../../src/main/state/store'
import {
  clock,
  debian,
  dns,
  firewall,
  makeProvider,
  mcpStatus,
  resources,
  ubuntu,
  type FakeProvider
} from './helpers'

function diskImage(vhdxBytes: number): DiskImageInfo {
  return {
    distro: 'Ubuntu-24.04',
    vhdxPath: 'C:\\Users\\dev\\AppData\\Local\\wsl\\Ubuntu-24.04\\ext4.vhdx',
    basePath: 'C:\\Users\\dev\\AppData\\Local\\wsl\\Ubuntu-24.04',
    vhdxBytes,
    allocatedBytes: vhdxBytes,
    sparse: false,
    fsSizeBytes: 200 * 1024 ** 3,
    fsUsedBytes: 20 * 1024 ** 3,
    reclaimableBytes: vhdxBytes - 20 * 1024 ** 3,
    error: null
  }
}

function wslSettings(): WslConfigInfo {
  return {
    wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
    wslconfigExists: true,
    wslConfPath: '/etc/wsl.conf',
    wslConfExists: true,
    restartPending: false,
    vmStartedAt: '2026-07-30T08:00:00.000Z',
    networkingModeDeclared: 'nat',
    networkingModeEffective: 'nat',
    interop: null,
    defaultUser: null,
      platform: {
            wsl: '2.6.3.0',
            kernel: '6.6.87.2-1',
            wslg: '1.0.71',
            msrdc: '1.2.6353',
            direct3d: '1.611.1-81528511',
            dxcore: '10.0.26100.1-240331-1435.ge-release',
            windows: '10.0.26200.7840',
            storeBuild: true
          },
    
    settings: [
      {
        key: 'memory',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: '16GB',
        effectiveValue: '16GB',
        origin: 'wslconfig',
        provenance: 'user',
        verdict: 'applied',
        note: null
      }
    ]
  }
}

function memoryDetail(): MemoryReconciliation {
  return {
    hostTotalBytes: 32 * 1024 ** 3,
    vmLimitBytes: 16 * 1024 ** 3,
    vmLimitSource: 'wslconfig',
    vmmemWorkingSetBytes: 7 * 1024 ** 3,
    guestTotalBytes: 16 * 1024 ** 3,
    guestUsedBytes: 1024 ** 3,
    guestCacheBytes: 6 * 1024 ** 3,
    guestFreeBytes: 9 * 1024 ** 3,
    swapTotalBytes: 4 * 1024 ** 3,
    swapUsedBytes: 0,
    autoMemoryReclaim: 'dropcache'
  }
}

describe('SnapshotStore', () => {
  let provider: FakeProvider
  let store: SnapshotStore

  beforeEach(() => {
    provider = makeProvider()
    store = new SnapshotStore(provider)
  })

  it('returns a valid empty snapshot before initialize', () => {
    const snap = store.get()
    expect(snap.schemaVersion).toBe(1)
    expect(new Date(snap.generatedAt).getTime()).not.toBeNaN()
    expect(snap.selectedDistro).toBeNull()
    expect(snap.distros).toEqual([])
    expect(snap.dashboard).toBeNull()
    expect(snap.warnings).toEqual([])
  })

  it('initialize selects the default distro', async () => {
    await store.initialize()
    const snap = store.get()
    expect(snap.selectedDistro).toBe('Ubuntu-24.04')
    expect(snap.distros).toHaveLength(2)
    expect(snap.dashboard?.distro.name).toBe('Ubuntu-24.04')
  })

  it('initialize falls back to the first distro when none is default', async () => {
    provider.listDistros.mockResolvedValue([
      { ...debian('Running'), isDefault: false },
      { ...ubuntu(), isDefault: false }
    ])
    await store.initialize()
    expect(store.get().selectedDistro).toBe('Debian')
  })

  it('initialize survives a provider failure and records a warning', async () => {
    provider.listDistros.mockRejectedValue(new Error('wsl missing'))
    await expect(store.initialize()).resolves.toBeUndefined()
    const snap = store.get()
    expect(snap.distros).toEqual([])
    expect(snap.warnings.some((w) => w.messageKey === 'warnings.runnerFailed')).toBe(true)
  })

  it('refreshFast collects resources, processes and ports', async () => {
    await store.initialize()
    await store.refreshFast()
    const dash = store.get().dashboard
    expect(dash?.resources.cpuPercent).toBe(10)
    expect(dash?.processes).toHaveLength(1)
    expect(dash?.ports).toHaveLength(1)
  })

  it('keeps last-good resources when the provider fails, then recovers', async () => {
    await store.initialize()
    await store.refreshFast()
    expect(store.get().dashboard?.resources.cpuPercent).toBe(10)

    provider.getResources.mockRejectedValueOnce(new Error('boom'))
    await store.refreshFast()
    const snap = store.get()
    expect(snap.dashboard?.resources.cpuPercent).toBe(10)
    expect(snap.warnings.some((w) => w.messageKey === 'warnings.runnerFailed')).toBe(true)

    provider.getResources.mockResolvedValue(resources(55))
    await store.refreshFast()
    const after = store.get()
    expect(after.dashboard?.resources.cpuPercent).toBe(55)
    expect(after.warnings.some((w) => w.messageKey === 'warnings.runnerFailed')).toBe(false)
  })

  it('skips an overlapping refresh of the same tier', async () => {
    await store.initialize()
    let release!: () => void
    provider.getResources.mockImplementationOnce(
      () =>
        new Promise<ResourceInfo>((resolve) => {
          release = () => resolve(resources(99))
        })
    )
    const first = store.refreshFast()
    const second = store.refreshFast()
    await second
    await vi.waitFor(() => expect(provider.getResources).toHaveBeenCalledTimes(1))
    release()
    await first
    expect(provider.getResources).toHaveBeenCalledTimes(1)
    expect(store.get().dashboard?.resources.cpuPercent).toBe(99)

    await store.refreshFast()
    expect(provider.getResources).toHaveBeenCalledTimes(2)
  })

  it('keeps cached dashboard data when the selected distro stops', async () => {
    await store.initialize()
    await store.refreshFast()
    expect(provider.getResources).toHaveBeenCalledTimes(1)

    provider.listDistros.mockResolvedValue([ubuntu('Stopped'), debian()])
    await store.refreshFast()
    const snap = store.get()
    expect(snap.distros[0].state).toBe('Stopped')
    expect(snap.dashboard?.distro.state).toBe('Stopped')
    expect(snap.dashboard?.resources.cpuPercent).toBe(10)
    expect(provider.getResources).toHaveBeenCalledTimes(1)
    expect(snap.warnings.some((w) => w.messageKey === 'warnings.distroStopped')).toBe(true)
  })

  it('does not query a stopped distro on medium/slow tiers', async () => {
    provider.listDistros.mockResolvedValue([ubuntu('Stopped'), debian()])
    await store.initialize()
    await store.refreshMedium()
    await store.refreshSlow()
    expect(provider.getServices).not.toHaveBeenCalled()
    expect(provider.getHermes).not.toHaveBeenCalled()
    expect(provider.getSystemInfo).not.toHaveBeenCalled()
    expect(provider.getTools).not.toHaveBeenCalled()
  })

  it('refreshMedium collects services and hermes', async () => {
    await store.initialize()
    await store.refreshMedium()
    const dash = store.get().dashboard
    expect(dash?.services).toHaveLength(1)
    expect(dash?.hermes?.installed).toBe(true)
  })

  it('refreshSlow collects system info, tools, environment, paths and config', async () => {
    await store.initialize()
    await store.refreshSlow()
    const dash = store.get().dashboard
    expect(dash?.system.user).toBe('dev')
    expect(dash?.distro.osName).toBe('Ubuntu 24.04.2 LTS')
    expect(dash?.tools).toHaveLength(1)
    expect(dash?.environment).toHaveLength(1)
    expect(dash?.paths).toHaveLength(1)
    expect(dash?.configuration).toHaveLength(1)
  })

  it('leaves disk, wslSettings and memoryDetail null when the provider omits them', async () => {
    await store.initialize()
    await store.refreshFast()
    await store.refreshSlow()
    const dash = store.get().dashboard
    expect(dash?.disk).toBeNull()
    expect(dash?.wslSettings).toBeNull()
    expect(dash?.memoryDetail).toBeNull()
    // An absent optional collector is not a failure and must not warn.
    expect(store.get().warnings.some((w) => w.messageKey === 'warnings.runnerFailed')).toBe(false)
  })

  it('collects memoryDetail in the fast tier and disk + wslSettings in the slow tier', async () => {
    const extended = {
      ...provider,
      getDiskImage: vi.fn(async () => diskImage(80 * 1024 ** 3)),
      getWslSettings: vi.fn(async () => wslSettings()),
      getMemoryDetail: vi.fn(async () => memoryDetail())
    }
    const s = new SnapshotStore(extended)
    await s.initialize()
    await s.refreshFast()
    expect(s.get().dashboard?.memoryDetail?.vmmemWorkingSetBytes).toBe(7 * 1024 ** 3)
    expect(extended.getDiskImage).not.toHaveBeenCalled()
    expect(extended.getWslSettings).not.toHaveBeenCalled()

    await s.refreshSlow()
    expect(s.get().dashboard?.disk?.vhdxBytes).toBe(80 * 1024 ** 3)
    expect(s.get().dashboard?.wslSettings?.settings).toHaveLength(1)
  })

  it('keeps the last-good disk image when its collector fails, then recovers', async () => {
    const getDiskImage = vi.fn(async () => diskImage(80 * 1024 ** 3))
    const s = new SnapshotStore({ ...provider, getDiskImage })
    await s.initialize()
    await s.refreshSlow()

    getDiskImage.mockRejectedValueOnce(new Error('vhdx unreadable'))
    await s.refreshSlow()
    expect(s.get().dashboard?.disk?.vhdxBytes).toBe(80 * 1024 ** 3)
    expect(s.get().warnings.some((w) => w.message.includes('disk image'))).toBe(true)

    getDiskImage.mockResolvedValue(diskImage(90 * 1024 ** 3))
    await s.refreshSlow()
    expect(s.get().dashboard?.disk?.vhdxBytes).toBe(90 * 1024 ** 3)
    expect(s.get().warnings.some((w) => w.messageKey === 'warnings.runnerFailed')).toBe(false)
  })

  it('never wakes a stopped distro for disk, settings or memory detail', async () => {
    const extended = {
      ...provider,
      getDiskImage: vi.fn(async () => diskImage(80 * 1024 ** 3)),
      getWslSettings: vi.fn(async () => wslSettings()),
      getMemoryDetail: vi.fn(async () => memoryDetail())
    }
    extended.listDistros.mockResolvedValue([ubuntu('Stopped'), debian()])
    const s = new SnapshotStore(extended)
    await s.initialize()
    await s.refreshFast()
    await s.refreshSlow()
    expect(extended.getMemoryDetail).not.toHaveBeenCalled()
    expect(extended.getDiskImage).not.toHaveBeenCalled()
    expect(extended.getWslSettings).not.toHaveBeenCalled()
  })

  it('setDistro resets cached sections and validates the name', async () => {
    await store.initialize()
    await store.refreshSlow()
    expect(store.get().dashboard?.system.user).toBe('dev')

    await store.setDistro('Debian')
    const snap = store.get()
    expect(snap.selectedDistro).toBe('Debian')
    expect(snap.dashboard?.distro.name).toBe('Debian')
    // Debian is stopped: sections reset and stay empty instead of waking it
    expect(snap.dashboard?.system.user).toBeNull()

    await expect(store.setDistro('NoSuchDistro')).rejects.toThrow('Unknown WSL distro')
    await expect(store.setDistro('bad name!')).rejects.toThrow('Invalid WSL distro name')
  })

  it('subscribe emits on refresh and unsubscribe stops emissions', async () => {
    const seen: WslPadSnapshot[] = []
    const unsub = store.subscribe((s) => seen.push(s))
    await store.initialize()
    await store.refreshFast()
    expect(seen.length).toBeGreaterThanOrEqual(2)
    const last = seen[seen.length - 1]
    expect(new Date(last.generatedAt).getTime()).not.toBeNaN()
    expect(last.dashboard?.resources.cpuPercent).toBe(10)

    const count = seen.length
    unsub()
    await store.refreshFast()
    expect(seen.length).toBe(count)
  })

  it('setMcpStatus with an error surfaces the mcpStartFailed warning', async () => {
    await store.initialize()
    store.setMcpStatus(mcpStatus({ running: false, error: 'port in use' }))
    const snap = store.get()
    expect(snap.mcp.error).toBe('port in use')
    expect(snap.warnings.some((w) => w.messageKey === 'warnings.mcpStartFailed')).toBe(true)
  })

  it('setExplorerContext and setTerminalContext update the snapshot and emit', async () => {
    const seen: WslPadSnapshot[] = []
    store.subscribe((s) => seen.push(s))
    store.setExplorerContext({ distro: 'Ubuntu-24.04', currentPath: '/etc', showHidden: true })
    store.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/etc', status: 'ready' })
    const snap = store.get()
    expect(snap.explorer.currentPath).toBe('/etc')
    expect(snap.terminal.status).toBe('ready')
    expect(seen.length).toBe(2)
  })

  it('noteRunnerFailure feeds warnings without emitting', async () => {
    await store.initialize()
    const seen: WslPadSnapshot[] = []
    store.subscribe((s) => seen.push(s))
    store.noteRunnerFailure('df -k')
    expect(seen).toHaveLength(0)
    expect(store.get().warnings.some((w) => w.message.includes('df -k'))).toBe(true)
  })

  it('collects clock in the fast tier and firewall + dns in the medium tier', async () => {
    const extended = {
      ...provider,
      getFirewall: vi.fn(async () => firewall()),
      getClock: vi.fn(async () => clock()),
      getDns: vi.fn(async () => dns())
    }
    const s = new SnapshotStore(extended)
    await s.initialize()
    await s.refreshFast()
    expect(s.get().dashboard?.clock?.skewSeconds).toBe(-47)
    expect(extended.getFirewall).not.toHaveBeenCalled()
    expect(extended.getDns).not.toHaveBeenCalled()

    await s.refreshMedium()
    expect(s.get().dashboard?.firewall?.defaultInbound).toBe('Block')
    expect(s.get().dashboard?.dns?.generateResolvConf).toBe(false)
  })

  it('leaves firewall, clock and dns null when the provider omits them', async () => {
    await store.initialize()
    await store.refreshFast()
    await store.refreshMedium()
    const dash = store.get().dashboard
    expect(dash?.firewall).toBeNull()
    expect(dash?.clock).toBeNull()
    expect(dash?.dns).toBeNull()
    expect(store.get().warnings.some((w) => w.messageKey === 'warnings.runnerFailed')).toBe(false)
  })

  it('keeps the last-good dns when its collector fails, then recovers', async () => {
    const getDns = vi.fn(async () => dns())
    const s = new SnapshotStore({ ...provider, getDns })
    await s.initialize()
    await s.refreshMedium()

    getDns.mockRejectedValueOnce(new Error('resolv.conf unreadable'))
    await s.refreshMedium()
    expect(s.get().dashboard?.dns?.nameservers).toEqual(['10.255.255.254'])
    expect(s.get().warnings.some((w) => w.message.includes('dns'))).toBe(true)

    getDns.mockResolvedValue(dns({ nameservers: ['192.168.1.1'] }))
    await s.refreshMedium()
    expect(s.get().dashboard?.dns?.nameservers).toEqual(['192.168.1.1'])
    expect(s.get().warnings.some((w) => w.messageKey === 'warnings.runnerFailed')).toBe(false)
  })

  it('never wakes a stopped distro for clock, firewall or dns', async () => {
    const extended = {
      ...provider,
      getFirewall: vi.fn(async () => firewall()),
      getClock: vi.fn(async () => clock()),
      getDns: vi.fn(async () => dns())
    }
    extended.listDistros.mockResolvedValue([ubuntu('Stopped'), debian()])
    const s = new SnapshotStore(extended)
    await s.initialize()
    await s.refreshFast()
    await s.refreshMedium()
    expect(extended.getClock).not.toHaveBeenCalled()
    expect(extended.getFirewall).not.toHaveBeenCalled()
    expect(extended.getDns).not.toHaveBeenCalled()
  })

  it('dispose stops refreshes and emissions', async () => {
    await store.initialize()
    const seen: WslPadSnapshot[] = []
    store.subscribe((s) => seen.push(s))
    store.dispose()
    await store.refreshFast()
    expect(seen).toHaveLength(0)
    expect(provider.getResources).not.toHaveBeenCalled()
  })
})

/**
 * Issue #37: a wedged distro answers nothing, and before the liveness gate
 * every collector in every tier sat on its own timeout each poll.
 */
describe('SnapshotStore liveness gate', () => {
  let provider: FakeProvider
  let probeDistro: ReturnType<typeof vi.fn>
  let getWindowsPorts: ReturnType<typeof vi.fn>
  let store: SnapshotStore

  beforeEach(() => {
    vi.useFakeTimers()
    provider = makeProvider()
    probeDistro = vi.fn(async () => false)
    getWindowsPorts = vi.fn(async () => [])
    store = new SnapshotStore({ ...provider, probeDistro, getWindowsPorts })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips in-distro work on every tier while keeping the host queries fresh', async () => {
    await store.initialize()
    await Promise.all([store.refreshFast(), store.refreshMedium(), store.refreshSlow()])

    expect(provider.getResources).not.toHaveBeenCalled()
    expect(provider.getProcesses).not.toHaveBeenCalled()
    expect(provider.getServices).not.toHaveBeenCalled()
    expect(provider.getSystemInfo).not.toHaveBeenCalled()
    expect(provider.getTools).not.toHaveBeenCalled()
    // Neither of these touches the distro, so neither is allowed to stall.
    expect(provider.listDistros).toHaveBeenCalled()
    expect(getWindowsPorts).toHaveBeenCalled()
    // One probe answers all three tiers of the cycle.
    expect(probeDistro).toHaveBeenCalledTimes(1)
  })

  it('backs off with a growing delay instead of probing on every poll', async () => {
    await store.initialize()
    await store.refreshFast()
    expect(probeDistro).toHaveBeenCalledTimes(1)

    await store.refreshFast()
    await store.refreshMedium()
    expect(probeDistro).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(PROBE_BACKOFF_BASE_MS)
    await store.refreshFast()
    expect(probeDistro).toHaveBeenCalledTimes(2)

    // Second failure doubles the window: the same delay is no longer enough.
    vi.advanceTimersByTime(PROBE_BACKOFF_BASE_MS)
    await store.refreshFast()
    expect(probeDistro).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(PROBE_BACKOFF_BASE_MS)
    await store.refreshFast()
    expect(probeDistro).toHaveBeenCalledTimes(3)
  })

  it('warns once about the unresponsive distro, not once per poll', async () => {
    await store.initialize()
    await store.refreshFast()
    vi.advanceTimersByTime(PROBE_BACKOFF_BASE_MS)
    await store.refreshFast()
    await store.refreshMedium()

    const raised = store.get().warnings.filter((w) => w.id === 'distro-unresponsive')
    expect(raised).toHaveLength(1)
    expect(raised[0].messageKey).toBe('warnings.distroUnresponsive')
    expect(raised[0].params?.distro).toBe('Ubuntu-24.04')
  })

  it('keeps the last good snapshot when the distro stops answering', async () => {
    probeDistro.mockResolvedValue(true)
    await store.initialize()
    await store.refreshFast()
    expect(store.get().dashboard?.resources.cpuPercent).toBe(10)

    probeDistro.mockResolvedValue(false)
    vi.advanceTimersByTime(PROBE_TRUST_MS)
    await store.refreshFast()
    expect(store.get().dashboard?.resources.cpuPercent).toBe(10)
    expect(provider.getResources).toHaveBeenCalledTimes(1)
  })

  it('recovers on the next successful probe without any user action', async () => {
    await store.initialize()
    await store.refreshFast()
    expect(store.get().warnings.some((w) => w.id === 'distro-unresponsive')).toBe(true)
    expect(provider.getResources).not.toHaveBeenCalled()

    probeDistro.mockResolvedValue(true)
    vi.advanceTimersByTime(PROBE_BACKOFF_BASE_MS)
    await store.refreshFast()

    expect(provider.getResources).toHaveBeenCalledTimes(1)
    expect(store.get().dashboard?.resources.cpuPercent).toBe(10)
    expect(store.get().warnings.some((w) => w.id === 'distro-unresponsive')).toBe(false)
  })

  it('treats a probe that throws as unresponsive instead of failing the poll', async () => {
    probeDistro.mockRejectedValue(new Error('wsl.exe hung'))
    await store.initialize()
    await expect(store.refreshFast()).resolves.toBeUndefined()
    expect(provider.getResources).not.toHaveBeenCalled()
    expect(store.get().warnings.some((w) => w.id === 'distro-unresponsive')).toBe(true)
  })

  it('leaves a provider without a probe ungated', async () => {
    const s = new SnapshotStore(makeProvider())
    await s.initialize()
    await s.refreshFast()
    expect(s.get().dashboard?.resources.cpuPercent).toBe(10)
    expect(s.get().warnings.some((w) => w.id === 'distro-unresponsive')).toBe(false)
  })
})
