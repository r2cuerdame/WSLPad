import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { FileEntry, WslPadSnapshot } from '@shared/types'
import { PANE_SPLIT_BOUNDS, PANE_SPLIT_DEFAULT, WINDOWS_ROOT } from '@shared/constants'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import ExplorerTab from '@renderer/explorer/ExplorerTab'
import { INTERNAL_DND_TYPE } from '@renderer/explorer/FileList'
import { SPLIT_STORAGE_KEY } from '@renderer/explorer/Splitter'
import { sortEntries } from '@renderer/explorer/useExplorer'

const WIN_HOME = 'C:\\Users\\dev'
const LINUX_HOME = '/home/dev'

function entry(partial: Partial<FileEntry> & { name: string; path: string }): FileEntry {
  return {
    type: 'file',
    sizeBytes: 100,
    mtime: '2026-07-30T10:00:00.000Z',
    owner: 'dev',
    group: 'dev',
    permissions: 'rw-r--r--',
    permissionsOctal: '644',
    isHidden: false,
    symlinkTarget: null,
    targetType: null,
    ...partial
  }
}

function winEntry(partial: Partial<FileEntry> & { name: string; path: string }): FileEntry {
  return entry({ owner: null, group: null, permissions: null, permissionsOctal: null, ...partial })
}

function makeSnapshot(): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-30T12:00:00.000Z',
    selectedDistro: 'Ubuntu-24.04',
    distros: [{ name: 'Ubuntu-24.04', state: 'Running', wslVersion: 2, isDefault: true }],
    dashboard: {
      distro: {
        name: 'Ubuntu-24.04',
        state: 'Running',
        wslVersion: 2,
        isDefault: true,
        osName: 'Ubuntu 24.04.2 LTS',
        uncPath: '\\\\wsl.localhost\\Ubuntu-24.04'
      },
      system: {
        kernel: '6.6.36-microsoft-standard-WSL2',
        hostname: 'devbox',
        user: 'dev',
        home: LINUX_HOME,
        shell: '/bin/bash',
        uptimeSeconds: 7200,
        systemdEnabled: true,
        ip: '172.20.0.2',
        windowsUserProfileLinux: '/mnt/c/Users/dev'
      },
      resources: {
        cpuPercent: 1,
        cpuCount: 8,
        memTotalBytes: null,
        memUsedBytes: null,
        memAvailableBytes: null,
        swapTotalBytes: null,
        swapUsedBytes: null,
        disks: [],
        loadAvg: null,
        processCount: null
      },
      paths: [],
      configuration: [],
      tools: [],
      hermes: null,
      environment: [],
      processes: [],
      services: [],
      ports: [],
      warnings: []
    },
    explorer: { distro: 'Ubuntu-24.04', currentPath: LINUX_HOME, showHidden: false },
    terminal: { distro: 'Ubuntu-24.04', cwd: LINUX_HOME, status: 'ready' },
    mcp: {
      running: true,
      transport: 'http',
      endpoint: 'http://127.0.0.1:4923/mcp',
      port: 4923,
      connectedClients: 0,
      lastRequestAt: null,
      readOnly: true,
      tokenSet: true,
      error: null
    },
    warnings: []
  }
}

const linuxListing: FileEntry[] = [
  entry({ name: 'config.json', path: `${LINUX_HOME}/config.json` }),
  entry({ name: 'logs', path: `${LINUX_HOME}/logs`, type: 'directory', sizeBytes: null }),
  entry({ name: 'a.txt', path: `${LINUX_HOME}/a.txt` })
]

const windowsListings: Record<string, FileEntry[]> = {
  [WINDOWS_ROOT]: [
    winEntry({ name: 'C:', path: 'C:\\', type: 'directory', sizeBytes: null }),
    winEntry({ name: 'D:', path: 'D:\\', type: 'directory', sizeBytes: null })
  ],
  'C:\\': [winEntry({ name: 'Users', path: 'C:\\Users', type: 'directory', sizeBytes: null })],
  'C:\\Users': [winEntry({ name: 'dev', path: WIN_HOME, type: 'directory', sizeBytes: null })],
  [WIN_HOME]: [
    winEntry({ name: 'notes.txt', path: `${WIN_HOME}\\notes.txt` }),
    winEntry({ name: 'Documents', path: `${WIN_HOME}\\Documents`, type: 'directory', sizeBytes: null }),
    winEntry({ name: 'app.log', path: `${WIN_HOME}\\app.log` })
  ],
  [`${WIN_HOME}\\Documents`]: []
}

