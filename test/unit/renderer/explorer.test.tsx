import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { DirSizeResult, FileEntry, WslPadSnapshot } from '@shared/types'
import { PANE_SPLIT_BOUNDS, PANE_SPLIT_DEFAULT, WINDOWS_ROOT } from '@shared/constants'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import ExplorerTab from '@renderer/explorer/ExplorerTab'
import { entrySide, normalizeWindowsPath, resolveWindowsPath } from '@renderer/explorer/fsAdapter'
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
      disk: null,
      wslSettings: null,
      memoryDetail: null,
      paths: [],
      configuration: [],
      tools: [],
      docker: null,
      zoneIdentifier: null,
      diskConsumers: null,
      driveMounts: null,
      defender: null,
      inotify: null,
      terminalProfiles: null,
      hermes: null,
      environment: [],
      processes: [],
      services: [],
      ports: [],
      windowsPorts: [],
      portProxy: null,
      firewall: null,
      clock: null,
      dns: null,
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
    liveness: null,
    warnings: []
  }
}

const linuxListing: FileEntry[] = [
  entry({ name: 'config.json', path: `${LINUX_HOME}/config.json` }),
  entry({ name: 'logs', path: `${LINUX_HOME}/logs`, type: 'directory', sizeBytes: null }),
  entry({ name: 'a.txt', path: `${LINUX_HOME}/a.txt` }),
  // A link that quietly leads onto the Windows drive: the case a badge on the
  // link's own path would hide (issue #26).
  entry({
    name: 'winlink',
    path: `${LINUX_HOME}/winlink`,
    type: 'symlink',
    symlinkTarget: '/mnt/c/Users/dev',
    targetType: 'directory'
  })
]

const MNT_DIR = '/mnt/c/Users/dev'
const mntListing: FileEntry[] = [
  entry({ name: 'report.docx', path: `${MNT_DIR}/report.docx` }),
  entry({ name: 'repos', path: `${MNT_DIR}/repos`, type: 'directory', sizeBytes: null })
]

const rootListing: FileEntry[] = [
  entry({ name: 'etc', path: '/etc', type: 'directory', sizeBytes: null }),
  entry({ name: 'mnt', path: '/mnt', type: 'directory', sizeBytes: null })
]

const linuxListings: Record<string, FileEntry[]> = {
  [LINUX_HOME]: linuxListing,
  [MNT_DIR]: mntListing,
  '/': rootListing
}

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
      list: vi.fn(async (path: string) => linuxListings[path] ?? []),
      tree: vi.fn(async (_path: string) => [] as FileEntry[]),
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
      dirSizes: vi.fn(async (path: string): Promise<DirSizeResult> => ({
        path,
        entries: [
          { name: 'logs', path: `${path}/logs`, isDirectory: true, sizeBytes: 900, partial: false },
          {
            name: 'config.json',
            path: `${path}/config.json`,
            isDirectory: false,
            sizeBytes: 120,
            partial: false
          },
          { name: 'a.txt', path: `${path}/a.txt`, isDirectory: false, sizeBytes: null, partial: false }
        ],
        totalBytes: 1020,
        skipped: 0,
        cancelled: false,
        error: null
      })),
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

