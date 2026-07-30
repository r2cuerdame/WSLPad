/**
 * Deterministic fixture world for WSLPAD_FIXTURE_MODE=1 (goal.md §18.4).
 * Every function builds fresh plain objects so callers can never mutate
 * shared state — two providers always observe identical data.
 */
import type {
  ConfigurationFileInfo,
  DistroDetails,
  DistroSummary,
  HermesInfo,
  ImportantPathInfo,
  PortInfo,
  ProcessInfo,
  ResourceInfo,
  ServiceInfo,
  SystemInfo,
  ToolInfo
} from '@shared/types'
import { CONFIG_FILE_SPECS, IMPORTANT_PATH_SPECS, TOOL_SPECS } from '@shared/constants'

export const FIXTURE_UBUNTU = 'Ubuntu-24.04'
export const FIXTURE_DEBIAN = 'Debian'
export const FIXTURE_USER = 'dev'
export const FIXTURE_HOME = '/home/dev'
export const FIXTURE_WINDOWS_USERPROFILE = 'C:\\Users\\dev'

/** Fixed ISO stamps so listings and snapshots are byte-identical across runs. */
export const FIXTURE_SEED_MTIME = '2024-06-01T10:00:00.000Z'
export const FIXTURE_NEW_MTIME = '2024-06-15T12:00:00.000Z'
/** freedesktop .trashinfo DeletionDate format (no zone suffix). */
export const FIXTURE_TRASH_DATE = '2024-06-15T12:00:00'

export type FixtureDistroName = typeof FIXTURE_UBUNTU | typeof FIXTURE_DEBIAN

export function isFixtureDistro(name: string): name is FixtureDistroName {
  return name === FIXTURE_UBUNTU || name === FIXTURE_DEBIAN
}

export function assertFixtureDistro(name: string): asserts name is FixtureDistroName {
  if (!isFixtureDistro(name)) throw new Error(`Unknown fixture distro: ${JSON.stringify(name)}`)
}

