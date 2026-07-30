import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { ImportantPathInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
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

function renderCard(): void {
  render(
    <AppStoreProvider>
      <PathsCard paths={PATHS} />
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
})
