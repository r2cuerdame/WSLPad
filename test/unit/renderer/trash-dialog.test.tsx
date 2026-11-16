import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WslPadApi } from '@shared/ipc'
import type { Settings, TrashEntry, WslPadSnapshot } from '@shared/types'
import { Toasts } from '@renderer/components/Toasts'
import { TrashDialog } from '@renderer/explorer/TrashDialog'
import { initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeSnapshot(selectedDistro: string | null): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    selectedDistro,
    distros: [],
    dashboard: null,
    explorer: { distro: selectedDistro, currentPath: null, showHidden: false },
    terminal: { distro: selectedDistro, cwd: null, status: 'ready' },
    mcp: {
      running: false,
      transport: 'http',
      endpoint: null,
      port: 0,
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

function makeEntry(
  overrides: Partial<TrashEntry> & Pick<TrashEntry, 'trashName' | 'originalPath'>
): TrashEntry {
  return {
    deletedAt: '2026-01-01T12:00:00Z',
    type: 'file',
    present: true,
    sizeBytes: 128,
    ...overrides
  }
}

interface MockApiControls {
  listTrash: ReturnType<typeof vi.fn<() => Promise<TrashEntry[]>>>
  restoreTrash: ReturnType<typeof vi.fn<(trashNames: string[]) => Promise<void>>>
  copyToClipboard: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>
  emitSnapshot: (next: WslPadSnapshot) => void
}

function installMockApi(initialDistro: string | null = 'Ubuntu-24.04'): MockApiControls {
  let snapshotListener: ((s: WslPadSnapshot) => void) | null = null
  const listTrash = vi.fn<() => Promise<TrashEntry[]>>().mockResolvedValue([])
  const restoreTrash = vi.fn<(trashNames: string[]) => Promise<void>>().mockResolvedValue()
  const copyToClipboard = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()

  const api = {
    getSnapshot: vi.fn().mockResolvedValue(makeSnapshot(initialDistro)),
    onSnapshot: vi.fn((cb: (s: WslPadSnapshot) => void) => {
      snapshotListener = cb
      return () => {
        if (snapshotListener === cb) snapshotListener = null
      }
    }),
    onNavigateSettings: vi.fn(() => () => {}),
    copyToClipboard,
    explorer: {
      listTrash,
      restoreTrash
    },
    settings: {
      get: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        language: 'en',
        theme: 'dark',
        startWithWindows: false
      } as unknown as Settings),
      getLoadError: vi.fn().mockResolvedValue(null),
      onChange: vi.fn(() => () => {})
    }
  } as unknown as WslPadApi

  Object.defineProperty(window, 'wslpad', {
    configurable: true,
    writable: true,
    value: api
  })

  return {
    listTrash,
    restoreTrash,
    copyToClipboard,
    emitSnapshot: (next: WslPadSnapshot) => {
      snapshotListener?.(next)
    }
  }
}

function renderTrashDialog(props?: {
  onClose?: () => void
  onRestored?: (paths: string[]) => void
}): { onClose: ReturnType<typeof vi.fn<() => void>>; onRestored: ReturnType<typeof vi.fn<(paths: string[]) => void>> } {
  const onClose = vi.fn<() => void>(props?.onClose)
  const onRestored = vi.fn<(paths: string[]) => void>(props?.onRestored)
  render(
    <AppStoreProvider>
      <Toasts />
      <TrashDialog onClose={onClose} onRestored={onRestored} />
    </AppStoreProvider>
  )
  return { onClose, onRestored }
}