export function toUncPath(distro: string, linuxPath: string): string {
  return `\\\\wsl.localhost\\${distro}` + linuxPath.replace(/\//g, '\\')
}

function expandHome(path: string): string {
  if (path === '~') return FIXTURE_HOME
  if (path.startsWith('~/')) return FIXTURE_HOME + path.slice(1)
  return path
}

export function fixtureDistros(): DistroSummary[] {
  return [
    { name: FIXTURE_UBUNTU, state: 'Running', wslVersion: 2, isDefault: true },
    { name: FIXTURE_DEBIAN, state: 'Stopped', wslVersion: 1, isDefault: false }
  ]
}

export function fixtureDistroDetails(distro: FixtureDistroName): DistroDetails {
  if (distro === FIXTURE_UBUNTU) {
    return {
      name: FIXTURE_UBUNTU,
      state: 'Running',
      wslVersion: 2,
      isDefault: true,
      osName: 'Ubuntu 24.04.2 LTS',
      uncPath: toUncPath(FIXTURE_UBUNTU, '')
    }
  }
  return {
    name: FIXTURE_DEBIAN,
    state: 'Stopped',
    wslVersion: 1,
    isDefault: false,
    osName: 'Debian GNU/Linux 12 (bookworm)',
    uncPath: toUncPath(FIXTURE_DEBIAN, '')
  }
}

export function fixtureSystemInfo(distro: FixtureDistroName): SystemInfo {
  if (distro === FIXTURE_UBUNTU) {
    return {
      kernel: '6.6.36-microsoft-standard-WSL2',
      hostname: 'wslpad-fixture',
      user: FIXTURE_USER,
      home: FIXTURE_HOME,
      shell: '/bin/bash',
      uptimeSeconds: 86400,
      systemdEnabled: true,
      ip: '172.20.144.2',
      windowsUserProfileLinux: '/mnt/c/Users/dev'
    }
  }
  // Stopped distro: only statically-known facts are available.
  return {
    kernel: null,
    hostname: null,
    user: FIXTURE_USER,
    home: FIXTURE_HOME,
    shell: '/bin/bash',
    uptimeSeconds: null,
    systemdEnabled: false,
    ip: null,
    windowsUserProfileLinux: '/mnt/c/Users/dev'
  }
}

const GIB = 1024 ** 3

export function fixtureResources(distro: FixtureDistroName): ResourceInfo {
  if (distro !== FIXTURE_UBUNTU) {
    return {
      cpuPercent: null,
      cpuCount: null,
      memTotalBytes: null,
      memUsedBytes: null,
      memAvailableBytes: null,
      swapTotalBytes: null,
      swapUsedBytes: null,
      disks: [],
      loadAvg: null,
      processCount: null
    }
  }
  const memTotal = Math.round(15.5 * GIB)
  const memUsed = Math.round(3.2 * GIB)
  return {
    cpuPercent: 7.5,
    cpuCount: 8,
    memTotalBytes: memTotal,
    memUsedBytes: memUsed,
    memAvailableBytes: memTotal - memUsed,
    swapTotalBytes: 4 * GIB,
    swapUsedBytes: Math.round(0.25 * GIB),
    disks: [
      {
        mountPoint: '/',
        exists: true,
        totalBytes: 268435456000,
        usedBytes: 112742891520,
        availableBytes: 155692564480,
        usePercent: 42
      },
      {
        mountPoint: '/home',
        exists: true,
        totalBytes: 268435456000,
        usedBytes: 112742891520,
        availableBytes: 155692564480,
        usePercent: 42
      },
      {
        mountPoint: '/mnt/c',
        exists: true,
        totalBytes: 536870912000,
        usedBytes: 381178347520,
        availableBytes: 155692564480,
        usePercent: 71
      }
    ],
    loadAvg: [0.12, 0.08, 0.05],
    processCount: 12
  }
}

export function fixtureProcesses(distro: FixtureDistroName): ProcessInfo[] {
  if (distro !== FIXTURE_UBUNTU) return []
  return [
    {
      pid: 1,
      user: 'root',
      cpuPercent: 0,
      memPercent: 0.1,
      elapsedSeconds: 86400,
      command: '/sbin/init',
      executablePath: '/usr/lib/systemd/systemd'
    },
    {
      pid: 88,
      user: 'root',
      cpuPercent: 0,
      memPercent: 0.2,
      elapsedSeconds: 86390,
      command: '/usr/lib/systemd/systemd-journald',
      executablePath: '/usr/lib/systemd/systemd-journald'
    },
    {
      pid: 120,
      user: 'root',
      cpuPercent: 0,
      memPercent: 0.1,
      elapsedSeconds: 86380,
      command: '/usr/lib/systemd/systemd-udevd',
      executablePath: '/usr/lib/systemd/systemd-udevd'
    },
    {
      pid: 310,
      user: 'root',
      cpuPercent: 0,
      memPercent: 0.1,
      elapsedSeconds: 86300,
      command: 'sshd: /usr/sbin/sshd -D [listener]',
      executablePath: '/usr/sbin/sshd'
    },
    {
      pid: 402,
      user: 'root',
      cpuPercent: 0.5,
      memPercent: 1.8,
      elapsedSeconds: 86200,
      command: '/usr/bin/dockerd -H fd://',
      executablePath: '/usr/bin/dockerd'
    },
    {
      pid: 610,
      user: 'avahi',
      cpuPercent: 0,
      memPercent: 0.1,
      elapsedSeconds: 86100,
      command: 'avahi-daemon: running [wslpad-fixture.local]',
      executablePath: '/usr/sbin/avahi-daemon'
    },
    {
      pid: 850,
      user: FIXTURE_USER,
      cpuPercent: 0,
      memPercent: 0.2,
      elapsedSeconds: 43200,
      command: '/usr/lib/systemd/systemd --user',
      executablePath: '/usr/lib/systemd/systemd'
    },
    {
      pid: 4242,
      user: FIXTURE_USER,
      cpuPercent: 1.2,
      memPercent: 2.4,
      elapsedSeconds: 7200,
      command: '/home/dev/.local/bin/hermes gateway --port 8790',
      executablePath: '/home/dev/.local/bin/hermes'
    },
    {
      pid: 5100,
      user: FIXTURE_USER,
      cpuPercent: 0.8,
      memPercent: 3.1,
      elapsedSeconds: 3600,
      command: 'node /home/dev/projects/wslpad-demo/src/index.ts',
      executablePath: '/home/dev/.nvm/versions/node/v20.19.0/bin/node'
    },
    {
      pid: 5230,
      user: FIXTURE_USER,
      cpuPercent: 0,
      memPercent: 0.3,
      elapsedSeconds: 3500,
      command: '-bash',
      executablePath: '/usr/bin/bash'
    },
    {
      pid: 6120,
      user: FIXTURE_USER,
      cpuPercent: 0.1,
      memPercent: 0.5,
      elapsedSeconds: 1800,
      command: 'vim /home/dev/notes.md',
      executablePath: '/usr/bin/vim'
    },
    {
      pid: 7010,
      user: FIXTURE_USER,
      cpuPercent: 0,
      memPercent: 0.2,
      elapsedSeconds: 600,
      command: 'tmux: server',
      executablePath: '/usr/bin/tmux'
    }
  ]
}

export function fixtureServices(distro: FixtureDistroName): ServiceInfo[] {
  if (distro !== FIXTURE_UBUNTU) return []
  return [
    {
      name: 'ssh.service',
      scope: 'system',
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      enabled: 'enabled',
      description: 'OpenBSD Secure Shell server'
    },
    {
      name: 'hermes-gateway.service',
      scope: 'user',
      loadState: 'loaded',
      activeState: 'active',
      subState: 'running',
      enabled: 'enabled',
      description: 'Hermes Gateway'
    },
    {
      name: 'broken.service',
      scope: 'system',
      loadState: 'loaded',
      activeState: 'failed',
      subState: 'failed',
      enabled: 'enabled',
      description: 'Fixture service that always fails'
    }
  ]
}

export function fixturePorts(distro: FixtureDistroName): PortInfo[] {
  if (distro !== FIXTURE_UBUNTU) return []
  return [
    {
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      port: 22,
      pid: 310,
      processName: 'sshd',
      listening: true,
      localhostUrl: null
    },
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      port: 8790,
      pid: 4242,
      processName: 'hermes',
      listening: true,
      localhostUrl: 'http://127.0.0.1:8790'
    },
    {
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      port: 8080,
      pid: 5100,
      processName: 'node',
      listening: true,
      localhostUrl: 'http://127.0.0.1:8080'
    },
    {
      protocol: 'udp',
      localAddress: '0.0.0.0',
      port: 5353,
      pid: 610,
      processName: 'avahi-daemon',
      listening: true,
      localhostUrl: null
    }
  ]
}

