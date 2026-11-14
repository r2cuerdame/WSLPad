import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { FsKind, TextFileContent, WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import { EditorOverlay } from '@renderer/explorer/EditorOverlay'

const LINUX_FILE = '/etc/wsl.conf'
const WIN_FILE = 'C:\\Users\\dev\\notes.txt'

function textFile(partial: Partial<TextFileContent> = {}): TextFileContent {
  return {
    content: 'alpha beta alpha gamma alpha\n',
    encoding: 'utf-8',
    truncated: false,
    sizeBytes: 29,
    writable: true,
    ...partial
  }
}

/** Only selectedDistro matters to the editor; the rest of the snapshot is never read. */
function snapshotFor(distro: string | null): WslPadSnapshot {
  return { selectedDistro: distro } as unknown as WslPadSnapshot
}

function makeApi(file: TextFileContent) {
  let pushSnapshot: ((s: WslPadSnapshot) => void) | null = null
  const api = {
    getSnapshot: vi.fn(async () => snapshotFor('Ubuntu')),
    onSnapshot: vi.fn((cb: (s: WslPadSnapshot) => void) => {
      pushSnapshot = cb
      return () => undefined
    }),
    onNavigateSettings: vi.fn(() => () => undefined),
    settings: {
      get: vi.fn(async () => defaultSettings()),
      onChange: vi.fn(() => () => undefined)
    },
    explorer: {
      readText: vi.fn(async () => file),
      writeText: vi.fn(async () => undefined)
    },
    windows: {
      readText: vi.fn(async () => file),
      writeText: vi.fn(async () => undefined)
    }
  }
  const selectDistro = (distro: string): void => {
    act(() => pushSnapshot?.(snapshotFor(distro)))
  }
  return { api, selectDistro }
}

let mock: ReturnType<typeof makeApi>

function install(file: TextFileContent): void {
  mock = makeApi(file)
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = mock.api as unknown as WslPadApi
}

function PreparedProbe(): React.JSX.Element {
  const { preparedCommand } = useApp()
  return <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
}

/** Open the editor once the store knows the selected distro, as the Explorer does. */
function Harness({ path, fs, onClose }: { path: string; fs: FsKind; onClose: () => void }) {
  const { snapshot } = useApp()
  if (snapshot === null) return null
  return <EditorOverlay path={path} fs={fs} onClose={onClose} />
}

function textarea(): HTMLTextAreaElement {
  const ta = document.querySelector('textarea')
  if (!ta) throw new Error('editor not loaded')
  return ta
}

async function renderEditor(fs: FsKind, onClose = vi.fn()): Promise<void> {
  render(
    <AppStoreProvider>
      <PreparedProbe />
      <Harness path={fs === 'linux' ? LINUX_FILE : WIN_FILE} fs={fs} onClose={onClose} />
    </AppStoreProvider>
  )
  await waitFor(() => textarea())
}

function saveButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Save' })
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
  install(textFile())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EditorOverlay encoding guard', () => {
  it.each<FsKind>(['linux', 'windows'])(
    'keeps a latin1 fallback read read-only on the %s side so save cannot re-encode it',
    async (fs) => {
      install(textFile({ content: 'caf\u00e9\n', encoding: 'latin1', sizeBytes: 5 }))
      await renderEditor(fs)
      await waitFor(() => expect(textarea().value).toBe('caf\u00e9\n'))
      expect(screen.getByText('Read-only')).toBeTruthy()
      expect(screen.getByText('Latin-1')).toBeTruthy()
      expect(textarea().readOnly).toBe(true)
      expect(saveButton()).toBeNull()

      fireEvent.keyDown(textarea(), { key: 's', ctrlKey: true })
      await act(async () => {
        await Promise.resolve()
      })
      expect(mock.api.explorer.writeText).not.toHaveBeenCalled()
      expect(mock.api.windows.writeText).not.toHaveBeenCalled()
    }
  )

  it('leaves UTF-8 files writable', async () => {
    await renderEditor('linux')
    await waitFor(() => expect(saveButton()).not.toBeNull())
    expect(screen.queryByText('Latin-1')).toBeNull()
    expect(textarea().readOnly).toBe(false)
  })
})

