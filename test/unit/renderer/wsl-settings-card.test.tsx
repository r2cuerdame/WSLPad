import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { WslConfigInfo, WslSettingInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import WslSettingsCard, { settingNeedsAttention } from '@renderer/dashboard/WslSettingsCard'

function setting(over: Partial<WslSettingInfo>): WslSettingInfo {
  return {
    key: 'memory',
    section: 'wsl2',
    scope: 'windows',
    declaredValue: null,
    effectiveValue: null,
    origin: 'default',
    verdict: 'not-set',
    note: null,
    ...over
  }
}

const SETTINGS: WslSettingInfo[] = [
  setting({
    key: 'memory',
    declaredValue: '16GB',
    effectiveValue: '15.6GB',
    origin: 'wslconfig',
    verdict: 'applied',
    note: 'Read from MemTotal in the guest.'
  }),
  setting({
    key: 'processors',
    declaredValue: '12',
    effectiveValue: '8',
    origin: 'wslconfig',
    verdict: 'pending-restart',
    note: 'The running VM still reports 8. Applies after wsl --shutdown.'
  }),
  setting({
    key: 'memroy',
    declaredValue: '8GB',
    origin: 'wslconfig',
    verdict: 'unknown-key',
    note: 'WSL ignores this key. Did you mean memory?'
  }),
  setting({
    key: 'networkingMode',
    section: 'experimental',
    declaredValue: 'mirrored',
    origin: 'wslconfig',
    verdict: 'wrong-section',
    note: 'Current WSL releases read networkingMode from [wsl2], not [experimental].'
  }),
  setting({ key: 'localhostForwarding', effectiveValue: 'true' }),
  setting({
    key: 'systemd',
    section: 'boot',
    scope: 'linux',
    declaredValue: 'true',
    effectiveValue: 'true',
    origin: 'wsl-conf',
    verdict: 'applied',
    note: 'PID 1 is systemd.'
  }),
  setting({
    key: 'appendWindowsPath',
    section: 'interop',
    scope: 'linux',
    effectiveValue: 'true',
    origin: 'computed'
  })
]

function info(over: Partial<WslConfigInfo> = {}): WslConfigInfo {
  return {
    wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
    wslconfigExists: true,
    wslConfPath: '/etc/wsl.conf',
    wslConfExists: true,
    restartPending: false,
    vmStartedAt: '2026-01-02T11:50:00.000Z',
    networkingModeDeclared: null,
    networkingModeEffective: 'nat',
    settings: SETTINGS,
    ...over
  }
}

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

/** Surfaces the store fields the card is supposed to drive. */
function Probe(): React.JSX.Element {
  const { preparedCommand, explorerNavigateRequest, tab, toasts } = useApp()
  return (
    <>
      <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
      <div data-testid="nav">
        {explorerNavigateRequest === null
          ? ''
          : `${explorerNavigateRequest.fs}:${explorerNavigateRequest.path}`}
      </div>
      <div data-testid="tab">{tab}</div>
      <div data-testid="toasts">{toasts.map((t) => t.text).join('|')}</div>
    </>
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderCard(value: WslConfigInfo | null = info()): Promise<void> {
  render(
    <AppStoreProvider>
      <WslSettingsCard settings={value} />
      <Probe />
    </AppStoreProvider>
  )
  await flush()
}

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').filter((r) => r.querySelectorAll('td').length > 0)
}

function rowFor(label: string): HTMLElement {
  const found = bodyRows().find((r) =>
    (r.querySelectorAll('td')[0].textContent ?? '').startsWith(label)
  )
  if (found === undefined) throw new Error(`no row for ${label}`)
  return found
}

function cells(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? '')
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
  window.localStorage.clear()
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WslSettingsCard networking headline', () => {
  it('leads with the declared mode against the one actually in force', async () => {
    await renderCard(info({ networkingModeDeclared: 'mirrored', networkingModeEffective: 'nat' }))
    const status = screen.getAllByRole('status')[0]
    expect(status.textContent).toContain('mirrored requested, running as nat')
    // A word, not only a colour.
    expect(within(status).getByText('Mismatch')).toBeTruthy()
  })

  it('states the running mode plainly when the two agree', async () => {
    await renderCard(info({ networkingModeDeclared: 'nat', networkingModeEffective: 'nat' }))
    expect(screen.queryByText('Mismatch')).toBeNull()
    const row = screen.getByText('Networking mode').closest('.kv-row') as HTMLElement
    expect(row.textContent).toContain('nat')
    expect(within(row).getByText('Applied')).toBeTruthy()
  })
})

describe('WslSettingsCard restart banner', () => {
  it('stays away while the running VM matches the files on disk', async () => {
    await renderCard()
    expect(screen.queryByRole('button', { name: /shutdown/i })).toBeNull()
  })

  it('only PREPARES wsl --shutdown, never runs it', async () => {
    await renderCard(info({ restartPending: true }))
    const button = screen.getByRole('button', { name: 'Prepare wsl --shutdown' })

    fireEvent.click(button)
    await flush()

    expect(screen.getByTestId('prepared').textContent).toBe('wsl.exe --shutdown')
    // Nothing was executed: no terminal input, no session, no shell out.
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.ensure).not.toHaveBeenCalled()
    expect(api.openExternal).not.toHaveBeenCalled()
    expect(screen.getByTestId('toasts').textContent).toBe('Command prepared in Console')
  })

  it('says plainly that the VM predates the files', async () => {
    await renderCard(info({ restartPending: true }))
    expect(screen.getByText(/VM started before these files were last saved/i)).toBeTruthy()
  })
})

