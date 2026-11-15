import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import { WINDOWS_ROOT } from '@shared/constants'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import { Toolbar } from '@renderer/explorer/Toolbar'
import { Breadcrumb } from '@renderer/explorer/Breadcrumb'
import {
  createLinuxAdapter,
  createWindowsAdapter,
  type FsAdapter
} from '@renderer/explorer/fsAdapter'

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

let api: ReturnType<typeof makeApi>

function ToastProbe(): React.JSX.Element {
  const { toasts } = useApp()
  return <div data-testid="toasts">{toasts.map((t) => t.text).join('|')}</div>
}

function makeHandlers() {
  return {
    onBack: vi.fn(),
    onForward: vi.fn(),
    onUp: vi.fn(),
    onRefresh: vi.fn(),
    onHome: vi.fn(),
    onRoot: vi.fn(),
    onNavigate: vi.fn(),
    onToggleHidden: vi.fn(),
    onToggleTree: vi.fn(),
    onSearch: vi.fn(),
    onClearSearch: vi.fn()
  }
}

type Handlers = ReturnType<typeof makeHandlers>

interface Options {
  adapter?: FsAdapter
  path?: string | null
  canBack?: boolean
  canForward?: boolean
  searchQuery?: string
}

function toolbar(h: Handlers, o: Options = {}): React.JSX.Element {
  return (
    <Toolbar
      adapter={o.adapter ?? createLinuxAdapter('/home/dev')}
      path={o.path === undefined ? '/home/dev/projects' : o.path}
      canBack={o.canBack ?? true}
      canForward={o.canForward ?? true}
      showHidden={false}
      searchQuery={o.searchQuery ?? ''}
      treeOpen
      {...h}
    />
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderToolbar(o: Options = {}): Promise<{
  h: Handlers
  rerender: (next: Options) => void
}> {
  const h = makeHandlers()
  const view = render(
    <AppStoreProvider>
      {toolbar(h, o)}
      <ToastProbe />
    </AppStoreProvider>
  )
  await flush()
  return {
    h,
    rerender: (next) =>
      view.rerender(
        <AppStoreProvider>
          {toolbar(h, { ...o, ...next })}
          <ToastProbe />
        </AppStoreProvider>
      )
  }
}

const pathInput = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: 'Enter a path and press Enter' }) as HTMLInputElement
const searchInput = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: 'Search in current folder' }) as HTMLInputElement

function expectAllSelected(input: HTMLInputElement): void {
  expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(input.value.length)
}

async function submit(input: HTMLInputElement, value: string): Promise<void> {
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await flush()
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

describe('Explorer toolbar shortcuts', () => {
  it('opens the path editor with the whole path selected on Ctrl+L and Alt+D', async () => {
    await renderToolbar()
    expect(screen.queryByRole('textbox', { name: 'Enter a path and press Enter' })).toBeNull()

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(pathInput().value).toBe('/home/dev/projects')
    expectAllSelected(pathInput())

    fireEvent.keyDown(pathInput(), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Enter a path and press Enter' })).toBeNull()

    fireEvent.keyDown(window, { key: 'd', altKey: true })
    expectAllSelected(pathInput())
  })

  it('focuses and selects the search box on Ctrl+F, even from the path editor', async () => {
    await renderToolbar({ searchQuery: 'notes' })
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(searchInput().value).toBe('notes')
    expectAllSelected(searchInput())

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(document.activeElement).toBe(pathInput())
    fireEvent.keyDown(pathInput(), { key: 'F', ctrlKey: true })
    expect(document.activeElement).toBe(searchInput())
  })

  it('runs back, forward, up and refresh exactly like the toolbar buttons', async () => {
    const { h } = await renderToolbar()
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true })
    fireEvent.keyDown(window, { key: 'F5' })
    expect(h.onBack).toHaveBeenCalledTimes(1)
    expect(h.onForward).toHaveBeenCalledTimes(1)
    expect(h.onUp).toHaveBeenCalledTimes(1)
    expect(h.onRefresh).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    expect(h.onBack).toHaveBeenCalledTimes(2)
    expect(h.onUp).toHaveBeenCalledTimes(2)
  })

  it('does nothing where the matching button is disabled', async () => {
    const { h } = await renderToolbar({ path: '/', canBack: false, canForward: false })
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true })
    expect(h.onBack).not.toHaveBeenCalled()
    expect(h.onForward).not.toHaveBeenCalled()
    expect(h.onUp).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Up' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('leaves navigation keys to a text box that has focus', async () => {
    const { h } = await renderToolbar()
    searchInput().focus()
    fireEvent.keyDown(searchInput(), { key: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(searchInput(), { key: 'F5' })
    expect(h.onBack).not.toHaveBeenCalled()
    expect(h.onRefresh).not.toHaveBeenCalled()
  })
})

