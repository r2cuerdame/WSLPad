import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DiskImageInfo,
  DriveMountInfo,
  DriveMountsInfo,
  HermesInfo,
  InotifyInfo,
  MemoryReconciliation,
  ResourceInfo,
  WindowsPortInfo,
  WslConfigInfo,
  WslPadSnapshot
} from '@shared/types'
import { PROBE_BACKOFF_BASE_MS, PROBE_TRUST_MS } from '@shared/constants'
import { SnapshotStore } from '../../../src/main/state/store'
import { DiagnosticsService } from '../../../src/main/state/diagnostics'
import { createPortProxyCollector } from '../../../src/main/wsl/portproxy'
import {
  clock,
  debian,
  disk,
  dns,
  firewall,
  hermes,
  makeProvider,
  mcpStatus,
  port,
  proc,
  resources,
  svc,
  system,
  ubuntu,
  type FakeProvider
} from './helpers'

function driveMount(point: string): DriveMountInfo {
  return {
    point,
    source: 'C:\\',
    metadata: true,
    caseSensitivity: null,
    uid: 1000,
    gid: 1000,
    umask: null,
    fmask: null,
    dmask: null,
    options: 'rw,aname=drvfs;path=C:\\;metadata'
  }
}

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

  describe('disk usage that was not read (issue #318)', () => {
    const unknownDisk = (mountPoint: string): ResourceInfo['disks'][number] => ({
      mountPoint,
      exists: null,
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      usePercent: null
    })
    const missingDisk = (mountPoint: string): ResourceInfo['disks'][number] => ({
      ...unknownDisk(mountPoint),
      exists: false
    })

    it('stays unknown when the very first read did not finish', async () => {
      provider.getResources.mockResolvedValue(
        resources(10, { disks: [unknownDisk('/'), unknownDisk('/home'), unknownDisk('/mnt/c')] })
      )
      await store.initialize()
      await store.refreshFast()
      const disks = store.get().dashboard?.resources.disks ?? []
      expect(disks.map((d) => d.exists)).toEqual([null, null, null])
    })

    it('keeps the last answered value per mount, then takes the next answer', async () => {
      provider.getResources.mockResolvedValue(
        resources(10, { disks: [disk('/', 40), disk('/mnt/c', 70), missingDisk('/mnt/d')] })
      )
      await store.initialize()
      await store.refreshFast()

      // /mnt/c timed out this tick, / still answered with a new value
      provider.getResources.mockResolvedValue(
        resources(20, { disks: [disk('/', 41), unknownDisk('/mnt/c'), unknownDisk('/mnt/d')] })
      )
      await store.refreshFast()
      let disks = store.get().dashboard?.resources.disks ?? []
      expect(store.get().dashboard?.resources.cpuPercent).toBe(20)
      expect(disks.map((d) => [d.mountPoint, d.exists, d.usePercent])).toEqual([
        ['/', true, 41],
        ['/mnt/c', true, 70],
        ['/mnt/d', false, null]
      ])

      // the next finished read replaces the kept value
      provider.getResources.mockResolvedValue(
        resources(30, { disks: [disk('/', 42), disk('/mnt/c', 75), disk('/mnt/d', 5)] })
      )
      await store.refreshFast()
      disks = store.get().dashboard?.resources.disks ?? []
      expect(disks.map((d) => [d.mountPoint, d.exists, d.usePercent])).toEqual([
        ['/', true, 42],
        ['/mnt/c', true, 75],
        ['/mnt/d', true, 5]
      ])
    })

    it("never carries one distro's disks into another after a switch", async () => {
      provider.listDistros.mockResolvedValue([ubuntu(), debian('Running')])
      provider.getResources.mockResolvedValue(resources(10, { disks: [disk('/', 88)] }))
      await store.initialize()
      await store.refreshFast()
      expect(store.get().dashboard?.resources.disks[0].usePercent).toBe(88)

      provider.getResources.mockResolvedValue(resources(10, { disks: [unknownDisk('/')] }))
      await store.setDistro('Debian')
      const snap = store.get()
      expect(snap.selectedDistro).toBe('Debian')
      expect(provider.getResources).toHaveBeenLastCalledWith('Debian')
      expect(snap.dashboard?.resources.disks).toEqual([unknownDisk('/')])
    })
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

  it('setTerminalContext re-judges the Console cwd warning at once', async () => {
    await store.initialize()
    const seen: WslPadSnapshot[] = []
    store.subscribe((s) => seen.push(s))
    const has = (s: WslPadSnapshot | undefined) =>
      (s?.warnings ?? []).some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')

    store.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/mnt/c/Users/dev', status: 'ready' })
    expect(has(seen.at(-1))).toBe(true)
    expect(
      store
        .get()
        .dashboard?.warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')
    ).toBe(true)

    store.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/home/dev', status: 'ready' })
    expect(has(seen.at(-1))).toBe(false)
    expect(
      store
        .get()
        .dashboard?.warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')
    ).toBe(false)
  })

  it('judges the Console cwd against the automount root in force', async () => {
    const settings = wslSettings()
    settings.settings.push({
      key: 'root',
      section: 'automount',
      scope: 'linux',
      declaredValue: '/',
      effectiveValue: '/',
      origin: 'wsl-conf',
      provenance: 'user',
      verdict: 'applied',
      note: null
    })
    const s = new SnapshotStore({ ...provider, getWslSettings: vi.fn(async () => settings) })
    await s.initialize()
    await s.refreshSlow()
    const has = () =>
      s.get().warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')

    s.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/c/Users/dev/project', status: 'ready' })
    expect(has()).toBe(true)
    s.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/mnt/c/cache', status: 'ready' })
    expect(has()).toBe(false)
  })

  it("does not blame the selected distro for another distro's Console cwd", async () => {
    await store.initialize()
    const has = () =>
      store.get().warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')
    store.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/mnt/c/Users/dev', status: 'ready' })
    expect(has()).toBe(true)

    await store.setDistro('Debian')
    expect(has()).toBe(false)

    await store.setDistro('Ubuntu-24.04')
    expect(has()).toBe(true)
  })

  it('isolates Explorer and Console contexts per distro and restores them on switch back', async () => {
    await store.initialize()
    const hasSlowWarning = () =>
      store.get().warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')

    store.setExplorerContext({
      distro: 'Ubuntu-24.04',
      currentPath: '/mnt/c/Users/dev/docs',
      showHidden: true
    })
    store.setTerminalContext({
      distro: 'Ubuntu-24.04',
      cwd: '/mnt/c/Users/dev',
      status: 'ready'
    })
    expect(store.get().explorer).toEqual({
      distro: 'Ubuntu-24.04',
      currentPath: '/mnt/c/Users/dev/docs',
      showHidden: true
    })
    expect(store.get().terminal).toEqual({
      distro: 'Ubuntu-24.04',
      cwd: '/mnt/c/Users/dev',
      status: 'ready'
    })
    expect(hasSlowWarning()).toBe(true)

    // Switching to stopped Debian must not expose Ubuntu's paths or status.
    await store.setDistro('Debian')
    expect(store.get().explorer).toEqual({
      distro: null,
      currentPath: null,
      showHidden: false
    })
    expect(store.get().terminal).toEqual({
      distro: null,
      cwd: null,
      status: 'disconnected'
    })
    expect(hasSlowWarning()).toBe(false)

    // Using Explorer and Console on Debian must not overwrite Ubuntu's saved context.
    store.setExplorerContext({ distro: 'Debian', currentPath: '/var/log', showHidden: false })
    store.setTerminalContext({ distro: 'Debian', cwd: '/home/deb', status: 'ready' })
    expect(store.get().explorer).toEqual({
      distro: 'Debian',
      currentPath: '/var/log',
      showHidden: false
    })
    expect(store.get().terminal).toEqual({
      distro: 'Debian',
      cwd: '/home/deb',
      status: 'ready'
    })
    expect(hasSlowWarning()).toBe(false)

    // Switching back to Ubuntu immediately restores Ubuntu's paths and slow-path warning.
    const emittedOnSwitch: WslPadSnapshot[] = []
    const unsub = store.subscribe((s) => emittedOnSwitch.push(s))
    await store.setDistro('Ubuntu-24.04')
    unsub()

    expect(emittedOnSwitch[0]?.explorer).toEqual({
      distro: 'Ubuntu-24.04',
      currentPath: '/mnt/c/Users/dev/docs',
      showHidden: true
    })
    expect(emittedOnSwitch[0]?.terminal).toEqual({
      distro: 'Ubuntu-24.04',
      cwd: '/mnt/c/Users/dev',
      status: 'ready'
    })
    expect(
      emittedOnSwitch[0]?.warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')
    ).toBe(true)
    expect(store.get().explorer.currentPath).toBe('/mnt/c/Users/dev/docs')
    expect(store.get().terminal.cwd).toBe('/mnt/c/Users/dev')
    expect(hasSlowWarning()).toBe(true)
  })

  it('stores background context updates for unselected distros without emitting or polluting diagnostics', async () => {
    await store.initialize()
    const diagnostics = new DiagnosticsService(null, () => store.get())
    const seen: WslPadSnapshot[] = []
    store.subscribe((s) => {
      diagnostics.observe(s)
      seen.push(s)
    })

    store.setExplorerContext({ distro: 'Ubuntu-24.04', currentPath: '/home/dev', showHidden: false })
    store.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/home/dev', status: 'ready' })
    const countBeforeBackground = seen.length

    // Background activity on unselected Debian must not emit or trigger Ubuntu incidents/warnings.
    store.setExplorerContext({ distro: 'Debian', currentPath: '/srv/deb', showHidden: true })
    store.setTerminalContext({
      distro: 'Debian',
      cwd: '/mnt/c/Users/deb',
      status: 'start-failed'
    })

    expect(seen.length).toBe(countBeforeBackground)
    expect(store.get().explorer).toEqual({
      distro: 'Ubuntu-24.04',
      currentPath: '/home/dev',
      showHidden: false
    })
    expect(store.get().terminal).toEqual({
      distro: 'Ubuntu-24.04',
      cwd: '/home/dev',
      status: 'ready'
    })
    expect(
      store.get().warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')
    ).toBe(false)
    expect(diagnostics.get().incidents.some((i) => i.kind === 'console-failed')).toBe(false)

    // Once Debian is selected, its stored context and slow-path warning surface immediately.
    await store.setDistro('Debian')
    expect(store.get().explorer).toEqual({
      distro: 'Debian',
      currentPath: '/srv/deb',
      showHidden: true
    })
    expect(store.get().terminal).toEqual({
      distro: 'Debian',
      cwd: '/mnt/c/Users/deb',
      status: 'start-failed'
    })
    expect(
      store.get().warnings.some((w) => w.messageKey === 'warnings.consoleCwdCrossBoundary')
    ).toBe(true)
  })

  it('drops stored Explorer and Console contexts when a distro is removed from WSL', async () => {
    await store.initialize()
    store.setExplorerContext({ distro: 'Debian', currentPath: '/var/log', showHidden: true })
    store.setTerminalContext({ distro: 'Debian', cwd: '/mnt/c/deb', status: 'ready' })

    provider.listDistros.mockResolvedValueOnce([ubuntu()])
    await store.refreshFast()

    provider.listDistros.mockResolvedValue([ubuntu(), debian()])
    await store.refreshFast()
    await store.setDistro('Debian')

    expect(store.get().explorer).toEqual({
      distro: null,
      currentPath: null,
      showHidden: false
    })
    expect(store.get().terminal).toEqual({
      distro: null,
      cwd: null,
      status: 'disconnected'
    })
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

  it('keeps the last-good Hermes, drive mounts and watch limits through an unknown read, until a distro switch', async () => {
    const mounts = (point: string): DriveMountsInfo => ({
      drives: [driveMount(point)],
      declaredOptions: null,
      declaredEnabled: null
    })
    const limits = (maxUserWatches: number): InotifyInfo => ({
      maxUserWatches,
      maxUserInstances: 128,
      raiseCommand: 'wsl.exe -d Ubuntu -u root sh -c true'
    })
    const getDriveMounts = vi.fn(async (): Promise<DriveMountsInfo | null> => mounts('/mnt/c'))
    const getInotify = vi.fn(async (): Promise<InotifyInfo | null> => limits(65536))
    const getHermes = vi.fn(async (): Promise<HermesInfo | null> => hermes())
    const extended = { ...provider, getHermes, getDriveMounts, getInotify }
    extended.listDistros.mockResolvedValue([ubuntu(), debian('Running')])
    const s = new SnapshotStore(extended)
    await s.initialize()
    await s.refreshMedium()
    await s.refreshSlow()
    expect(s.get().dashboard?.hermes?.installed).toBe(true)

    extended.getHermes.mockResolvedValueOnce(null)
    getDriveMounts.mockResolvedValueOnce(null)
    getInotify.mockResolvedValueOnce(null)
    await s.refreshMedium()
    await s.refreshSlow()
    const dash = s.get().dashboard
    expect(dash?.hermes?.installed).toBe(true)
    expect(dash?.driveMounts?.drives.map((d) => d.point)).toEqual(['/mnt/c'])
    expect(dash?.inotify?.maxUserWatches).toBe(65536)

    // A fresh answer still replaces the remembered one.
    getInotify.mockResolvedValueOnce(limits(524288))
    await s.refreshSlow()
    expect(s.get().dashboard?.inotify?.maxUserWatches).toBe(524288)

    // Another distro starts from unknown and never shows Ubuntu's answers.
    extended.getHermes.mockResolvedValue(null)
    getDriveMounts.mockResolvedValue(null)
    getInotify.mockResolvedValue(null)
    await s.setDistro('Debian')
    expect(s.get().selectedDistro).toBe('Debian')
    const other = s.get().dashboard
    expect(other?.hermes).toBeNull()
    expect(other?.driveMounts).toBeNull()
    expect(other?.inotify).toBeNull()
  })

  it('keeps the last-good tool list when detection fails, and never marks a first failure as collected', async () => {
    const status = (st: SnapshotStore) =>
      (st.get().dashboard as { toolsCollectionStatus?: string } | null)?.toolsCollectionStatus
    const toolsFailed = (st: SnapshotStore) =>
      st
        .get()
        .warnings.some((w) => w.messageKey === 'warnings.runnerFailed' && w.message.includes('tools'))

    // First read fails: still no list, and the status says why.
    provider.getTools.mockRejectedValueOnce(new Error('tool detection timed out in Ubuntu-24.04'))
    await store.initialize()
    await store.refreshSlow()
    expect(store.get().dashboard?.tools).toEqual([])
    expect(status(store)).toBe('failed')
    expect(toolsFailed(store)).toBe(true)

    // Recovery publishes the list and clears the failure.
    await store.refreshSlow()
    expect(store.get().dashboard?.tools.map((t) => t.id)).toEqual(['node'])
    expect(status(store)).toBe('succeeded')
    expect(toolsFailed(store)).toBe(false)

    // A later failure keeps the list on screen and raises the warning again.
    provider.getTools.mockRejectedValueOnce(new Error('tool detection exited with code 1'))
    await store.refreshSlow()
    expect(store.get().dashboard?.tools.map((t) => t.id)).toEqual(['node'])
    expect(status(store)).toBe('succeeded')
    expect(toolsFailed(store)).toBe(true)
  })

  it('tracks processes and ports collection status, keeps last-good on later failure, and resets on setDistro', async () => {
    const hasFailed = (st: SnapshotStore, cmd: 'processes' | 'ports') =>
      st.get().warnings.some((w) => w.id === `runner-failed-${cmd}`)

    await store.initialize()
    expect(store.get().dashboard?.processesCollectionStatus).toBe('pending')
    expect(store.get().dashboard?.portsCollectionStatus).toBe('pending')
    expect(store.get().dashboard?.processes).toEqual([])
    expect(store.get().dashboard?.ports).toEqual([])

    // Initial failure marks failed (never succeeded) and raises warnings without fabricating 0.
    provider.getProcesses.mockRejectedValueOnce(new Error('ps exited with code 127'))
    provider.getPorts.mockRejectedValueOnce(new Error('ss timed out'))
    await store.refreshFast()
    expect(store.get().dashboard?.processes).toEqual([])
    expect(store.get().dashboard?.ports).toEqual([])
    expect(store.get().dashboard?.processesCollectionStatus).toBe('failed')
    expect(store.get().dashboard?.portsCollectionStatus).toBe('failed')
    expect(hasFailed(store, 'processes')).toBe(true)
    expect(hasFailed(store, 'ports')).toBe(true)

    // Genuine empty result clears failure and sets succeeded.
    provider.getProcesses.mockResolvedValueOnce([])
    provider.getPorts.mockResolvedValueOnce([])
    await store.refreshFast()
    expect(store.get().dashboard?.processesCollectionStatus).toBe('succeeded')
    expect(store.get().dashboard?.portsCollectionStatus).toBe('succeeded')
    expect(store.get().dashboard?.processes).toEqual([])
    expect(store.get().dashboard?.ports).toEqual([])
    expect(hasFailed(store, 'processes')).toBe(false)
    expect(hasFailed(store, 'ports')).toBe(false)

    // Normal populated query updates lists.
    await store.refreshFast()
    expect(store.get().dashboard?.processes.map((p) => p.pid)).toEqual([100])
    expect(store.get().dashboard?.ports.map((p) => p.port)).toEqual([8080])

    // Post-success failure keeps last-good lists and raises warnings.
    provider.getProcesses.mockRejectedValueOnce(new Error('ps failed again'))
    provider.getPorts.mockRejectedValueOnce(new Error('ss failed again'))
    await store.refreshFast()
    expect(store.get().dashboard?.processes.map((p) => p.pid)).toEqual([100])
    expect(store.get().dashboard?.ports.map((p) => p.port)).toEqual([8080])
    expect(store.get().dashboard?.processesCollectionStatus).toBe('succeeded')
    expect(store.get().dashboard?.portsCollectionStatus).toBe('succeeded')
    expect(hasFailed(store, 'processes')).toBe(true)
    expect(hasFailed(store, 'ports')).toBe(true)

    // Subsequent recovery replaces lists and clears failure warnings.
    provider.getProcesses.mockResolvedValueOnce([proc(202)])
    provider.getPorts.mockResolvedValueOnce([port(9090)])
    await store.refreshFast()
    expect(store.get().dashboard?.processes.map((p) => p.pid)).toEqual([202])
    expect(store.get().dashboard?.ports.map((p) => p.port)).toEqual([9090])
    expect(hasFailed(store, 'processes')).toBe(false)
    expect(hasFailed(store, 'ports')).toBe(false)

    // Switching distros resets both lists, statuses, and runner failure warnings.
    provider.getProcesses.mockRejectedValueOnce(new Error('ps failed before switch'))
    await store.refreshFast()
    expect(hasFailed(store, 'processes')).toBe(true)
    await store.setDistro('Debian')
    expect(store.get().dashboard?.processes).toEqual([])
    expect(store.get().dashboard?.ports).toEqual([])
    expect(store.get().dashboard?.processesCollectionStatus).toBe('pending')
    expect(store.get().dashboard?.portsCollectionStatus).toBe('pending')
    expect(hasFailed(store, 'processes')).toBe(false)
    expect(hasFailed(store, 'ports')).toBe(false)
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

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const NETSH_SAMPLE_TABLE = [
  '',
  'Listen on ipv4:             Connect to ipv4:',
  '',
  'Address         Port        Address         Port',
  '--------------- ----------  --------------- ----------',
  '0.0.0.0         8080        172.20.128.7    8080',
  '127.0.0.1       5173        172.20.144.2    5173',
  ''
].join('\n')

function windowsPort(portNumber = 8080): WindowsPortInfo {
  return {
    protocol: 'tcp',
    localAddress: '0.0.0.0',
    port: portNumber,
    pid: 4,
    processName: 'wslrelay',
    listening: true,
    localhostUrl: `http://127.0.0.1:${portNumber}`,
    fromWsl: true
  }
}

describe('SnapshotStore cross-tier reconciliation', () => {
  it('updates port reachability immediately once firewall and networking mode arrive', async () => {
    const p = {
      ...makeProvider(),
      getWindowsPorts: vi.fn(async () => [windowsPort(8080)]),
      getFirewall: vi.fn(async () => firewall({ defaultInbound: 'Allow' })),
      getWslSettings: vi.fn(async () => wslSettings())
    }
    p.getPorts.mockResolvedValue([{ ...port(8080), localAddress: '0.0.0.0' }])

    const store = new SnapshotStore(p)
    await store.initialize()

    await store.refreshFast()
    expect(store.get().dashboard?.ports[0]?.reachability).toBe('unknown')

    await store.refreshMedium()
    expect(store.get().dashboard?.ports[0]?.reachability).toBe('unknown')

    await store.refreshSlow()
    expect(store.get().dashboard?.ports[0]?.reachability).toBe('lan')
    expect(p.getPorts).toHaveBeenCalledTimes(1)
  })

  it('converges port reachability when fast, medium, and slow run concurrently or host firewall arrives last', async () => {
    const fwDeferred = deferred<ReturnType<typeof firewall>>()
    const settingsDeferred = deferred<ReturnType<typeof wslSettings>>()
    const p = {
      ...makeProvider(),
      getWindowsPorts: vi.fn(async () => [windowsPort(8080)]),
      getFirewall: vi.fn(() => fwDeferred.promise),
      getWslSettings: vi.fn(() => settingsDeferred.promise)
    }
    p.getPorts.mockResolvedValue([{ ...port(8080), localAddress: '0.0.0.0' }])

    const store = new SnapshotStore(p)
    await store.initialize()

    const pending = Promise.all([store.refreshFast(), store.refreshMedium(), store.refreshSlow()])
    // Fast finishes before firewall and networking mode settle.
    await Promise.resolve()
    await Promise.resolve()
    settingsDeferred.resolve(wslSettings())
    await Promise.resolve()
    fwDeferred.resolve(firewall({ defaultInbound: 'Block' }))
    await pending

    expect(store.get().dashboard?.ports[0]?.reachability).toBe('windows-only')
  })

  it('re-evaluates portProxy via collector cache on system.ip arrival and change without standalone slow calls', async () => {
    const standaloneProvider = {
      ...makeProvider(),
      getPortProxy: vi.fn(async (ip: string | null) => ({ rules: [], distroIp: ip, error: null }))
    }
    const standaloneStore = new SnapshotStore(standaloneProvider)
    await standaloneStore.initialize()
    await standaloneStore.refreshSlow()
    expect(standaloneProvider.getPortProxy).not.toHaveBeenCalled()

    const run = vi.fn().mockResolvedValue(NETSH_SAMPLE_TABLE)
    const collector = createPortProxyCollector({ run })
    const p = {
      ...makeProvider(),
      getPortProxy: vi.fn((ip: string | null) => collector.collect(ip))
    }
    p.getSystemInfo
      .mockResolvedValueOnce(system({ ip: '172.20.144.2' }))
      .mockResolvedValueOnce(system({ ip: '172.20.128.7' }))

    const store = new SnapshotStore(p)
    await store.initialize()

    await store.refreshMedium()
    expect(store.get().dashboard?.portProxy?.distroIp).toBeNull()
    expect(store.get().dashboard?.portProxy?.rules.every((r) => r.verdict === 'unknown')).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)

    await store.refreshSlow()
    const firstSlow = store.get().dashboard?.portProxy
    expect(firstSlow?.distroIp).toBe('172.20.144.2')
    expect(firstSlow?.rules.find((r) => r.listenPort === 8080)?.verdict).toBe('stale')
    expect(firstSlow?.rules.find((r) => r.listenPort === 5173)?.verdict).toBe('live')
    expect(run).toHaveBeenCalledTimes(1)

    await store.refreshSlow()
    const secondSlow = store.get().dashboard?.portProxy
    expect(secondSlow?.distroIp).toBe('172.20.128.7')
    expect(secondSlow?.rules.find((r) => r.listenPort === 8080)?.verdict).toBe('live')
    expect(secondSlow?.rules.find((r) => r.listenPort === 5173)?.verdict).toBe('stale')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent portProxy refresh across medium and slow and converges to the arrived IP', async () => {
    const firstProxy = deferred<{ rules: []; distroIp: string | null; error: null }>()
    const sysDeferred = deferred<ReturnType<typeof system>>()
    let activePortProxy = 0
    let maxConcurrent = 0

    const p = {
      ...makeProvider(),
      getPortProxy: vi.fn(async (ip: string | null) => {
        activePortProxy += 1
        maxConcurrent = Math.max(maxConcurrent, activePortProxy)
        try {
          if (ip === null) return await firstProxy.promise
          return { rules: [], distroIp: ip, error: null }
        } finally {
          activePortProxy -= 1
        }
      })
    }
    p.getSystemInfo.mockImplementation(() => sysDeferred.promise)

    const store = new SnapshotStore(p)
    await store.initialize()

    const pending = Promise.all([store.refreshMedium(), store.refreshSlow()])
    sysDeferred.resolve(system({ ip: '172.20.144.2' }))
    await vi.waitFor(() => {
      expect(p.getPortProxy).toHaveBeenCalledWith(null)
    })
    firstProxy.resolve({ rules: [], distroIp: null, error: null })
    await pending

    expect(maxConcurrent).toBe(1)
    expect(p.getPortProxy).toHaveBeenNthCalledWith(1, null)
    expect(p.getPortProxy).toHaveBeenNthCalledWith(2, '172.20.144.2')
    expect(store.get().dashboard?.portProxy?.distroIp).toBe('172.20.144.2')
  })

  it('clears runner-failed-services on non-systemd distros sequentially and when getServices rejects late', async () => {
    // Sequential: refreshMedium fails before refreshSlow sets systemdEnabled: false.
    const seqProvider = {
      ...makeProvider(),
      getServices: vi.fn(async (_distro: string, systemdEnabled?: boolean | null) => {
        if (systemdEnabled === false) return []
        throw new Error('System has not been booted with systemd as init system')
      })
    }
    seqProvider.getSystemInfo.mockResolvedValue(system({ systemdEnabled: false }))

    const seqStore = new SnapshotStore(seqProvider)
    await seqStore.initialize()
    await seqStore.refreshMedium()
    expect(seqStore.get().warnings.some((w) => w.id === 'runner-failed-services')).toBe(true)

    await seqStore.refreshSlow()
    expect(seqStore.get().dashboard?.services).toEqual([])
    expect(seqStore.get().dashboard?.servicesCollected).toBe(true)
    expect(seqStore.get().warnings.some((w) => w.id === 'runner-failed-services')).toBe(false)
    expect(seqStore.get().warnings.some((w) => w.id === 'systemd-disabled')).toBe(true)

    // Concurrent tail: getServices rejects AFTER refreshSlow already confirmed systemdEnabled: false.
    const svcDeferred = deferred<ReturnType<typeof svc>[]>()
    const concProvider = {
      ...makeProvider(),
      getServices: vi.fn(() => svcDeferred.promise)
    }
    concProvider.getSystemInfo.mockResolvedValue(system({ systemdEnabled: false }))

    const concStore = new SnapshotStore(concProvider)
    await concStore.initialize()
    const medPromise = concStore.refreshMedium()
    await concStore.refreshSlow()
    expect(concStore.get().dashboard?.system.systemdEnabled).toBe(false)

    svcDeferred.reject(new Error('systemctl failed'))
    await medPromise

    expect(concStore.get().dashboard?.services).toEqual([])
    expect(concStore.get().dashboard?.servicesCollected).toBe(true)
    expect(concStore.get().warnings.some((w) => w.id === 'runner-failed-services')).toBe(false)
    expect(concStore.get().warnings.some((w) => w.id === 'systemd-disabled')).toBe(true)
  })

  it('keeps stopped distros un-woken and isolates per-distro explorer and terminal context on switch', async () => {
    const p = {
      ...makeProvider(),
      getWindowsPorts: vi.fn(async () => [windowsPort(8080)]),
      getFirewall: vi.fn(async () => firewall({ defaultInbound: 'Allow' })),
      getWslSettings: vi.fn(async () => wslSettings())
    }
    p.getPorts.mockResolvedValue([{ ...port(8080), localAddress: '0.0.0.0' }])

    const store = new SnapshotStore(p)
    await store.initialize()
    store.setExplorerContext({ distro: 'Ubuntu-24.04', currentPath: '/home/dev/u', showHidden: false })
    store.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/home/dev/u', status: 'ready' })

    await store.setDistro('Debian')
    await Promise.all([store.refreshFast(), store.refreshMedium(), store.refreshSlow()])

    expect(p.getPorts).not.toHaveBeenCalled()
    expect(p.getFirewall).not.toHaveBeenCalled()
    expect(p.getSystemInfo).not.toHaveBeenCalled()
    expect(store.get().explorer.currentPath).toBeNull()
    expect(store.get().terminal.cwd).toBeNull()

    await store.setDistro('Ubuntu-24.04')
    expect(store.get().explorer.currentPath).toBe('/home/dev/u')
    expect(store.get().terminal.cwd).toBe('/home/dev/u')

    await Promise.all([store.refreshFast(), store.refreshMedium(), store.refreshSlow()])
    expect(store.get().dashboard?.ports[0]?.reachability).toBe('lan')
  })
})