function makeApi(snapshot: WslPadSnapshot) {
  return {
    listDistros: vi.fn(async () => snapshot.distros),
    selectDistro: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined),
    revealEnv: vi.fn(async () => null),
    copyLlmMarkdown: vi.fn(async () => ''),
    exportLlmJson: vi.fn(async () => null),
    explorer: {
      list: vi.fn(async (path: string) => (path === LINUX_HOME ? linuxListing : [])),
      tree: vi.fn(async () => [] as FileEntry[]),
      stat: vi.fn(async () => ({
        ...entry({ name: 'config.json', path: `${LINUX_HOME}/config.json` }),
        inode: 1,
        atime: null,
        windowsPath: null
      })),
      mkdir: vi.fn(async () => undefined),
      createFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      copy: vi.fn(async () => 'op-1'),
      trash: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      readText: vi.fn(async () => ({
        content: '',
        encoding: 'utf-8' as const,
        truncated: false,
        sizeBytes: 0,
        writable: true
      })),
      writeText: vi.fn(async () => undefined),
      importFromWindows: vi.fn(async () => 'op-2'),
      exportToWindows: vi.fn(async () => 'op-3'),
      cancelOp: vi.fn(async () => undefined),
      search: vi.fn(async () => [] as FileEntry[]),
      pickImportPaths: vi.fn(async () => [] as string[]),
      pickExportDir: vi.fn(async () => null),
      startDrag: vi.fn(async () => undefined)
    },
    windows: {
      places: vi.fn(async () => []),
      home: vi.fn(async () => WIN_HOME),
      list: vi.fn(async (path: string) => windowsListings[path] ?? []),
      tree: vi.fn(async (_path: string) => [] as FileEntry[]),
      stat: vi.fn(async () => ({
        ...winEntry({ name: 'notes.txt', path: `${WIN_HOME}\\notes.txt` }),
        inode: null,
        atime: null,
        windowsPath: `${WIN_HOME}\\notes.txt`
      })),
      mkdir: vi.fn(async () => undefined),
      createFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      copy: vi.fn(async () => 'op-4'),
      trash: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      readText: vi.fn(async () => ({
        content: '',
        encoding: 'utf-8' as const,
        truncated: false,
        sizeBytes: 0,
        writable: true
      })),
      writeText: vi.fn(async () => undefined),
      search: vi.fn(async () => [] as FileEntry[]),
      openPath: vi.fn(async () => undefined),
      startDrag: vi.fn(async () => undefined)
    },
    convertPath: vi.fn(async () => ''),
    openInWindowsExplorer: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    terminal: {
      ensure: vi.fn(async () => ({ sessionId: 's1', status: 'ready' as const, cwd: LINUX_HOME })),
      input: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      setCwd: vi.fn(async () => undefined),
      getState: vi.fn(async () => ({ status: 'ready' as const, cwd: LINUX_HOME })),
      onData: vi.fn(() => () => undefined),
      onStatus: vi.fn(() => () => undefined)
    },
    settings: {
      get: vi.fn(async () => defaultSettings()),
      set: vi.fn(async () => defaultSettings()),
      reset: vi.fn(async () => defaultSettings()),
      getLoadError: vi.fn(async () => ({ corrupted: false, message: null })),
      onChange: vi.fn(() => () => undefined)
    },
    mcp: {
      status: vi.fn(async () => snapshot.mcp),
      regenerateToken: vi.fn(async () => snapshot.mcp),
      registerClient: vi.fn(async () => ({ ok: true, configPath: null, error: null })),
      test: vi.fn(async () => ({ ok: true, error: null })),
      getConfigJson: vi.fn(async () => '{}'),
      onStatus: vi.fn(() => () => undefined)
    },
    updates: {
      check: vi.fn(async () => ({ state: 'idle', version: null, percent: null, error: null })),
      install: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({ state: 'idle', version: null, percent: null, error: null })),
      onStatus: vi.fn(() => () => undefined)
    },
    app: {
      version: vi.fn(async () => '0.1.1'),
      quit: vi.fn(async () => undefined)
    },
    onSnapshot: vi.fn(() => () => undefined),
    onOpProgress: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }
}

type MockApi = ReturnType<typeof makeApi>

let api: MockApi
let snapshot: WslPadSnapshot