beforeAll(async () => {
  await initRendererI18n('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TrashDialog', () => {
  it('shows error and retry on initial listTrash failure without empty or loading text', async () => {
    const { listTrash } = installMockApi('Ubuntu-24.04')
    listTrash.mockRejectedValueOnce(new Error('permission denied reading trash'))
    listTrash.mockResolvedValueOnce([
      makeEntry({ trashName: 'a.trashinfo', originalPath: '/home/dev/a.txt' })
    ])

    renderTrashDialog()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/permission denied reading trash/)).toBeInTheDocument()
    expect(screen.queryByText('The trash is empty.')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('/home/dev/a.txt')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves already loaded entries on subsequent refresh and post-restore listTrash failure', async () => {
    const { listTrash } = installMockApi('Ubuntu-24.04')
    listTrash
      .mockResolvedValueOnce([
        makeEntry({ trashName: 'a.trashinfo', originalPath: '/home/dev/a.txt' }),
        makeEntry({ trashName: 'b.trashinfo', originalPath: '/home/dev/b.txt' })
      ])
      .mockRejectedValueOnce(new Error('transient refresh error'))
      .mockRejectedValueOnce(new Error('post-restore list error'))

    const { onRestored } = renderTrashDialog()

    expect(await screen.findByText('/home/dev/a.txt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/transient refresh error/)).toBeInTheDocument()
    expect(screen.getByText('/home/dev/a.txt')).toBeInTheDocument()
    expect(screen.getByText('/home/dev/b.txt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '/home/dev/a.txt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledWith(['/home/dev/a.txt'])
    })
    const postAlert = await screen.findByRole('alert')
    expect(within(postAlert).getByText(/post-restore list error/)).toBeInTheDocument()
    expect(screen.getByText('/home/dev/a.txt')).toBeInTheDocument()
  })

  it('prunes vanished and present=false selections on refresh', async () => {
    const { listTrash, restoreTrash } = installMockApi('Ubuntu-24.04')
    listTrash
      .mockResolvedValueOnce([
        makeEntry({ trashName: 'keep', originalPath: '/home/dev/keep.txt', present: true }),
        makeEntry({ trashName: 'gone-later', originalPath: '/home/dev/gone.txt', present: true }),
        makeEntry({ trashName: 'removed', originalPath: '/home/dev/removed.txt', present: true })
      ])
      .mockResolvedValueOnce([
        makeEntry({ trashName: 'keep', originalPath: '/home/dev/keep.txt', present: true }),
        makeEntry({ trashName: 'gone-later', originalPath: '/home/dev/gone.txt', present: false })
      ])
      .mockResolvedValueOnce([])

    renderTrashDialog()

    expect(await screen.findByText('/home/dev/keep.txt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '/home/dev/keep.txt' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '/home/dev/gone.txt' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '/home/dev/removed.txt' }))
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('3 items selected')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.queryByText('/home/dev/removed.txt')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('1 items selected')
    expect(screen.getByRole('checkbox', { name: '/home/dev/keep.txt' })).toBeChecked()
    const goneBox = screen.getByRole('checkbox', { name: '/home/dev/gone.txt' })
    expect(goneBox).not.toBeChecked()
    expect(goneBox).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => {
      expect(restoreTrash).toHaveBeenCalledWith(['keep'])
    })
  })

  it('syncs with selectedDistro changes, ignores stale responses, and disables controls on null distro', async () => {
    const { listTrash, emitSnapshot } = installMockApi('Ubuntu-24.04')
    const staleDebianLoad = deferred<TrashEntry[]>()
    const fedoraLoad = deferred<TrashEntry[]>()

    listTrash
      .mockResolvedValueOnce([
        makeEntry({ trashName: 'u1', originalPath: '/home/ubuntu/note.md' })
      ])
      .mockImplementationOnce(() => staleDebianLoad.promise)
      .mockImplementationOnce(() => fedoraLoad.promise)

    renderTrashDialog()

    expect(await screen.findByText('/home/ubuntu/note.md')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '/home/ubuntu/note.md' }))
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ubuntu' } })
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('1 items selected')

    // Periodic snapshot for same distro must not reset query/selection or reload.
    emitSnapshot(makeSnapshot('Ubuntu-24.04'))
    expect(listTrash).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Search')).toHaveValue('ubuntu')
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('1 items selected')

    // Switch to Debian while first distro had state; state resets and Debian load starts.
    emitSnapshot(makeSnapshot('Debian'))
    await waitFor(() => {
      expect(listTrash).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByLabelText('Search')).toHaveValue('')
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('0 items selected')
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    // Switch quickly to Fedora before Debian settles; resolve Fedora first, then stale Debian.
    emitSnapshot(makeSnapshot('Fedora'))
    await waitFor(() => {
      expect(listTrash).toHaveBeenCalledTimes(3)
    })

    fedoraLoad.resolve([
      makeEntry({ trashName: 'f1', originalPath: '/home/fedora/readme.md' })
    ])
    expect(await screen.findByText('/home/fedora/readme.md')).toBeInTheDocument()

    staleDebianLoad.resolve([
      makeEntry({ trashName: 'd1', originalPath: '/home/debian/stale.md' })
    ])
    await Promise.resolve()
    expect(screen.queryByText('/home/debian/stale.md')).not.toBeInTheDocument()
    expect(screen.getByText('/home/fedora/readme.md')).toBeInTheDocument()

    // Switch to null distro: shows noDistro, disables controls, does not call listTrash.
    emitSnapshot(makeSnapshot(null))
    expect(await screen.findByText('No distribution selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
    expect(screen.getByLabelText('Search')).toBeDisabled()
    expect(listTrash).toHaveBeenCalledTimes(3)
  })

  it('filters entries by search query, handles Escape without closing while non-empty, and shows None on empty filter', async () => {
    const { listTrash } = installMockApi('Ubuntu-24.04')
    listTrash.mockResolvedValueOnce([
      makeEntry({ trashName: 'n1', originalPath: '/home/dev/notes.md', type: 'file' }),
      makeEntry({ trashName: 'p1', originalPath: '/home/dev/projects/app', type: 'directory' })
    ])

    const { onClose } = renderTrashDialog()

    expect(await screen.findByText('/home/dev/notes.md')).toBeInTheDocument()

    const search = screen.getByPlaceholderText('Search')
    fireEvent.change(search, { target: { value: '  PROJECTS  ' } })
    expect(screen.queryByText('/home/dev/notes.md')).not.toBeInTheDocument()
    expect(screen.getByText('/home/dev/projects/app')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'no-match-anywhere' } })
    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.queryByText('The trash is empty.')).not.toBeInTheDocument()

    // Pressing Escape when query is non-empty clears query and keeps dialog open.
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(search).toHaveValue('')
    expect(screen.getByText('/home/dev/notes.md')).toBeInTheDocument()
    expect(screen.getByText('/home/dev/projects/app')).toBeInTheDocument()

    // Pressing Escape when query is empty bubbles to Dialog and calls onClose.
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('supports header select-all checkbox with indeterminate state, filtered scope, and present=false exclusion', async () => {
    const { listTrash } = installMockApi('Ubuntu-24.04')
    listTrash.mockResolvedValueOnce([
      makeEntry({ trashName: 'f1', originalPath: '/home/dev/alpha.txt', present: true }),
      makeEntry({ trashName: 'f2', originalPath: '/home/dev/beta.txt', present: true }),
      makeEntry({ trashName: 'f3', originalPath: '/home/dev/gone.txt', present: false })
    ])

    renderTrashDialog()

    expect(await screen.findByText('/home/dev/alpha.txt')).toBeInTheDocument()
    const selectAll = screen.getByRole('checkbox', {
      name: 'Select for restore'
    }) as HTMLInputElement
    const alphaBox = screen.getByRole('checkbox', { name: '/home/dev/alpha.txt' })
    const betaBox = screen.getByRole('checkbox', { name: '/home/dev/beta.txt' })
    const goneBox = screen.getByRole('checkbox', { name: '/home/dev/gone.txt' })

    expect(goneBox).toBeDisabled()
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(false)

    // Partial selection sets indeterminate = true.
    fireEvent.click(alphaBox)
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(true)
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('1 items selected')

    // Select all selects all restorable visible entries and skips present=false.
    fireEvent.click(selectAll)
    expect(selectAll.checked).toBe(true)
    expect(selectAll.indeterminate).toBe(false)
    expect(alphaBox).toBeChecked()
    expect(betaBox).toBeChecked()
    expect(goneBox).not.toBeChecked()
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('2 items selected')

    // Unselect all clears visible restorable entries.
    fireEvent.click(selectAll)
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(false)
    expect(alphaBox).not.toBeChecked()
    expect(betaBox).not.toBeChecked()
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('0 items selected')

    // Select-all respects active search filter.
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'beta' } })
    fireEvent.click(selectAll)
    expect(screen.getByTestId('trash-selected-count')).toHaveTextContent('1 items selected')

    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: '/home/dev/alpha.txt' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '/home/dev/beta.txt' })).toBeChecked()
    expect((screen.getByRole('checkbox', { name: 'Select for restore' }) as HTMLInputElement).indeterminate).toBe(true)
  })

  it('renders type badges, copies original path with toast, and restores selected entries', async () => {
    const { listTrash, restoreTrash, copyToClipboard } = installMockApi('Ubuntu-24.04')
    listTrash
      .mockResolvedValueOnce([
        makeEntry({ trashName: 'n1', originalPath: '/home/dev/notes.md', type: 'file' }),
        makeEntry({ trashName: 'd1', originalPath: '/home/dev/projects', type: 'directory' }),
        makeEntry({
          trashName: 'o1',
          originalPath: '/home/dev/pipe',
          type: 'other',
          present: false
        })
      ])
      .mockResolvedValueOnce([
        makeEntry({
          trashName: 'o1',
          originalPath: '/home/dev/pipe',
          type: 'other',
          present: false
        })
      ])

    const { onRestored } = renderTrashDialog()

    expect(await screen.findByText('/home/dev/notes.md')).toBeInTheDocument()
    const table = screen.getByTestId('trash-list')
    expect(within(table).getByText('File')).toBeInTheDocument()
    expect(within(table).getByText('Folder')).toBeInTheDocument()
    expect(within(table).getByText('Other')).toBeInTheDocument()
    expect(within(table).getByText('File gone')).toBeInTheDocument()

    const copyButtons = within(table).getAllByRole('button', { name: 'Copy' })
    expect(copyButtons).toHaveLength(3)
    fireEvent.click(copyButtons[1])
    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('/home/dev/projects')
    })
    expect(await screen.findByText('Path copied')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '/home/dev/notes.md' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '/home/dev/projects' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(restoreTrash).toHaveBeenCalledWith(['n1', 'd1'])
      expect(onRestored).toHaveBeenCalledWith(['/home/dev/notes.md', '/home/dev/projects'])
    })
    expect(await screen.findByText('Restored 2 item(s)')).toBeInTheDocument()
  })
})
