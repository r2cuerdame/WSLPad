import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import {
  AppUpdater,
  compareVersions,
  judgeInstallOutcome,
  type AutoUpdaterLike
} from '../../src/main/updater'

class FakeAutoUpdater implements AutoUpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  forceDevUpdateConfig = true
  onCalls = 0
  checkCalls = 0
  quitAndInstallCalls = 0
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: never[]) => void): unknown {
    this.onCalls++
    const list = this.handlers.get(event) ?? []
    list.push(listener as (...args: unknown[]) => void)
    this.handlers.set(event, list)
    return this
  }

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls++
    return null
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls++
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args)
  }
}

function collect(): { statuses: UpdateStatus[]; onStatus: (s: UpdateStatus) => void } {
  const statuses: UpdateStatus[] = []
  return { statuses, onStatus: (s) => statuses.push(s) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AppUpdater in dev mode (goal.md §4.3.7)', () => {
  it('reports disabled and never touches the auto updater', async () => {
    const fake = new FakeAutoUpdater()
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: false,
      autoCheck: true,
      onStatus,
      currentVersion: '1.0.0',
      injectAutoUpdater: fake
    })
    updater.start()
    expect(statuses.map((s) => s.state)).toEqual(['disabled'])
    expect(fake.onCalls).toBe(0)
    expect(fake.checkCalls).toBe(0)
    const status = await updater.checkNow()
    expect(status.state).toBe('disabled')
    expect(fake.checkCalls).toBe(0)
    updater.dispose()
  })
})

describe('AppUpdater packaged flow', () => {
  it('configures background download and install-on-quit (goal.md §4.3.5)', () => {
    const fake = new FakeAutoUpdater()
    const { onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: false,
      onStatus,
      currentVersion: '1.0.0',
      injectAutoUpdater: fake
    })
    updater.start()
    expect(fake.autoDownload).toBe(true)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    expect(fake.forceDevUpdateConfig).toBe(false)
    updater.dispose()
  })

  it('emits statuses in order checking → available → downloading → downloaded', () => {
    const fake = new FakeAutoUpdater()
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: true,
      onStatus,
      currentVersion: '1.0.0',
      injectAutoUpdater: fake
    })
    updater.start()
    expect(fake.checkCalls).toBe(1)

    fake.emit('checking-for-update')
    fake.emit('update-available', { version: '1.2.3' })
    fake.emit('download-progress', { percent: 42.5 })
    fake.emit('update-downloaded', { version: '1.2.3' })

    expect(statuses.map((s) => s.state)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded'
    ])
    expect(statuses[1].version).toBe('1.2.3')
    expect(statuses[2].percent).toBe(42.5)
    expect(statuses[3]).toEqual({
      state: 'downloaded',
      version: '1.2.3',
      percent: 100,
      error: null,
      installFailedVersion: null
    })
    expect(updater.getStatus().state).toBe('downloaded')
    updater.dispose()
  })

  it('keeps running on error events (goal.md §4.3.6)', () => {
    const fake = new FakeAutoUpdater()
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: false,
      onStatus,
      currentVersion: '1.0.0',
      injectAutoUpdater: fake
    })
    updater.start()
    fake.emit('error', new Error('network down'))
    expect(statuses.at(-1)).toMatchObject({ state: 'error', error: 'network down' })
    updater.dispose()
  })

  it('does not auto-check when autoCheck is false', () => {
    const fake = new FakeAutoUpdater()
    const { onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: false,
      onStatus,
      currentVersion: '1.0.0',
      injectAutoUpdater: fake
    })
    updater.start()
    expect(fake.checkCalls).toBe(0)
    updater.dispose()
  })

  it('runs the periodic timer and setAutoCheck(false) stops it', async () => {
    vi.useFakeTimers()
    const fake = new FakeAutoUpdater()
    const { onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: true,
      onStatus,
      currentVersion: '1.0.0',
      injectAutoUpdater: fake,
      checkIntervalMs: 1000
    })
    updater.start()
    expect(fake.checkCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(2100)
    expect(fake.checkCalls).toBe(3)
    updater.setAutoCheck(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.checkCalls).toBe(3)
    updater.setAutoCheck(true)
    await vi.advanceTimersByTimeAsync(1100)
    expect(fake.checkCalls).toBe(4)
    updater.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.checkCalls).toBe(4)
  })

  it('proxies quitAndInstall and surfaces checkForUpdates rejections', async () => {
    const fake = new FakeAutoUpdater()
    fake.checkForUpdates = async () => {
      fake.checkCalls++
      throw new Error('offline')
    }
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: false,
      onStatus,
      currentVersion: '1.0.0',
      injectAutoUpdater: fake
    })
    updater.start()
    const status = await updater.checkNow()
    expect(status.state).toBe('error')
    expect(statuses.at(-1)?.error).toBe('offline')
    updater.quitAndInstall()
    expect(fake.quitAndInstallCalls).toBe(1)
    updater.dispose()
  })
})

