import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@shared/schemas'
import { initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import MigrationTab from '@renderer/migration/MigrationTab'
import type { WindowsPlace } from '@shared/types'

const GIB = 1024 ** 3

function makeDrives(): WindowsPlace[] {
  return [
    {
      id: 'drive-C',
      label: 'C:',
      path: 'C:\\',
      kind: 'drive',
      totalBytes: 500 * GIB,
      freeBytes: 200 * GIB
    },
    {
      id: 'drive-D',
      label: 'D:',
      path: 'D:\\',
      kind: 'drive',
      totalBytes: 1000 * GIB,
      freeBytes: 600 * GIB
    }
  ]
}

function makeApi() {
  const mkdirMock = vi.fn(async () => undefined)
  const openPathMock = vi.fn(async () => undefined)

  return {
    getSnapshot: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    openInWindowsExplorer: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    windows: {
      places: vi.fn(async () => makeDrives()),
      mkdir: mkdirMock,
      openPath: openPathMock
    },
    terminal: {
      ensure: vi.fn(async () => ({ sessionId: 's1', status: 'running', cwd: null })),
      input: vi.fn(async () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined),
    selectDistro: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined),
    _mkdirMock: mkdirMock,
    _openPathMock: openPathMock
  }
}

describe('MigrationTab', () => {
  beforeAll(() => {
    initRendererI18n('en')
  })

  let api: ReturnType<typeof makeApi>

  beforeEach(() => {
    api = makeApi()
    // @ts-expect-error test mock
    window.wslpad = api
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the title and detects real Windows drives', async () => {
    await act(async () => {
      render(
        <AppStoreProvider>
          <MigrationTab />
        </AppStoreProvider>
      )
    })

    expect(screen.getByText('VHDX Safe Relocation Wizard')).toBeTruthy()
    expect(screen.getAllByText('1. Choose Target Location').length).toBeGreaterThan(0)
    expect(screen.getByText(/Target Drive/)).toBeTruthy()
  })

  it('opens target folder in Explorer when clicking openFolder button', async () => {
    await act(async () => {
      render(
        <AppStoreProvider>
          <MigrationTab />
        </AppStoreProvider>
      )
    })

    const openBtn = screen.getByText('Open in Explorer')
    await act(async () => {
      fireEvent.click(openBtn)
    })

    expect(api._mkdirMock).toHaveBeenCalled()
    expect(api._openPathMock).toHaveBeenCalled()
  })

  it('enforces strict verification gates: cannot proceed to next step until verified', async () => {
    await act(async () => {
      render(
        <AppStoreProvider>
          <MigrationTab />
        </AppStoreProvider>
      )
    })

    // Step 1 is ready (600GB free on D:), so Next button should be enabled
    const nextBtn = screen.getByRole('button', { name: 'Next Step' })
    expect(nextBtn.hasAttribute('disabled')).toBe(false)

    // Click Next Step to go to Step 2
    await act(async () => {
      fireEvent.click(nextBtn)
    })

    expect(screen.getByText('Export command (Run in PowerShell / CMD)')).toBeTruthy()

    // On Step 2, Next Step MUST be disabled because verifiedStep2 is false!
    expect(nextBtn.hasAttribute('disabled')).toBe(true)

    // Step 3 button should be disabled
    const step3Btn = screen.getByText('3. Import into New Location').closest('button')!
    expect(step3Btn.hasAttribute('disabled')).toBe(true)

    // Now click Verify Backup File
    const verifyBtn = screen.getByText('Verify Backup File')
    await act(async () => {
      fireEvent.click(verifyBtn)
    })

    expect(screen.getByText(/Backup file verified successfully!/)).toBeTruthy()

    // Now Next Step button should be enabled!
    expect(nextBtn.hasAttribute('disabled')).toBe(false)
    expect(step3Btn.hasAttribute('disabled')).toBe(false)
  })
})
