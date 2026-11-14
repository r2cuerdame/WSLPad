import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { ImportantPathInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import PathsCard from '@renderer/dashboard/PathsCard'

/** Only what AppStoreProvider touches on mount — the card itself needs no IPC. */
const storeApi = {
  getSnapshot: async () => null,
  settings: { get: async () => defaultSettings(), onChange: () => () => undefined },
  onSnapshot: () => () => undefined,
  onNavigateSettings: () => () => undefined
}

function path(id: string, over: Partial<ImportantPathInfo> = {}): ImportantPathInfo {
  return {
    id,
    label: id,
    linuxPath: `/home/dev/${id}`,
    windowsPath: `\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\${id}`,
    exists: true,
    isDirectory: true,
    side: 'ext4',
    ...over
  }
}

const PATHS: ImportantPathInfo[] = [
  path('HOME', { linuxPath: '/home/dev' }),
  path('Current project', { linuxPath: '/mnt/c/repos/app', side: 'windows-mount' }),
  path('~/.hermes', { exists: false, side: 'unknown' })
]

function NavProbe(): React.JSX.Element {
  const { explorerNavigateRequest } = useApp()
  return (
    <div data-testid="nav" data-select={explorerNavigateRequest?.selectPath ?? ''}>
      {explorerNavigateRequest === null
        ? ''
        : `${explorerNavigateRequest.fs}:${explorerNavigateRequest.path}`}
    </div>
  )
}

function renderCard(paths: ImportantPathInfo[] = PATHS): void {
  render(
    <AppStoreProvider>
      <PathsCard paths={paths} />
      <NavProbe />
    </AppStoreProvider>
  )
}

const badges = (): HTMLElement[] => Array.from(document.querySelectorAll('.side-badge'))

beforeAll(async () => {
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = storeApi as unknown as WslPadApi
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

afterEach(cleanup)

describe('PathsCard filesystem side', () => {
  it('badges only the path that crosses the boundary', () => {
    renderCard()
    expect(badges()).toHaveLength(1)
    expect(badges()[0].getAttribute('data-side')).toBe('windows-mount')
  })

  it('names the side in text, not by colour, and explains why it is slow', () => {
    renderCard()
    const badge = badges()[0]
    expect(badge.textContent).toContain('Windows drive')
    expect(badge.getAttribute('title')).toContain('slower')
  })

  it('keeps the existing rows and the missing marker untouched', () => {
    renderCard()
    expect(screen.getByText('/home/dev')).toBeDefined()
    expect(screen.getByText('/mnt/c/repos/app')).toBeDefined()
    expect(screen.getByText('Missing')).toBeDefined()
  })

  it('opens directories directly and opens parent directory with selectPath for files', () => {
    renderCard([
      path('HOME', { linuxPath: '/home/dev', isDirectory: true }),
      path('Profile', { linuxPath: '/home/dev/.profile', isDirectory: false }),
      path('Missing', { linuxPath: '/home/dev/missing', exists: false })
    ])
    const buttons = screen.getAllByRole('button', { name: 'Open in Explorer' })
    expect(buttons).toHaveLength(3)
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(buttons[0])
    const nav = screen.getByTestId('nav')
    expect(nav.textContent).toBe('linux:/home/dev')
    expect(nav.getAttribute('data-select')).toBe('')

    fireEvent.click(buttons[1])
    expect(nav.textContent).toBe('linux:/home/dev')
    expect(nav.getAttribute('data-select')).toBe('/home/dev/.profile')
  })
})