describe('comparing versions', () => {
  it('reads the numbers, not the characters', () => {
    // The whole feature turns on this: '0.1.10' sorts BEFORE '0.1.9' as text,
    // which would report every successful update as a failure.
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('0.1.9', '0.1.10')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
  })

  it('ignores a prerelease suffix rather than choking on it', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(0)
    expect(compareVersions('nonsense', '0.0.0')).toBe(0)
  })
})

describe('judging what the installer did', () => {
  it('says nothing when no install was ever handed off', () => {
    expect(judgeInstallOutcome(null, '1.0.0')).toBe('none')
  })

  it('calls it installed when the running version caught up', () => {
    expect(judgeInstallOutcome('1.2.0', '1.2.0')).toBe('installed')
    // Someone installing a newer build by hand also counts: the pending one is
    // no longer missing.
    expect(judgeInstallOutcome('1.2.0', '1.3.0')).toBe('installed')
  })

  it('calls it failed when the old version came back', () => {
    expect(judgeInstallOutcome('1.2.0', '1.1.0')).toBe('failed')
  })
})

describe('an update that did not install', () => {
  const store = (initial: string | null = null) => {
    let value = initial
    return {
      read: () => value,
      write: (v: string | null) => void (value = v),
      current: () => value
    }
  }

  it('records the handoff only once an update is actually ready', () => {
    const fake = new FakeAutoUpdater()
    const pendingInstall = store()
    const { onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: false,
      onStatus,
      currentVersion: '1.0.0',
      pendingInstall,
      injectAutoUpdater: fake
    })
    updater.start()

    // Quitting with nothing downloaded is just quitting.
    updater.markInstallHandoff()
    expect(pendingInstall.current()).toBeNull()

    fake.emit('update-downloaded', { version: '1.1.0' })
    updater.markInstallHandoff()
    expect(pendingInstall.current()).toBe('1.1.0')
    updater.dispose()
  })

  it('says so on the next start, even with automatic checks switched off', () => {
    const fake = new FakeAutoUpdater()
    const pendingInstall = store('1.1.0')
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: false,
      onStatus,
      currentVersion: '1.0.0',
      pendingInstall,
      injectAutoUpdater: fake
    })
    updater.start()

    expect(statuses.at(-1)?.installFailedVersion).toBe('1.1.0')
    // Kept on disk: the app is still on the old version tomorrow too.
    expect(pendingInstall.current()).toBe('1.1.0')
    updater.dispose()
  })

  it('keeps saying it while the state machine moves on', () => {
    const fake = new FakeAutoUpdater()
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: true,
      onStatus,
      currentVersion: '1.0.0',
      pendingInstall: store('1.1.0'),
      injectAutoUpdater: fake
    })
    updater.start()
    fake.emit('checking-for-update')
    fake.emit('update-available', { version: '1.1.0' })

    // A notice that vanished on the next poll would be no notice at all.
    expect(statuses.map((s) => s.installFailedVersion)).toEqual(['1.1.0', '1.1.0', '1.1.0'])
    updater.dispose()
  })

  it('forgets it the moment the app comes up on the version in question', () => {
    const fake = new FakeAutoUpdater()
    const pendingInstall = store('1.1.0')
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: true,
      autoCheck: false,
      onStatus,
      currentVersion: '1.1.0',
      pendingInstall,
      injectAutoUpdater: fake
    })
    updater.start()

    expect(statuses).toEqual([])
    expect(pendingInstall.current()).toBeNull()
    updater.dispose()
  })

  it('never claims a failure in dev mode, where there is no installer at all', () => {
    const fake = new FakeAutoUpdater()
    const pendingInstall = store('1.1.0')
    const { statuses, onStatus } = collect()
    const updater = new AppUpdater({
      isPackaged: false,
      autoCheck: false,
      onStatus,
      currentVersion: '1.0.0',
      pendingInstall,
      injectAutoUpdater: fake
    })
    updater.start()

    expect(statuses.map((s) => s.state)).toEqual(['disabled'])
    expect(statuses.at(-1)?.installFailedVersion).toBeNull()
    updater.dispose()
  })
})
