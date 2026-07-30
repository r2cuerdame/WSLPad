import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import SettingsDrawer from '@renderer/settings/SettingsDrawer'
import Toasts from '@renderer/components/Toasts'

/** Minimal snapshot: the drawer only reads `mcp` out of it. */
function makeSnapshot(): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-30T12:00:00.000Z',
    selectedDistro: 'Ubuntu-24.04',
    distros: [{ name: 'Ubuntu-24.04', state: 'Running', wslVersion: 2, isDefault: true }],
    dashboard: null,
    explorer: { distro: 'Ubuntu-24.04', currentPath: '/home/dev', showHidden: false },
    terminal: { distro: 'Ubuntu-24.04', cwd: '/home/dev', status: 'ready' },
    mcp: {
      running: true,
      transport: 'http',
      endpoint: 'http://127.0.0.1:4923/mcp',
      port: 4923,
      connectedClients: 1,
      lastRequestAt: '2026-07-30T11:59:00.000Z',
      readOnly: true,
      tokenSet: true,
      error: null
    },
    warnings: []
  }
}

let snapshot: WslPadSnapshot | null = null

function makeApi() {
  return {
    listDistros: vi.fn(async () => []),
    selectDistro: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined),
    revealEnv: vi.fn(async () => null),
    copyLlmMarkdown: vi.fn(async () => ''),
    exportLlmJson: vi.fn(async () => null),
    convertPath: vi.fn(async () => ''),
    openInWindowsExplorer: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    terminal: {
      ensure: vi.fn(async () => ({ sessionId: 's1', status: 'ready', cwd: null })),
      input: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      setCwd: vi.fn(async () => undefined),
      getState: vi.fn(async () => ({ status: 'ready', cwd: null })),
      onData: vi.fn(() => () => undefined),
      onStatus: vi.fn(() => () => undefined)
    },
    settings: {
      get: vi.fn(async () => defaultSettings()),
      set: vi.fn(async () => defaultSettings()),
      reset: vi.fn(async () => defaultSettings()),
      getLoadError: vi.fn(async () => ({ corrupted: false, message: null })),
      onChange: vi.fn(() => () => undefined)
    },
    mcp: {
      status: vi.fn(async () => null),
      regenerateToken: vi.fn(async () => null),
      registerClient: vi.fn(async () => ({ ok: true, configPath: null, error: null })),
      test: vi.fn(async () => ({ ok: true, error: null })),
      getConfigJson: vi.fn(async () => '{}'),
      onStatus: vi.fn(() => () => undefined)
    },
    updates: {
      check: vi.fn(async () => ({
        state: 'not-available',
        version: null,
        percent: null,
        error: null
      })),
      install: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({ state: 'idle', version: null, percent: null, error: null })),
      onStatus: vi.fn(() => () => undefined)
    },
    app: {
      version: vi.fn(async () => '0.1.0'),
      quit: vi.fn(async () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onOpProgress: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

type MockApi = ReturnType<typeof makeApi>

let api: MockApi

function OpenSettingsOnMount(): null {
  const { openSettings } = useApp()
  useEffect(() => {
    openSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderDrawer(): Promise<void> {
  render(
    <AppStoreProvider>
      <OpenSettingsOnMount />
      <SettingsDrawer />
      <Toasts />
    </AppStoreProvider>
  )
  await flush()
  await screen.findByRole('dialog', { name: 'Settings' })
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
  snapshot = makeSnapshot()
  api = makeApi()
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsDrawer', () => {
  it('closes on Escape', async () => {
    await renderDrawer()
    const panel = screen.getByRole('dialog', { name: 'Settings' })
    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull())
  })

  it('clamps a too-small MCP port before persisting', async () => {
    await renderDrawer()
    const port = screen.getByLabelText(/Local port/)
    fireEvent.change(port, { target: { value: '80' } })
    fireEvent.blur(port)
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ mcp: { port: 1024 } }))
  })

  it('clamps a too-large MCP port before persisting', async () => {
    await renderDrawer()
    const port = screen.getByLabelText(/Local port/)
    fireEvent.change(port, { target: { value: '999999' } })
    fireEvent.blur(port)
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ mcp: { port: 65535 } }))
  })

  it('ignores a non-numeric port without persisting', async () => {
    await renderDrawer()
    const port = screen.getByLabelText(/Local port/)
    fireEvent.change(port, { target: { value: '' } })
    fireEvent.blur(port)
    await flush()
    expect(api.settings.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ mcp: expect.anything() })
    )
  })

  it('resets all settings only after the confirm dialog', async () => {
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Restore all defaults' }))
    expect(api.settings.reset).not.toHaveBeenCalled()

    await screen.findByRole('dialog', { name: 'Restore all settings?' })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(api.settings.reset).toHaveBeenCalledTimes(1))
  })

  it('cancelling the reset dialog does not reset', async () => {
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Restore all defaults' }))
    await screen.findByRole('dialog', { name: 'Restore all settings?' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Restore all settings?' })).toBeNull()
    )
    expect(api.settings.reset).not.toHaveBeenCalled()
  })
})

describe('SettingsDrawer MCP section', () => {
  it('shows the MCP status from the snapshot without adding a tab', async () => {
    await renderDrawer()
    const panel = screen.getByRole('dialog', { name: 'Settings' })

    expect(within(panel).getByText('Running')).toBeTruthy()
    expect(within(panel).getByText('Read-only')).toBeTruthy()
    expect(within(panel).getByText('HTTP')).toBeTruthy()
    expect(within(panel).getByText('http://127.0.0.1:4923/mcp')).toBeTruthy()
    expect(within(panel).getByText('Configured')).toBeTruthy()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('copies the endpoint through the clipboard IPC', async () => {
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Copy endpoint' }))
    await waitFor(() =>
      expect(api.copyToClipboard).toHaveBeenCalledWith('http://127.0.0.1:4923/mcp')
    )
  })

  it('copies the config JSON through the MCP IPC and toasts', async () => {
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Copy config JSON' }))

    await waitFor(() => expect(api.mcp.getConfigJson).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.copyToClipboard).toHaveBeenCalledWith('{}'))
    expect(await screen.findByText('Copied')).toBeTruthy()
  })

  it('registers a client on an explicit click and toasts the success', async () => {
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Register in Codex' }))

    await waitFor(() => expect(api.mcp.registerClient).toHaveBeenCalledWith('codex'))
    expect(await screen.findByText('Registered in Codex')).toBeTruthy()
  })

  it('toasts an error when the registration fails', async () => {
    api.mcp.registerClient.mockResolvedValue({ ok: false, configPath: null, error: null })
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Register in Claude Desktop' }))

    await waitFor(() => expect(api.mcp.registerClient).toHaveBeenCalledWith('claude-desktop'))
    expect(await screen.findByText('Could not update Claude Desktop configuration')).toBeTruthy()
  })

  it('tests the connection through the MCP IPC', async () => {
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    await waitFor(() => expect(api.mcp.test).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Connection OK')).toBeTruthy()
  })

  it('regenerates the auth token through the MCP IPC', async () => {
    await renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate auth token' }))

    await waitFor(() => expect(api.mcp.regenerateToken).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Token regenerated — re-register clients')).toBeTruthy()
  })

  it('keeps the actions usable before the first snapshot arrives', async () => {
    snapshot = null
    await renderDrawer()

    expect(screen.getByRole('button', { name: 'Copy config JSON' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Register in Hermes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy endpoint' })).toBeNull()
  })
})
