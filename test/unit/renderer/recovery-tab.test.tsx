import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { WindowsPlace, WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import RecoveryTab from '@renderer/recovery/RecoveryTab'

const GIB = 1024 ** 3

function makeSnapshot(selectedDistro: string): WslPadSnapshot {
  return {
    generatedAt: '2026-11-18T00:00:00.000Z',
    selectedDistro,
    distros: [
      { name: 'Ubuntu', state: 'Running', wslVersion: 2, isDefault: true },
      { name: 'Debian', state: 'Stopped', wslVersion: 2, isDefault: false }
    ],
    dashboard: null
  } as unknown as WslPadSnapshot
}

function makeDrives(): WindowsPlace[] {
  return [
    { id: 'drive-C', label: 'C:', path: 'C:\\', kind: 'drive', totalBytes: 500 * GIB, freeBytes: 200 * GIB },
    { id: 'drive-D', label: 'D:', path: 'D:\\', kind: 'drive', totalBytes: 1000 * GIB, freeBytes: 600 * GIB }
  ]
}

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    selectDistro: vi.fn(async () => undefined),
    onSnapshot: vi.fn((_cb: (snap: WslPadSnapshot) => void) => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    windows: {
      places: vi.fn(async () => makeDrives()),
      mkdir: vi.fn(async () => undefined),
      openPath: vi.fn(async () => undefined)
    }
  }
}

let api: ReturnType<typeof makeApi>

async function emit(selected: string): Promise<void> {
  const cb = api.onSnapshot.mock.calls.at(-1)![0]
  await act(async () => {
    cb(makeSnapshot(selected))
  })
}

async function renderRecovery(selected: string): Promise<void> {
  await act(async () => {
    render(
      <AppStoreProvider>
        <RecoveryTab />
      </AppStoreProvider>
    )
  })
  await emit(selected)
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(el)
  })
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

describe('RecoveryTab distro switch', () => {
  it('shows backup status and verify action only for the selected distro', async () => {
    await renderRecovery('Ubuntu')
    await click(screen.getByTestId('recovery-confirm-backup'))
    expect(screen.getByTestId('recovery-backup-status').textContent).toBe('Unverified')
    expect(screen.getByTestId('recovery-verify-backup')).toBeTruthy()

    await emit('Debian')
    expect(screen.queryByTestId('recovery-backup-status')).toBeNull()
    expect(screen.queryByTestId('recovery-verify-backup')).toBeNull()

    await emit('Ubuntu')
    expect(screen.getByTestId('recovery-backup-status').textContent).toBe('Unverified')
    await click(screen.getByTestId('recovery-verify-backup'))
    expect(screen.getByTestId('recovery-backup-status').textContent).toBe('Verified')

    await emit('Debian')
    expect(screen.queryByTestId('recovery-backup-status')).toBeNull()
    await click(screen.getByTestId('recovery-confirm-backup'))
    expect(screen.getByTestId('recovery-backup-status').textContent).toBe('Unverified')

    await emit('Ubuntu')
    expect(screen.getByTestId('recovery-backup-status').textContent).toBe('Verified')
    expect(screen.queryByTestId('recovery-verify-backup')).toBeNull()
  })

  it('shows the clone verify action only for the distro it was cloned from', async () => {
    await renderRecovery('Ubuntu')
    await click(screen.getByTestId('recovery-nav-clone'))
    const panel = (): HTMLElement => screen.getByTestId('recovery-clone')
    await click(within(panel()).getByRole('button', { name: 'I ran this command' }))
    expect(within(panel()).getByRole('button', { name: 'Mark verified' })).toBeTruthy()

    await emit('Debian')
    expect(within(panel()).queryByRole('button', { name: 'Mark verified' })).toBeNull()

    await emit('Ubuntu')
    expect(within(panel()).getByRole('button', { name: 'Mark verified' })).toBeTruthy()
  })

  it('keeps every operation and its source distro in history across switches', async () => {
    await renderRecovery('Ubuntu')
    await click(screen.getByTestId('recovery-confirm-backup'))
    await click(screen.getByTestId('recovery-nav-clone'))
    await click(within(screen.getByTestId('recovery-clone')).getByRole('button', { name: 'I ran this command' }))

    await emit('Debian')
    await click(screen.getByTestId('recovery-nav-backup'))
    await click(screen.getByTestId('recovery-confirm-backup'))

    await click(screen.getByTestId('recovery-nav-history'))
    const rows = within(screen.getByTestId('recovery-history')).getAllByRole('row').slice(1) as HTMLTableRowElement[]
    expect(rows.map((row) => [row.cells[0].textContent, row.cells[1].textContent])).toEqual([
      ['Backup', 'Debian'],
      ['Clone', 'Ubuntu'],
      ['Backup', 'Ubuntu']
    ])
    expect(within(screen.getByTestId('recovery-history')).getAllByRole('button', { name: 'Mark verified' })).toHaveLength(3)
  })
})