function ConsolePathProbe(): React.JSX.Element {
  const { pendingConsolePath } = useApp()
  return <div data-testid="console-path">{pendingConsolePath ?? ''}</div>
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/** Render both panes and wait until each has listed its start directory. */
async function renderExplorer(): Promise<void> {
  render(
    <AppStoreProvider>
      <ConsolePathProbe />
      <ExplorerTab />
    </AppStoreProvider>
  )
  await flush()
  await waitFor(() => expect(api.windows.list).toHaveBeenCalledWith(WIN_HOME, { showHidden: false }))
  await waitFor(() =>
    expect(api.explorer.list).toHaveBeenCalledWith(LINUX_HOME, { showHidden: false })
  )
  await screen.findByText('notes.txt')
  await screen.findByText('config.json')
}

function pane(kind: 'windows' | 'linux'): HTMLElement {
  return screen.getByTestId(`pane-${kind}`)
}

function rowNames(kind: 'windows' | 'linux'): string[] {
  return Array.from(pane(kind).querySelectorAll('.fl-body .fl-row .fl-name')).map(
    (el) => el.textContent ?? ''
  )
}

/**
 * jsdom has no DragEvent, so build a MouseEvent carrying the payload — React
 * reads dataTransfer/ctrlKey straight off the native event.
 */
function fireDrop(target: Element, payload: unknown, ctrlKey = false): void {
  const ev = new MouseEvent('drop', { bubbles: true, cancelable: true, ctrlKey })
  Object.defineProperty(ev, 'dataTransfer', {
    value: {
      types: [INTERNAL_DND_TYPE],
      getData: (type: string) => (type === INTERNAL_DND_TYPE ? JSON.stringify(payload) : ''),
      files: [] as unknown as FileList,
      dropEffect: 'none'
    }
  })
  fireEvent(target, ev)
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
  localStorage.clear()
  snapshot = makeSnapshot()
  api = makeApi(snapshot)
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('sortEntries', () => {
  const items: FileEntry[] = [
    entry({ name: 'beta.txt', path: '/x/beta.txt' }),
    entry({ name: 'zeta', path: '/x/zeta', type: 'directory' }),
    entry({ name: 'alpha.txt', path: '/x/alpha.txt' }),
    entry({ name: 'mid', path: '/x/mid', type: 'directory' })
  ]

  it('groups folders first when sorting ascending by name', () => {
    expect(sortEntries(items, 'name', 'asc').map((e) => e.name)).toEqual([
      'mid',
      'zeta',
      'alpha.txt',
      'beta.txt'
    ])
  })

  it('keeps folders first even when sorting descending', () => {
    expect(sortEntries(items, 'name', 'desc').map((e) => e.name)).toEqual([
      'zeta',
      'mid',
      'beta.txt',
      'alpha.txt'
    ])
  })
})

describe('dual pane layout', () => {
  it('renders a Windows pane and a WSL pane', async () => {
    await renderExplorer()
    expect(pane('windows')).toBeDefined()
    expect(pane('linux')).toBeDefined()
    expect(within(pane('linux')).getByText('Ubuntu-24.04')).toBeDefined()
    expect(
      within(pane('windows')).getByRole('grid', { name: 'Windows files' })
    ).toBeDefined()
    expect(
      within(pane('linux')).getByRole('grid', { name: 'Ubuntu-24.04 files' })
    ).toBeDefined()
  })

  it('shows the no-distro message in the right pane when nothing is selected', async () => {
    snapshot.selectedDistro = null
    render(
      <AppStoreProvider>
        <ExplorerTab />
      </AppStoreProvider>
    )
    await flush()
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(WIN_HOME, { showHidden: false })
    )
    expect(within(pane('linux')).getAllByText('No distribution selected').length).toBeGreaterThan(0)
    // the Windows pane keeps working without a distro
    expect(within(pane('windows')).getByText('notes.txt')).toBeDefined()
    expect(api.explorer.list).not.toHaveBeenCalled()
  })

  it('sorts folders first in both panes', async () => {
    await renderExplorer()
    expect(rowNames('windows')).toEqual(['Documents', 'app.log', 'notes.txt'])
    expect(rowNames('linux')).toEqual(['logs', 'a.txt', 'config.json'])
  })
})

describe('windows pane navigation', () => {
  it('starts at the user profile, lists drives at This PC and opens a drive', async () => {
    await renderExplorer()
    const win = pane('windows')
    expect(api.windows.list).toHaveBeenCalledWith(WIN_HOME, { showHidden: false })

    fireEvent.click(within(win).getByRole('button', { name: 'Root' }))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(WINDOWS_ROOT, { showHidden: false })
    )
    await within(win).findByText('C:')
    expect(within(win).getByText('D:')).toBeDefined()

    fireEvent.doubleClick(within(win).getByText('C:'))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith('C:\\', { showHidden: false })
    )
    await within(win).findByText('Users')
  })
})

