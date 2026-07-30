import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import DashboardTab from '@renderer/dashboard/DashboardTab'
import EnvironmentCard from '@renderer/dashboard/EnvironmentCard'
import ProcessesCard from '@renderer/dashboard/ProcessesCard'
import PortsCard from '@renderer/dashboard/PortsCard'
import WarningsCard from '@renderer/dashboard/WarningsCard'
import Dialog from '@renderer/components/Dialog'
import Toasts from '@renderer/components/Toasts'
import VirtualList from '@renderer/components/VirtualList'

const GIB = 1024 ** 3

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
        cpuPercent: 12.5,
        cpuCount: 8,
        memTotalBytes: 8 * GIB,
        memUsedBytes: 2 * GIB,
        memAvailableBytes: 6 * GIB,
        swapTotalBytes: 2 * GIB,
        swapUsedBytes: 0,
        disks: [
          {
            mountPoint: '/',
            exists: true,
            totalBytes: 100 * GIB,
            usedBytes: 40 * GIB,
            availableBytes: 60 * GIB,
            usePercent: 40
          }
        ],
        loadAvg: [0.5, 0.4, 0.3],
        processCount: 42
      },
      paths: [
        {
          id: 'home',
          label: 'HOME',
          linuxPath: '/home/dev',
          windowsPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev',
          exists: true,
          isDirectory: true
        }
      ],
      configuration: [
        {
          id: 'bashrc',
          label: '~/.bashrc',
          scope: 'linux',
          linuxPath: '/home/dev/.bashrc',
          windowsPath: null,
          exists: true,
          readable: true,
          writable: false
        }
      ],
      tools: [
        {
          id: 'node',
          displayName: 'Node.js',
          installed: true,
          executablePath: '/usr/bin/node',
          version: '22.1.0',
          installMethod: 'apt',
          configPaths: [],
          runningProcesses: 1,
          services: []
        }
      ],
      hermes: {
        installed: true,
        executablePath: '/home/dev/.local/bin/hermes',
        dataDir: '/home/dev/.hermes',
        venvPath: null,
        configPath: null,
        gatewayStatus: 'running',
        dashboardStatus: 'not-detected',
        mcpServerCount: 4,
        processes: [],
        ports: [8420],
        services: ['hermes-gateway.service'],
        logPaths: []
      },
      environment: [
        {
          name: 'MY_API_KEY',
          maskedValue: '••••••••',
          valueLength: 12,
          isSecret: true,
          isPathLike: false,
          fromWindows: false
        },
        {
          name: 'EDITOR',
          maskedValue: 'vim',
          valueLength: 3,
          isSecret: false,
          isPathLike: false,
          fromWindows: false
        }
      ],
      processes: [
        {
          pid: 4242,
          user: 'dev',
          cpuPercent: 3.5,
          memPercent: 1.2,
          elapsedSeconds: 600,
          command: 'node server.js',
          executablePath: '/usr/bin/node'
        },
        {
          pid: 1,
          user: 'root',
          cpuPercent: 0,
          memPercent: 0.1,
          elapsedSeconds: 7200,
          command: '/sbin/init',
          executablePath: null
        }
      ],
      services: [
        {
          name: 'hermes-gateway.service',
          scope: 'user',
          loadState: 'loaded',
          activeState: 'active',
          subState: 'running',
          enabled: 'enabled',
          description: 'Hermes Gateway'
        }
      ],
      ports: [
        {
          protocol: 'tcp',
          localAddress: '127.0.0.1',
          port: 8080,
          pid: 4242,
          processName: 'node',
          listening: true,
          localhostUrl: 'http://127.0.0.1:8080'
        }
      ],
      warnings: []
    },
    explorer: { distro: 'Ubuntu-24.04', currentPath: '/home/dev', showHidden: false },
    terminal: { distro: 'Ubuntu-24.04', cwd: '/home/dev', status: 'ready' },
    mcp: {
      running: true,
      transport: 'http',
      endpoint: 'http://127.0.0.1:4923/mcp',
      port: 4923,
      connectedClients: 1,
      lastRequestAt: '2026-07-30T11:59:00.000Z',
      readOnly: true,
      tokenSet: true,
      error: null
    },
    warnings: []
  }
}

