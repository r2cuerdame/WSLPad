import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { ClockInfo, DistroDetails, DistroLiveness, SystemInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import OverviewCard from '@renderer/dashboard/OverviewCard'

const WINDOWS_ISO = '2026-07-30T12:00:00.000Z'
const HWCLOCK = 'sudo hwclock -s'
const TIMESYNCD = 'sudo systemctl restart systemd-timesyncd'

const DISTRO: DistroDetails = {
  name: 'Ubuntu-24.04',
  state: 'Running',
  wslVersion: 2,
  isDefault: true,
  osName: 'Ubuntu 24.04.2 LTS',
  uncPath: '\\\\wsl.localhost\\Ubuntu-24.04'
}

function system(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    kernel: '6.6.36-microsoft-standard-WSL2',
    hostname: 'devbox',
    user: 'dev',
    home: '/home/dev',
    shell: '/bin/bash',
    uptimeSeconds: 7200,
    systemdEnabled: true,
    ip: '172.20.0.2',
    windowsUserProfileLinux: '/mnt/c/Users/dev',
    ...over
  }
}

function clock(over: Partial<ClockInfo> = {}): ClockInfo {
  return {
    windowsIso: WINDOWS_ISO,
    distroIso: '2026-07-30T11:59:13.000Z',
    skewSeconds: -47,
    ...over
  }
}

/** Every API a card could use to make something happen, so none may fire. */
function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    openInWindowsExplorer: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    windows: { openPath: vi.fn(async () => undefined) },
    terminal: {
      ensure: vi.fn(async () => ({ sessionId: 's1', status: 'running', cwd: null })),
      input: vi.fn(async () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

let api: ReturnType<typeof makeApi>

function PreparedProbe(): React.JSX.Element {
  const { preparedCommand } = useApp()
  return <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderCard(
  clockInfo: ClockInfo | null,
  systemInfo: SystemInfo = system(),
  liveness: DistroLiveness | null = null
): Promise<void> {
  render(
    <AppStoreProvider>
      <OverviewCard liveness={liveness} distro={DISTRO} system={systemInfo} clock={clockInfo} />
      <PreparedProbe />
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

describe('OverviewCard clock', () => {
  it('puts both clocks side by side with the drift between them', async () => {
    await renderCard(clock())
    expect(screen.getByText('Clock')).toBeTruthy()
    expect(screen.getByTitle(WINDOWS_ISO)).toBeTruthy()
    expect(screen.getByTitle('2026-07-30T11:59:13.000Z')).toBeTruthy()
    expect(screen.getByText('47 s behind Windows')).toBeTruthy()
  })

  it('says the number is approximate rather than pretending to be exact', async () => {
    await renderCard(clock())
    expect(
      screen.getByText('The two clocks are read a moment apart, so this difference is approximate.')
    ).toBeTruthy()
  })

  it('reports a clock ahead of Windows in the same terms', async () => {
    await renderCard(clock({ skewSeconds: 62 }))
    expect(screen.getByText('62 s ahead of Windows')).toBeTruthy()
  })

  it('calls a sub-threshold difference no drift and offers no correction', async () => {
    await renderCard(clock({ skewSeconds: 0 }))
    expect(screen.getByText('In step with Windows')).toBeTruthy()
    expect(screen.queryByRole('button', { name: `Prepare ${HWCLOCK}` })).toBeNull()
  })

  it('shows a small difference without dressing it up as a failure', async () => {
    await renderCard(clock({ skewSeconds: -3 }))
    expect(screen.getByText('3 s behind Windows')).toBeTruthy()
    expect(document.querySelector('.badge-warn')).toBeNull()
    expect(screen.queryByRole('button', { name: `Prepare ${HWCLOCK}` })).toBeNull()
  })

  it('keeps one readable clock from becoming a skew of zero', async () => {
    await renderCard(clock({ distroIso: null, skewSeconds: null }))
    expect(screen.getByText('Only one of the two clocks could be read')).toBeTruthy()
    expect(screen.queryByText('In step with Windows')).toBeNull()
    expect(screen.queryByRole('button', { name: `Prepare ${HWCLOCK}` })).toBeNull()
  })

  it('omits the whole block until a clock has been sampled', async () => {
    await renderCard(null)
    expect(screen.queryByText('Clock')).toBeNull()
    expect(screen.getByText('Ubuntu-24.04')).toBeTruthy()
  })

  it('explains what a drifted clock breaks', async () => {
    await renderCard(clock())
    expect(
      screen.getByText(
        'A drifted clock makes TLS certificates and package signatures fail before anything explains why.'
      )
    ).toBeTruthy()
    expect(document.querySelector('.badge-warn')).toBeTruthy()
  })

  it('prepares the correction in the Console instead of running it', async () => {
    await renderCard(clock())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Prepare ${HWCLOCK}` }))
      await Promise.resolve()
    })
    expect(prepared()).toBe(HWCLOCK)
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.ensure).not.toHaveBeenCalled()
    expect(api.openExternal).not.toHaveBeenCalled()
    expect(api.windows.openPath).not.toHaveBeenCalled()
  })

  it('offers the time daemon only where one exists', async () => {
    await renderCard(clock())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Prepare ${TIMESYNCD}` }))
      await Promise.resolve()
    })
    expect(prepared()).toBe(TIMESYNCD)

    cleanup()
    await renderCard(clock(), system({ systemdEnabled: false }))
    expect(screen.queryByRole('button', { name: `Prepare ${TIMESYNCD}` })).toBeNull()
    expect(screen.getByRole('button', { name: `Prepare ${HWCLOCK}` })).toBeTruthy()
  })
})

/**
 * Issue #73: `wsl --list` keeps saying Running for a distribution that stopped
 * answering — after a lid close, a hung mount, an OOM kill of the init. The
 * probe knows within one cycle, and the badge has to say so.
 */
describe('OverviewCard liveness', () => {
  const alive: DistroLiveness = {
    distro: 'Ubuntu-24.04',
    answering: true,
    lastAliveAt: '2026-07-30T11:59:00.000Z',
    failures: 0
  }

  it('keeps the plain Running badge while the probe is being answered', async () => {
    await renderCard(null, system(), alive)
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.queryByText(/not answering/i)).toBeNull()
  })

  it('contradicts the list when the probe has stopped getting answers', async () => {
    await renderCard(null, system(), { ...alive, answering: false, failures: 3 })
    expect(screen.getByText('Running — not answering')).toBeTruthy()
    // And says when it last worked, so the user can place the failure in time.
    expect(screen.getByText(/the last reply was at/i)).toBeTruthy()
  })

  it('says plainly that it never answered rather than inventing a time', async () => {
    await renderCard(null, system(), {
      ...alive,
      answering: false,
      lastAliveAt: null,
      failures: 1
    })
    expect(screen.getByText(/has not answered once since WSLPad started/i)).toBeTruthy()
    expect(screen.queryByText(/the last reply was at/i)).toBeNull()
  })

  it('trusts the list while liveness is still unknown', async () => {
    await renderCard(null, system(), { ...alive, answering: null, lastAliveAt: null })
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.queryByText(/not answering/i)).toBeNull()
  })
})