describe('folder tree strip', () => {
  it('is collapsed by default and reveals the This PC root when toggled', async () => {
    const winTree: Record<string, FileEntry[]> = {
      [WINDOWS_ROOT]: [winEntry({ name: 'C:', path: 'C:\\', type: 'directory', sizeBytes: null })],
      'C:\\': [winEntry({ name: 'Users', path: 'C:\\Users', type: 'directory', sizeBytes: null })],
      'C:\\Users': [winEntry({ name: 'dev', path: WIN_HOME, type: 'directory', sizeBytes: null })]
    }
    api.windows.tree.mockImplementation(async (path: string) => winTree[path] ?? [])
    await renderExplorer()
    const win = pane('windows')
    expect(within(win).queryByRole('tree')).toBeNull()

    fireEvent.click(within(win).getByRole('button', { name: 'Show folder tree' }))
    const tree = await within(win).findByRole('tree')
    expect(within(tree).getByText('This PC')).toBeDefined()
    await waitFor(() => expect(api.windows.tree).toHaveBeenCalledWith(WINDOWS_ROOT))
    expect(localStorage.getItem('wslpad.explorer.tree.windows')).toBe('1')
  })
})

describe('cross-pane transfer', () => {
  it('copies from the Windows pane into the WSL pane directory', async () => {
    await renderExplorer()
    const win = pane('windows')
    fireEvent.click(within(win).getByText('notes.txt'))
    fireEvent.click(within(win).getByRole('button', { name: 'Copy to the other pane' }))

    await waitFor(() =>
      expect(api.explorer.importFromWindows).toHaveBeenCalledWith(
        [`${WIN_HOME}\\notes.txt`],
        LINUX_HOME
      )
    )
    expect(api.explorer.exportToWindows).not.toHaveBeenCalled()
  })

  it('copies from the WSL pane into the Windows pane directory', async () => {
    await renderExplorer()
    const linux = pane('linux')
    fireEvent.click(within(linux).getByText('config.json'))
    fireEvent.click(within(linux).getByRole('button', { name: 'Copy to the other pane' }))

    await waitFor(() =>
      expect(api.explorer.exportToWindows).toHaveBeenCalledWith(
        [`${LINUX_HOME}/config.json`],
        WIN_HOME
      )
    )
    expect(api.explorer.importFromWindows).not.toHaveBeenCalled()
  })
})

describe('drag and drop', () => {
  it('moves inside one pane and copies when Ctrl is held', async () => {
    await renderExplorer()
    const grid = within(pane('linux')).getByRole('grid', { name: 'Ubuntu-24.04 files' })

    fireDrop(grid, { fs: 'linux', paths: [`${LINUX_HOME}/a.txt`] })
    await waitFor(() =>
      expect(api.explorer.copy).toHaveBeenCalledWith([`${LINUX_HOME}/a.txt`], LINUX_HOME, true)
    )

    fireDrop(grid, { fs: 'linux', paths: [`${LINUX_HOME}/a.txt`] }, true)
    await waitFor(() =>
      expect(api.explorer.copy).toHaveBeenCalledWith([`${LINUX_HOME}/a.txt`], LINUX_HOME, false)
    )
  })

  it('treats a drop from the other pane as a transfer and never deletes the source', async () => {
    await renderExplorer()
    const grid = within(pane('linux')).getByRole('grid', { name: 'Ubuntu-24.04 files' })

    fireDrop(grid, { fs: 'windows', paths: [`${WIN_HOME}\\notes.txt`] })
    await waitFor(() =>
      expect(api.explorer.importFromWindows).toHaveBeenCalledWith(
        [`${WIN_HOME}\\notes.txt`],
        LINUX_HOME
      )
    )
    expect(api.explorer.copy).not.toHaveBeenCalled()
    expect(api.explorer.trash).not.toHaveBeenCalled()
    expect(api.explorer.remove).not.toHaveBeenCalled()
    expect(api.windows.trash).not.toHaveBeenCalled()
    expect(api.windows.remove).not.toHaveBeenCalled()
  })

  it('exports to Windows when a WSL drag is dropped on the Windows pane', async () => {
    await renderExplorer()
    const grid = within(pane('windows')).getByRole('grid', { name: 'Windows files' })

    fireDrop(grid, { fs: 'linux', paths: [`${LINUX_HOME}/a.txt`] })
    await waitFor(() =>
      expect(api.explorer.exportToWindows).toHaveBeenCalledWith(
        [`${LINUX_HOME}/a.txt`],
        WIN_HOME
      )
    )
    expect(api.windows.copy).not.toHaveBeenCalled()
  })
})