function makeApi(snapshot: WslPadSnapshot) {
  return {
    listDistros: vi.fn(async () => snapshot.distros),
    selectDistro: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => undefined),
    setMonitoringPaused: vi.fn(async () => undefined),
    revealEnv: vi.fn(async () => 'raw-secret-value'),
    copyLlmMarkdown: vi.fn(async () => '# snapshot'),
    exportLlmJson: vi.fn(async () => 'C:\\out\\snapshot.json'),
    convertPath: vi.fn(async () => ''),
    openInWindowsExplorer: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    terminal: {
      ensure: vi.fn(async () => ({ sessionId: 's1', status: 'ready', cwd: null })),
      input: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      setCwd: vi.fn(async () => undefined),
      getState: vi.fn(async () => ({ status: 'ready', cwd: null })),
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

function PreparedProbe(): React.JSX.Element {
  const { preparedCommand } = useApp()
  return <div data-testid="prepared">{preparedCommand?.text ?? ''}</div>
}

function ToastProbe(): React.JSX.Element {
  const { pushToast } = useApp()
  return (
    <button type="button" onClick={() => pushToast('info', 'hello toast')}>
      push
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
  snapshot = makeSnapshot()
  api = makeApi(snapshot)
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('DashboardTab', () => {
  it('renders all twelve card titles', async () => {
    render(
      <AppStoreProvider>
        <DashboardTab />
      </AppStoreProvider>
    )
    await flush()
    const titles = [
      'Overview',
      'Resources',
      'Important paths',
      'Configuration',
      'Installed tools',
      'Hermes',
      'Environment',
      'Processes',
      'Services',
      'Ports',
      'Warnings',
      'MCP server'
    ]
    for (const title of titles) {
      expect(screen.getAllByRole('heading', { name: title }).length).toBeGreaterThan(0)
    }
  })

  it('shows the not-installed screen when no distros exist', async () => {
    snapshot.distros = []
    render(
      <AppStoreProvider>
        <DashboardTab />
      </AppStoreProvider>
    )
    await flush()
    expect(screen.getByText('WSL is not available on this PC')).toBeTruthy()
  })
})

describe('EnvironmentCard', () => {
  it('hides secret values until reveal, then re-masks after 10s', async () => {
    vi.useFakeTimers()
    render(
      <AppStoreProvider>
        <EnvironmentCard env={makeSnapshot().dashboard!.environment} />
      </AppStoreProvider>
    )
    await flush()

    expect(screen.getByText('••••••••')).toBeTruthy()
    expect(screen.queryByText('raw-secret-value')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
      await Promise.resolve()
    })
    expect(api.revealEnv).toHaveBeenCalledWith('MY_API_KEY')
    expect(screen.getByText('raw-secret-value')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(screen.queryByText('raw-secret-value')).toBeNull()
    expect(screen.getByText('••••••••')).toBeTruthy()
  })
})

describe('ProcessesCard', () => {
  it('prepares a kill command without executing anything', async () => {
    render(
      <AppStoreProvider>
        <ProcessesCard processes={makeSnapshot().dashboard!.processes} />
        <PreparedProbe />
      </AppStoreProvider>
    )
    await flush()

    // Sorted by CPU desc: pid 4242 (3.5%) is the first row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Prepare kill command' })[0])

    expect(screen.getByTestId('prepared').textContent).toBe('kill 4242')
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.ensure).not.toHaveBeenCalled()
  })
})

describe('PortsCard', () => {
  it('opens the localhost url via openExternal', async () => {
    render(
      <AppStoreProvider>
        <PortsCard ports={makeSnapshot().dashboard!.ports} />
      </AppStoreProvider>
    )
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(api.openExternal).toHaveBeenCalledWith('http://127.0.0.1:8080')
  })
})

describe('WarningsCard', () => {
  it('localizes known keys and falls back to the raw message otherwise', async () => {
    render(
      <AppStoreProvider>
        <WarningsCard
          warnings={[
            {
              id: 'w1',
              severity: 'warning',
              messageKey: 'warnings.notARealKey',
              message: 'Raw fallback message'
            },
            {
              id: 'w2',
              severity: 'error',
              messageKey: 'warnings.distroStopped',
              params: { distro: 'Debian' },
              message: 'Distro Debian stopped (raw english)'
            }
          ]}
        />
      </AppStoreProvider>
    )
    await flush()

    expect(screen.getByText('Raw fallback message')).toBeTruthy()
    expect(screen.getByText('Distribution Debian is stopped')).toBeTruthy()
    expect(screen.queryByText('Distro Debian stopped (raw english)')).toBeNull()
  })
})

describe('Dialog', () => {
  it('closes on Escape and moves focus into the dialog', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="My dialog" onClose={onClose}>
        <button type="button">inner</button>
      </Dialog>
    )
    const dialog = screen.getByRole('dialog', { name: 'My dialog' })
    expect(dialog).toBeTruthy()
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Toasts', () => {
  it('renders pushed toasts and dismisses them', async () => {
    render(
      <AppStoreProvider>
        <ToastProbe />
        <Toasts />
      </AppStoreProvider>
    )
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'push' }))
    expect(screen.getByText('hello toast')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('hello toast')).toBeNull()
  })
})

describe('VirtualList', () => {
  it('renders only a window of rows', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i)
    const { container } = render(
      <VirtualList
        items={items}
        rowHeight={20}
        render={(item) => (
          <div key={item} data-row style={{ height: 20 }}>
            row {item}
          </div>
        )}
      />
    )
    const rendered = container.querySelectorAll('[data-row]').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)
  })
})
