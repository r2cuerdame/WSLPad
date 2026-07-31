import { vi } from 'vitest'
import type {
  ClockInfo,
  ConfigurationFileInfo,
  DashboardSnapshot,
  DiskUsage,
  DistroDetails,
  DistroState,
  DistroSummary,
  DnsInfo,
  EnvironmentVariableInfo,
  FirewallInfo,
  HermesInfo,
  ImportantPathInfo,
  McpStatus,
  PortInfo,
  ProcessInfo,
  ResourceInfo,
  ServiceInfo,
  SystemInfo,
  ToolInfo,
  WslPadSnapshot
} from '@shared/types'

export function ubuntu(state: DistroState = 'Running'): DistroSummary {
  return { name: 'Ubuntu-24.04', state, wslVersion: 2, isDefault: true }
}

export function debian(state: DistroState = 'Stopped'): DistroSummary {
  return { name: 'Debian', state, wslVersion: 2, isDefault: false }
}

export function details(): DistroDetails {
  return {
    ...ubuntu(),
    osName: 'Ubuntu 24.04.2 LTS',
    uncPath: '\\\\wsl.localhost\\Ubuntu-24.04'
  }
}

export function system(over: Partial<SystemInfo> = {}): SystemInfo {
  return {
    kernel: '6.6.36-microsoft-standard-WSL2',
    hostname: 'devbox',
    user: 'dev',
    home: '/home/dev',
    shell: '/bin/bash',
    uptimeSeconds: 3600,
    systemdEnabled: true,
    ip: '172.20.0.2',
    windowsUserProfileLinux: '/mnt/c/Users/dev',
    ...over
  }
}

export function disk(mountPoint: string, usePercent: number | null): DiskUsage {
  return {
    mountPoint,
    exists: true,
    totalBytes: 100 * 1024 ** 3,
    usedBytes: 40 * 1024 ** 3,
    availableBytes: 60 * 1024 ** 3,
    usePercent
  }
}

export function resources(cpuPercent = 10, over: Partial<ResourceInfo> = {}): ResourceInfo {
  return {
    cpuPercent,
    cpuCount: 8,
    memTotalBytes: 8 * 1024 ** 3,
    memUsedBytes: 2 * 1024 ** 3,
    memAvailableBytes: 6 * 1024 ** 3,
    swapTotalBytes: 2 * 1024 ** 3,
    swapUsedBytes: 0,
    disks: [disk('/', 40)],
    loadAvg: [0.5, 0.4, 0.3],
    processCount: 42,
    ...over
  }
}

export function proc(pid = 100): ProcessInfo {
  return {
    pid,
    user: 'dev',
    cpuPercent: 1.5,
    memPercent: 0.8,
    elapsedSeconds: 120,
    command: 'node server.js',
    executablePath: '/usr/bin/node'
  }
}

export function svc(name = 'ssh', activeState = 'active'): ServiceInfo {
  return {
    name,
    scope: 'system',
    loadState: 'loaded',
    activeState,
    subState: activeState === 'active' ? 'running' : 'dead',
    enabled: 'enabled',
    description: `${name} service`
  }
}

export function port(portNumber = 8080, pid: number | null = 100): PortInfo {
  return {
    protocol: 'tcp',
    localAddress: '127.0.0.1',
    port: portNumber,
    pid,
    processName: 'node',
    listening: true,
    localhostUrl: `http://127.0.0.1:${portNumber}`,
    windowsBound: null,
    windowsProcess: null,
    reachability: 'unknown',
    reachabilityReason: null
  }
}

export function envVar(name: string, maskedValue: string): EnvironmentVariableInfo {
  return {
    name,
    maskedValue,
    valueLength: maskedValue.length,
    isSecret: false,
    isPathLike: false,
    fromWindows: false
  }
}

export function tool(over: Partial<ToolInfo> = {}): ToolInfo {
  return {
    id: 'node',
    displayName: 'Node.js',
    installed: true,
    executablePath: '/usr/bin/node',
    version: '20.11.0',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 1,
    services: [],
    side: 'ext4',
    shadowedByWindows: false,
    ...over
  }
}

