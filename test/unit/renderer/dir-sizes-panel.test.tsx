import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { DirSizeEntry, DirSizeResult, FileEntry, WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider } from '@renderer/store'
import { DirSizesPanel } from '@renderer/explorer/DirSizesPanel'
import ExplorerTab from '@renderer/explorer/ExplorerTab'

const WIN_HOME = 'C:\\Users\\dev'
const LINUX_HOME = '/home/dev'

function makeEntry(partial: Partial<FileEntry> & { name: string; path: string }): FileEntry {
  return {
    type: 'file',
    sizeBytes: 100,
    mtime: '2026-07-30T10:00:00.000Z',
    owner: 'dev',
    group: 'dev',
    permissions: 'rw-r--r--',
    permissionsOctal: '644',
    isHidden: partial.name.startsWith('.'),
    symlinkTarget: null,
    targetType: null,
    ...partial
  }
}

function makeWinEntry(partial: Partial<FileEntry> & { name: string; path: string }): FileEntry {
  return makeEntry({ owner: null, group: null, permissions: null, permissionsOctal: null, ...partial })
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

interface TreeState {
  linux: Record<string, FileEntry[]>
  windows: Record<string, FileEntry[]>
  linuxSizes: Record<string, DirSizeResult>
  windowsSizes: Record<string, DirSizeResult>
  linuxDenied: Set<string>
  windowsDenied: Set<string>
}

function makeDefaultTree(): TreeState {
  const manyFiles = Array.from({ length: 59 }, (_, i) => {
    const name = `f${String(i).padStart(2, '0')}.txt`
    return makeEntry({ name, path: `${LINUX_HOME}/${name}`, sizeBytes: 100 })
  })
  const bigFile = makeEntry({
    name: 'z-huge.bin',
    path: `${LINUX_HOME}/z-huge.bin`,
    sizeBytes: 5_000_000
  })
  const hiddenFile = makeEntry({
    name: '.cache-dump',
    path: `${LINUX_HOME}/.cache-dump`,
    sizeBytes: 4_000_000,
    isHidden: true
  })
  const subDir = makeEntry({
    name: 'projects',
    path: `${LINUX_HOME}/projects`,
    type: 'directory',
    sizeBytes: null
  })
  const nestedDir = makeEntry({
    name: 'app',
    path: `${LINUX_HOME}/projects/app`,
    type: 'directory',
    sizeBytes: null
  })
  const lockedDir = makeEntry({
    name: 'locked',
    path: `${LINUX_HOME}/locked`,
    type: 'directory',
    sizeBytes: null
  })

  const winSubDir = makeWinEntry({
    name: 'projects',
    path: `${WIN_HOME}\\projects`,
    type: 'directory',
    sizeBytes: null
  })
  const winNestedDir = makeWinEntry({
    name: 'demo',
    path: `${WIN_HOME}\\projects\\demo`,
    type: 'directory',
    sizeBytes: null
  })
  const winLockedDir = makeWinEntry({
    name: 'locked',
    path: `${WIN_HOME}\\locked`,
    type: 'directory',
    sizeBytes: null
  })
  const winVisible = makeWinEntry({
    name: 'notes.txt',
    path: `${WIN_HOME}\\notes.txt`,
    sizeBytes: 500
  })
  const winHidden = makeWinEntry({
    name: '.hidden-config',
    path: `${WIN_HOME}\\.hidden-config`,
    sizeBytes: 2_000_000,
    isHidden: true
  })

  return {
    linux: {
      [LINUX_HOME]: [subDir, lockedDir, ...manyFiles, bigFile, hiddenFile],
      [`${LINUX_HOME}/projects`]: [
        nestedDir,
        makeEntry({ name: 'readme.md', path: `${LINUX_HOME}/projects/readme.md`, sizeBytes: 200 })
      ],
      [`${LINUX_HOME}/projects/app`]: [
        makeEntry({
          name: 'bundle.js',
          path: `${LINUX_HOME}/projects/app/bundle.js`,
          sizeBytes: 1_200_000
        })
      ]
    },
    windows: {
      [WIN_HOME]: [winSubDir, winLockedDir, winVisible, winHidden],
      [`${WIN_HOME}\\projects`]: [
        winNestedDir,
        makeWinEntry({
          name: 'notes.txt',
          path: `${WIN_HOME}\\projects\\notes.txt`,
          sizeBytes: 150
        })
      ],
      [`${WIN_HOME}\\projects\\demo`]: [
        makeWinEntry({
          name: 'README.md',
          path: `${WIN_HOME}\\projects\\demo\\README.md`,
          sizeBytes: 300
        })
      ]
    },
    linuxSizes: {
      [LINUX_HOME]: {
        path: LINUX_HOME,
        entries: [
          {
            name: 'projects',
            path: `${LINUX_HOME}/projects`,
            isDirectory: true,
            sizeBytes: 8_000_000,
            partial: false
          },
          {
            name: 'z-huge.bin',
            path: `${LINUX_HOME}/z-huge.bin`,
            isDirectory: false,
            sizeBytes: 5_000_000,
            partial: false
          },
          {
            name: '.cache-dump',
            path: `${LINUX_HOME}/.cache-dump`,
            isDirectory: false,
            sizeBytes: 4_000_000,
            partial: false
          },
          {
            name: 'locked',
            path: `${LINUX_HOME}/locked`,
            isDirectory: true,
            sizeBytes: null,
            partial: false
          }
        ],
        totalBytes: 17_000_000,
        skipped: 0,
        cancelled: false,
        error: null
      },
      [`${LINUX_HOME}/projects`]: {
        path: `${LINUX_HOME}/projects`,
        entries: [
          {
            name: 'app',
            path: `${LINUX_HOME}/projects/app`,
            isDirectory: true,
            sizeBytes: 1_200_000,
            partial: false
          },
          {
            name: 'readme.md',
            path: `${LINUX_HOME}/projects/readme.md`,
            isDirectory: false,
            sizeBytes: 200,
            partial: false
          }
        ],
        totalBytes: 1_200_200,
        skipped: 0,
        cancelled: false,
        error: null
      },
      [`${LINUX_HOME}/projects/app`]: {
        path: `${LINUX_HOME}/projects/app`,
        entries: [
          {
            name: 'bundle.js',
            path: `${LINUX_HOME}/projects/app/bundle.js`,
            isDirectory: false,
            sizeBytes: 1_200_000,
            partial: false
          }
        ],
        totalBytes: 1_200_000,
        skipped: 0,
        cancelled: false,
        error: null
      }
    },
    windowsSizes: {
      [WIN_HOME]: {
        path: WIN_HOME,
        entries: [
          {
            name: 'projects',
            path: `${WIN_HOME}\\projects`,
            isDirectory: true,
            sizeBytes: 4_000_000,
            partial: false
          },
          {
            name: '.hidden-config',
            path: `${WIN_HOME}\\.hidden-config`,
            isDirectory: false,
            sizeBytes: 2_000_000,
            partial: false
          },
          {
            name: 'locked',
            path: `${WIN_HOME}\\locked`,
            isDirectory: true,
            sizeBytes: null,
            partial: false
          },
          {
            name: 'notes.txt',
            path: `${WIN_HOME}\\notes.txt`,
            isDirectory: false,
            sizeBytes: 500,
            partial: false
          }
        ],
        totalBytes: 6_000_500,
        skipped: 0,
        cancelled: false,
        error: null
      },
      [`${WIN_HOME}\\projects`]: {
        path: `${WIN_HOME}\\projects`,
        entries: [
          {
            name: 'demo',
            path: `${WIN_HOME}\\projects\\demo`,
            isDirectory: true,
            sizeBytes: 300,
            partial: false
          },
          {
            name: 'notes.txt',
            path: `${WIN_HOME}\\projects\\notes.txt`,
            isDirectory: false,
            sizeBytes: 150,
            partial: false
          }
        ],
        totalBytes: 450,
        skipped: 0,
        cancelled: false,
        error: null
      },
      [`${WIN_HOME}\\projects\\demo`]: {
        path: `${WIN_HOME}\\projects\\demo`,
        entries: [
          {
            name: 'README.md',
            path: `${WIN_HOME}\\projects\\demo\\README.md`,
            isDirectory: false,
            sizeBytes: 300,
            partial: false
          }
        ],
        totalBytes: 300,
        skipped: 0,
        cancelled: false,
        error: null
      }
    },
    linuxDenied: new Set([`${LINUX_HOME}/locked`]),
    windowsDenied: new Set([`${WIN_HOME}\\locked`])
  }
}

function makeApi(snapshot: WslPadSnapshot, tree: TreeState) {
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
      list: vi.fn(async (path: string, opts?: { showHidden?: boolean }) => {
        if (tree.linuxDenied.has(path)) throw new Error(`EACCES: ${path}`)
        const list = tree.linux[path] ?? []
        return opts?.showHidden ? list : list.filter((e) => !e.isHidden)
      }),
      tree: vi.fn(async () => [] as FileEntry[]),
      stat: vi.fn(async () => ({
        ...makeEntry({ name: 'z-huge.bin', path: `${LINUX_HOME}/z-huge.bin` }),
        inode: 1,
        atime: null,
        windowsPath: null
      })),
      mkdir: vi.fn(async () => undefined),
      createFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      copy: vi.fn(async () => 'op-1'),
      trash: vi.fn(async () => undefined),
      listTrash: vi.fn(async () => []),
      restoreTrash: vi.fn(async () => undefined),
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
      dirSizes: vi.fn(async (path: string): Promise<DirSizeResult> => {
        return (
          tree.linuxSizes[path] ?? {
            path,
            entries: [],
            totalBytes: 0,
            skipped: 0,
            cancelled: false,
            error: null
          }
        )
      }),
      search: vi.fn(async (path: string) => {
        const list = tree.linux[path] ?? []
        return list.filter((e) => e.name === 'f00.txt')
      }),
      pickImportPaths: vi.fn(async () => [] as string[]),
      pickExportDir: vi.fn(async () => null),
      startDrag: vi.fn(async () => undefined)
    },
    windows: {
      places: vi.fn(async () => []),
      home: vi.fn(async () => WIN_HOME),
      list: vi.fn(async (path: string, opts?: { showHidden?: boolean }) => {
        if (tree.windowsDenied.has(path)) throw new Error(`EACCES: ${path}`)
        const list = tree.windows[path] ?? []
        return opts?.showHidden ? list : list.filter((e) => !e.isHidden)
      }),
      tree: vi.fn(async () => [] as FileEntry[]),
      stat: vi.fn(async () => ({
        ...makeWinEntry({ name: 'notes.txt', path: `${WIN_HOME}\\notes.txt` }),
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
      startDrag: vi.fn(async () => undefined),
      dirSizes: vi.fn(async (path: string): Promise<DirSizeResult> => {
        return (
          tree.windowsSizes[path] ?? {
            path,
            entries: [],
            totalBytes: 0,
            skipped: 0,
            cancelled: false,
            error: null
          }
        )
      }),
      cancelDirSizes: vi.fn(async () => undefined)
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
      version: vi.fn(async () => '1.2.0'),
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
let tree: TreeState

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function pane(kind: 'windows' | 'linux'): HTMLElement {
  return screen.getByTestId(`pane-${kind}`)
}

function measureButton(kind: 'windows' | 'linux'): HTMLElement {
  return within(pane(kind)).getByRole('button', { name: 'Measure directory sizes' })
}

async function renderExplorer(): Promise<void> {
  render(
    <AppStoreProvider>
      <ExplorerTab />
    </AppStoreProvider>
  )
  await flush()
  await waitFor(() => expect(api.windows.list).toHaveBeenCalledWith(WIN_HOME, { showHidden: false }))
  await waitFor(() =>
    expect(api.explorer.list).toHaveBeenCalledWith(LINUX_HOME, { showHidden: false })
  )
  await within(pane('windows')).findByText('notes.txt')
  await within(pane('linux')).findByText('f00.txt')
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
  tree = makeDefaultTree()
  api = makeApi(snapshot, tree)
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DirSizesPanel component', () => {
  const sampleEntries: DirSizeEntry[] = [
    { name: 'logs', path: '/home/dev/logs', isDirectory: true, sizeBytes: 900, partial: false },
    {
      name: 'big.bin',
      path: '/home/dev/big.bin',
      isDirectory: false,
      sizeBytes: 300,
      partial: false
    }
  ]

  it('renders interactive row buttons with click, keyboard activation, selection highlight, and no delete buttons', async () => {
    const user = userEvent.setup()
    const onActivateEntry = vi.fn()
    render(
      <DirSizesPanel
        state={{
          status: 'ready',
          path: '/home/dev',
          result: {
            path: '/home/dev',
            entries: sampleEntries,
            totalBytes: 1200,
            skipped: 0,
            cancelled: false,
            error: null
          },
          error: null
        }}
        onCancel={vi.fn()}
        onClose={vi.fn()}
        onActivateEntry={onActivateEntry}
        selectedPaths={new Set(['/home/dev/big.bin'])}
      />
    )

    const panel = screen.getByRole('region', { name: 'Directory sizes' })
    const logsBtn = within(panel).getByRole('button', { name: /logs\// })
    const fileBtn = within(panel).getByRole('button', { name: /big\.bin/ })

    expect(logsBtn.getAttribute('aria-current')).toBeNull()
    expect(logsBtn.closest('li')?.classList.contains('is-selected')).toBe(false)
    expect(fileBtn.getAttribute('aria-current')).toBe('true')
    expect(fileBtn.closest('li')?.classList.contains('is-selected')).toBe(true)

    await user.click(logsBtn)
    expect(onActivateEntry).toHaveBeenNthCalledWith(1, sampleEntries[0])

    fileBtn.focus()
    await user.keyboard('{Enter}')
    expect(onActivateEntry).toHaveBeenNthCalledWith(2, sampleEntries[1])

    logsBtn.focus()
    await user.keyboard(' ')
    expect(onActivateEntry).toHaveBeenNthCalledWith(3, sampleEntries[0])

    // Safety invariant: DirSizesPanel never renders any delete or trash button.
    const buttons = within(panel).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/delete|trash|remove/i)])
    )
    expect(buttons).toHaveLength(3) // Close + 2 row buttons
  })

  it('keeps static list rows when onActivateEntry is omitted', () => {
    render(
      <DirSizesPanel
        state={{
          status: 'ready',
          path: '/home/dev',
          result: {
            path: '/home/dev',
            entries: sampleEntries,
            totalBytes: 1200,
            skipped: 0,
            cancelled: false,
            error: null
          },
          error: null
        }}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const panel = screen.getByRole('region', { name: 'Directory sizes' })
    expect(panel.querySelectorAll('.dir-sizes-row-btn')).toHaveLength(0)
    expect(panel.querySelectorAll('.dir-sizes-row')).toHaveLength(2)
  })
})

describe('DirSizesPanel interaction in Explorer panes', () => {
  it('drills down into subfolders on click and keyboard activation in both Linux and Windows panes', async () => {
    const user = userEvent.setup()
    await renderExplorer()

    // Linux pane: click projects/ -> navigates and immediately measures /home/dev/projects
    await user.click(measureButton('linux'))
    const linuxPanel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    const linuxProjectsBtn = await within(linuxPanel).findByRole('button', { name: /projects\// })
    await user.click(linuxProjectsBtn)

    await waitFor(() =>
      expect(api.explorer.list).toHaveBeenCalledWith(`${LINUX_HOME}/projects`, { showHidden: false })
    )
    await waitFor(() =>
      expect(api.explorer.dirSizes).toHaveBeenCalledWith(
        `${LINUX_HOME}/projects`,
        expect.any(String)
      )
    )
    const linuxProjectsPanel = await within(pane('linux')).findByRole('region', {
      name: 'Directory sizes'
    })
    const linuxAppBtn = await within(linuxProjectsPanel).findByRole('button', { name: /app\// })
    linuxAppBtn.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(api.explorer.dirSizes).toHaveBeenCalledWith(
        `${LINUX_HOME}/projects/app`,
        expect.any(String)
      )
    )
    const linuxAppPanel = await within(pane('linux')).findByRole('region', {
      name: 'Directory sizes'
    })
    await within(linuxAppPanel).findByRole('button', { name: /bundle\.js/ })

    // Windows pane: focus projects/ and press Space -> navigates and measures C:\Users\dev\projects
    await user.click(measureButton('windows'))
    const winPanel = await within(pane('windows')).findByRole('region', {
      name: 'Directory sizes'
    })
    const winProjectsBtn = await within(winPanel).findByRole('button', { name: /projects\// })
    winProjectsBtn.focus()
    await user.keyboard(' ')

    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(`${WIN_HOME}\\projects`, { showHidden: false })
    )
    await waitFor(() =>
      expect(api.windows.dirSizes).toHaveBeenCalledWith(
        `${WIN_HOME}\\projects`,
        expect.any(String)
      )
    )
    const winProjectsPanel = await within(pane('windows')).findByRole('region', {
      name: 'Directory sizes'
    })
    const winDemoBtn = await within(winProjectsPanel).findByRole('button', { name: /demo\// })
    await user.click(winDemoBtn)
    await waitFor(() =>
      expect(api.windows.dirSizes).toHaveBeenCalledWith(
        `${WIN_HOME}\\projects\\demo`,
        expect.any(String)
      )
    )
    const winDemoPanel = await within(pane('windows')).findByRole('region', {
      name: 'Directory sizes'
    })
    await within(winDemoPanel).findByRole('button', { name: /README\.md/ })
  })

  it('stays in the current folder and does not re-measure when subfolder navigation fails', async () => {
    const user = userEvent.setup()
    await renderExplorer()

    // Linux failure
    await user.click(measureButton('linux'))
    const linuxPanel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    await waitFor(() => expect(api.explorer.dirSizes).toHaveBeenCalledTimes(1))

    const linuxLockedBtn = await within(linuxPanel).findByRole('button', { name: /locked\// })
    await user.click(linuxLockedBtn)
    await waitFor(() =>
      expect(api.explorer.list).toHaveBeenCalledWith(`${LINUX_HOME}/locked`, { showHidden: false })
    )
    await flush()

    expect(api.explorer.dirSizes).toHaveBeenCalledTimes(1)
    expect(pane('linux').querySelector('.dir-sizes-path')?.textContent).toBe(LINUX_HOME)
    expect(pane('linux').querySelector('.pane-status')?.textContent).toBe(LINUX_HOME)

    // Even if the locked folder later becomes readable and is opened via the file list,
    // the stale failed drill-down must not trigger an unexpected auto-measure.
    tree.linuxDenied.delete(`${LINUX_HOME}/locked`)
    tree.linux[`${LINUX_HOME}/locked`] = []
    fireEvent.doubleClick(within(pane('linux')).getByText('locked'))
    await waitFor(() =>
      expect(api.explorer.list).toHaveBeenCalledWith(`${LINUX_HOME}/locked`, { showHidden: false })
    )
    await flush()
    expect(api.explorer.dirSizes).toHaveBeenCalledTimes(1)

    // Windows failure
    await user.click(measureButton('windows'))
    const winPanel = await within(pane('windows')).findByRole('region', {
      name: 'Directory sizes'
    })
    await waitFor(() => expect(api.windows.dirSizes).toHaveBeenCalledTimes(1))

    const winLockedBtn = await within(winPanel).findByRole('button', { name: /locked\// })
    await user.click(winLockedBtn)
    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(`${WIN_HOME}\\locked`, { showHidden: false })
    )
    await flush()

    expect(api.windows.dirSizes).toHaveBeenCalledTimes(1)
    expect(pane('windows').querySelector('.dir-sizes-path')?.textContent).toBe(WIN_HOME)
    expect(pane('windows').querySelector('.pane-status')?.textContent).toBe(WIN_HOME)
  })

  it('selects and scrolls to a file while keeping DirSizesPanel open and keeping anchorIndex synced', async () => {
    const user = userEvent.setup()
    await renderExplorer()

    const listBody = pane('linux').querySelector('.fl-body') as HTMLDivElement
    expect(listBody.scrollTop).toBe(0)
    // z-huge.bin is at the end of a 62-entry directory, outside the initial virtual window.
    expect(within(pane('linux')).queryByText('z-huge.bin')).toBeNull()

    await user.click(measureButton('linux'))
    const linuxPanel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    const hugeBtn = await within(linuxPanel).findByRole('button', { name: /z-huge\.bin/ })
    await user.click(hugeBtn)

    // Panel stays open and highlights the selected file row.
    expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).not.toBeNull()
    expect(hugeBtn.getAttribute('aria-current')).toBe('true')
    expect(hugeBtn.closest('li')?.classList.contains('is-selected')).toBe(true)

    // FileList scrolls the offscreen entry into the virtualized DOM and selects it.
    await waitFor(() => {
      const row = within(pane('linux')).getByRole('row', { name: /z-huge\.bin/ })
      expect(row.getAttribute('aria-selected')).toBe('true')
    })
    expect(listBody.scrollTop).toBeGreaterThan(0)
    expect(api.explorer.readText).not.toHaveBeenCalled()

    // anchorIndex follows the external selection: ArrowUp selects the preceding item (f58.txt), not row 0.
    const grid = within(pane('linux')).getByRole('grid')
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    await waitFor(() => {
      const prevRow = within(pane('linux')).getByRole('row', { name: /f58\.txt/ })
      expect(prevRow.getAttribute('aria-selected')).toBe('true')
    })
  })

  it('turns on showHidden automatically when activating a hidden file in either pane, and clears active search if needed', async () => {
    const user = userEvent.setup()
    await renderExplorer()

    // Search filter active on Linux pane (only f00.txt visible)
    const searchInput = within(pane('linux')).getByLabelText('Search in current folder')
    await user.type(searchInput, 'f00{Enter}')
    await waitFor(() => expect(api.explorer.search).toHaveBeenCalledWith(LINUX_HOME, 'f00'))

    await user.click(measureButton('linux'))
    const linuxPanel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    const hiddenLinuxBtn = await within(linuxPanel).findByRole('button', { name: /\.cache-dump/ })
    await user.click(hiddenLinuxBtn)

    await waitFor(() =>
      expect(api.explorer.list).toHaveBeenCalledWith(LINUX_HOME, { showHidden: true })
    )
    const linuxHiddenToggle = within(pane('linux')).getByRole('button', {
      name: /Hide hidden files/i
    })
    expect(linuxHiddenToggle.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => {
      const row = within(pane('linux')).getByRole('row', { name: /\.cache-dump/ })
      expect(row.getAttribute('aria-selected')).toBe('true')
    })
    expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).not.toBeNull()

    // Windows pane hidden file activation
    await user.click(measureButton('windows'))
    const winPanel = await within(pane('windows')).findByRole('region', {
      name: 'Directory sizes'
    })
    const hiddenWinBtn = await within(winPanel).findByRole('button', { name: /\.hidden-config/ })
    await user.click(hiddenWinBtn)

    await waitFor(() =>
      expect(api.windows.list).toHaveBeenCalledWith(WIN_HOME, { showHidden: true })
    )
    const winHiddenToggle = within(pane('windows')).getByRole('button', {
      name: /Hide hidden files/i
    })
    expect(winHiddenToggle.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => {
      const row = within(pane('windows')).getByRole('row', { name: /\.hidden-config/ })
      expect(row.getAttribute('aria-selected')).toBe('true')
    })
  })

  it('toggles measurement from the toolbar button: start, cancel while running, and close when ready', async () => {
    const user = userEvent.setup()
    let resolvePending!: (result: DirSizeResult) => void
    api.explorer.dirSizes.mockImplementationOnce(
      () =>
        new Promise<DirSizeResult>((resolve) => {
          resolvePending = resolve
        })
    )

    await renderExplorer()
    const linuxBtn = measureButton('linux')
    expect(linuxBtn.getAttribute('aria-pressed')).toBe('false')

    // Closed -> starts measuring
    await user.click(linuxBtn)
    const panel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    expect(panel.getAttribute('aria-busy')).toBe('true')
    expect(linuxBtn.getAttribute('aria-pressed')).toBe('true')

    // Running -> cancels and closes
    await user.click(linuxBtn)
    await waitFor(() =>
      expect(api.explorer.cancelOp).toHaveBeenCalledWith(expect.stringContaining('dirsize-'))
    )
    expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()
    expect(linuxBtn.getAttribute('aria-pressed')).toBe('false')

    // Resolving the cancelled run later does not reopen the panel
    resolvePending(tree.linuxSizes[LINUX_HOME])
    await flush()
    expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()

    // Closed -> measures again until ready, then clicking again closes without starting a new run
    await user.click(linuxBtn)
    await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    await waitFor(() =>
      expect(
        within(pane('linux')).getByRole('region', { name: 'Directory sizes' }).getAttribute('aria-busy')
      ).toBe('false')
    )
    expect(api.explorer.dirSizes).toHaveBeenCalledTimes(2)
    expect(linuxBtn.getAttribute('aria-pressed')).toBe('true')

    await user.click(linuxBtn)
    expect(within(pane('linux')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()
    expect(linuxBtn.getAttribute('aria-pressed')).toBe('false')
    expect(api.explorer.dirSizes).toHaveBeenCalledTimes(2)

    // Windows running cancel uses cancelDirSizes
    let resolveWin!: (result: DirSizeResult) => void
    api.windows.dirSizes.mockImplementationOnce(
      () =>
        new Promise<DirSizeResult>((resolve) => {
          resolveWin = resolve
        })
    )
    const winBtn = measureButton('windows')
    await user.click(winBtn)
    await within(pane('windows')).findByRole('region', { name: 'Directory sizes' })
    await user.click(winBtn)
    await waitFor(() =>
      expect(api.windows.cancelDirSizes).toHaveBeenCalledWith(expect.stringContaining('dirsize-'))
    )
    expect(within(pane('windows')).queryByRole('region', { name: 'Directory sizes' })).toBeNull()
    resolveWin(tree.windowsSizes[WIN_HOME])
    await flush()
  })

  it('keeps deletion strictly in the lower file list, never inside DirSizesPanel', async () => {
    const user = userEvent.setup()
    await renderExplorer()

    await user.click(measureButton('linux'))
    const linuxPanel = await within(pane('linux')).findByRole('region', { name: 'Directory sizes' })
    const fileBtn = await within(linuxPanel).findByRole('button', { name: /z-huge\.bin/ })
    fileBtn.focus()
    fireEvent.keyDown(fileBtn, { key: 'Delete' })
    expect(api.explorer.trash).not.toHaveBeenCalled()
    expect(api.explorer.remove).not.toHaveBeenCalled()
    expect(within(linuxPanel).queryByRole('button', { name: /delete|trash|remove/i })).toBeNull()
  })
})