describe('rename', () => {
  it('commits through the Windows adapter in the Windows pane', async () => {
    await renderExplorer()
    const cell = within(pane('windows')).getByText('notes.txt')
    fireEvent.click(cell)
    fireEvent.keyDown(cell, { key: 'F2' })

    const editor = await screen.findByDisplayValue('notes.txt')
    fireEvent.change(editor, { target: { value: 'renamed.txt' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    await waitFor(() =>
      expect(api.windows.rename).toHaveBeenCalledWith(`${WIN_HOME}\\notes.txt`, 'renamed.txt')
    )
    expect(api.explorer.rename).not.toHaveBeenCalled()
  })

  it('commits through the WSL adapter in the WSL pane', async () => {
    await renderExplorer()
    const cell = within(pane('linux')).getByText('config.json')
    fireEvent.click(cell)
    fireEvent.keyDown(cell, { key: 'F2' })

    const editor = await screen.findByDisplayValue('config.json')
    fireEvent.change(editor, { target: { value: 'renamed.json' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    await waitFor(() =>
      expect(api.explorer.rename).toHaveBeenCalledWith(
        `${LINUX_HOME}/config.json`,
        'renamed.json'
      )
    )
    expect(api.windows.rename).not.toHaveBeenCalled()
  })
})

describe('splitter', () => {
  it('clamps to the allowed bounds and persists the percentage', async () => {
    await renderExplorer()
    const splitter = screen.getByRole('separator', { name: 'Resize panes' })
    expect(splitter.getAttribute('aria-valuenow')).toBe(String(PANE_SPLIT_DEFAULT))

    for (let i = 0; i < 40; i++) fireEvent.keyDown(splitter, { key: 'ArrowLeft' })
    expect(splitter.getAttribute('aria-valuenow')).toBe(String(PANE_SPLIT_BOUNDS.min))
    expect(localStorage.getItem(SPLIT_STORAGE_KEY)).toBe(String(PANE_SPLIT_BOUNDS.min))

    for (let i = 0; i < 80; i++) fireEvent.keyDown(splitter, { key: 'ArrowRight' })
    expect(splitter.getAttribute('aria-valuenow')).toBe(String(PANE_SPLIT_BOUNDS.max))
    expect(localStorage.getItem(SPLIT_STORAGE_KEY)).toBe(String(PANE_SPLIT_BOUNDS.max))

    fireEvent.doubleClick(splitter)
    expect(localStorage.getItem(SPLIT_STORAGE_KEY)).toBe(String(PANE_SPLIT_DEFAULT))
  })

  it('restores a persisted percentage on mount', async () => {
    localStorage.setItem(SPLIT_STORAGE_KEY, '35')
    await renderExplorer()
    expect(
      screen.getByRole('separator', { name: 'Resize panes' }).getAttribute('aria-valuenow')
    ).toBe('35')
  })
})

describe('console path sync', () => {
  it('follows WSL navigation only, never the Windows pane', async () => {
    await renderExplorer()
    const probe = screen.getByTestId('console-path')
    await waitFor(() => expect(probe.textContent).toBe(LINUX_HOME))

    fireEvent.doubleClick(within(pane('windows')).getByText('Documents'))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(`${WIN_HOME}\\Documents`, {
        showHidden: false
      })
    )
    expect(probe.textContent).toBe(LINUX_HOME)

    fireEvent.doubleClick(within(pane('linux')).getByText('logs'))
    await waitFor(() => expect(probe.textContent).toBe(`${LINUX_HOME}/logs`))
  })
})

describe('context menus', () => {
  it('offers no chmod command on Windows entries but keeps it on WSL entries', async () => {
    await renderExplorer()

    fireEvent.contextMenu(within(pane('windows')).getByText('notes.txt'))
    const winMenu = await screen.findByRole('menu')
    expect(within(winMenu).queryByRole('menuitem', { name: 'Prepare chmod command' })).toBeNull()
    expect(within(winMenu).queryByRole('menuitem', { name: 'Prepare chown command' })).toBeNull()
    expect(within(winMenu).getByRole('menuitem', { name: 'Show in Windows Explorer' })).toBeDefined()
    fireEvent.keyDown(winMenu, { key: 'Escape' })

    fireEvent.contextMenu(within(pane('linux')).getByText('config.json'))
    const linuxMenu = await screen.findByRole('menu')
    expect(
      within(linuxMenu).getByRole('menuitem', { name: 'Prepare chmod command' })
    ).toBeDefined()
    expect(within(linuxMenu).getByRole('menuitem', { name: 'Copy Linux path' })).toBeDefined()
  })
})
