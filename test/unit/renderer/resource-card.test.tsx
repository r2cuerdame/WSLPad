import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { MemoryReconciliation, ResourceInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import ResourceCard from '@renderer/dashboard/ResourceCard'
import Toasts from '@renderer/components/Toasts'

const GIB = 1024 ** 3

const RESOURCES: ResourceInfo = {
  cpuPercent: 12.5,
  cpuCount: 8,
  memTotalBytes: 16 * GIB,
  memUsedBytes: 2 * GIB,
  memAvailableBytes: 14 * GIB,
  swapTotalBytes: 4 * GIB,
  swapUsedBytes: 1 * GIB,
  disks: [
    {
      mountPoint: '/',
      exists: true,
      totalBytes: 100 * GIB,
      usedBytes: 40 * GIB,
      availableBytes: 60 * GIB,
      usePercent: 40
    },
    {
      mountPoint: '/mnt/c',
      exists: false,
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      usePercent: null
    }
  ],
  loadAvg: [0.5, 0.4, 0.3],
  processCount: 42
}

/** vmmem holds 7 GB while Linux only uses 2 GB — 5 GB of it is page cache. */
const MEMORY: MemoryReconciliation = {
  hostTotalBytes: 32 * GIB,
  vmLimitBytes: 16 * GIB,
  vmLimitSource: 'wslconfig',
  vmmemWorkingSetBytes: 7 * GIB,
  guestTotalBytes: 16 * GIB,
  guestUsedBytes: 2 * GIB,
  guestCacheBytes: 5 * GIB,
  guestFreeBytes: 9 * GIB,
  swapTotalBytes: 4 * GIB,
  swapUsedBytes: 1 * GIB,
  autoMemoryReclaim: 'gradual'
}

const ALL_NULL: MemoryReconciliation = {
  hostTotalBytes: null,
  vmLimitBytes: null,
  vmLimitSource: 'unknown',
  vmmemWorkingSetBytes: null,
  guestTotalBytes: null,
  guestUsedBytes: null,
  guestCacheBytes: null,
  guestFreeBytes: null,
  swapTotalBytes: null,
  swapUsedBytes: null,
  autoMemoryReclaim: null
}

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    terminal: {
      input: vi.fn(async () => undefined),
      spawn: vi.fn(async () => undefined)
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

async function renderCard(memoryDetail?: MemoryReconciliation | null): Promise<void> {
  render(
    <AppStoreProvider>
      <ResourceCard resources={RESOURCES} memoryDetail={memoryDetail} />
      <PreparedProbe />
      <Toasts />
    </AppStoreProvider>
  )
  await flush()
}

/** The value cell of the row whose label is exactly `label`. */
function rowValue(label: string): string {
  const row = screen.getByText(label).closest('.res-row')
  if (row === null) throw new Error(`no resource row labelled ${label}`)
  return row.querySelector('.res-value')?.textContent?.trim() ?? ''
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

describe('ResourceCard reconciliation block', () => {
  it('tells the memory story from host RAM down to the Linux split', async () => {
    await renderCard(MEMORY)

    expect(rowValue('Windows memory')).toBe('32 GB')
    expect(rowValue('WSL memory limit')).toBe('16 GB from .wslconfig')
    expect(rowValue('Held by vmmem')).toBe('7 GB')
    expect(rowValue('Used in Linux')).toBe('2 GB of 16 GB')
    expect(rowValue('Cache in Linux')).toBe('5 GB')
    expect(rowValue('Free in Linux')).toBe('9 GB')
    expect(rowValue('Swap in Linux')).toBe('1 GB of 4 GB')
    expect(rowValue('Auto memory reclaim')).toBe('gradual')
  })

  it('says in words that most of what Windows holds is page cache', async () => {
    await renderCard(MEMORY)

    const story = screen.getByText(/page cache/)
    expect(story.textContent).toContain('Most of the 7 GB')
    expect(story.textContent).toContain('5 GB')
    // 5 GB of the 7 GB Windows holds
    expect(story.textContent).toContain('71.4%')
    expect(story.textContent).toContain('not leaked memory')
  })

  it('states the smaller share plainly when cache is not the bulk of it', async () => {
    await renderCard({ ...MEMORY, vmmemWorkingSetBytes: 8 * GIB, guestCacheBytes: 1 * GIB })

    const story = screen.getByText(/page cache/)
    expect(story.textContent).toContain('1 GB of the 8 GB')
    expect(story.textContent).toContain('12.5%')
    expect(story.textContent).not.toContain('Most of the')
  })

  it('renders every unknown as an em dash and makes no claim about cache', async () => {
    await renderCard(ALL_NULL)

    expect(rowValue('Windows memory')).toBe('—')
    expect(rowValue('WSL memory limit')).toBe('— source unknown')
    expect(rowValue('Held by vmmem')).toBe('—')
    expect(rowValue('Used in Linux')).toBe('—')
    expect(rowValue('Cache in Linux')).toBe('—')
    expect(rowValue('Free in Linux')).toBe('—')
    expect(rowValue('Swap in Linux')).toBe('—')
    expect(rowValue('Auto memory reclaim')).toBe('—')
    expect(screen.queryByText(/page cache/)).toBeNull()
    // no zeros anywhere in the block
    expect(screen.queryByText('0 B')).toBeNull()
  })

  it('shows nothing extra when the Windows side was never sampled', async () => {
    await renderCard(null)

    expect(screen.queryByText('Windows memory')).toBeNull()
    expect(screen.queryByText('Held by vmmem')).toBeNull()
    expect(screen.queryByRole('button', { name: /shutdown/ })).toBeNull()
  })
})

describe('ResourceCard reclaim command', () => {
  it('only prepares wsl.exe --shutdown and never runs it', async () => {
    await renderCard(MEMORY)

    const button = screen.getByRole('button', { name: 'Prepare wsl.exe --shutdown' })
    expect(screen.getByTestId('prepared').textContent).toBe('')

    fireEvent.click(button)
    await flush()

    expect(screen.getByTestId('prepared').textContent).toBe('wsl.exe --shutdown')
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.spawn).not.toHaveBeenCalled()
    expect(api.copyToClipboard).not.toHaveBeenCalled()
    expect(screen.getByText('Command prepared in Console')).toBeTruthy()
  })

  it('offers the command even when every number is unknown', async () => {
    await renderCard(ALL_NULL)

    fireEvent.click(screen.getByRole('button', { name: 'Prepare wsl.exe --shutdown' }))
    await flush()
    expect(screen.getByTestId('prepared').textContent).toBe('wsl.exe --shutdown')
  })
})

describe('ResourceCard existing rows', () => {
  it('keeps cpu, memory, swap, disks, load and process count intact', async () => {
    await renderCard(MEMORY)

    expect(rowValue('CPU')).toBe('12.5%')
    expect(rowValue('Memory')).toBe('2 GB of 16 GB')
    expect(rowValue('Swap')).toBe('1 GB of 4 GB')
    expect(rowValue('Root filesystem')).toBe('40 GB of 100 GB')
    expect(rowValue('/mnt/c')).toBe('Not mounted')
    expect(rowValue('Load average')).toBe('0.5  0.4  0.3')
    expect(rowValue('Processes')).toBe('42')
  })
})
