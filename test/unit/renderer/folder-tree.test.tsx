import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { FileEntry, WslPadSnapshot } from '@shared/types'
import { WINDOWS_ROOT } from '@shared/constants'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import ExplorerTab from '@renderer/explorer/ExplorerTab'
import { FolderTree } from '@renderer/explorer/FolderTree'
import { createLinuxAdapter, createWindowsAdapter } from '@renderer/explorer/fsAdapter'

const WIN_HOME = 'C:\\Users\\dev'
const LINUX_HOME = '/home/dev'

function dirEntry(name: string, path: string): FileEntry {
  return {
    name,
    path,
    type: 'directory',
    sizeBytes: null,
    mtime: '2026-07-30T10:00:00.000Z',
    owner: 'dev',
    group: 'dev',
    permissions: 'rwxr-xr-x',
    permissionsOctal: '755',
    isHidden: name.startsWith('.'),
    symlinkTarget: null,
    targetType: null
  }
}

function makeSnapshot(selectedDistro = 'Ubuntu-24.04'): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-30T12:00:00.000Z',
    selectedDistro,
    distros: [
      { name: 'Ubuntu-24.04', state: 'Running', wslVersion: 2, isDefault: true },
      { name: 'Debian', state: 'Running', wslVersion: 2, isDefault: false }
    ],
    dashboard: {
      distro: {
        name: selectedDistro,
        state: 'Running',
        wslVersion: 2,
        isDefault: selectedDistro === 'Ubuntu-24.04',
        osName: `${selectedDistro} LTS`,
        uncPath: `\\\\wsl.localhost\\${selectedDistro}`
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
    explorer: { distro: selectedDistro, currentPath: LINUX_HOME, showHidden: false },
    terminal: { distro: selectedDistro, cwd: LINUX_HOME, status: 'ready' },
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

function makeApi(initialSnapshot: WslPadSnapshot) {
  const snapshotListeners = new Set<(s: WslPadSnapshot) => void>()

  const api = {
    listDistros: vi.fn(async () => initialSnapshot.distros),
    selectDistro: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => initialSnapshot),
    refresh: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined),
    revealEnv: vi.fn(async () => null),
    copyLlmMarkdown: vi.fn(async () => ''),
    exportLlmJson: vi.fn(async () => null),
    explorer: {
      list: vi.fn(async (_path: string) => [] as FileEntry[]),
      tree: vi.fn(async (_path: string) => [] as FileEntry[]),
      stat: vi.fn(async () => ({
        ...dirEntry('dev', LINUX_HOME),
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
      dirSizes: vi.fn(async (path: string) => ({
        path,
        entries: [],
        totalBytes: 0,
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
      list: vi.fn(async (_path: string) => [] as FileEntry[]),
      tree: vi.fn(async (_path: string) => [] as FileEntry[]),
      stat: vi.fn(async () => ({
        ...dirEntry('dev', WIN_HOME),
        owner: null,
        group: null,
        permissions: null,
        permissionsOctal: null,
        inode: null,
        atime: null,
        windowsPath: WIN_HOME
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
      status: vi.fn(async () => initialSnapshot.mcp),
      regenerateToken: vi.fn(async () => initialSnapshot.mcp),
      registerClient: vi.fn(async () => ({ ok: true, configPath: null, error: null })),
      test: vi.fn(async () => ({ ok: true, error: null })),
      getConfigJson: vi.fn(async () => '{}'),
      onStatus: vi.fn(() => () => undefined)
    },
    updates: {
      check: vi.fn(async () => ({ state: 'idle' as const, version: null, percent: null, error: null })),
      install: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({
        state: 'idle' as const,
        version: null,
        percent: null,
        error: null
      })),
      onStatus: vi.fn(() => () => undefined)
    },
    app: {
      version: vi.fn(async () => '1.2.0'),
      quit: vi.fn(async () => undefined)
    },
    onSnapshot: vi.fn((cb: (s: WslPadSnapshot) => void) => {
      snapshotListeners.add(cb)
      return () => {
        snapshotListeners.delete(cb)
      }
    }),
    onOpProgress: vi.fn(() => () => undefined),
    onNavigateSettings: vi.fn(() => () => undefined)
  }

  return {
    api,
    emitSnapshot(next: WslPadSnapshot): void {
      for (const cb of snapshotListeners) cb(next)
    }
  }
}

function treeitemByName(tree: HTMLElement, label: string): HTMLElement {
  const items = within(tree).getAllByRole('treeitem')
  const match = items.find((item) => item.querySelector('.tree-name')?.textContent === label)
  if (!match) throw new Error(`Treeitem "${label}" not found`)
  return match
}

function visibleLabels(tree: HTMLElement): string[] {
  return Array.from(tree.querySelectorAll('.tree-node .tree-name')).map(
    (el) => el.textContent ?? ''
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

let apiHandle: ReturnType<typeof makeApi>
let snapshot: WslPadSnapshot
let originalScrollIntoView: PropertyDescriptor | undefined

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
  snapshot = makeSnapshot('Ubuntu-24.04')
  apiHandle = makeApi(snapshot)
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = apiHandle.api as unknown as WslPadApi
  originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  } else {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
  }
})

describe('FolderTree sorting and empty leaf rendering', () => {
  it('sorts subfolders case-insensitively and removes expand affordance from empty folders', async () => {
    const treeMap: Record<string, FileEntry[]> = {
      '/': [
        dirEntry('usr', '/usr'),
        dirEntry('alpha', '/alpha'),
        dirEntry('dir10', '/dir10'),
        dirEntry('Beta', '/Beta'),
        dirEntry('Alpha', '/Alpha'),
        dirEntry('dir2', '/dir2'),
        dirEntry('empty', '/empty')
      ],
      '/empty': []
    }
    apiHandle.api.explorer.tree.mockImplementation(async (p: string) => treeMap[p] ?? [])

    render(
      <AppStoreProvider>
        <FolderTree
          adapter={createLinuxAdapter(LINUX_HOME)}
          currentPath="/"
          refreshToken={0}
          onNavigate={vi.fn()}
          onDropPaths={vi.fn()}
          onCrossDrop={vi.fn()}
        />
      </AppStoreProvider>
    )
    await flush()

    const tree = await screen.findByRole('tree')
    await within(tree).findByText('usr')

    expect(visibleLabels(tree)).toEqual([
      '/',
      'Alpha',
      'alpha',
      'Beta',
      'dir2',
      'dir10',
      'empty',
      'usr'
    ])

    // Unloaded folder keeps aria-expanded="false" and its expand button.
    const betaItem = treeitemByName(tree, 'Beta')
    expect(betaItem.getAttribute('aria-expanded')).toBe('false')
    expect(within(betaItem).getByRole('button', { name: 'Expand' })).toBeDefined()

    // Expanding an empty folder loads [], then drops aria-expanded and renders a non-interactive spacer.
    const emptyItem = treeitemByName(tree, 'empty')
    fireEvent.click(within(emptyItem).getByRole('button', { name: 'Expand' }))
    await waitFor(() => expect(apiHandle.api.explorer.tree).toHaveBeenCalledWith('/empty'))

    await waitFor(() => {
      const updated = treeitemByName(tree, 'empty')
      expect(updated.getAttribute('aria-expanded')).toBeNull()
      expect(within(updated).queryByRole('button')).toBeNull()
      const spacer = updated.querySelector('span.tree-twisty') as HTMLElement | null
      expect(spacer).not.toBeNull()
      expect(spacer?.getAttribute('aria-hidden')).toBe('true')
      expect(spacer?.style.cursor).toBe('default')
    })
  })
})

describe('FolderTree keyboard navigation and double-click toggle', () => {
  it('supports roving tabIndex and Arrow/Home/End/Enter/Space keys in the Linux tree', async () => {
    const treeMap: Record<string, FileEntry[]> = {
      '/': [dirEntry('etc', '/etc'), dirEntry('home', '/home'), dirEntry('mnt', '/mnt')],
      '/etc': [],
      '/home': [dirEntry('dev', '/home/dev')],
      '/home/dev': [dirEntry('projects', '/home/dev/projects')],
      '/home/dev/projects': []
    }
    apiHandle.api.explorer.tree.mockImplementation(async (p: string) => treeMap[p] ?? [])
    const onNavigate = vi.fn()

    render(
      <AppStoreProvider>
        <FolderTree
          adapter={createLinuxAdapter(LINUX_HOME)}
          currentPath="/etc"
          refreshToken={0}
          onNavigate={onNavigate}
          onDropPaths={vi.fn()}
          onCrossDrop={vi.fn()}
        />
      </AppStoreProvider>
    )
    await flush()

    const tree = await screen.findByRole('tree')
    await within(tree).findByText('mnt')

    // Roving tabIndex: only one visible treeitem has tabIndex=0 (starts on currentPath '/etc').
    const initialTabZero = within(tree)
      .getAllByRole('treeitem')
      .filter((el) => el.tabIndex === 0)
    expect(initialTabZero).toHaveLength(1)
    expect(initialTabZero[0]).toBe(treeitemByName(tree, 'etc'))

    // Focus 'etc', then Home -> '/', End -> 'mnt', ArrowUp -> 'home'.
    treeitemByName(tree, 'etc').focus()
    fireEvent.keyDown(treeitemByName(tree, 'etc'), { key: 'Home' })
    expect(document.activeElement).toBe(treeitemByName(tree, '/'))
    expect(treeitemByName(tree, '/').tabIndex).toBe(0)
    expect(treeitemByName(tree, 'etc').tabIndex).toBe(-1)

    fireEvent.keyDown(treeitemByName(tree, '/'), { key: 'End' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'mnt'))

    fireEvent.keyDown(treeitemByName(tree, 'mnt'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'home'))

    // ArrowRight on collapsed 'home' expands it while keeping focus on 'home'.
    fireEvent.keyDown(treeitemByName(tree, 'home'), { key: 'ArrowRight' })
    await within(tree).findByText('dev')
    expect(treeitemByName(tree, 'home').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(treeitemByName(tree, 'home'))

    // ArrowRight on already-expanded 'home' moves focus to its first child 'dev'.
    fireEvent.keyDown(treeitemByName(tree, 'home'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'dev'))

    // Enter and Space both trigger onNavigate for the focused folder.
    fireEvent.keyDown(treeitemByName(tree, 'dev'), { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('/home/dev')

    fireEvent.keyDown(treeitemByName(tree, 'dev'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'mnt'))
    fireEvent.keyDown(treeitemByName(tree, 'mnt'), { key: ' ' })
    expect(onNavigate).toHaveBeenCalledWith('/mnt')

    // Move back to 'dev', expand into empty 'projects', then navigate back up with ArrowLeft.
    fireEvent.keyDown(treeitemByName(tree, 'mnt'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'dev'))

    fireEvent.keyDown(treeitemByName(tree, 'dev'), { key: 'ArrowRight' })
    await within(tree).findByText('projects')
    fireEvent.keyDown(treeitemByName(tree, 'dev'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'projects'))

    // Expanding 'projects' discovers it is empty and omits aria-expanded.
    fireEvent.keyDown(treeitemByName(tree, 'projects'), { key: 'ArrowRight' })
    await waitFor(() =>
      expect(treeitemByName(tree, 'projects').getAttribute('aria-expanded')).toBeNull()
    )
    // Pressing ArrowRight on an empty leaf stays put.
    fireEvent.keyDown(treeitemByName(tree, 'projects'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'projects'))

    // Pressing ArrowLeft on a collapsed/empty node moves focus to its parent ('dev').
    fireEvent.keyDown(treeitemByName(tree, 'projects'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'dev'))

    // Pressing ArrowLeft on expanded 'dev' collapses it while keeping focus on 'dev'.
    fireEvent.keyDown(treeitemByName(tree, 'dev'), { key: 'ArrowLeft' })
    expect(treeitemByName(tree, 'dev').getAttribute('aria-expanded')).toBe('false')
    expect(within(tree).queryByText('projects')).toBeNull()
    expect(document.activeElement).toBe(treeitemByName(tree, 'dev'))

    // Pressing ArrowLeft again on collapsed 'dev' moves focus to parent 'home'.
    fireEvent.keyDown(treeitemByName(tree, 'dev'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'home'))
  })

  it('supports keyboard navigation in the Windows tree', async () => {
    const winTree: Record<string, FileEntry[]> = {
      [WINDOWS_ROOT]: [dirEntry('C:', 'C:\\'), dirEntry('D:', 'D:\\')],
      'C:\\': [dirEntry('Users', 'C:\\Users')],
      'C:\\Users': [dirEntry('dev', WIN_HOME)],
      [WIN_HOME]: []
    }
    apiHandle.api.windows.tree.mockImplementation(async (p: string) => winTree[p] ?? [])
    const onNavigate = vi.fn()

    render(
      <AppStoreProvider>
        <FolderTree
          adapter={createWindowsAdapter()}
          currentPath={WINDOWS_ROOT}
          refreshToken={0}
          onNavigate={onNavigate}
          onDropPaths={vi.fn()}
          onCrossDrop={vi.fn()}
        />
      </AppStoreProvider>
    )
    await flush()

    const tree = await screen.findByRole('tree')
    await within(tree).findByText('C:')

    const rootNode = treeitemByName(tree, 'This PC')
    rootNode.focus()
    fireEvent.keyDown(rootNode, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'C:'))

    fireEvent.keyDown(treeitemByName(tree, 'C:'), { key: 'ArrowRight' })
    await within(tree).findByText('Users')
    fireEvent.keyDown(treeitemByName(tree, 'C:'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'Users'))

    fireEvent.keyDown(treeitemByName(tree, 'Users'), { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('C:\\Users')

    fireEvent.keyDown(treeitemByName(tree, 'Users'), { key: 'End' })
    expect(document.activeElement).toBe(treeitemByName(tree, 'D:'))
    fireEvent.keyDown(treeitemByName(tree, 'D:'), { key: ' ' })
    expect(onNavigate).toHaveBeenCalledWith('D:\\')
  })

  it('toggles folder expansion on row double-click without aiming at the twisty button', async () => {
    const treeMap: Record<string, FileEntry[]> = {
      '/': [dirEntry('etc', '/etc'), dirEntry('home', '/home')],
      '/etc': [],
      '/home': [dirEntry('dev', '/home/dev')]
    }
    apiHandle.api.explorer.tree.mockImplementation(async (p: string) => treeMap[p] ?? [])

    render(
      <AppStoreProvider>
        <FolderTree
          adapter={createLinuxAdapter(LINUX_HOME)}
          currentPath="/"
          refreshToken={0}
          onNavigate={vi.fn()}
          onDropPaths={vi.fn()}
          onCrossDrop={vi.fn()}
        />
      </AppStoreProvider>
    )
    await flush()

    const tree = await screen.findByRole('tree')
    const homeLabel = await within(tree).findByText('home')

    // First double-click on the folder row expands it.
    fireEvent.doubleClick(homeLabel)
    await within(tree).findByText('dev')
    expect(treeitemByName(tree, 'home').getAttribute('aria-expanded')).toBe('true')

    // Second double-click collapses it.
    fireEvent.doubleClick(homeLabel)
    expect(treeitemByName(tree, 'home').getAttribute('aria-expanded')).toBe('false')
    expect(within(tree).queryByText('dev')).toBeNull()

    // Empty leaf folder does not re-gain aria-expanded on double-click.
    fireEvent.doubleClick(treeitemByName(tree, 'etc'))
    await waitFor(() =>
      expect(treeitemByName(tree, 'etc').getAttribute('aria-expanded')).toBeNull()
    )
    fireEvent.doubleClick(treeitemByName(tree, 'etc'))
    expect(treeitemByName(tree, 'etc').getAttribute('aria-expanded')).toBeNull()
  })
})

describe('FolderTree auto-scroll and distro switch reset', () => {
  it('expands async ancestors and scrolls the active folder row into view on deep navigation', async () => {
    let resolveDev!: (entries: FileEntry[]) => void
    const devPromise = new Promise<FileEntry[]>((resolve) => {
      resolveDev = resolve
    })

    const treeMap: Record<string, FileEntry[]> = {
      '/': [dirEntry('etc', '/etc'), dirEntry('home', '/home')],
      '/etc': [dirEntry('nginx', '/etc/nginx')],
      '/home': [dirEntry('dev', '/home/dev')],
      '/home/dev/projects': [dirEntry('wslpad-demo', '/home/dev/projects/wslpad-demo')]
    }
    apiHandle.api.explorer.tree.mockImplementation(async (p: string) => {
      if (p === '/home/dev') return devPromise
      return treeMap[p] ?? []
    })

    const scrollSpy = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy
    })

    const adapter = createLinuxAdapter(LINUX_HOME)
    const { rerender } = render(
      <AppStoreProvider>
        <FolderTree
          adapter={adapter}
          currentPath="/"
          refreshToken={0}
          onNavigate={vi.fn()}
          onDropPaths={vi.fn()}
          onCrossDrop={vi.fn()}
        />
      </AppStoreProvider>
    )
    await flush()

    const tree = await screen.findByRole('tree')
    await within(tree).findByText('home')
    scrollSpy.mockClear()

    // Navigate deep while /home/dev loads asynchronously.
    rerender(
      <AppStoreProvider>
        <FolderTree
          adapter={adapter}
          currentPath="/home/dev/projects/wslpad-demo"
          refreshToken={0}
          onNavigate={vi.fn()}
          onDropPaths={vi.fn()}
          onCrossDrop={vi.fn()}
        />
      </AppStoreProvider>
    )
    await flush()

    // Deep target is not rendered until /home/dev resolves.
    expect(within(tree).queryByText('wslpad-demo')).toBeNull()

    await act(async () => {
      resolveDev([dirEntry('projects', '/home/dev/projects')])
      await Promise.resolve()
    })

    const targetName = await within(tree).findByText('wslpad-demo')
    const targetNode = targetName.closest('.tree-node') as HTMLElement
    expect(targetNode.classList.contains('active')).toBe(true)

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' }))
    expect(scrollSpy.mock.instances).toContain(targetNode)

    // Expanding an unrelated node later must not yank scroll back to the active row.
    scrollSpy.mockClear()
    fireEvent.click(within(treeitemByName(tree, 'etc')).getByRole('button', { name: 'Expand' }))
    await within(tree).findByText('nginx')
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('clears cached tree state and ignores stale responses when selectedDistro changes', async () => {
    let activeDistro = 'Ubuntu-24.04'
    let resolveSlowUbuntu!: (entries: FileEntry[]) => void
    const slowUbuntuPromise = new Promise<FileEntry[]>((resolve) => {
      resolveSlowUbuntu = resolve
    })

    const treesByDistro: Record<string, Record<string, FileEntry[]>> = {
      'Ubuntu-24.04': {
        '/': [dirEntry('home', '/home')],
        '/home': [dirEntry('dev', '/home/dev')],
        '/home/dev': [
          dirEntry('ubuntu-only', '/home/dev/ubuntu-only'),
          dirEntry('slow-dir', '/home/dev/slow-dir')
        ]
      },
      Debian: {
        '/': [dirEntry('srv', '/srv')],
        '/srv': [dirEntry('debian-only', '/srv/debian-only')]
      }
    }

    apiHandle.api.explorer.tree.mockImplementation(async (p: string) => {
      if (activeDistro === 'Ubuntu-24.04' && p === '/home/dev/slow-dir') {
        return slowUbuntuPromise
      }
      return treesByDistro[activeDistro]?.[p] ?? []
    })

    render(
      <AppStoreProvider>
        <FolderTree
          adapter={createLinuxAdapter(LINUX_HOME)}
          currentPath={LINUX_HOME}
          refreshToken={0}
          onNavigate={vi.fn()}
          onDropPaths={vi.fn()}
          onCrossDrop={vi.fn()}
        />
      </AppStoreProvider>
    )
    await flush()

    const tree = await screen.findByRole('tree')
    await within(tree).findByText('dev')

    // Expand /home/dev and start an in-flight load for slow-dir in Ubuntu-24.04.
    fireEvent.click(within(treeitemByName(tree, 'dev')).getByRole('button', { name: 'Expand' }))
    await within(tree).findByText('ubuntu-only')
    fireEvent.click(within(treeitemByName(tree, 'slow-dir')).getByRole('button', { name: 'Expand' }))

    // Switch distro via snapshot update to Debian.
    activeDistro = 'Debian'
    await act(async () => {
      apiHandle.emitSnapshot(makeSnapshot('Debian'))
      await Promise.resolve()
    })

    // Previous Ubuntu folders are cleared immediately and Debian root is loaded.
    await waitFor(() => expect(within(tree).queryByText('ubuntu-only')).toBeNull())
    expect(within(tree).queryByText('dev')).toBeNull()
    await within(tree).findByText('srv')

    // Resolving the stale pre-switch Ubuntu promise must not inject old entries into Debian.
    await act(async () => {
      resolveSlowUbuntu([dirEntry('stale-ubuntu-child', '/home/dev/slow-dir/stale-ubuntu-child')])
      await Promise.resolve()
    })
    expect(within(tree).queryByText('stale-ubuntu-child')).toBeNull()
    expect(within(tree).queryByText('slow-dir')).toBeNull()
  })

  it('resets the WSL pane folder tree inside ExplorerTab when switching distros', async () => {
    let activeDistro = 'Ubuntu-24.04'
    const listsByDistro: Record<string, Record<string, FileEntry[]>> = {
      'Ubuntu-24.04': {
        [LINUX_HOME]: [dirEntry('ubuntu-proj', `${LINUX_HOME}/ubuntu-proj`)]
      },
      Debian: {
        [LINUX_HOME]: [dirEntry('debian-proj', `${LINUX_HOME}/debian-proj`)]
      }
    }
    const treesByDistro: Record<string, Record<string, FileEntry[]>> = {
      'Ubuntu-24.04': {
        '/': [dirEntry('home', '/home'), dirEntry('ubuntu-root-dir', '/ubuntu-root-dir')],
        '/home': [dirEntry('dev', LINUX_HOME)],
        [LINUX_HOME]: [dirEntry('ubuntu-proj', `${LINUX_HOME}/ubuntu-proj`)]
      },
      Debian: {
        '/': [dirEntry('home', '/home'), dirEntry('debian-root-dir', '/debian-root-dir')],
        '/home': [dirEntry('dev', LINUX_HOME)],
        [LINUX_HOME]: [dirEntry('debian-proj', `${LINUX_HOME}/debian-proj`)]
      }
    }

    apiHandle.api.explorer.list.mockImplementation(
      async (p: string) => listsByDistro[activeDistro]?.[p] ?? []
    )
    apiHandle.api.explorer.tree.mockImplementation(
      async (p: string) => treesByDistro[activeDistro]?.[p] ?? []
    )

    render(
      <AppStoreProvider>
        <ExplorerTab />
      </AppStoreProvider>
    )
    await flush()

    const linuxPane = screen.getByTestId('pane-linux')
    fireEvent.click(within(linuxPane).getByRole('button', { name: 'Show folder tree' }))
    const tree = await within(linuxPane).findByRole('tree')
    await within(tree).findByText('ubuntu-root-dir')

    // Expand /home/dev inside Ubuntu so an extra subtree is open before switching.
    fireEvent.click(within(treeitemByName(tree, 'dev')).getByRole('button', { name: 'Expand' }))
    await within(tree).findByText('ubuntu-proj')

    activeDistro = 'Debian'
    await act(async () => {
      apiHandle.emitSnapshot(makeSnapshot('Debian'))
      await Promise.resolve()
    })

    await within(tree).findByText('debian-root-dir')
    expect(within(tree).queryByText('ubuntu-root-dir')).toBeNull()
    expect(within(tree).queryByText('ubuntu-proj')).toBeNull()
  })
})