const FIXTURE_PATH_VALUE = [
  '/home/dev/.local/bin',
  '/home/dev/.nvm/versions/node/v20.19.0/bin',
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
  '/mnt/c/Windows/System32'
].join(':')

/** Raw environment values; secrets stay raw here and are masked by the provider. */
export function fixtureEnvRaw(distro: FixtureDistroName): Record<string, string> {
  if (distro !== FIXTURE_UBUNTU) return {}
  return {
    PATH: FIXTURE_PATH_VALUE,
    HOME: FIXTURE_HOME,
    USER: FIXTURE_USER,
    SHELL: '/bin/bash',
    LANG: 'C.UTF-8',
    WSL_DISTRO_NAME: FIXTURE_UBUNTU,
    EDITOR: 'vim',
    FIXTURE_API_KEY: 'super-secret-fixture-value',
    DB_PASSWORD: 'hunter2'
  }
}

export function fixtureImportantPaths(distro: FixtureDistroName): ImportantPathInfo[] {
  return IMPORTANT_PATH_SPECS.map((spec) => {
    const linuxPath = expandHome(spec.path)
    const exists = !(distro === FIXTURE_DEBIAN && spec.id === 'hermes')
    return {
      id: spec.id,
      label: spec.label,
      linuxPath,
      windowsPath: exists ? toUncPath(distro, linuxPath) : null,
      exists,
      isDirectory: exists ? true : null
    }
  })
}