/** Row names without the symlink target and the boundary badge's screen-reader text. */
function rowNames(kind: 'windows' | 'linux'): string[] {
  return Array.from(pane(kind).querySelectorAll('.fl-body .fl-row .fl-name')).map((el) => {
    const clone = el.cloneNode(true) as HTMLElement
    for (const extra of clone.querySelectorAll('.fl-linktarget, .side-badge')) extra.remove()
    return clone.textContent ?? ''
  })
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

describe('fsAdapter path and symlink helpers', () => {
  it('strips Win32 and NT device prefixes in normalizeWindowsPath and uppercases drive letters', () => {
    expect(normalizeWindowsPath('\\\\?\\c:\\Users\\Shared\\')).toBe('C:\\Users\\Shared')
    expect(normalizeWindowsPath('\\??\\d:\\')).toBe('D:\\')
    expect(normalizeWindowsPath('\\\\?\\UNC\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\')).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev'
    )
    expect(normalizeWindowsPath('\\??\\UNC\\wsl$\\Debian\\etc')).toBe('\\\\wsl$\\Debian\\etc')
  })

  it('resolves device-prefixed and root-relative targets in resolveWindowsPath', () => {
    expect(resolveWindowsPath('C:\\Users\\dev', '\\\\?\\c:\\Users\\Shared')).toBe('C:\\Users\\Shared')
    expect(resolveWindowsPath('C:\\Users\\dev', '\\??\\C:\\Users\\Shared\\..')).toBe('C:\\Users')
    expect(
      resolveWindowsPath('C:\\Users\\dev', '\\\\?\\UNC\\wsl.localhost\\Ubuntu-24.04\\home\\dev')
    ).toBe('\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev')
    expect(resolveWindowsPath('C:\\Users\\dev', '\\??\\UNC\\wsl$\\Debian\\etc')).toBe(
      '\\\\wsl$\\Debian\\etc'
    )
    expect(resolveWindowsPath('c:\\Users\\dev', '\\Users\\Shared')).toBe('C:\\Users\\Shared')
    expect(resolveWindowsPath('C:\\Users\\dev', '/Users/Shared/../Public')).toBe('C:\\Users\\Public')
    expect(
      resolveWindowsPath('\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev', '\\etc\\wsl.conf')
    ).toBe('\\\\wsl.localhost\\Ubuntu-24.04\\etc\\wsl.conf')
  })

  it('judges entrySide by the resolved symlink destination on both Linux and Windows', () => {
    expect(
      entrySide(
        entry({
          name: 'rel-win',
          path: '/home/dev/rel-win',
          type: 'symlink',
          symlinkTarget: '../../mnt/c/Users/dev'
        })
      )
    ).toBe('windows-mount')
    expect(
      entrySide(
        entry({
          name: 'custom-win',
          path: '/home/dev/custom-win',
          type: 'symlink',
          symlinkTarget: '../../drives/d/work'
        }),
        '/drives/'
      )
    ).toBe('windows-mount')
    expect(
      entrySide(
        entry({
          name: 'back-to-ext4',
          path: '/home/dev/back-to-ext4',
          type: 'symlink',
          symlinkTarget: '/mnt/c/../../home/dev/docs'
        })
      )
    ).toBe('ext4')
    expect(
      entrySide(
        winEntry({
          name: 'wsl-junc',
          path: 'C:\\Users\\dev\\wsl-junc',
          type: 'symlink',
          symlinkTarget: '\\\\?\\UNC\\wsl.localhost\\Ubuntu-24.04\\home\\dev'
        })
      )
    ).toBe('unc')
    expect(
      entrySide(
        winEntry({
          name: 'c-from-unc',
          path: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\c-from-unc',
          type: 'symlink',
          symlinkTarget: 'C:\\Users\\Shared'
        })
      )
    ).toBe('unknown')
  })
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
  it('refreshes listings after partial file operations, but not empty failures', async () => {
    const progressListeners: Array<(progress: import('@shared/types').FileOpProgress) => void> = []
    api.onOpProgress.mockImplementation(((callback: (progress: import('@shared/types').FileOpProgress) => void) => {
      progressListeners.push(callback)
      return () => undefined
    }) as unknown as () => () => undefined)
    await renderExplorer()

    const linuxListCalls = api.explorer.list.mock.calls.length
    const windowsListCalls = api.windows.list.mock.calls.length
    const progress = {
      opId: 'op-partial',
      kind: 'copy' as const,
      totalItems: 2,
      totalBytes: null,
      doneBytes: null,
      currentItem: null,
      error: null
    }

    act(() =>
      progressListeners.forEach((listener) =>
        listener({ ...progress, status: 'running', doneItems: 1 })
      )
    )
    await flush()
    expect(api.explorer.list.mock.calls.length).toBe(linuxListCalls)
    expect(api.windows.list.mock.calls.length).toBe(windowsListCalls)

    act(() => progressListeners.forEach((listener) => listener({ ...progress, status: 'error', doneItems: 1 })))
    await waitFor(() => {
      expect(api.explorer.list.mock.calls.length).toBe(linuxListCalls + 1)
      expect(api.windows.list.mock.calls.length).toBe(windowsListCalls + 1)
    })

    const refreshedLinuxCalls = api.explorer.list.mock.calls.length
    const refreshedWindowsCalls = api.windows.list.mock.calls.length
    act(() => progressListeners.forEach((listener) => listener({ ...progress, status: 'cancelled', doneItems: 2 })))
    await waitFor(() => {
      expect(api.explorer.list.mock.calls.length).toBe(refreshedLinuxCalls + 1)
      expect(api.windows.list.mock.calls.length).toBe(refreshedWindowsCalls + 1)
    })

    const finalLinuxCalls = api.explorer.list.mock.calls.length
    const finalWindowsCalls = api.windows.list.mock.calls.length
    act(() => progressListeners.forEach((listener) => listener({ ...progress, status: 'error', doneItems: 0 })))
    await flush()
    expect(api.explorer.list.mock.calls.length).toBe(finalLinuxCalls)
    expect(api.windows.list.mock.calls.length).toBe(finalWindowsCalls)

    act(() => progressListeners.forEach((listener) => listener({ ...progress, status: 'done', doneItems: 2 })))
    await waitFor(() => {
      expect(api.explorer.list.mock.calls.length).toBe(finalLinuxCalls + 1)
      expect(api.windows.list.mock.calls.length).toBe(finalWindowsCalls + 1)
    })
  })

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
    expect(rowNames('linux')).toEqual(['logs', 'a.txt', 'config.json', 'winlink'])
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

  it('resolves relative Windows directory symlink targets against the link parent', async () => {
    windowsListings[WIN_HOME].push(
      winEntry({
        name: 'shared-link',
        path: `${WIN_HOME}\\shared-link`,
        type: 'symlink',
        symlinkTarget: '..\\Shared',
        targetType: 'directory'
      })
    )
    await renderExplorer()

    fireEvent.doubleClick(within(pane('windows')).getByText('shared-link'))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith('C:\\Users\\Shared', { showHidden: false })
    )
    expect(api.windows.readText).not.toHaveBeenCalled()
  })

  it('normalizes device-prefixed and drive-root-relative symlink folders so opening and Up work', async () => {
    const customWin: Record<string, FileEntry[]> = {
      ...windowsListings,
      [WIN_HOME]: [
        winEntry({ name: 'notes.txt', path: `${WIN_HOME}\\notes.txt` }),
        winEntry({
          name: 'device-junction',
          path: `${WIN_HOME}\\device-junction`,
          type: 'symlink',
          symlinkTarget: '\\\\?\\c:\\Users\\Shared',
          targetType: 'directory',
          sizeBytes: null
        }),
        winEntry({
          name: 'root-rel-junction',
          path: `${WIN_HOME}\\root-rel-junction`,
          type: 'symlink',
          symlinkTarget: '\\Users\\Public',
          targetType: 'directory',
          sizeBytes: null
        }),
        winEntry({
          name: 'wsl-device-link',
          path: `${WIN_HOME}\\wsl-device-link`,
          type: 'symlink',
          symlinkTarget: '\\??\\UNC\\wsl.localhost\\Ubuntu-24.04\\home\\dev',
          targetType: 'directory',
          sizeBytes: null
        })
      ],
      'C:\\Users': [
        winEntry({ name: 'dev', path: WIN_HOME, type: 'directory', sizeBytes: null }),
        winEntry({ name: 'Shared', path: 'C:\\Users\\Shared', type: 'directory', sizeBytes: null }),
        winEntry({ name: 'Public', path: 'C:\\Users\\Public', type: 'directory', sizeBytes: null })
      ],
      'C:\\Users\\Shared': [winEntry({ name: 'shared.txt', path: 'C:\\Users\\Shared\\shared.txt' })],
      'C:\\Users\\Public': [winEntry({ name: 'public.txt', path: 'C:\\Users\\Public\\public.txt' })],
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev': [
        winEntry({ name: 'bashrc', path: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\bashrc' })
      ],
      '\\\\wsl.localhost\\Ubuntu-24.04\\home': [
        winEntry({
          name: 'dev',
          path: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev',
          type: 'directory',
          sizeBytes: null
        })
      ]
    }
    api.windows.list.mockImplementation(async (path: string) => customWin[path] ?? [])

    await renderExplorer()
    const win = pane('windows')

    fireEvent.doubleClick(within(win).getByText('device-junction'))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith('C:\\Users\\Shared', { showHidden: false })
    )
    await within(win).findByText('shared.txt')

    fireEvent.click(within(win).getByRole('button', { name: 'Up' }))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith('C:\\Users', { showHidden: false })
    )

    fireEvent.click(within(win).getByRole('button', { name: 'Home' }))
    await within(win).findByText('root-rel-junction')

    fireEvent.doubleClick(within(win).getByText('root-rel-junction'))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith('C:\\Users\\Public', { showHidden: false })
    )
    await within(win).findByText('public.txt')

    fireEvent.click(within(win).getByRole('button', { name: 'Home' }))
    await within(win).findByText('wsl-device-link')

    fireEvent.doubleClick(within(win).getByText('wsl-device-link'))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev',
        { showHidden: false }
      )
    )
    await within(win).findByText('bashrc')

    fireEvent.click(within(win).getByRole('button', { name: 'Up' }))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith('\\\\wsl.localhost\\Ubuntu-24.04\\home', {
        showHidden: false
      })
    )
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

  it('renders and expands directory symlinks while navigating to their link path', async () => {
    const linkedDir = `${LINUX_HOME}/linked-dir`
    api.explorer.tree.mockImplementation(async (path: string) => {
      if (path === '/') return [entry({
        name: 'linked-dir',
        path: linkedDir,
        type: 'symlink',
        symlinkTarget: '/srv/data',
        targetType: 'directory',
        sizeBytes: null
      })]
      if (path === linkedDir) return [entry({ name: 'child', path: `${linkedDir}/child`, type: 'directory', sizeBytes: null })]
      return []
    })
    api.windows.tree.mockImplementation(async (path: string) =>
      path === WINDOWS_ROOT ? [winEntry({ name: 'C:', path: 'C:\\', type: 'directory', sizeBytes: null })] : []
    )
    await renderExplorer()
    const linux = pane('linux')
    fireEvent.click(within(linux).getByRole('button', { name: 'Show folder tree' }))
    const tree = await within(linux).findByRole('tree')
    const linkNode = await within(tree).findByText('linked-dir')
    fireEvent.click(linkNode)
    await waitFor(() => expect(api.explorer.list).toHaveBeenCalledWith(linkedDir, { showHidden: false }))
    fireEvent.click(within(tree).getByRole('button', { name: 'Expand' }))
    await within(tree).findByText('child')
    expect(api.explorer.tree).toHaveBeenCalledWith(linkedDir)
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
  it('opens a directory symlink from the context menu as a directory', async () => {
    linuxListings[LINUX_HOME].push(
      entry({
        name: 'linked-logs',
        path: `${LINUX_HOME}/linked-logs`,
        type: 'symlink',
        symlinkTarget: '../shared/logs',
        targetType: 'directory'
      })
    )
    await renderExplorer()

    fireEvent.contextMenu(within(pane('linux')).getByText('linked-logs'))
    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getAllByRole('menuitem', { name: /open/i })[0])

    await waitFor(() =>
      expect(api.explorer.list).toHaveBeenCalledWith('/home/shared/logs', {
        showHidden: false
      })
    )
    expect(api.explorer.readText).not.toHaveBeenCalled()
  })

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

/** Badges of a pane, in row order, by the side they report. */
function rowBadges(kind: 'windows' | 'linux'): string[] {
  return Array.from(pane(kind).querySelectorAll('.fl-body .fl-row .side-badge')).map(
    (el) => el.getAttribute('data-side') ?? ''
  )
}

describe('filesystem boundary badge', () => {
  it('marks a link that leads onto the Windows drive and leaves ext4 rows alone', async () => {
    await renderExplorer()
    // Only the symlink crosses; the three ext4 rows stay unmarked.
    expect(rowBadges('linux')).toEqual(['windows-mount'])
    const badge = pane('linux').querySelector('.fl-body .side-badge') as HTMLElement
    expect(badge.getAttribute('title')).toContain('/mnt')
    // Never colour alone: the side is spelled out for assistive tech too.
    expect(badge.textContent).toContain('Windows drive')
  })

  it('marks the directory once instead of every row when the whole folder is across', async () => {
    await renderExplorer()
    fireEvent.doubleClick(within(pane('linux')).getByText('winlink'))
    await waitFor(() =>
      expect(api.explorer.list).toHaveBeenCalledWith(MNT_DIR, { showHidden: false })
    )
    await within(pane('linux')).findByText('report.docx')

    expect(rowBadges('linux')).toEqual([])
    const header = pane('linux').querySelector('.pane-header .side-badge') as HTMLElement
    expect(header.getAttribute('data-side')).toBe('windows-mount')
  })

  it('marks /mnt as the crossing when it is listed from the Linux root', async () => {
    await renderExplorer()
    fireEvent.click(within(pane('linux')).getByRole('button', { name: 'Root' }))
    await waitFor(() => expect(api.explorer.list).toHaveBeenCalledWith('/', { showHidden: false }))
    await within(pane('linux')).findByText('mnt')

    // /mnt itself is not a drive mount — only /mnt/<letter> is — so nothing is
    // badged here, and the pane chip stays away from a plain ext4 directory.
    expect(rowBadges('linux')).toEqual([])
    expect(pane('linux').querySelector('.pane-header .side-badge')).toBeNull()
  })

  it('never badges a plain Windows drive path', async () => {
    await renderExplorer()
    expect(rowBadges('windows')).toEqual([])
    expect(pane('windows').querySelector('.pane-header .side-badge')).toBeNull()
  })

  it('resolves relative and .. symlink targets on Linux before judging the boundary', async () => {
    api.explorer.list.mockImplementation(async (path: string) => {
      if (path === LINUX_HOME) {
        return [
          entry({ name: 'config.json', path: `${LINUX_HOME}/config.json` }),
          entry({
            name: 'back-to-ext4',
            path: `${LINUX_HOME}/back-to-ext4`,
            type: 'symlink',
            symlinkTarget: '/mnt/c/../../home/dev/docs',
            targetType: 'directory'
          }),
          entry({
            name: 'rel-winlink',
            path: `${LINUX_HOME}/rel-winlink`,
            type: 'symlink',
            symlinkTarget: '../../mnt/c/Users/dev',
            targetType: 'directory'
          })
        ]
      }
      return linuxListings[path] ?? []
    })

    await renderExplorer()
    expect(rowBadges('linux')).toEqual(['windows-mount'])
    const relRow = within(pane('linux')).getByText('rel-winlink').closest('.fl-row') as HTMLElement
    const ext4Row = within(pane('linux')).getByText('back-to-ext4').closest('.fl-row') as HTMLElement
    expect(relRow.querySelector('.side-badge')?.getAttribute('data-side')).toBe('windows-mount')
    expect(ext4Row.querySelector('.side-badge')).toBeNull()
  })

  it('honors a custom [automount] root for relative Linux symlinks', async () => {
    snapshot.dashboard!.wslSettings = {
      wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
      wslconfigExists: false,
      wslConfPath: '/etc/wsl.conf',
      wslConfExists: true,
      restartPending: false,
      vmStartedAt: null,
      networkingModeDeclared: null,
      networkingModeEffective: 'nat',
      platform: null,
      interop: null,
      defaultUser: null,
      settings: [
        {
          key: 'root',
          section: 'automount',
          scope: 'linux',
          declaredValue: '/drives/',
          effectiveValue: '/drives/',
          origin: 'wsl-conf',
          provenance: 'user',
          verdict: 'applied',
          note: null
        }
      ]
    }
    api.explorer.list.mockImplementation(async (path: string) => {
      if (path === LINUX_HOME) {
        return [
          entry({ name: 'config.json', path: `${LINUX_HOME}/config.json` }),
          entry({
            name: 'custom-drive-link',
            path: `${LINUX_HOME}/custom-drive-link`,
            type: 'symlink',
            symlinkTarget: '../../drives/d/work',
            targetType: 'directory'
          }),
          entry({
            name: 'unmounted-mnt-link',
            path: `${LINUX_HOME}/unmounted-mnt-link`,
            type: 'symlink',
            symlinkTarget: '../../mnt/c/Users/dev',
            targetType: 'directory'
          })
        ]
      }
      return linuxListings[path] ?? []
    })

    await renderExplorer()
    expect(rowBadges('linux')).toEqual(['windows-mount'])
    const customRow = within(pane('linux'))
      .getByText('custom-drive-link')
      .closest('.fl-row') as HTMLElement
    const mntRow = within(pane('linux'))
      .getByText('unmounted-mnt-link')
      .closest('.fl-row') as HTMLElement
    expect(customRow.querySelector('.side-badge')?.getAttribute('data-side')).toBe('windows-mount')
    expect(mntRow.querySelector('.side-badge')).toBeNull()
  })

  it('badges device-prefixed WSL shares on Windows and omits false unc badges on C: links inside a WSL share', async () => {
    const wslShareDir = '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev'
    api.windows.list.mockImplementation(async (path: string) => {
      if (path === WIN_HOME) {
        return [
          winEntry({ name: 'notes.txt', path: `${WIN_HOME}\\notes.txt` }),
          winEntry({
            name: 'device-c-link',
            path: `${WIN_HOME}\\device-c-link`,
            type: 'symlink',
            symlinkTarget: '\\\\?\\C:\\Users\\Shared',
            targetType: 'directory'
          }),
          winEntry({
            name: 'nt-wsl-link',
            path: `${WIN_HOME}\\nt-wsl-link`,
            type: 'symlink',
            symlinkTarget: '\\??\\UNC\\wsl$\\Debian\\etc',
            targetType: 'directory'
          }),
          winEntry({
            name: 'win32-wsl-link',
            path: `${WIN_HOME}\\win32-wsl-link`,
            type: 'symlink',
            symlinkTarget: `\\\\?\\UNC\\wsl.localhost\\Ubuntu-24.04\\home\\dev`,
            targetType: 'directory'
          })
        ]
      }
      if (path === wslShareDir) {
        return [
          winEntry({ name: 'bashrc', path: `${wslShareDir}\\bashrc` }),
          winEntry({
            name: 'plain-c-link',
            path: `${wslShareDir}\\plain-c-link`,
            type: 'symlink',
            symlinkTarget: 'C:\\Users\\Shared',
            targetType: 'directory'
          }),
          winEntry({
            name: 'prefixed-c-link',
            path: `${wslShareDir}\\prefixed-c-link`,
            type: 'symlink',
            symlinkTarget: '\\\\?\\C:\\Users\\Shared',
            targetType: 'directory'
          })
        ]
      }
      return windowsListings[path] ?? []
    })

    await renderExplorer()
    const win = pane('windows')
    expect(rowBadges('windows')).toEqual(['unc', 'unc'])
    const driveRow = within(win).getByText('device-c-link').closest('.fl-row') as HTMLElement
    expect(driveRow.querySelector('.side-badge')).toBeNull()

    fireEvent.doubleClick(within(win).getByText('win32-wsl-link'))
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(wslShareDir, { showHidden: false })
    )
    await within(win).findByText('bashrc')

    const headerBadge = win.querySelector('.pane-header .side-badge') as HTMLElement
    expect(headerBadge.getAttribute('data-side')).toBe('unc')
    expect(rowBadges('windows')).toEqual([])
  })
})

