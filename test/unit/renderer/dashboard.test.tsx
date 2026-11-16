import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WslPadApi } from '@shared/ipc'
import type { WslPadSnapshot } from '@shared/types'
import { defaultSettings } from '@shared/schemas'
import { i18n, initRendererI18n } from '@renderer/i18n'
import { AppStoreProvider, useApp } from '@renderer/store'
import DashboardTab from '@renderer/dashboard/DashboardTab'
import EnvironmentCard from '@renderer/dashboard/EnvironmentCard'
import OpenClawCard from '@renderer/dashboard/OpenClawCard'
import ProcessesCard from '@renderer/dashboard/ProcessesCard'
import PortsCard from '@renderer/dashboard/PortsCard'
import WarningsCard from '@renderer/dashboard/WarningsCard'
import Dialog from '@renderer/components/Dialog'
import Toasts from '@renderer/components/Toasts'
import VirtualList from '@renderer/components/VirtualList'

const GIB = 1024 ** 3

const SECTION_LABELS: ReadonlyArray<[string, string]> = [
  ['overview', 'Overview'],
  ['resources', 'Resources'],
  ['disk', 'Disk image'],
  ['wslconfig', 'WSL settings'],
  ['network', 'Network'],
  ['diagnostics', 'Diagnostics'],
  ['doctor', 'Environment Doctor'],
  ['paths', 'Important paths'],
  ['configuration', 'Configuration files'],
  ['profiles', 'Developer Profiles'],
  ['tools', 'Installed tools'],
  ['discover', 'Discover'],
  ['update-center', 'Update Center'],
  ['usb', 'USB Devices'],
  ['docker', 'Docker'],
  ['hermes', 'Hermes'],
  ['openclaw', 'OpenClaw'],
  ['environment', 'Environment'],
  ['processes', 'Processes'],
  ['services', 'Services'],
  ['ports', 'Ports'],
  ['warnings', 'Warnings']
]

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
      disk: null,
      wslSettings: null,
      memoryDetail: null,
      paths: [
        {
          id: 'home',
          label: 'HOME',
          linuxPath: '/home/dev',
          windowsPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev',
          exists: true,
          isDirectory: true,
          side: 'ext4'
        }
      ],
      configuration: [
        {
          id: 'wslconfig',
          label: '.wslconfig',
          scope: 'windows',
          linuxPath: null,
          windowsPath: 'C:\\Users\\dev\\.wslconfig',
          exists: true,
          readable: true,
          writable: true
        },
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
          services: [],
          side: 'ext4',
          shadowedByWindows: false
        },
        {
          id: 'bun',
          displayName: 'Bun',
          installed: false,
          executablePath: null,
          version: null,
          installMethod: null,
          configPaths: [],
          runningProcesses: 0,
          services: [],
          side: 'unknown',
          shadowedByWindows: false
        }
      ],
      docker: null,
      zoneIdentifier: null,
      diskConsumers: null,
      driveMounts: null,
      defender: null,
      inotify: null,
      terminalProfiles: null,
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
        logPaths: [],
        platforms: [
          { name: 'Telegram', configured: true, detail: null },
          { name: 'Discord', configured: false, detail: 'not configured' }
        ],
        profiles: [{ name: 'default', model: null, gatewayState: 'running', isCurrent: true }],
        activeSessions: 0,
        scheduledJobs: 0,
        dashboardPort: null,
        home: null
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
          localhostUrl: 'http://127.0.0.1:8080',
          windowsBound: null,
          windowsProcess: null,
          reachability: 'unknown',
          reachabilityReason: null
        }
      ],
      windowsPorts: [],
      portProxy: null,
      firewall: {
        enabled: true,
        defaultInbound: 'Block',
        defaultOutbound: 'Allow',
        loopbackEnabled: true,
        ruleCount: 3,
        error: null
      },
      clock: {
        windowsIso: '2026-07-30T12:00:00.000Z',
        distroIso: '2026-07-30T11:59:13.000Z',
        skewSeconds: -47
      },
      dns: {
        resolvConfPath: '/etc/resolv.conf',
        isGeneratedSymlink: false,
        generateResolvConf: false,
        dnsTunneling: false,
        nameservers: ['10.255.255.254'],
        windowsAdapterDns: ['192.168.1.1'],
        error: null
      },
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
    liveness: null,
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
    diagnostics: {
      get: vi.fn(async () => ({
        incidents: [],
        lastNetworkCheck: null,
        lastRecoveryCheck: null
      })),
      runNetworkCheck: vi.fn(),
      runRecoveryCheck: vi.fn(),
      exportBundle: vi.fn(async () => 'C:\\out\\diagnostic.json'),
      onChange: vi.fn(() => () => undefined)
    },
    performance: {
      get: vi.fn(async () => ({ enabled: false, path: null as string | null, intervals: [], writeError: false, unsavedSamples: 0 })),
      setEnabled: vi.fn(async (enabled: boolean) => ({
        enabled,
        path: enabled ? 'C:\\local\\slowdown.jsonl' : 'C:\\local\\slowdown.jsonl',
        intervals: [],
        writeError: false,
        unsavedSamples: 0
      })),
      record: vi.fn(async () => undefined),
      exportLog: vi.fn(async () => null),
      onChange: vi.fn(() => () => undefined)
    },
    tools: {
      search: vi.fn(async (query: string) => ({
        query,
        results: [
          {
            provider: 'apt' as const,
            target: 'wsl' as const,
            name: 'ripgrep',
            version: '14.1.0',
            description: 'fast recursive search',
            installCommand: "sudo apt install -- 'ripgrep'"
          }
        ],
        providers: [
          {
            provider: 'apt' as const,
            displayName: 'APT',
            target: 'wsl' as const,
            state: 'ready' as const,
            message: null
          },
          {
            provider: 'cargo' as const,
            displayName: 'Cargo',
            target: 'wsl' as const,
            state: 'timed-out' as const,
            message: 'Provider timed out'
          }
        ]
      })),
      checkUpdates: vi.fn(async () => ({
        updates: [
          {
            provider: 'winget' as const,
            target: 'windows' as const,
            name: 'Microsoft.PowerShell',
            installedVersion: '7.5.2.0',
            availableVersion: '7.5.3.0',
            updateCommand: 'winget.exe upgrade --id Microsoft.PowerShell --exact --source winget'
          }
        ],
        providers: [
          {
            provider: 'winget' as const,
            displayName: 'winget',
            target: 'windows' as const,
            state: 'ready' as const,
            message: null
          },
          {
            provider: 'cargo' as const,
            displayName: 'Cargo',
            target: 'wsl' as const,
            state: 'unsupported' as const,
            message: 'No reliable native update listing'
          }
        ],
        checkedAt: '2026-09-14T00:00:00.000Z'
      }))
    },
    doctor: {
      run: vi.fn(async () => ({
        generatedAt: '2026-07-30T12:00:00.000Z',
        checks: [
          {
            id: 'project-path',
            title: 'Project path filesystem',
            verdict: 'healthy' as const,
            evidence: 'Home directory /home/dev is on native ext4.',
            command: null
          }
        ],
        maskedMarkdown: '# Doctor Report'
      }))
    },
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
    onSnapshot: vi.fn((_cb: (snap: WslPadSnapshot) => void) => () => undefined),
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