export function fixtureConfigFiles(distro: FixtureDistroName): ConfigurationFileInfo[] {
  return CONFIG_FILE_SPECS.map((spec) => {
    if (spec.scope === 'windows') {
      return {
        id: spec.id,
        label: spec.label,
        scope: 'windows' as const,
        linuxPath: null,
        windowsPath: `${FIXTURE_WINDOWS_USERPROFILE}\\.wslconfig`,
        exists: true,
        readable: true,
        writable: true
      }
    }
    const linuxPath = expandHome(spec.path)
    return {
      id: spec.id,
      label: spec.label,
      scope: 'linux' as const,
      linuxPath,
      windowsPath: toUncPath(distro, linuxPath),
      exists: true,
      readable: true,
      writable: !linuxPath.startsWith('/etc')
    }
  })
}

interface ToolOverride {
  executablePath: string
  version: string
  installMethod: string
  configPaths: string[]
  runningProcesses: number
  services: string[]
}

const UBUNTU_TOOLS: Record<string, ToolOverride> = {
  hermes: {
    executablePath: '/home/dev/.local/bin/hermes',
    version: '0.9.2',
    installMethod: 'user-local',
    configPaths: ['/home/dev/.hermes/config.json'],
    runningProcesses: 1,
    services: ['hermes-gateway.service']
  },
  node: {
    executablePath: '/home/dev/.nvm/versions/node/v20.19.0/bin/node',
    version: '20.19.0',
    installMethod: 'nvm',
    configPaths: [],
    runningProcesses: 1,
    services: []
  },
  python: {
    executablePath: '/usr/bin/python3',
    version: '3.12.3',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  git: {
    executablePath: '/usr/bin/git',
    version: '2.43.0',
    installMethod: 'apt',
    configPaths: ['/home/dev/.gitconfig'],
    runningProcesses: 0,
    services: []
  },
  docker: {
    executablePath: '/usr/bin/docker',
    version: '26.1.4',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 1,
    services: []
  }
}

export function fixtureTools(distro: FixtureDistroName): ToolInfo[] {
  return TOOL_SPECS.map((spec) => {
    const found = distro === FIXTURE_UBUNTU ? UBUNTU_TOOLS[spec.id] : undefined
    if (!found) {
      return {
        id: spec.id,
        displayName: spec.displayName,
        installed: false,
        executablePath: null,
        version: null,
        installMethod: null,
        configPaths: [],
        runningProcesses: 0,
        services: []
      }
    }
    return {
      id: spec.id,
      displayName: spec.displayName,
      installed: true,
      executablePath: found.executablePath,
      version: found.version,
      installMethod: found.installMethod,
      configPaths: [...found.configPaths],
      runningProcesses: found.runningProcesses,
      services: [...found.services]
    }
  })
}

export function fixtureHermes(distro: FixtureDistroName): HermesInfo | null {
  if (distro !== FIXTURE_UBUNTU) return null
  return {
    installed: true,
    executablePath: '/home/dev/.local/bin/hermes',
    dataDir: '/home/dev/.hermes',
    venvPath: null,
    configPath: '/home/dev/.hermes/config.json',
    gatewayStatus: 'running',
    dashboardStatus: 'not-detected',
    mcpServerCount: 4,
    processes: [{ pid: 4242, command: '/home/dev/.local/bin/hermes gateway --port 8790' }],
    ports: [8790],
    services: ['hermes-gateway.service'],
    logPaths: ['/home/dev/.hermes/logs/gateway.log']
  }
}
