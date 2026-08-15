import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { DefenderInfo, DiskImageInfo, DriveMountsInfo, InotifyInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import DriveMountsBlock from '@renderer/dashboard/DriveMountsBlock'
import DefenderBlock from '@renderer/dashboard/DefenderBlock'
import InotifyBlock from '@renderer/dashboard/InotifyBlock'

const BASE = 'C:\\Users\\dev\\AppData\\Local\\wsl\\Ubuntu-24.04'

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    terminal: {
      ensure: vi.fn(async () => ({ sessionId: 's1', status: 'ready' as const, cwd: null })),
      input: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      setCwd: vi.fn(async () => undefined),
      getState: vi.fn(async () => ({ status: 'ready' as const, cwd: null })),
      onData: vi.fn(() => () => undefined),
      onStatus: vi.fn(() => () => undefined)
    },
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

let api: ReturnType<typeof makeApi>

function Probe(): React.JSX.Element {
  const { preparedCommand } = useApp()
  return <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function show(node: React.ReactNode): Promise<void> {
  render(
    <AppStoreProvider>
      {node}
      <Probe />
    </AppStoreProvider>
  )
  await flush()
}

function prepared(): string {
  return screen.getByTestId('prepared').textContent ?? ''
}

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

beforeEach(() => {
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// drives
// ---------------------------------------------------------------------------

function mounts(over: Partial<DriveMountsInfo> = {}): DriveMountsInfo {
  return {
    drives: [
      {
        point: '/mnt/c',
        source: 'C:\\',
        metadata: false,
        caseSensitivity: 'off',
        uid: 1000,
        gid: 1000,
        umask: null,
        fmask: null,
        dmask: null,
        options: 'rw,noatime'
      }
    ],
    declaredOptions: null,
    declaredEnabled: true,
    ...over
  }
}

describe('DriveMountsBlock', () => {
  it('says plainly that chmod does not persist without metadata', async () => {
    await show(<DriveMountsBlock mounts={mounts()} />)
    const row = screen.getByText('/mnt/c').closest('.kv-row') as HTMLElement
    expect(within(row).getByText('no metadata')).toBeTruthy()
    expect(screen.getByText(/report success and store nothing/i)).toBeTruthy()
  })

  it('stays quiet about a drive that does have it', async () => {
    const info = mounts({ drives: [{ ...mounts().drives[0], metadata: true }] })
    await show(<DriveMountsBlock mounts={info} />)
    expect(screen.getByText('metadata')).toBeTruthy()
    expect(screen.queryByText(/store nothing/i)).toBeNull()
  })

  /** The same declared-vs-in-force gap the WSL settings section exists for. */
  it('names the restart when the file asks for metadata and the mount lacks it', async () => {
    await show(<DriveMountsBlock mounts={mounts({ declaredOptions: 'metadata,umask=22' })} />)
    expect(screen.getByText(/needs wsl --shutdown/i)).toBeTruthy()
  })

  it('does not blame the file when it never asked for metadata', async () => {
    await show(<DriveMountsBlock mounts={mounts({ declaredOptions: 'umask=22' })} />)
    expect(screen.queryByText(/needs wsl --shutdown/i)).toBeNull()
  })

  it('shows the options that shape permissions, and only those that exist', async () => {
    await show(<DriveMountsBlock mounts={mounts()} />)
    const row = screen.getByText('/mnt/c').closest('.kv-row') as HTMLElement
    expect(within(row).getByText('uid=1000')).toBeTruthy()
    expect(within(row).getByText('case=off')).toBeTruthy()
    // No umask was recorded, so none is invented.
    expect(row.textContent).not.toContain('umask=')
  })

  it('separates automount being off from nothing being read', async () => {
    await show(<DriveMountsBlock mounts={mounts({ drives: [], declaredEnabled: false })} />)
    expect(screen.getByText(/Automount is off/i)).toBeTruthy()

    cleanup()
    await show(<DriveMountsBlock mounts={null} />)
    expect(screen.queryByText('Windows drives')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// defender
// ---------------------------------------------------------------------------

function disk(over: Partial<DiskImageInfo> = {}): DiskImageInfo {
  return {
    distro: 'Ubuntu-24.04',
    vhdxPath: `${BASE}\\ext4.vhdx`,
    basePath: BASE,
    vhdxBytes: 1,
    allocatedBytes: 1,
    sparse: false,
    fsSizeBytes: 1,
    fsUsedBytes: 1,
    reclaimableBytes: 0,
    error: null,
    ...over
  }
}

function defender(over: Partial<DefenderInfo> = {}): DefenderInfo {
  return { available: true, elevated: false, realtimeEnabled: true, exclusionPaths: null, ...over }
}

describe('DefenderBlock', () => {
  /**
   * The failure this block exists to prevent: an unelevated read returns a
   * placeholder, and calling that "not excluded" would be a confident wrong
   * answer on every ordinary machine.
   */
  it('says it cannot see the list rather than claiming nothing is excluded', async () => {
    await show(<DefenderBlock defender={defender()} disk={disk()} />)
    const row = screen.getByText('This image excluded').closest('.kv-row') as HTMLElement
    expect(within(row).getByText('Unknown')).toBeTruthy()
    expect(within(row).queryByText('Not excluded')).toBeNull()
    expect(screen.getByText(/only be read by an elevated process/i)).toBeTruthy()
  })

  it('reports not-excluded only when the list was genuinely readable', async () => {
    await show(
      <DefenderBlock
        defender={defender({ elevated: true, exclusionPaths: ['C:\\Temp'] })}
        disk={disk()}
      />
    )
    const row = screen.getByText('This image excluded').closest('.kv-row') as HTMLElement
    expect(within(row).getByText('Not excluded')).toBeTruthy()
    expect(screen.getByText(/reads every block WSL touches/i)).toBeTruthy()
  })

  it('drops the warning and the command once the image is excluded', async () => {
    await show(
      <DefenderBlock
        defender={defender({ elevated: true, exclusionPaths: [BASE] })}
        disk={disk()}
      />
    )
    expect(screen.getByText('Excluded')).toBeTruthy()
    expect(screen.queryByText(/reads every block/i)).toBeNull()
    expect(screen.queryByText(/Add-MpPreference/)).toBeNull()
  })

  /**
   * The Console is a shell inside the distribution and this needs an elevated
   * Windows PowerShell, so offering it as a prepared command would be a lie
   * about what pressing Enter would do.
   */
  it('offers the exclusion as text to copy, never as a prepared command', async () => {
    await show(<DefenderBlock defender={defender()} disk={disk()} />)
    expect(screen.getByText(`Add-MpPreference -ExclusionPath '${BASE}'`)).toBeTruthy()
    expect(screen.getByText(/elevated PowerShell/i)).toBeTruthy()
    expect(prepared()).toBe('')
    expect(api.terminal.input).not.toHaveBeenCalled()
  })

  it('does not warn about a scanner that is switched off', async () => {
    await show(
      <DefenderBlock
        defender={defender({ realtimeEnabled: false, elevated: true, exclusionPaths: [] })}
        disk={disk()}
      />
    )
    expect(screen.queryByText(/reads every block/i)).toBeNull()
  })

  it('shows nothing at all when Defender never answered', async () => {
    await show(<DefenderBlock defender={null} disk={disk()} />)
    expect(screen.queryByText('Microsoft Defender')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// inotify
// ---------------------------------------------------------------------------

const RAISE = "wsl.exe -d 'Ubuntu-24.04' -u root sh -c 'echo …'"

function inotify(over: Partial<InotifyInfo> = {}): InotifyInfo {
  return { maxUserWatches: 8192, maxUserInstances: 128, raiseCommand: RAISE, ...over }
}

describe('InotifyBlock', () => {
  it('names the error the ceiling actually produces', async () => {
    await show(<InotifyBlock inotify={inotify()} />)
    expect(screen.getByText(/no space left on device/i)).toBeTruthy()
    const row = screen.getByText('Watches per user').closest('.kv-row') as HTMLElement
    expect(within(row).getByText('Low')).toBeTruthy()
  })

  it('stays quiet on a machine that is already generous', async () => {
    await show(<InotifyBlock inotify={inotify({ maxUserWatches: 1048576 })} />)
    expect(screen.queryByText('Low')).toBeNull()
    expect(screen.queryByText(/no space left on device/i)).toBeNull()
    // The numbers are still worth showing when they are fine.
    expect(screen.getByText('Watches per user')).toBeTruthy()
  })

  it('only prepares the raise, never runs it', async () => {
    await show(<InotifyBlock inotify={inotify()} />)
    fireEvent.click(screen.getByRole('button', { name: /Prepare the sysctl command/i }))
    await flush()
    expect(prepared()).toBe(RAISE)
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.ensure).not.toHaveBeenCalled()
  })

  it('shows a dash for a limit it could not read, not a zero', async () => {
    await show(<InotifyBlock inotify={inotify({ maxUserWatches: null })} />)
    const row = screen.getByText('Watches per user').closest('.kv-row') as HTMLElement
    expect(row.textContent).toContain('—')
    // Unknown is not low, so no verdict is offered either.
    expect(screen.queryByText('Low')).toBeNull()
  })

  it('shows nothing when the limits were never read', async () => {
    await show(<InotifyBlock inotify={null} />)
    expect(screen.queryByText('File watchers')).toBeNull()
  })
})
