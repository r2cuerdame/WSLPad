import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { DirSizeResult, FileStat, FsKind, WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import { PropertiesDialog } from '@renderer/explorer/PropertiesDialog'

const LINUX_FILE = '/home/dev/notes.md'
const LINUX_DIR = '/home/dev/projects'
const WIN_DIR = 'C:\\Users\\dev\\Documents'

function stat(partial: Partial<FileStat> & { path: string }): FileStat {
  return {
    name: partial.path.split(/[\\/]/).pop() ?? partial.path,
    type: 'file',
    sizeBytes: 2048,
    mtime: '2026-07-30T10:00:00.000Z',
    owner: 'dev',
    group: 'staff',
    permissions: 'rw-r--r--',
    permissionsOctal: '644',
    isHidden: false,
    symlinkTarget: null,
    targetType: null,
    inode: 42,
    atime: null,
    windowsPath: null,
    ...partial
  }
}

function sizes(path: string, partial: Partial<DirSizeResult> = {}): DirSizeResult {
  return {
    path,
    entries: [
      { name: 'a', path: `${path}/a`, isDirectory: true, sizeBytes: 3072, partial: false },
      { name: 'b.txt', path: `${path}/b.txt`, isDirectory: false, sizeBytes: 1024, partial: false }
    ],
    totalBytes: 4096,
    skipped: 0,
    cancelled: false,
    error: null,
    ...partial
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeApi() {
  return {
    getSnapshot: vi.fn(async () => null as unknown as WslPadSnapshot),
    onSnapshot: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    copyToClipboard: vi.fn(async () => undefined),
    explorer: {
      stat: vi.fn(async (path: string) => stat({ path })),
      dirSizes: vi.fn(async (path: string, _token: string) => sizes(path)),
      cancelOp: vi.fn(async (_token: string) => undefined)
    },
    windows: {
      stat: vi.fn(async (path: string) =>
        stat({ path, owner: null, group: null, permissions: null, permissionsOctal: null, inode: null })
      ),
      dirSizes: vi.fn(async (path: string, _token: string) => sizes(path)),
      cancelDirSizes: vi.fn(async (_token: string) => undefined)
    }
  }
}

let api: ReturnType<typeof makeApi>

function StoreProbe(): React.JSX.Element {
  const { preparedCommand, toasts } = useApp()
  return (
    <>
      <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
      <div data-testid="toasts">{toasts.map((t) => t.text).join('|')}</div>
    </>
  )
}

function renderDialog(path: string, fs: FsKind): ReturnType<typeof render> {
  return render(
    <AppStoreProvider>
      <StoreProbe />
      <PropertiesDialog path={path} fs={fs} onClose={() => undefined} />
    </AppStoreProvider>
  )
}

function prepared(): string {
  return screen.getByTestId('prepared').textContent ?? ''
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled
}

/** The value cell of a labelled properties row. */
function rowValue(label: string): HTMLElement {
  const labelEl = screen.getByText(label, { selector: '.props-label' })
  return labelEl.parentElement!.querySelector<HTMLElement>('.props-value')!
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

describe('PropertiesDialog prepared commands (issue #349)', () => {
  it('prepares the same chmod/chown commands as before when every value was read', async () => {
    renderDialog(LINUX_FILE, 'linux')
    const chmod = await screen.findByRole('button', { name: 'Prepare chmod command' })
    const chown = screen.getByRole('button', { name: 'Prepare chown command' })
    expect((chmod as HTMLButtonElement).disabled).toBe(false)
    expect((chown as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(chmod)
    expect(prepared()).toBe(`chmod 644 '${LINUX_FILE}'`)
    fireEvent.click(chown)
    expect(prepared()).toBe(`chown dev:staff '${LINUX_FILE}'`)
  })

  it('does not prepare chmod with an invented mode when the mode is unknown', async () => {
    api.explorer.stat.mockImplementationOnce(async (path: string) =>
      stat({ path, permissions: null, permissionsOctal: null })
    )
    renderDialog(LINUX_FILE, 'linux')
    const chmod = await screen.findByRole('button', { name: 'Prepare chmod command' })
    expect(isDisabled(chmod)).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: 'Prepare chown command' }))).toBe(false)
    fireEvent.click(chmod)
    expect(prepared()).toBe('')
  })

  it.each<[string, Partial<FileStat>]>([
    ['owner', { owner: null }],
    ['group', { group: null }]
  ])('does not prepare chown when the %s is unknown', async (_label, unknown) => {
    api.explorer.stat.mockImplementationOnce(async (path: string) => stat({ path, ...unknown }))
    renderDialog(LINUX_FILE, 'linux')
    const chown = await screen.findByRole('button', { name: 'Prepare chown command' })
    expect(isDisabled(chown)).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: 'Prepare chmod command' }))).toBe(false)
    fireEvent.click(chown)
    expect(prepared()).toBe('')
    expect(rowValue('Owner').textContent).toBe(unknown.owner === null ? 'Unknown' : 'dev')
  })

  it('still prepares the symlink command', async () => {
    renderDialog(LINUX_FILE, 'linux')
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare symlink command' }))
    expect(prepared()).toBe(`ln -s '${LINUX_FILE}' '${LINUX_FILE}-link'`)
  })
})

