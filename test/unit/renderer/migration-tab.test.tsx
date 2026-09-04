import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@shared/schemas'
import { initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import MigrationTab from '@renderer/migration/MigrationTab'

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
    onNavigateSettings: vi.fn(() => () => undefined),
    selectDistro: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined)
  }
}

describe('MigrationTab', () => {
  beforeAll(() => {
    initRendererI18n('en')
  })

  beforeEach(() => {
    // @ts-expect-error test mock
    window.wslpad = makeApi()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the title and stepper buttons', async () => {
    await act(async () => {
      render(
        <AppStoreProvider>
          <MigrationTab />
        </AppStoreProvider>
      )
    })

    expect(screen.getByText('VHDX Safe Relocation Wizard')).toBeTruthy()
    expect(screen.getAllByText('1. Choose Target Location').length).toBeGreaterThan(0)
  })

  it('navigates through steps using the stepper buttons', async () => {
    await act(async () => {
      render(
        <AppStoreProvider>
          <MigrationTab />
        </AppStoreProvider>
      )
    })

    // Click step 2
    const step2Btn = screen.getByText('2. Terminate WSL & Export Backup')
    fireEvent.click(step2Btn)

    expect(screen.getByText('Export command (Run in PowerShell / CMD)')).toBeTruthy()

    // Click verify export
    const verifyBtn = screen.getByText('Verify Backup File')
    fireEvent.click(verifyBtn)

    expect(screen.getByText(/Backup file verified successfully!/)).toBeTruthy()
  })
})
