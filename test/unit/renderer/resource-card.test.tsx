import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { MemoryReconciliation, ResourceInfo, WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import { resetMetricHistory } from '@renderer/hooks/useMetricHistory'
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

let snapshotListener: ((s: WslPadSnapshot) => void) | null = null

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
    onSnapshot: vi.fn((cb: (s: WslPadSnapshot) => void) => {
      snapshotListener = cb
      return () => {
        snapshotListener = null
      }
    }),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

/** Only the two fields the trend samples are real; the card reads nothing else. */
function snapshotAt(seconds: number, distro = 'Ubuntu-24.04'): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: new Date(Date.UTC(2026, 6, 30, 12, 0, seconds)).toISOString(),
    selectedDistro: distro,
    distros: [],
    dashboard: null,
    explorer: { distro: null, currentPath: null, showHidden: false },
    terminal: { distro: null, cwd: null, status: 'disconnected' },
    mcp: {
      running: false,
      transport: 'http',
      endpoint: null,
      port: 4923,
      connectedClients: 0,
      lastRequestAt: null,
      readOnly: true,
      tokenSet: false,
      error: null
    },
    liveness: null,
    warnings: []
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

interface HarnessProps {
  resources: ResourceInfo
  memoryDetail?: MemoryReconciliation | null
}

function Harness({ resources, memoryDetail }: HarnessProps): React.JSX.Element {
  return (
    <AppStoreProvider>
      <ResourceCard resources={resources} memoryDetail={memoryDetail} />
      <PreparedProbe />
      <Toasts />
    </AppStoreProvider>
  )
}

async function renderCard(
  memoryDetail?: MemoryReconciliation | null,
  resources: ResourceInfo = RESOURCES
): Promise<RenderResult> {
  const view = render(<Harness resources={resources} memoryDetail={memoryDetail} />)
  await flush()
  return view
}

/** One snapshot tick, the only thing that feeds the trend. */
async function emitSnapshot(seconds: number, distro?: string): Promise<void> {
  await act(async () => {
    snapshotListener?.(snapshotAt(seconds, distro))
  })
}

/** `count` ticks one default fast tier apart, starting at `fromSeconds`. */
async function emitTicks(count: number, fromSeconds = 0): Promise<void> {
  for (let i = 0; i < count; i += 1) await emitSnapshot(fromSeconds + i * 3)
}

function trendName(metric: 'CPU' | 'Memory'): string {
  const svg = screen
    .getAllByRole('img')
    .find((el) => el.getAttribute('aria-label')?.startsWith(metric))
  return svg?.getAttribute('aria-label') ?? ''
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
  snapshotListener = null
  // The buffer outlives the card on purpose, so each test starts it over.
  resetMetricHistory()
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

describe('ResourceCard trend', () => {
  it('admits it has no history yet instead of drawing one point as a line', async () => {
    await renderCard(null)
    await emitSnapshot(0)

    expect(trendName('CPU')).toBe('CPU: Not enough samples yet')
    expect(trendName('Memory')).toBe('Memory: Not enough samples yet')
    expect(document.querySelectorAll('polyline')).toHaveLength(0)
    expect(screen.queryByText(/nothing is written to disk/)).toBeNull()
  })

  it('draws both trends once a second snapshot lands, over the measured window', async () => {
    await renderCard(null)
    // Twenty-one ticks of the default fast tier is exactly one minute.
    await emitTicks(21)

    expect(trendName('CPU')).toContain('CPU, last 1 min')
    expect(trendName('Memory')).toContain('Memory, last 1 min')
    expect(document.querySelectorAll('polyline')).toHaveLength(2)
  })

  it('answers "is this climbing?" in words when the numbers keep rising', async () => {
    const view = await renderCard(null, { ...RESOURCES, cpuPercent: 5, memUsedBytes: 2 * GIB })
    await emitSnapshot(0)
    view.rerender(<Harness resources={{ ...RESOURCES, cpuPercent: 40, memUsedBytes: 6 * GIB }} />)
    await emitSnapshot(3)
    view.rerender(<Harness resources={{ ...RESOURCES, cpuPercent: 70, memUsedBytes: 9 * GIB }} />)
    await emitSnapshot(6)

    expect(trendName('CPU')).toContain('rising')
    expect(trendName('CPU')).toContain('now 70%')
    expect(trendName('CPU')).toContain('between 5% and 70%')
    expect(trendName('Memory')).toContain('rising')
    expect(trendName('Memory')).toContain('between 2 GB and 9 GB')
  })

  it('states in the card that the history never leaves memory', async () => {
    await renderCard(null)
    await emitTicks(2)

    expect(screen.getByText(/nothing is written to disk/)).toBeTruthy()
  })

  it('shows a hole in the record rather than a line across a pause', async () => {
    await renderCard(null)
    await emitTicks(2)
    // Monitoring paused, or the section left, for five minutes.
    await emitSnapshot(303)

    expect(trendName('CPU')).toContain('No sample')
  })

  it('starts over when the selected distro changes', async () => {
    await renderCard(null)
    await emitTicks(2)
    expect(document.querySelectorAll('polyline')).toHaveLength(2)

    await emitSnapshot(6, 'Debian')

    expect(trendName('CPU')).toBe('CPU: Not enough samples yet')
    expect(document.querySelectorAll('polyline')).toHaveLength(0)
  })

  it('persists nothing while it samples', async () => {
    const writes: string[] = []
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function patched(key: string, value: string): void {
      writes.push(key)
      original.call(this, key, value)
    }
    try {
      await renderCard(MEMORY)
      await emitTicks(2)
    } finally {
      Storage.prototype.setItem = original
    }

    expect(writes).toEqual([])
    expect(api.copyToClipboard).not.toHaveBeenCalled()
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