describe('directory sizes', () => {
  const measureButton = (kind: 'windows' | 'linux'): HTMLElement | null =>
    within(pane(kind)).queryByRole('button', { name: 'Measure directory sizes' })

  it('is offered on both Explorer panes', async () => {
    await renderExplorer()
    expect(measureButton('linux')).not.toBeNull()
    expect(measureButton('windows')).not.toBeNull()
  })

  it('hides Windows size measurement at the virtual This PC root', async () => {
    await renderExplorer()
    fireEvent.click(within(pane('windows')).getByRole('button', { name: 'Root' }))
    await waitFor(() => expect(api.windows.list).toHaveBeenCalledWith(WINDOWS_ROOT, { showHidden: false }))
    expect(measureButton('windows')).toBeNull()
  })

  it('measures on demand and lists the children largest first', async () => {
    await renderExplorer()
    expect(api.explorer.dirSizes).not.toHaveBeenCalled()

    fireEvent.click(measureButton('linux') as HTMLElement)
    const panel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    await waitFor(() =>
      expect(api.explorer.dirSizes).toHaveBeenCalledWith(LINUX_HOME, expect.any(String))
    )

    await waitFor(() => expect(panel.getAttribute('aria-busy')).toBe('false'))
    const rows = Array.from(panel.querySelectorAll('.dir-sizes-row .dir-sizes-name')).map(
      (el) => el.textContent ?? ''
    )
    expect(rows).toEqual(['logs/', 'config.json', 'a.txt'])
    // An unmeasured child says so instead of showing a zero.
    expect(panel.textContent).toContain('Not measured')
  })

  it('serves a second look from the cache and re-measures after a refresh', async () => {
    await renderExplorer()
    const button = measureButton('linux') as HTMLElement

    fireEvent.click(button)
    await waitFor(() => expect(api.explorer.dirSizes).toHaveBeenCalledTimes(1))
    await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })

    fireEvent.click(within(pane('linux')).getByRole('button', { name: 'Close' }))
    fireEvent.click(button)
    await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    expect(api.explorer.dirSizes).toHaveBeenCalledTimes(1)

    // A refresh changes the listing, so the measured numbers stop being an answer.
    fireEvent.click(within(pane('linux')).getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()
    )
    fireEvent.click(button)
    await waitFor(() => expect(api.explorer.dirSizes).toHaveBeenCalledTimes(2))
  })

  it('shows progress while it runs and cancels through the existing op channel', async () => {
    let release!: (value: DirSizeResult) => void
    api.explorer.dirSizes.mockReturnValueOnce(
      new Promise<DirSizeResult>((resolve) => {
        release = resolve
      })
    )
    await renderExplorer()

    fireEvent.click(measureButton('linux') as HTMLElement)
    const panel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    expect(panel.getAttribute('aria-busy')).toBe('true')
    expect(within(panel).getByRole('status').textContent).toContain('Measuring')

    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(api.explorer.cancelOp).toHaveBeenCalledWith(expect.stringContaining('dirsize-'))
    )
    expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()

    // A late answer for a cancelled run must not reopen the panel.
    release({ path: LINUX_HOME, entries: [], totalBytes: 0, skipped: 0, cancelled: false, error: null })
    await flush()
    expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()
  })

  it('reports a failure instead of an empty folder', async () => {
    api.explorer.dirSizes.mockRejectedValueOnce(new Error('EACCES: /home/dev'))
    await renderExplorer()

    fireEvent.click(measureButton('linux') as HTMLElement)
    const panel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    await waitFor(() => expect(panel.textContent).toContain('Could not measure this folder'))
    expect(panel.querySelectorAll('.dir-sizes-row')).toHaveLength(0)
  })

  it('closes when the pane navigates away', async () => {
    await renderExplorer()
    fireEvent.click(measureButton('linux') as HTMLElement)
    await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })

    fireEvent.doubleClick(within(pane('linux')).getByText('logs'))
    await waitFor(() =>
      expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()
    )
  })
})