describe('PropertiesDialog sizes (issue #349)', () => {
  it('keeps the file size row as before', async () => {
    renderDialog(LINUX_FILE, 'linux')
    await screen.findByText('Prepare chmod command')
    expect(rowValue('Size').textContent).toBe('2 KB')
    expect(screen.queryByRole('button', { name: 'Measure directory sizes' })).toBeNull()
  })

  it.each<[FsKind, string]>([
    ['linux', LINUX_DIR],
    ['windows', WIN_DIR]
  ])('measures a %s folder only on request and shows its total', async (fs, path) => {
    const source = fs === 'linux' ? api.explorer : api.windows
    source.stat.mockImplementationOnce(async (p: string) =>
      stat({ path: p, type: 'directory', sizeBytes: 4096 })
    )
    renderDialog(path, fs)
    const measure = await screen.findByRole('button', { name: 'Measure directory sizes' })
    // The directory record's own 4 KB is never shown as the folder's size.
    expect(rowValue('Size').textContent).not.toContain('4 KB')
    expect(source.dirSizes).not.toHaveBeenCalled()

    fireEvent.click(measure)
    await waitFor(() => expect(rowValue('Size').textContent).toBe('4 KB'))
    expect(source.dirSizes).toHaveBeenCalledWith(path, expect.stringMatching(/^[A-Za-z0-9-]+$/))
    const other = fs === 'linux' ? api.windows : api.explorer
    expect(other.dirSizes).not.toHaveBeenCalled()
  })

  it('shows the running state while measuring', async () => {
    const pending = deferred<DirSizeResult>()
    api.explorer.stat.mockImplementationOnce(async (p: string) => stat({ path: p, type: 'directory' }))
    api.explorer.dirSizes.mockImplementationOnce(() => pending.promise)
    renderDialog(LINUX_DIR, 'linux')
    fireEvent.click(await screen.findByRole('button', { name: 'Measure directory sizes' }))
    expect(within(rowValue('Size')).getByRole('status').textContent).toContain(
      'Measuring this folder'
    )
    await act(async () => pending.resolve(sizes(LINUX_DIR)))
    expect(rowValue('Size').textContent).toBe('4 KB')
  })

  it.each([
    ['a partial entry', { entries: [{ name: 'x', path: `${LINUX_DIR}/x`, isDirectory: true, sizeBytes: 4096, partial: true }] }],
    ['a skipped child', { skipped: 3 }],
    ['an unmeasured child', { entries: [{ name: 'x', path: `${LINUX_DIR}/x`, isDirectory: true, sizeBytes: null, partial: false }] }]
  ])('marks the total as a minimum when it leaves out %s', async (_label, partial) => {
    api.explorer.stat.mockImplementationOnce(async (p: string) => stat({ path: p, type: 'directory' }))
    api.explorer.dirSizes.mockImplementationOnce(async (p: string) => sizes(p, partial))
    renderDialog(LINUX_DIR, 'linux')
    fireEvent.click(await screen.findByRole('button', { name: 'Measure directory sizes' }))
    await waitFor(() => expect(rowValue('Size').textContent).toMatch(/^≥ 4 KB/))
    expect(rowValue('Size').textContent).toContain('At least this much')
  })

  it('says "not measured" instead of 0 when nothing could be measured', async () => {
    api.explorer.stat.mockImplementationOnce(async (p: string) => stat({ path: p, type: 'directory' }))
    api.explorer.dirSizes.mockImplementationOnce(async (p: string) =>
      sizes(p, { totalBytes: null, entries: [], skipped: 2 })
    )
    renderDialog(LINUX_DIR, 'linux')
    fireEvent.click(await screen.findByRole('button', { name: 'Measure directory sizes' }))
    await waitFor(() => expect(rowValue('Size').textContent).toBe('Not measured'))
    expect(rowValue('Size').textContent).not.toMatch(/\b0 B\b/)
  })

  it('shows a collector failure with its reason and lets the user measure again', async () => {
    api.explorer.stat.mockImplementationOnce(async (p: string) => stat({ path: p, type: 'directory' }))
    api.explorer.dirSizes.mockImplementationOnce(async (p: string) =>
      sizes(p, { entries: [], totalBytes: 0, error: 'du: permission denied' })
    )
    renderDialog(LINUX_DIR, 'linux')
    fireEvent.click(await screen.findByRole('button', { name: 'Measure directory sizes' }))
    await waitFor(() => expect(rowValue('Size').textContent).toContain('Could not measure this folder'))
    expect(rowValue('Size').textContent).toContain('du: permission denied')
    expect(rowValue('Size').textContent).not.toContain('0 B')

    fireEvent.click(within(rowValue('Size')).getByRole('button', { name: 'Measure directory sizes' }))
    await waitFor(() => expect(rowValue('Size').textContent).toBe('4 KB'))
  })

  it('shows a rejected measurement as a failure', async () => {
    api.windows.stat.mockImplementationOnce(async (p: string) =>
      stat({ path: p, type: 'directory', owner: null, group: null, permissionsOctal: null })
    )
    api.windows.dirSizes.mockImplementationOnce(async () => {
      throw new Error('EACCES: access denied')
    })
    renderDialog(WIN_DIR, 'windows')
    fireEvent.click(await screen.findByRole('button', { name: 'Measure directory sizes' }))
    await waitFor(() => expect(rowValue('Size').textContent).toContain('Could not measure this folder'))
    expect(rowValue('Size').textContent).toContain('EACCES')
  })

  it.each<[FsKind, string]>([
    ['linux', LINUX_DIR],
    ['windows', WIN_DIR]
  ])('cancels a %s measurement when the dialog closes and ignores its late answer', async (fs, path) => {
    const source = fs === 'linux' ? api.explorer : api.windows
    const pending = deferred<DirSizeResult>()
    source.stat.mockImplementationOnce(async (p: string) => stat({ path: p, type: 'directory' }))
    source.dirSizes.mockImplementationOnce(() => pending.promise)
    const view = renderDialog(path, fs)
    fireEvent.click(await screen.findByRole('button', { name: 'Measure directory sizes' }))
    const token = source.dirSizes.mock.calls[0][1]

    view.unmount()
    const cancel = fs === 'linux' ? api.explorer.cancelOp : api.windows.cancelDirSizes
    expect(cancel).toHaveBeenCalledWith(token)

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await act(async () => pending.resolve(sizes(path)))
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
    expect(screen.queryByText('4 KB')).toBeNull()
  })

  it('ignores a late answer from a run that a retry replaced', async () => {
    const pending = deferred<DirSizeResult>()
    api.explorer.stat.mockImplementation(async (p: string) => stat({ path: p, type: 'directory' }))
    api.explorer.dirSizes.mockImplementationOnce(() => pending.promise)
    const view = renderDialog(LINUX_DIR, 'linux')
    fireEvent.click(await screen.findByRole('button', { name: 'Measure directory sizes' }))
    view.rerender(
      <AppStoreProvider>
        <StoreProbe />
        <PropertiesDialog path="/home/dev/other" fs="linux" onClose={() => undefined} />
      </AppStoreProvider>
    )
    expect(api.explorer.cancelOp).toHaveBeenCalledWith(api.explorer.dirSizes.mock.calls[0][1])
    await screen.findByRole('button', { name: 'Measure directory sizes' })
    await act(async () => pending.resolve(sizes(LINUX_DIR)))
    expect(screen.queryByText('4 KB')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Measure directory sizes' })).not.toBeNull()
  })

  it('does not offer to measure the This PC root', async () => {
    api.windows.stat.mockImplementationOnce(async (p: string) =>
      stat({ path: p, type: 'directory', sizeBytes: null, owner: null, group: null, permissionsOctal: null })
    )
    renderDialog('ThisPC', 'windows')
    await waitFor(() => expect(rowValue('Size').textContent).toBe('Unknown'))
    expect(screen.queryByRole('button', { name: 'Measure directory sizes' })).toBeNull()
  })
})

describe('PropertiesDialog link target and retry (issue #349)', () => {
  it('copies the link target', async () => {
    api.explorer.stat.mockImplementationOnce(async (p: string) =>
      stat({ path: p, type: 'symlink', symlinkTarget: '/mnt/c/Users/dev', targetType: 'directory' })
    )
    renderDialog('/home/dev/winlink', 'linux')
    const value = await waitFor(() => rowValue('Link target'))
    expect(value.textContent).toBe('/mnt/c/Users/dev')
    const copy = within(value.parentElement!).getByRole('button', { name: 'Copy' })
    fireEvent.click(copy)
    await waitFor(() => expect(api.copyToClipboard).toHaveBeenCalledWith('/mnt/c/Users/dev'))
    await waitFor(() => expect(screen.getByTestId('toasts').textContent).toContain('Path copied'))
  })

  it.each<[FsKind, string]>([
    ['linux', LINUX_FILE],
    ['windows', 'C:\\Users\\dev\\notes.txt']
  ])('retries a failed %s read in place', async (fs, path) => {
    const source = fs === 'linux' ? api.explorer : api.windows
    source.stat.mockImplementationOnce(async () => {
      throw new Error('EIO: temporarily unavailable')
    })
    renderDialog(path, fs)
    await screen.findByText('EIO: temporarily unavailable')
    expect(screen.queryByText('Prepare symlink command')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(rowValue('Size').textContent).toBe('2 KB'))
    expect(screen.queryByText('EIO: temporarily unavailable')).toBeNull()
    expect(source.stat).toHaveBeenCalledTimes(2)
    expect(source.stat).toHaveBeenLastCalledWith(path)
  })
})
