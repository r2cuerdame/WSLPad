import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { ConsoleStatus, FileEntry, WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import ExplorerTab from '@renderer/explorer/ExplorerTab'
import ConsolePanel from '@renderer/console/ConsolePanel'
import { sortEntries } from '@renderer/explorer/useExplorer'

const xtermState = vi.hoisted(() => ({
  instances: [] as Array<{ write: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }>
}))

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    open = vi.fn()
    write = vi.fn()
    reset = vi.fn()
    clear = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
    loadAddon = vi.fn()
    onData = vi.fn()
    onResize = vi.fn()
    constructor() {
      xtermState.instances.push(this as unknown as (typeof xtermState.instances)[number])
    }
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

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
        home: '/home/dev',
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
    explorer: { distro: 'Ubuntu-24.04', currentPath: '/home/dev', showHidden: false },
    terminal: { distro: 'Ubuntu-24.04', cwd: '/home/dev', status: 'ready' },
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

const listing: FileEntry[] = [
  entry({ name: 'config.json', path: '/home/dev/config.json' }),
  entry({ name: 'logs', path: '/home/dev/logs', type: 'directory', sizeBytes: null }),
  entry({ name: 'a.txt', path: '/home/dev/a.txt' })
]

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
      list: vi.fn(async () => listing),
      tree: vi.fn(async () => [] as FileEntry[]),
      stat: vi.fn(async () => ({
        ...entry({ name: 'config.json', path: '/home/dev/config.json' }),
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
        encoding: 'utf-8',
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
    convertPath: vi.fn(async () => ''),
    openInWindowsExplorer: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    terminal: {
      ensure: vi.fn(
        async (
          _distro: string
        ): Promise<{ sessionId: string; status: ConsoleStatus; cwd: string | null }> => ({
          sessionId: 's1',
          status: 'ready',
          cwd: '/home/dev'
        })
      ),
      input: vi.fn(async (_sessionId: string, _data: string) => undefined),
      resize: vi.fn(async () => undefined),
      setCwd: vi.fn(async () => undefined),
      getState: vi.fn(async () => ({ status: 'ready', cwd: '/home/dev' })),
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
      version: vi.fn(async () => '0.1.0'),
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

function PrepareButton({ text }: { text: string }): React.JSX.Element {
  const { prepareCommand } = useApp()
  return (
    <button type="button" onClick={() => prepareCommand(text)}>
      __prepare__
    </button>
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
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
  xtermState.instances.length = 0
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
    const sorted = sortEntries(items, 'name', 'asc')
    expect(sorted.map((e) => e.name)).toEqual(['mid', 'zeta', 'alpha.txt', 'beta.txt'])
  })

  it('keeps folders first even when sorting descending', () => {
    const sorted = sortEntries(items, 'name', 'desc')
    expect(sorted.map((e) => e.name)).toEqual(['zeta', 'mid', 'beta.txt', 'alpha.txt'])
  })

  it('sorts by size within each group', () => {
    const bySize = sortEntries(
      [
        entry({ name: 'big', path: '/x/big', sizeBytes: 5000 }),
        entry({ name: 'small', path: '/x/small', sizeBytes: 10 }),
        entry({ name: 'dir', path: '/x/dir', type: 'directory', sizeBytes: null })
      ],
      'size',
      'asc'
    )
    expect(bySize.map((e) => e.name)).toEqual(['dir', 'small', 'big'])
  })
})

describe('ExplorerTab rename', () => {
  it('commits an inline rename via F2 and Enter with (path, newName)', async () => {
    render(
      <AppStoreProvider>
        <ExplorerTab />
      </AppStoreProvider>
    )
    await flush()

    const cell = await screen.findByText('config.json')
    fireEvent.click(cell)
    fireEvent.keyDown(cell, { key: 'F2' })

    const editor = await screen.findByDisplayValue('config.json')
    fireEvent.change(editor, { target: { value: 'renamed.json' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    await waitFor(() =>
      expect(api.explorer.rename).toHaveBeenCalledWith('/home/dev/config.json', 'renamed.json')
    )
    expect(api.explorer.rename).toHaveBeenCalledTimes(1)
  })

  it('cancels the rename with Escape without calling the API', async () => {
    render(
      <AppStoreProvider>
        <ExplorerTab />
      </AppStoreProvider>
    )
    await flush()

    const cell = await screen.findByText('a.txt')
    fireEvent.click(cell)
    fireEvent.keyDown(cell, { key: 'F2' })

    const editor = await screen.findByDisplayValue('a.txt')
    fireEvent.change(editor, { target: { value: 'other.txt' } })
    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(api.explorer.rename).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('other.txt')).toBeNull()
  })
})

describe('ConsolePanel prepared command', () => {
  it('inserts the command into terminal input WITHOUT a newline when ready', async () => {
    render(
      <AppStoreProvider>
        <PrepareButton text="systemctl --user restart hermes-gateway" />
        <ConsolePanel />
      </AppStoreProvider>
    )
    await flush()
    await waitFor(() => expect(api.terminal.ensure).toHaveBeenCalledWith('Ubuntu-24.04'))
    await screen.findByText('Ready')

    fireEvent.click(screen.getByRole('button', { name: '__prepare__' }))
    await flush()

    expect(api.terminal.input).toHaveBeenCalledTimes(1)
    expect(api.terminal.input).toHaveBeenCalledWith(
      's1',
      'systemctl --user restart hermes-gateway'
    )
    // Never auto-executed: no newline / carriage return in anything we sent.
    for (const call of api.terminal.input.mock.calls) {
      expect(String(call[1])).not.toContain('\n')
      expect(String(call[1])).not.toContain('\r')
    }

    // Consumed: a re-render must not insert it again.
    await flush()
    expect(api.terminal.input).toHaveBeenCalledTimes(1)
  })

  it('does not insert anything when the session is not ready', async () => {
    api.terminal.ensure.mockResolvedValue({
      sessionId: 's1',
      status: 'distro-stopped',
      cwd: null
    })
    render(
      <AppStoreProvider>
        <PrepareButton text="echo hi" />
        <ConsolePanel />
      </AppStoreProvider>
    )
    await flush()
    await waitFor(() => expect(api.terminal.ensure).toHaveBeenCalled())
    await screen.findByText('Distribution stopped')

    fireEvent.click(screen.getByRole('button', { name: '__prepare__' }))
    await flush()

    expect(api.terminal.input).not.toHaveBeenCalled()
  })
})
