import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceInfo, WslPadSnapshot } from '@shared/types'
import { SnapshotStore } from '../../../src/main/state/store'
import { debian, makeProvider, mcpStatus, resources, ubuntu, type FakeProvider } from './helpers'

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