describe('Explorer toolbar shortcut scope', () => {
  function Panes({ h, active }: { h: Handlers; active: boolean }): React.JSX.Element {
    return (
      <AppStoreProvider>
        <section className={'file-pane' + (active ? ' is-active' : '')} data-testid="mine">
          {toolbar(h)}
        </section>
        <section className={'file-pane' + (active ? '' : ' is-active')} />
      </AppStoreProvider>
    )
  }

  it('answers only in the active pane', async () => {
    const h = makeHandlers()
    const view = render(<Panes h={h} active={false} />)
    await flush()
    fireEvent.keyDown(window, { key: 'F5' })
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(h.onRefresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Enter a path and press Enter' })).toBeNull()

    view.rerender(<Panes h={h} active />)
    fireEvent.keyDown(window, { key: 'F5' })
    expect(h.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while its tab is hidden or an overlay is open', async () => {
    const h = makeHandlers()
    const view = render(
      <AppStoreProvider>
        <main style={{ display: 'none' }}>{toolbar(h)}</main>
      </AppStoreProvider>
    )
    await flush()
    fireEvent.keyDown(window, { key: 'F5' })
    expect(h.onRefresh).not.toHaveBeenCalled()

    view.rerender(
      <AppStoreProvider>
        <main>{toolbar(h)}</main>
        <div className="dialog-overlay" />
      </AppStoreProvider>
    )
    fireEvent.keyDown(window, { key: 'F5' })
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(h.onRefresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Enter a path and press Enter' })).toBeNull()
  })

  it('leaves Ctrl+L and Ctrl+F to a text box outside the toolbar', async () => {
    const h = makeHandlers()
    render(
      <AppStoreProvider>
        {toolbar(h)}
        <textarea aria-label="console" />
      </AppStoreProvider>
    )
    await flush()
    const other = screen.getByRole('textbox', { name: 'console' })
    other.focus()
    fireEvent.keyDown(other, { key: 'l', ctrlKey: true })
    fireEvent.keyDown(other, { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(other)
    expect(screen.queryByRole('textbox', { name: 'Enter a path and press Enter' })).toBeNull()
  })
})

describe('Explorer path editor', () => {
  it('drops a half-typed path when focus leaves, so reopening shows the current folder', async () => {
    const { h } = await renderToolbar()
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    fireEvent.change(pathInput(), { target: { value: '/home/dev/pro' } })
    fireEvent.blur(pathInput())
    expect(screen.queryByRole('textbox', { name: 'Enter a path and press Enter' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Enter a path and press Enter' }))
    expect(pathInput().value).toBe('/home/dev/projects')
    expectAllSelected(pathInput())
    expect(h.onNavigate).not.toHaveBeenCalled()
  })

  it('expands ~ to the distro home on the Linux pane', async () => {
    const { h } = await renderToolbar()
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    await submit(pathInput(), '~')
    expect(h.onNavigate).toHaveBeenLastCalledWith('/home/dev')

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    await submit(pathInput(), ' ~/projects/wslpad-demo ')
    expect(h.onNavigate).toHaveBeenLastCalledWith('/home/dev/projects/wslpad-demo')

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    await submit(pathInput(), '/etc')
    expect(h.onNavigate).toHaveBeenLastCalledWith('/etc')
  })

  it('expands ~ against a root home without doubling the slash', async () => {
    const { h } = await renderToolbar({ adapter: createLinuxAdapter(null) })
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    await submit(pathInput(), '~/tmp')
    expect(h.onNavigate).toHaveBeenLastCalledWith('/tmp')
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    await submit(pathInput(), '~')
    expect(h.onNavigate).toHaveBeenLastCalledWith('/')
  })

  it('never shows the internal This PC id and maps it back to the virtual root', async () => {
    const { h } = await renderToolbar({ adapter: createWindowsAdapter(), path: WINDOWS_ROOT })
    expect(screen.getByRole('button', { name: 'This PC' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy path' })).toBeNull()

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(pathInput().value).toBe('')
    await submit(pathInput(), '')
    expect(h.onNavigate).toHaveBeenLastCalledWith(WINDOWS_ROOT)

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    await submit(pathInput(), 'This PC')
    expect(h.onNavigate).toHaveBeenLastCalledWith(WINDOWS_ROOT)

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    await submit(pathInput(), 'C:\\Users\\dev')
    expect(h.onNavigate).toHaveBeenLastCalledWith('C:\\Users\\dev')
  })
})

describe('Explorer copy path and clear search', () => {
  it('copies the current folder path and confirms with a toast', async () => {
    await renderToolbar({ adapter: createWindowsAdapter(), path: 'C:\\Users\\dev\\Documents' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
      await Promise.resolve()
    })
    expect(api.copyToClipboard).toHaveBeenCalledWith('C:\\Users\\dev\\Documents')
    expect(screen.getByTestId('toasts').textContent).toContain('Path copied')
  })

  it('hides the copy button while the path is being edited', async () => {
    await renderToolbar()
    expect(screen.getByRole('button', { name: 'Copy path' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(screen.queryByRole('button', { name: 'Copy path' })).toBeNull()
  })

  it('shows a clear button only when there is something to clear', async () => {
    const { h, rerender } = await renderToolbar()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

    fireEvent.change(searchInput(), { target: { value: 'readme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(searchInput().value).toBe('')
    expect(h.onClearSearch).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(searchInput())
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

    // A search that already ran keeps the button even after the box was emptied.
    rerender({ searchQuery: 'readme' })
    expect(searchInput().value).toBe('readme')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(h.onClearSearch).toHaveBeenCalledTimes(2)
    rerender({ searchQuery: '' })
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})

describe('Explorer breadcrumb', () => {
  it('scrolls a deep path to its right end and navigates from any ancestor', async () => {
    const assigned: number[] = []
    const widthSpy = vi
      .spyOn(Element.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: Element) {
        return this.classList.contains('breadcrumb')
          ? this.querySelectorAll('button').length * 100
          : 0
      })
    const leftSpy = vi
      .spyOn(Element.prototype, 'scrollLeft', 'set')
      .mockImplementation(function (this: Element, value: number) {
        if (this.classList.contains('breadcrumb')) assigned.push(value)
      })
    try {
      const adapter = createLinuxAdapter('/home/dev')
      const onNavigate = vi.fn()
      const deep = '/home/dev/projects/wslpad-demo/src/renderer/components'
      const view = render(
        <Breadcrumb adapter={adapter} path="/home/dev" onNavigate={onNavigate} onEdit={vi.fn()} />
      )
      view.rerender(
        <Breadcrumb adapter={adapter} path={deep} onNavigate={onNavigate} onEdit={vi.fn()} />
      )
      // root + 7 segments + edit area
      expect(assigned.at(-1)).toBe(900)

      fireEvent.click(screen.getByRole('button', { name: 'projects' }))
      expect(onNavigate).toHaveBeenLastCalledWith('/home/dev/projects')
      fireEvent.click(screen.getByRole('button', { name: '/' }))
      expect(onNavigate).toHaveBeenLastCalledWith('/')
    } finally {
      widthSpy.mockRestore()
      leftSpy.mockRestore()
    }
  })
})
