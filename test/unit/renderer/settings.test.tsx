import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import SettingsDrawer from '@renderer/settings/SettingsDrawer'

function makeApi() {
  return {
    listDistros: vi.fn(async () => []),
    selectDistro: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => null),
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
      check: vi.fn(async () => ({ state: 'not-available', version: null, percent: null, error: null })),
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