export function hermes(over: Partial<HermesInfo> = {}): HermesInfo {
  return {
    installed: true,
    executablePath: '/home/dev/.local/bin/hermes',
    dataDir: '/home/dev/.hermes',
    venvPath: null,
    configPath: '/home/dev/.hermes/config.json',
    gatewayStatus: 'running',
    dashboardStatus: 'not-detected',
    mcpServerCount: 4,
    processes: [],
    ports: [],
    services: [],
    logPaths: [],
    platforms: [],
    profiles: [],
    activeSessions: null,
    scheduledJobs: null,
    dashboardPort: null,
    ...over
  }
}

export function pathInfo(): ImportantPathInfo {
  return {
    id: 'home',
    label: 'HOME',
    linuxPath: '/home/dev',
    windowsPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev',
    exists: true,
    isDirectory: true,
    side: 'ext4'
  }
}

export function cfg(): ConfigurationFileInfo {
  return {
    id: 'bashrc',
    label: '~/.bashrc',
    scope: 'linux',
    linuxPath: '/home/dev/.bashrc',
    windowsPath: null,
    exists: true,
    readable: true,
    writable: true
  }
}

export function mcpStatus(over: Partial<McpStatus> = {}): McpStatus {
  return {
    running: true,
    transport: 'http',
    endpoint: 'http://127.0.0.1:4923/mcp',
    port: 4923,
    connectedClients: 0,
    lastRequestAt: null,
    readOnly: true,
    tokenSet: true,
    error: null,
    ...over
  }
}

export function firewall(over: Partial<FirewallInfo> = {}): FirewallInfo {
  return {
    enabled: true,
    defaultInbound: 'Block',
    defaultOutbound: 'Allow',
    loopbackEnabled: true,
    ruleCount: 3,
    error: null,
    ...over
  }
}

export function clock(over: Partial<ClockInfo> = {}): ClockInfo {
  return {
    windowsIso: '2026-07-30T12:00:00.000Z',
    distroIso: '2026-07-30T11:59:13.000Z',
    skewSeconds: -47,
    ...over
  }
}

export function dns(over: Partial<DnsInfo> = {}): DnsInfo {
  return {
    resolvConfPath: '/etc/resolv.conf',
    isGeneratedSymlink: false,
    generateResolvConf: false,
    dnsTunneling: false,
    nameservers: ['10.255.255.254'],
    windowsAdapterDns: ['192.168.1.1'],
    error: null,
    ...over
  }
}

export function makeDashboard(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    distro: details(),
    system: system(),
    resources: resources(),
    disk: null,
    wslSettings: null,
    memoryDetail: null,
    paths: [pathInfo()],
    configuration: [cfg()],
    tools: [tool()],
    docker: null,
    zoneIdentifier: null,
    terminalProfiles: null,
    hermes: null,
    environment: [envVar('PATH', '/usr/bin:/usr/local/bin')],
    processes: [proc()],
    services: [svc()],
    ports: [port()],
    windowsPorts: [],
    portProxy: null,
    firewall: null,
    clock: null,
    dns: null,
    warnings: [],
    ...over
  }
}

export function makeSnapshot(over: Partial<WslPadSnapshot> = {}): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-30T12:00:00.000Z',
    selectedDistro: 'Ubuntu-24.04',
    distros: [ubuntu(), debian()],
    dashboard: makeDashboard(),
    explorer: { distro: 'Ubuntu-24.04', currentPath: '/home/dev/.hermes', showHidden: false },
    terminal: { distro: 'Ubuntu-24.04', cwd: '/home/dev', status: 'ready' },
    mcp: mcpStatus(),
    warnings: [],
    ...over
  }
}

export function makeProvider() {
  return {
    isAvailable: vi.fn(async () => true),
    listDistros: vi.fn(async () => [ubuntu(), debian()]),
    getDistroDetails: vi.fn(async () => details()),
    getSystemInfo: vi.fn(async () => system()),
    getResources: vi.fn(async () => resources()),
    getProcesses: vi.fn(async () => [proc()]),
    getServices: vi.fn(async () => [svc()]),
    getPorts: vi.fn(async () => [port()]),
    getEnvironment: vi.fn(async () => [envVar('PATH', '/usr/bin')]),
    revealEnv: vi.fn(async () => null),
    getImportantPaths: vi.fn(async () => [pathInfo()]),
    getConfigFiles: vi.fn(async () => [cfg()]),
    getTools: vi.fn(async () => [tool()]),
    getHermes: vi.fn(async () => hermes())
  }
}

export type FakeProvider = ReturnType<typeof makeProvider>