function ExplorerProbe(): React.JSX.Element {
  const { explorerNavigateRequest, explorerOpenFileRequest } = useApp()
  const req = explorerNavigateRequest
  const openReq = explorerOpenFileRequest
  return (
    <>
      <div data-testid="explorer-request" data-select={req?.selectPath ?? ''}>
        {req ? `${req.fs}:${req.path}` : ''}
      </div>
      <div data-testid="open-file-request">{openReq ? `${openReq.fs}:${openReq.path}` : ''}</div>
    </>
  )
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

async function renderDashboard(extra?: React.ReactNode): Promise<ReturnType<typeof render>> {
  const view = render(
    <AppStoreProvider>
      <DashboardTab />
      {extra}
    </AppStoreProvider>
  )
  await flush()
  return view
}

const navItem = (id: string): HTMLElement => screen.getByTestId(`dashboard-nav-${id}`)

const badgeText = (id: string): string | undefined =>
  navItem(id).querySelector('.dash-nav-badge')?.textContent ?? undefined

beforeAll(async () => {
  initRendererI18n('en')
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve())
    })
  }
})

beforeEach(() => {
  window.localStorage.clear()
  snapshot = makeSnapshot()
  api = makeApi(snapshot)
  ;(window as unknown as { wslpad: WslPadApi }).wslpad = api as unknown as WslPadApi
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('DashboardTab master–detail', () => {
  it('renders every section as a listbox option, never as a tab', async () => {
    await renderDashboard()

    const nav = screen.getByTestId('dashboard-nav')
    expect(nav.getAttribute('role')).toBe('listbox')
    expect(nav.getAttribute('aria-label')).toBe('Dashboard sections')

    const options = within(nav).getAllByRole('option')
    expect(options).toHaveLength(SECTION_LABELS.length)
    SECTION_LABELS.forEach(([id, label], index) => {
      const item = navItem(id)
      expect(item).toBe(options[index])
      expect(item.textContent).toContain(label)
    })

    // The three main tabs live in TopBar; the Dashboard must not add more.
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryAllByRole('tablist')).toHaveLength(0)
  })

  it('selects overview by default and swaps the detail body when a section is picked', async () => {
    await renderDashboard()

    expect(navItem('overview').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('6.6.36-microsoft-standard-WSL2')).toBeTruthy()

    fireEvent.click(navItem('processes'))

    expect(navItem('processes').getAttribute('aria-selected')).toBe('true')
    expect(navItem('overview').getAttribute('aria-selected')).toBe('false')
    const detail = screen.getByTestId('dashboard-detail')
    expect(within(detail).getByText('node server.js')).toBeTruthy()
    expect(within(detail).getByText('/sbin/init')).toBeTruthy()
    expect(screen.queryByText('6.6.36-microsoft-standard-WSL2')).toBeNull()
  })

  it('shows counts and status dots that match the snapshot', async () => {
    await renderDashboard()

    expect(badgeText('tools')).toBe('1')
    expect(badgeText('environment')).toBe('2')
    expect(badgeText('processes')).toBe('2')
    expect(badgeText('services')).toBe('1')
    expect(badgeText('ports')).toBe('1')
    expect(navItem('overview').querySelector('.dash-nav-badge')).toBeNull()
    expect(navItem('resources').querySelector('.dash-nav-badge')).toBeNull()
    expect(navItem('paths').querySelector('.dash-nav-badge')).toBeNull()
    expect(navItem('configuration').querySelector('.dash-nav-badge')).toBeNull()
    expect(navItem('hermes').querySelector('.dot-ok')).toBeTruthy()
  })

  it('explains the firewall and the resolver in the network section', async () => {
    await renderDashboard()

    // Inbound is blocked by default in this snapshot: the section is badged.
    expect(navItem('network').querySelector('.dot-err')).toBeTruthy()

    fireEvent.click(navItem('network'))
    const detail = screen.getByTestId('dashboard-detail')
    expect(within(detail).getByText('Block')).toBeTruthy()
    expect(within(detail).getByText('10.255.255.254')).toBeTruthy()
    expect(within(detail).getByText('192.168.1.1')).toBeTruthy()

    // The only action is navigation — nothing in this section mutates anything.
    fireEvent.click(within(detail).getByRole('button', { name: 'See the ports' }))
    expect(navItem('ports').getAttribute('aria-selected')).toBe('true')
  })

  it('opens session diagnostics without running a network check automatically', async () => {
    await renderDashboard()
    fireEvent.click(navItem('diagnostics'))
    const detail = screen.getByTestId('dashboard-detail')
    expect(within(detail).getByText('No network check has run in this session.')).toBeTruthy()
    expect(api.diagnostics.runNetworkCheck).not.toHaveBeenCalled()
    expect(api.diagnostics.runRecoveryCheck).not.toHaveBeenCalled()
  })

  it('lets the user start and stop local slowdown recording', async () => {
    await renderDashboard()
    fireEvent.click(navItem('diagnostics'))
    await flush()
    const detail = screen.getByTestId('dashboard-detail')
    expect(api.performance.setEnabled).not.toHaveBeenCalled()
    fireEvent.click(within(detail).getByRole('button', { name: 'Start recording' }))
    await flush()
    expect(api.performance.setEnabled).toHaveBeenCalledWith(true)
    fireEvent.click(within(detail).getByRole('button', { name: 'Stop recording' }))
    await flush()
    expect(api.performance.setEnabled).toHaveBeenCalledWith(false)
  })

  it('warns about unsaved samples and offers an export retry after a write failure', async () => {
    api.performance.get.mockResolvedValueOnce({
      enabled: false,
      path: 'recording.jsonl',
      intervals: [],
      writeError: true,
      unsavedSamples: 2
    })
    await renderDashboard()
    fireEvent.click(navItem('diagnostics'))
    await flush()
    const detail = screen.getByTestId('dashboard-detail')
    expect(within(detail).getByRole('alert').textContent).toContain('2 samples are still in memory')
    expect((within(detail).getByRole('button', { name: 'Start recording' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(detail).getByRole('button', { name: 'Export recording' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the least-destructive recovery step and only prepares its command', async () => {
    api.diagnostics.runRecoveryCheck.mockResolvedValue({
      distro: 'Ubuntu-24.04',
      startedAt: '2026-08-21T01:00:00.000Z',
      completedAt: '2026-08-21T01:00:01.000Z',
      network: {
        distro: 'Ubuntu-24.04',
        targetPort: null,
        startedAt: '2026-08-21T01:00:00.000Z',
        completedAt: '2026-08-21T01:00:01.000Z',
        probes: [
          { id: 'distro', status: 'pass', durationMs: 4, detail: 'wslpad-ok' },
          { id: 'wsl-dns', status: 'pass', durationMs: 8, detail: '93.184.216.34' },
          { id: 'windows-dns', status: 'pass', durationMs: 7, detail: '93.184.216.34' },
          { id: 'default-route', status: 'pass', durationMs: 3, detail: 'default via 172.20.0.1' }
        ]
      },
      vscodeServerInstalled: true,
      vscodeProcesses: [
        { pid: 201, role: 'extension-host', cpuPercent: 2.5, memPercent: 1.5, elapsedSeconds: 90 }
      ],
      recommendedStep: 'restart-vscode-server',
      steps: [
        {
          id: 'reload-window',
          status: 'available',
          command: null,
          reason: 'Reload first.',
          impact: 'Current window only.'
        },
        {
          id: 'restart-vscode-server',
          status: 'recommended',
          command: 'kill 201',
          reason: 'Measured process only.',
          impact: 'Editor reconnects.'
        },
        {
          id: 'terminate-distro',
          status: 'available',
          command: "wsl.exe --terminate 'Ubuntu-24.04'",
          reason: 'Distro fallback.',
          impact: 'Selected distro stops.'
        },
        {
          id: 'shutdown-wsl',
          status: 'last-resort',
          command: 'wsl.exe --shutdown',
          reason: 'Global fallback.',
          impact: 'All distros stop.'
        }
      ],
      resumedAt: null,
      resumeChanges: []
    })

    await renderDashboard(<PreparedProbe />)
    fireEvent.click(navItem('diagnostics'))
    const detail = screen.getByTestId('dashboard-detail')
    fireEvent.click(within(detail).getByRole('button', { name: 'Check recovery path' }))

    expect(await within(detail).findAllByText('Restart only VS Code Server')).toHaveLength(2)
    expect(screen.getByTestId('prepared').textContent).toBe('')
    fireEvent.click(within(detail).getAllByRole('button', { name: 'Prepare command' })[0])
    expect(screen.getByTestId('prepared').textContent).toBe('kill 201')
    expect(api.diagnostics.runNetworkCheck).not.toHaveBeenCalled()
  })

  it('has no MCP section — every MCP action lives in Settings', async () => {
    await renderDashboard()

    expect(screen.queryByTestId('dashboard-nav-mcp')).toBeNull()
    expect(screen.queryByText('MCP server')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy config JSON' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Register in Codex' })).toBeNull()
    expect(api.mcp.getConfigJson).not.toHaveBeenCalled()
  })

  it('falls back to overview when the stored section is the retired mcp id', async () => {
    window.localStorage.setItem('wslpad.dashboard.section', 'mcp')
    await renderDashboard()
    expect(navItem('overview').getAttribute('aria-selected')).toBe('true')
  })

  it('badges the deduped warning count in the error colour', async () => {
    snapshot.warnings = [
      {
        id: 'w1',
        severity: 'warning',
        messageKey: 'warnings.systemdDisabled',
        message: 'systemd is not enabled'
      }
    ]
    snapshot.dashboard!.warnings = [
      {
        id: 'w1',
        severity: 'warning',
        messageKey: 'warnings.systemdDisabled',
        message: 'systemd is not enabled'
      },
      {
        id: 'w2',
        severity: 'error',
        messageKey: 'warnings.distroStopped',
        params: { distro: 'Debian' },
        message: 'Distribution Debian is stopped'
      }
    ]
    await renderDashboard()

    const badge = navItem('warnings').querySelector('.dash-nav-badge')
    expect(badge?.textContent).toBe('2')
    expect(badge?.className).toContain('badge-err')

    fireEvent.click(navItem('warnings'))
    const detail = screen.getByTestId('dashboard-detail')
    expect(within(detail).getByText('systemd is not enabled')).toBeTruthy()
    expect(within(detail).getByText('Distribution Debian is stopped')).toBeTruthy()
  })

  it('restores the selected section from localStorage after a remount', async () => {
    const view = await renderDashboard()
    fireEvent.click(navItem('services'))
    expect(window.localStorage.getItem('wslpad.dashboard.section')).toBe('services')
    view.unmount()

    await renderDashboard()
    expect(navItem('services').getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByTestId('dashboard-detail')).getByText('Hermes Gateway')).toBeTruthy()
  })

  it('falls back to overview when the stored section is unknown', async () => {
    window.localStorage.setItem('wslpad.dashboard.section', 'not-a-section')
    await renderDashboard()
    expect(navItem('overview').getAttribute('aria-selected')).toBe('true')
  })

  it('moves the selection with the keyboard', async () => {
    await renderDashboard()
    const nav = screen.getByTestId('dashboard-nav')

    fireEvent.keyDown(nav, { key: 'ArrowDown' })
    expect(navItem('resources').getAttribute('aria-selected')).toBe('true')
    expect(navItem('overview').getAttribute('aria-selected')).toBe('false')
    expect(navItem('resources').tabIndex).toBe(0)
    expect(navItem('overview').tabIndex).toBe(-1)

    fireEvent.keyDown(nav, { key: 'ArrowDown' })
    fireEvent.keyDown(nav, { key: 'ArrowUp' })
    expect(navItem('resources').getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(nav, { key: 'End' })
    expect(navItem('warnings').getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(nav, { key: 'Home' })
    expect(navItem('overview').getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(nav, { key: 'Enter' })
    expect(navItem('overview').getAttribute('aria-selected')).toBe('true')
  })

  it('keeps secret values masked until the user reveals them', async () => {
    await renderDashboard()
    fireEvent.click(navItem('environment'))

    expect(screen.getByText('••••••••')).toBeTruthy()
    expect(screen.queryByText('raw-secret-value')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
      await Promise.resolve()
    })

    expect(api.revealEnv).toHaveBeenCalledWith('MY_API_KEY')
    expect(screen.getByText('raw-secret-value')).toBeTruthy()
  })

  it('only prepares a kill command from the processes section', async () => {
    await renderDashboard(<PreparedProbe />)
    fireEvent.click(navItem('processes'))

    // Sorted by CPU desc: pid 4242 (3.5%) is the first row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Prepare kill command' })[0])

    expect(screen.getByTestId('prepared').textContent).toBe('kill 4242')
    expect(api.terminal.input).not.toHaveBeenCalled()
    expect(api.terminal.ensure).not.toHaveBeenCalled()
  })

  it('discovers packages on demand and only prepares the install command', async () => {
    await renderDashboard(<PreparedProbe />)
    fireEvent.click(navItem('discover'))
    expect(api.tools.search).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Search available packages'), {
      target: { value: 'ripgrep' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('fast recursive search')).toBeTruthy()
    expect(screen.getByText('Cargo: Timed out')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare install command for ripgrep' }))
    expect(screen.getByTestId('prepared').textContent).toBe("sudo apt install -- 'ripgrep'")
    expect(api.terminal.input).not.toHaveBeenCalled()
  })

  it('checks updates on demand and only prepares the Windows update command', async () => {
    await renderDashboard(<PreparedProbe />)
    fireEvent.click(navItem('update-center'))
    expect(api.tools.checkUpdates).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('Microsoft.PowerShell')).toBeTruthy()
    expect(screen.getByText('Cargo: Unsupported')).toBeTruthy()
    expect(screen.getByText('Windows')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare update command for Microsoft.PowerShell' })
    )
    expect(screen.getByTestId('prepared').textContent).toBe(
      'winget.exe upgrade --id Microsoft.PowerShell --exact --source winget'
    )
    expect(api.terminal.input).not.toHaveBeenCalled()
  })

  it('keeps the Copy for LLM actions in the toolbar', async () => {
    await renderDashboard()
    expect(screen.getByRole('button', { name: 'Copy for LLM' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeTruthy()
  })

  it('shows a split skeleton while the snapshot is still loading', async () => {
    api.getSnapshot.mockImplementation(() => new Promise<WslPadSnapshot>(() => undefined))
    render(
      <AppStoreProvider>
        <DashboardTab />
      </AppStoreProvider>
    )
    await flush()
    expect(screen.getByLabelText('Loading…')).toBeTruthy()
    expect(screen.queryByTestId('dashboard-nav')).toBeNull()
  })

  it('shows the not-installed screen when no distros exist', async () => {
    snapshot.distros = []
    await renderDashboard()
    expect(screen.getByText('WSL is not available on this PC')).toBeTruthy()
  })
})

describe('ConfigCard', () => {
  it('opens parent Windows folder for .wslconfig and parent WSL folder for Linux files with selectPath', async () => {
    await renderDashboard(<ExplorerProbe />)
    fireEvent.click(navItem('configuration'))

    const buttons = screen.getAllByRole('button', { name: 'Show in Explorer' })
    expect(buttons).toHaveLength(2)

    // Windows-scoped row: opens parent directory in the Windows pane and selects the file.
    fireEvent.click(buttons[0])
    const probe = screen.getByTestId('explorer-request')
    expect(probe.textContent).toBe('windows:C:\\Users\\dev')
    expect(probe.getAttribute('data-select')).toBe('C:\\Users\\dev\\.wslconfig')

    // Linux-scoped row: opens parent directory in the WSL pane and selects the file.
    fireEvent.click(screen.getAllByRole('button', { name: 'Show in Explorer' })[1])
    expect(probe.textContent).toBe('linux:/home/dev')
    expect(probe.getAttribute('data-select')).toBe('/home/dev/.bashrc')
  })

  it('treats config-dir as a directory: hides Open in editor and opens ~/.config itself', async () => {
    snapshot.dashboard!.configuration = [
      ...snapshot.dashboard!.configuration,
      {
        id: 'config-dir',
        label: '~/.config',
        scope: 'linux',
        linuxPath: '/home/dev/.config',
        windowsPath: null,
        exists: true,
        readable: true,
        writable: true
      }
    ]
    await renderDashboard(<ExplorerProbe />)
    fireEvent.click(navItem('configuration'))

    const configRow = screen.getByText('~/.config').closest('.path-row') as HTMLElement
    expect(within(configRow).queryByRole('button', { name: 'Open in editor' })).toBeNull()

    fireEvent.click(within(configRow).getByRole('button', { name: 'Show in Explorer' }))
    const probe = screen.getByTestId('explorer-request')
    expect(probe.textContent).toBe('linux:/home/dev/.config')
    expect(probe.getAttribute('data-select')).toBe('')
  })

  it('opens readable Windows and Linux config files in EditorOverlay while preserving disabled and sudoedit states', async () => {
    snapshot.dashboard!.configuration = [
      ...snapshot.dashboard!.configuration,
      {
        id: 'missing',
        label: 'missing.conf',
        scope: 'linux',
        linuxPath: '/etc/missing.conf',
        windowsPath: null,
        exists: false,
        readable: false,
        writable: false
      },
      {
        id: 'secret',
        label: 'secret.conf',
        scope: 'linux',
        linuxPath: '/etc/secret.conf',
        windowsPath: null,
        exists: true,
        readable: false,
        writable: false
      }
    ]
    await renderDashboard(
      <>
        <ExplorerProbe />
        <PreparedProbe />
      </>
    )
    fireEvent.click(navItem('configuration'))

    const wslRow = screen.getByText('.wslconfig').closest('.path-row') as HTMLElement
    fireEvent.click(within(wslRow).getByRole('button', { name: 'Open in editor' }))
    expect(screen.getByTestId('open-file-request').textContent).toBe('windows:C:\\Users\\dev\\.wslconfig')

    const bashRow = screen.getByText('~/.bashrc').closest('.path-row') as HTMLElement
    fireEvent.click(within(bashRow).getByRole('button', { name: 'Open in editor' }))
    expect(screen.getByTestId('open-file-request').textContent).toBe('linux:/home/dev/.bashrc')

    // Read-only Linux file still prepares sudoedit in the Console.
    fireEvent.click(within(bashRow).getByRole('button', { name: 'Prepare sudoedit command' }))
    expect(screen.getByTestId('prepared').textContent).toBe("sudoedit '/home/dev/.bashrc'")

    const missingRow = screen.getByText('missing.conf').closest('.path-row') as HTMLElement
    expect(
      (within(missingRow).getByRole('button', { name: 'Show in Explorer' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (within(missingRow).getByRole('button', { name: 'Open in editor' }) as HTMLButtonElement).disabled
    ).toBe(true)

    const secretRow = screen.getByText('secret.conf').closest('.path-row') as HTMLElement
    expect(
      (within(secretRow).getByRole('button', { name: 'Show in Explorer' }) as HTMLButtonElement).disabled
    ).toBe(false)
    expect(
      (within(secretRow).getByRole('button', { name: 'Open in editor' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})

describe('OpenClawCard', () => {
  it('routes executable and data rows by each row own path side and respects automount.root', async () => {
    snapshot.dashboard!.wslSettings = {
      wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
      wslconfigExists: true,
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
          section: 'automount',
          key: 'root',
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
    const openclaw = {
      id: 'openclaw',
      displayName: 'OpenClaw',
      installed: true,
      executablePath: '/drives/c/Users/dev/AppData/Roaming/npm/openclaw',
      version: '2026.4.1',
      installMethod: 'npm',
      configPaths: ['/home/dev/.openclaw', '/drives/d/openclaw-state'],
      runningProcesses: 0,
      services: [],
      side: 'windows-mount' as const,
      shadowedByWindows: true
    }
    render(
      <AppStoreProvider>
        <OpenClawCard openclaw={openclaw} />
        <ExplorerProbe />
      </AppStoreProvider>
    )
    await flush()

    const buttons = screen.getAllByRole('button', { name: 'Show in Explorer' })
    expect(buttons).toHaveLength(3)

    // Executable under custom [automount] root -> converted to Windows path.
    fireEvent.click(buttons[0])
    const probe = screen.getByTestId('explorer-request')
    expect(probe.textContent).toBe('windows:C:\\Users\\dev\\AppData\\Roaming\\npm')
    expect(probe.getAttribute('data-select')).toBe('C:\\Users\\dev\\AppData\\Roaming\\npm\\openclaw')

    // ext4 data dir -> opens Linux pane even though openclaw.side is windows-mount.
    fireEvent.click(buttons[1])
    expect(probe.textContent).toBe('linux:/home/dev/.openclaw')
    expect(probe.getAttribute('data-select')).toBe('')

    // Windows-mount data dir -> opens converted Windows directory.
    fireEvent.click(buttons[2])
    expect(probe.textContent).toBe('windows:D:\\openclaw-state')
    expect(probe.getAttribute('data-select')).toBe('')
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

  it('distinguishes pending/failed from empty None and retains prior rows when refresh fails', async () => {
    const view = render(
      <AppStoreProvider>
        <ProcessesCard processes={[]} collectionStatus="pending" />
      </AppStoreProvider>
    )
    await flush()
    expect(screen.queryByText('None')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('not been collected yet')

    view.rerender(
      <AppStoreProvider>
        <ProcessesCard processes={[]} collectionStatus="failed" />
      </AppStoreProvider>
    )
    await flush()
    expect(screen.queryByText('None')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Could not query running processes')

    view.rerender(
      <AppStoreProvider>
        <ProcessesCard
          processes={makeSnapshot().dashboard!.processes}
          collectionStatus="succeeded"
          refreshFailed
        />
      </AppStoreProvider>
    )
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('latest process query failed')
    expect(screen.getByText(/node server\.js/)).toBeTruthy()

    view.rerender(
      <AppStoreProvider>
        <ProcessesCard processes={[]} collectionStatus="succeeded" refreshFailed={false} />
      </AppStoreProvider>
    )
    await flush()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('None')).toBeTruthy()
  })
})

describe('DashboardTab processes and ports failure/unknown lifecycle', () => {
  it('shows unknown/failed instead of 0 before first success, keeps stale list with notice on failure, shows 0 only on empty success, and resets on distro switch', async () => {
    let listener: ((snap: WslPadSnapshot) => void) | null = null
    api.onSnapshot.mockImplementation((cb: (snap: WslPadSnapshot) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    })

    const base = makeSnapshot()
    const baseDash = base.dashboard!

    // 1. Initial pending state (never collected yet)
    const pendingSnap: WslPadSnapshot = {
      ...base,
      dashboard: {
        ...baseDash,
        processes: [],
        processesCollectionStatus: 'pending',
        ports: [],
        portsCollectionStatus: 'pending',
        windowsPorts: []
      },
      warnings: []
    }
    api.getSnapshot.mockResolvedValue(pendingSnap)
    render(
      <AppStoreProvider>
        <DashboardTab />
      </AppStoreProvider>
    )
    await flush()

    expect(badgeText('processes')).not.toBe('0')
    expect(badgeText('ports')).not.toBe('0')
    expect(navItem('processes').querySelector('.dot-unknown')).not.toBeNull()
    expect(navItem('ports').querySelector('.dot-unknown')).not.toBeNull()

    fireEvent.click(navItem('processes'))
    expect(screen.getByTestId('dashboard-detail').textContent).toContain('Not collected yet')
    expect(screen.getByRole('status').textContent).toContain('not been collected yet')

    // 2. Initial query failure
    const initialFailSnap: WslPadSnapshot = {
      ...pendingSnap,
      dashboard: {
        ...pendingSnap.dashboard!,
        processesCollectionStatus: 'failed',
        portsCollectionStatus: 'failed'
      },
      warnings: [
        {
          id: 'runner-failed-processes',
          severity: 'warning',
          messageKey: 'warnings.runnerFailed',
          params: { command: 'processes' },
          message: 'A background query failed: processes'
        },
        {
          id: 'runner-failed-ports',
          severity: 'warning',
          messageKey: 'warnings.runnerFailed',
          params: { command: 'ports' },
          message: 'A background query failed: ports'
        }
      ]
    }
    act(() => listener?.(initialFailSnap))
    fireEvent.click(navItem('processes'))
    expect(navItem('processes').querySelector('.dot-err')).not.toBeNull()
    expect(navItem('ports').querySelector('.dot-err')).not.toBeNull()
    expect(screen.getByTestId('dashboard-detail').textContent).toContain('Query failed')
    expect(screen.getByRole('alert').textContent).toContain('Could not query running processes')

    fireEvent.click(navItem('ports'))
    expect(screen.getByTestId('dashboard-detail').textContent).toContain('Query failed')
    expect(screen.getByRole('alert').textContent).toContain('Could not query listening ports')

    // 3. Populated success followed by later refresh failure retains list + displays failure notice
    const staleSnap: WslPadSnapshot = {
      ...initialFailSnap,
      dashboard: {
        ...baseDash,
        processesCollectionStatus: 'succeeded',
        portsCollectionStatus: 'succeeded'
      }
    }
    act(() => listener?.(staleSnap))
    expect(badgeText('processes')).toBe('2')
    expect(navItem('processes').querySelector('.dash-nav-badge')?.className).toContain('badge-err')
    expect(badgeText('ports')).toBe('1')
    expect(navItem('ports').querySelector('.dash-nav-badge')?.className).toContain('badge-err')
    expect(screen.getByTestId('dashboard-detail').textContent).toContain('latest refresh failed')
    expect(screen.getByRole('alert').textContent).toContain('latest listening-port query failed')
    expect(screen.getByText('node')).toBeTruthy()

    // 4. Recovery clears failure alert and badge-err
    const recoveredSnap: WslPadSnapshot = {
      ...staleSnap,
      warnings: []
    }
    act(() => listener?.(recoveredSnap))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(navItem('ports').querySelector('.dash-nav-badge')?.className).not.toContain('badge-err')
    expect(screen.getByTestId('dashboard-detail').textContent).toContain('1 items')

    // 5. Genuine empty [] after success shows 0
    const genuineEmptySnap: WslPadSnapshot = {
      ...recoveredSnap,
      dashboard: {
        ...recoveredSnap.dashboard!,
        processes: [],
        ports: [],
        windowsPorts: []
      }
    }
    act(() => listener?.(genuineEmptySnap))
    expect(badgeText('processes')).toBe('0')
    expect(badgeText('ports')).toBe('0')
    expect(screen.getByText('None')).toBeTruthy()

    // 6. Distro switch snapshot resets back to pending unknown (not 0)
    const switchedSnap: WslPadSnapshot = {
      ...pendingSnap,
      selectedDistro: 'Debian',
      dashboard: {
        ...pendingSnap.dashboard!,
        distro: { ...baseDash.distro, name: 'Debian' }
      }
    }
    act(() => listener?.(switchedSnap))
    expect(navItem('processes').querySelector('.dot-unknown')).not.toBeNull()
    expect(navItem('ports').querySelector('.dot-unknown')).not.toBeNull()
    expect(screen.queryByText('None')).toBeNull()
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