describe('EditorOverlay distro pinning', () => {
  it('closes a clean Linux editor when the selected distro changes', async () => {
    const onClose = vi.fn()
    await renderEditor('linux', onClose)
    await waitFor(() => expect(saveButton()).not.toBeNull())
    mock.selectDistro('Debian')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mock.api.explorer.writeText).not.toHaveBeenCalled()
  })

  it('keeps unsaved edits but blocks saving into another distro until the original returns', async () => {
    const onClose = vi.fn()
    await renderEditor('linux', onClose)
    await waitFor(() => expect(saveButton()).not.toBeNull())
    fireEvent.change(textarea(), { target: { value: 'edited\n' } })

    mock.selectDistro('Debian')
    await waitFor(() => expect(saveButton()).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(textarea().value).toBe('edited\n')
    expect(screen.getByText('Read-only')).toBeTruthy()
    expect(screen.getByText('Ubuntu')).toBeTruthy()

    fireEvent.keyDown(textarea(), { key: 's', ctrlKey: true })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mock.api.explorer.writeText).not.toHaveBeenCalled()

    mock.selectDistro('Ubuntu')
    await waitFor(() => expect(saveButton()).not.toBeNull())
    expect(screen.queryByText('Ubuntu')).toBeNull()
    fireEvent.click(saveButton()!)
    await waitFor(() =>
      expect(mock.api.explorer.writeText).toHaveBeenCalledWith(LINUX_FILE, 'edited\n')
    )
  })

  it('does not prepare sudoedit for a save error once the distro has changed', async () => {
    mock.api.explorer.writeText.mockRejectedValueOnce({
      code: 'EACCES',
      path: LINUX_FILE,
      message: `EACCES: ${LINUX_FILE}`,
      detail: { user: 'dev', owner: 'root', permissions: 'rw-r--r--' }
    })
    await renderEditor('linux')
    await waitFor(() => expect(saveButton()).not.toBeNull())
    fireEvent.change(textarea(), { target: { value: 'edited\n' } })
    fireEvent.click(saveButton()!)
    await screen.findByRole('button', { name: 'Prepare sudoedit command' })

    mock.selectDistro('Debian')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Prepare sudoedit command' })).toBeNull()
    )
    expect(screen.getByTestId('prepared').textContent).toBe('')
  })

  it('lets a Windows-side file be saved regardless of the selected distro', async () => {
    const onClose = vi.fn()
    await renderEditor('windows', onClose)
    await waitFor(() => expect(saveButton()).not.toBeNull())
    fireEvent.change(textarea(), { target: { value: 'edited\n' } })
    mock.selectDistro('Debian')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(saveButton()!)
    await waitFor(() =>
      expect(mock.api.windows.writeText).toHaveBeenCalledWith(WIN_FILE, 'edited\n')
    )
  })
})

describe('EditorOverlay find in file', () => {
  async function openFind(): Promise<HTMLInputElement> {
    await renderEditor('linux')
    await waitFor(() => expect(saveButton()).not.toBeNull())
    fireEvent.keyDown(textarea(), { key: 'f', ctrlKey: true })
    const input = (await screen.findByPlaceholderText('Find in file')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'alpha' } })
    return input
  }

  // 'alpha beta alpha gamma alpha\n' — matches at 0, 11, 23.
  it('moves to the first match on the first Enter, then steps forward without editing', async () => {
    const input = await openFind()
    expect(screen.getByText('3 matches')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(textarea().selectionStart).toBe(0)
    expect(textarea().selectionEnd).toBe(5)
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(textarea().selectionStart).toBe(11)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(textarea().selectionStart).toBe(23)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(textarea().selectionStart).toBe(0)

    expect(textarea().value).toBe('alpha beta alpha gamma alpha\n')
    expect(document.activeElement).toBe(input)
  })

  it('steps backward with Shift+Enter', async () => {
    const input = await openFind()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(textarea().selectionStart).toBe(23)
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(textarea().selectionStart).toBe(11)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(textarea().selectionStart).toBe(23)
  })

  it('restarts from the first match when the query changes', async () => {
    const input = await openFind()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'alph' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(textarea().selectionStart).toBe(0)
    expect(textarea().selectionEnd).toBe(4)
  })

  it('returns focus to the textarea with the match selected when find closes', async () => {
    const input = await openFind()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Find in file')).toBeNull()
    expect(document.activeElement).toBe(textarea())
    expect(textarea().selectionStart).toBe(11)
    expect(textarea().selectionEnd).toBe(16)
  })

  it('refocuses and selects the open find box on Ctrl+F', async () => {
    const input = await openFind()
    textarea().focus()
    fireEvent.keyDown(textarea(), { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(5)
  })
})

describe('EditorOverlay saved size', () => {
  it('updates the footer size to the encoded length of what was saved', async () => {
    install(textFile({ content: 'abc\n', sizeBytes: 4 }))
    await renderEditor('linux')
    await waitFor(() => expect(saveButton()).not.toBeNull())
    expect(screen.getByText('4 B')).toBeTruthy()

    // Two 3-byte Hangul syllables plus a newline: 7 bytes in UTF-8, 3 UTF-16 units.
    fireEvent.change(textarea(), { target: { value: '\uD55C\uAE00\n' } })
    fireEvent.click(saveButton()!)
    await waitFor(() => expect(screen.getByText('7 B')).toBeTruthy())
    expect(mock.api.explorer.writeText).toHaveBeenCalledWith(LINUX_FILE, '\uD55C\uAE00\n')
  })
})