describe('WslSettingsCard table', () => {
  it('groups the two files, each with its own path', async () => {
    await renderCard()
    const headings = screen
      .getAllByText(/^(\.wslconfig|\/etc\/wsl\.conf)$/)
      .filter((el) => el.className === 'path-label')
      .map((el) => el.textContent)
    expect(headings).toEqual(['.wslconfig', '/etc/wsl.conf'])
    expect(screen.getByText('C:\\Users\\dev\\.wslconfig')).toBeTruthy()
    expect(screen.getByTitle('/etc/wsl.conf')).toBeTruthy()
  })

  it('pairs every verdict chip with a word', async () => {
    await renderCard()
    expect(cells(rowFor('wsl2.memory'))).toContain('Applied')
    expect(cells(rowFor('wsl2.processors'))).toContain('Restart needed')
    expect(cells(rowFor('wsl2.memroy'))).toContain('Unknown key')
    expect(cells(rowFor('experimental.networkingMode'))).toContain('Wrong section')
  })

  it('shows the declared value, the effective one and why they differ', async () => {
    await renderCard()
    const row = cells(rowFor('wsl2.processors'))
    expect(row[1]).toBe('12')
    expect(row[2]).toBe('8')
    expect(rowFor('wsl2.processors').textContent).toContain('Applies after wsl --shutdown')
  })

  it('marks an unreadable effective value instead of inventing one', async () => {
    await renderCard()
    const cell = rowFor('wsl2.memroy').querySelectorAll('td')[2]
    expect(cell.textContent).toBe('—')
    expect(cell.getAttribute('title')).toBe(
      'WSLPad cannot read this value back from a running system'
    )
  })
})

describe('WslSettingsCard filters', () => {
  it('hides unset defaults by default and remembers being switched off', async () => {
    await renderCard()
    expect(bodyRows()).toHaveLength(5)
    expect(bodyRows().some((r) => cells(r)[0].startsWith('wsl2.localhostForwarding'))).toBe(false)

    fireEvent.click(screen.getByLabelText('Hide unset defaults'))
    expect(bodyRows()).toHaveLength(7)
    expect(window.localStorage.getItem('wslpad.dashboard.wslconfig.hideDefaults')).toBe('0')

    cleanup()
    await renderCard()
    expect((screen.getByLabelText('Hide unset defaults') as HTMLInputElement).checked).toBe(false)
    expect(bodyRows()).toHaveLength(7)
  })

  it('filters on key, section and value', async () => {
    await renderCard()
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'processors' } })
    expect(bodyRows()).toHaveLength(1)
    expect(cells(bodyRows()[0])[0]).toContain('wsl2.processors')
    expect(screen.getByText('No setting matches the filter')).toBeTruthy()
  })
})

describe('WslSettingsCard file actions', () => {
  it('copies the exact path of each file', async () => {
    await renderCard()
    const buttons = screen.getAllByRole('button', { name: 'Copy path' })
    await act(async () => {
      fireEvent.click(buttons[0])
      await Promise.resolve()
    })
    expect(api.copyToClipboard).toHaveBeenCalledWith('C:\\Users\\dev\\.wslconfig')
  })

  it('opens .wslconfig in the Windows pane and wsl.conf in its Linux directory', async () => {
    await renderCard()
    const buttons = screen.getAllByRole('button', { name: 'Show in Explorer' })

    fireEvent.click(buttons[0])
    expect(screen.getByTestId('nav').textContent).toBe('windows:C:\\Users\\dev\\.wslconfig')
    expect(screen.getByTestId('tab').textContent).toBe('explorer')

    fireEvent.click(buttons[1])
    expect(screen.getByTestId('nav').textContent).toBe('linux:/etc')
  })

  it('disables the Explorer action for a file that is not there', async () => {
    await renderCard(info({ wslConfExists: false }))
    const buttons = screen.getAllByRole('button', { name: 'Show in Explorer' })
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('Missing')).toHaveLength(1)
  })
})

describe('WslSettingsCard empty states', () => {
  it('says so when the section has no data at all', async () => {
    await renderCard(null)
    expect(screen.getByText('No WSL settings information for this distribution')).toBeTruthy()
  })

  it('says so when a file declares nothing', async () => {
    await renderCard(info({ settings: SETTINGS.filter((s) => s.scope === 'windows') }))
    expect(screen.getByText('Nothing is configured in this file')).toBeTruthy()
  })
})

describe('settingNeedsAttention', () => {
  it('counts only the verdicts the user can act on', () => {
    expect(SETTINGS.filter(settingNeedsAttention).map((s) => s.key)).toEqual([
      'processors',
      'memroy',
      'networkingMode'
    ])
  })
})
