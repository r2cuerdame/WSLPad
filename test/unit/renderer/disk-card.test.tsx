import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { DiskImageInfo } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import DiskCard from '@renderer/dashboard/DiskCard'

const GIB = 1024 ** 3
const BASE = 'C:\\Users\\dev\\AppData\\Local\\wsl\\Ubuntu-24.04'
const VHDX = `${BASE}\\ext4.vhdx`

const COMPACT_COMMAND = `wsl --shutdown; Optimize-VHD -Path '${VHDX}' -Mode Full`
const SPARSE_COMMAND = 'wsl --manage Ubuntu-24.04 --set-sparse true'

function diskImage(over: Partial<DiskImageInfo> = {}): DiskImageInfo {
  return {
    distro: 'Ubuntu-24.04',
    vhdxPath: VHDX,
    basePath: BASE,
    vhdxBytes: 80 * GIB,
    allocatedBytes: 78 * GIB,
    sparse: false,
    fsSizeBytes: 1007 * GIB,
    fsUsedBytes: 12 * GIB,
    reclaimableBytes: 68 * GIB,
    error: null,
    ...over
  }
}

const UNKNOWN = diskImage({
  vhdxPath: null,
  basePath: null,
  vhdxBytes: null,
  allocatedBytes: null,
  sparse: null,
  fsSizeBytes: null,
  fsUsedBytes: null,
  reclaimableBytes: null,
  error: 'The WSL registry entries could not be read'
})

/** Every API a card could use to make something happen, so none may fire. */
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

async function renderCard(disk: DiskImageInfo | null): Promise<void> {
  render(
    <AppStoreProvider>
      <DiskCard disk={disk} zone={null} consumers={null} defender={null} />
      <PreparedProbe />
    </AppStoreProvider>
  )
  await flush()
}

/** Nothing in this card may run a command — only prepare one. */
function expectNothingExecuted(): void {
  expect(api.terminal.input).not.toHaveBeenCalled()
  expect(api.terminal.ensure).not.toHaveBeenCalled()
  expect(api.openExternal).not.toHaveBeenCalled()
  expect(api.windows.openPath).not.toHaveBeenCalled()
  expect(api.openInWindowsExplorer).not.toHaveBeenCalled()
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

describe('DiskCard populated', () => {
  it('leads with what the image holds versus what Linux uses', async () => {
    await renderCard(diskImage())
    expect(
      screen.getByText(
        'This image is holding 78 GB on the Windows disk while Ubuntu-24.04 only uses 12 GB inside.'
      )
    ).toBeTruthy()
    expect(screen.getByText('12 GB of 78 GB')).toBeTruthy()
  })

  it('shows the image path, the sizes and the reclaimable surplus', async () => {
    await renderCard(diskImage())
    expect(screen.getByTitle(VHDX).textContent).toBe(VHDX)
    expect(screen.getByTitle(BASE).textContent).toBe(BASE)
    expect(screen.getByText('80 GB')).toBeTruthy()
    expect(screen.getByText('78 GB')).toBeTruthy()
    expect(screen.getByText('68 GB')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
  })

  it('draws the used-inside share against the image size', async () => {
    const { container } = render(
      <AppStoreProvider>
        <DiskCard disk={diskImage()} zone={null} consumers={null} defender={null} />
      </AppStoreProvider>
    )
    await flush()
    const fill = container.querySelector('.bar-fill') as HTMLElement
    expect(fill).toBeTruthy()
    expect(fill.style.width).toBe(`${(12 / 78) * 100}%`)
  })

  it('copies the path and reveals the image in Windows Explorer', async () => {
    await renderCard(diskImage())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy image path' }))
      await Promise.resolve()
    })
    expect(api.copyToClipboard).toHaveBeenCalledWith(VHDX)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show in Windows Explorer' }))
      await Promise.resolve()
    })
    expect(api.windows.openPath).toHaveBeenCalledWith(VHDX)
  })
})

describe('DiskCard prepared commands', () => {
  it('only prepares the compaction command and executes nothing', async () => {
    await renderCard(diskImage())
    expect(screen.getByText(COMPACT_COMMAND)).toBeTruthy()

    const prepare = screen.getAllByRole('button', { name: 'Prepare in Console' })
    expect(prepare).toHaveLength(2)
    fireEvent.click(prepare[0])

    expect(screen.getByTestId('prepared').textContent).toBe(COMPACT_COMMAND)
    expectNothingExecuted()
  })

  it('prepares the sparse-mode command for the real distro name', async () => {
    await renderCard(diskImage())
    expect(screen.getByText(SPARSE_COMMAND)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Prepare in Console' })[1])
    expect(screen.getByTestId('prepared').textContent).toBe(SPARSE_COMMAND)
    expectNothingExecuted()
  })

  it('quotes a distro name that carries spaces', async () => {
    await renderCard(diskImage({ distro: 'My Distro' }))
    expect(screen.getByText('wsl --manage "My Distro" --set-sparse true')).toBeTruthy()
  })

  it('offers no compaction while the surplus is unknown', async () => {
    await renderCard(diskImage({ fsUsedBytes: null, reclaimableBytes: null }))
    expect(screen.queryByText(COMPACT_COMMAND)).toBeNull()
    expect(screen.getByText(SPARSE_COMMAND)).toBeTruthy()
  })

  it('offers no sparse switch when the flag is unknown or already on', async () => {
    await renderCard(diskImage({ sparse: null }))
    expect(screen.queryByText(SPARSE_COMMAND)).toBeNull()

    cleanup()
    await renderCard(diskImage({ sparse: true }))
    expect(screen.queryByText(SPARSE_COMMAND)).toBeNull()
  })

  it('hides the whole suggestion block when neither command applies', async () => {
    await renderCard(diskImage({ sparse: true, reclaimableBytes: null }))
    expect(screen.queryByText('Suggested commands')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Prepare in Console' })).toBeNull()
  })
})

describe('DiskCard unknown state', () => {
  it('says the image could not be located instead of showing zeroes', async () => {
    await renderCard(UNKNOWN)
    expect(
      screen.getByText('The disk image for this distribution could not be located.')
    ).toBeTruthy()
    expect(screen.getByText('The WSL registry entries could not be read')).toBeTruthy()
    expect(screen.queryByText('0 B')).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Prepare in Console' })).toBeNull()
    expectNothingExecuted()
  })

  it('keeps the install folder and the in-distro usage when only the image is missing', async () => {
    await renderCard(
      diskImage({
        vhdxPath: null,
        vhdxBytes: null,
        allocatedBytes: null,
        sparse: null,
        reclaimableBytes: null,
        error: 'No .vhdx image in the distribution folder'
      })
    )
    expect(screen.getByTitle(BASE).textContent).toBe(BASE)
    expect(screen.getByText('12 GB')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Prepare in Console' })).toBeNull()
  })

  it('reports an unavailable section without inventing a disk', async () => {
    await renderCard(null)
    expect(screen.getByText('No disk image information for this distribution')).toBeTruthy()
    expect(screen.queryByText('0 B')).toBeNull()
  })
})
