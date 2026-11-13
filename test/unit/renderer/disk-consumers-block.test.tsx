import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { DiskConsumerInfo, DiskConsumersInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import DiskConsumersBlock from '@renderer/dashboard/DiskConsumersBlock'

const FLOOR_HINT = 'At least this much — part of it could not be read'

function row(over: Partial<DiskConsumerInfo> & Pick<DiskConsumerInfo, 'id' | 'path'>): DiskConsumerInfo {
  return {
    exists: true,
    bytes: null,
    partial: false,
    cleanup: null,
    needsRoot: false,
    containedIn: null,
    ...over
  }
}

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    copyToClipboard: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

async function renderBlock(consumers: DiskConsumersInfo): Promise<void> {
  render(
    <AppStoreProvider>
      <DiskConsumersBlock consumers={consumers} />
    </AppStoreProvider>
  )
  await act(async () => {
    await Promise.resolve()
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
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = makeApi() as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DiskConsumersBlock', () => {
  it('shows a partly read cache as a floor, and the total as one too', async () => {
    await renderBlock({
      consumers: [
        row({ id: 'apt-cache', path: '/var/cache/apt', bytes: 2_097_152 }),
        row({ id: 'docker', path: '/var/lib/docker', bytes: 4096, partial: true })
      ],
      measuredBytes: 2_101_248,
      partial: true
    })
    const floor = screen.getByTitle(FLOOR_HINT)
    expect(floor.textContent).toBe('≥ 4 KB')
    expect(screen.getAllByTitle(FLOOR_HINT)).toHaveLength(1)
    expect(screen.getByText('2 MB').getAttribute('title')).toBeNull()
    expect(
      screen.getByText('At least 2 MB across the caches below — something could not be measured.')
    ).toBeTruthy()
  })

  it('keeps complete, empty and unknown rows as they were', async () => {
    await renderBlock({
      consumers: [
        row({ id: 'apt-cache', path: '/var/cache/apt', bytes: 2_097_152 }),
        row({ id: 'trash', path: '/home/dev/.local/share/Trash', bytes: 0 }),
        row({ id: 'tmp', path: '/tmp', bytes: null }),
        row({ id: 'docker', path: '/var/lib/docker', exists: false })
      ],
      measuredBytes: 2_097_152,
      partial: true
    })
    expect(screen.getByText('2 MB')).toBeTruthy()
    expect(screen.getByText('0 B')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(screen.queryByText(/≥/)).toBeNull()
    expect(screen.queryByTitle(FLOOR_HINT)).toBeNull()
    // A path that is not there is not a row at all.
    expect(screen.queryByText('/var/lib/docker')).toBeNull()
  })

  it('reads a fully measured total as the total', async () => {
    await renderBlock({
      consumers: [row({ id: 'apt-cache', path: '/var/cache/apt', bytes: 2_097_152 })],
      measuredBytes: 2_097_152,
      partial: false
    })
    expect(screen.getByText('2 MB across the caches below.')).toBeTruthy()
    expect(screen.queryByText(/≥/)).toBeNull()
  })
})
