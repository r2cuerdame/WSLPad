import type {
  DashboardSnapshot,
  FileEntry,
  FileEntryType,
  FileStat,
  TextFileContent,
  WslPadSnapshot
} from '@shared/types'
import type { McpDeps } from '../../../src/main/mcp/server'
import {
  ExplorerError,
  type ExplorerBackend,
  type ExplorerListOpts
} from '../../../src/main/wsl/contracts'

export const RAW_SECRET = 'raw-secret-value-should-never-leak'

export const PRIVATE_KEY_CONTENT = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
  '-----END OPENSSH PRIVATE KEY-----',
  ''
].join('\n')

const MTIME = '2026-07-30T10:00:00.000Z'
const ATIME = '2026-07-30T09:00:00.000Z'

function entry(
  dir: string,
  name: string,
  type: FileEntryType,
  sizeBytes: number | null
): FileEntry {
  return {
    name,
    path: dir === '/' ? `/${name}` : `${dir}/${name}`,
    type,
    sizeBytes,
    mtime: MTIME,
    owner: 'user',
    group: 'user',
    permissions: type === 'directory' ? 'rwxr-xr-x' : 'rw-r--r--',
    permissionsOctal: type === 'directory' ? '755' : '644',
    isHidden: name.startsWith('.'),
    symlinkTarget: null,
    targetType: null
  }
}

/**
 * Deterministic in-memory ExplorerBackend for MCP tests. Read APIs are backed
 * by a small fixture filesystem; every mutating API throws — the MCP layer
 * must never reach them.
 */
export class FakeExplorer implements ExplorerBackend {
  private dirs = new Map<string, FileEntry[]>()
  private files = new Map<string, { content: string; binary: boolean }>()

  constructor() {
    this.dirs.set('/', [
      entry('/', 'home', 'directory', null),
      entry('/', 'big', 'directory', null)
    ])
    this.dirs.set('/home', [entry('/home', 'user', 'directory', null)])
    this.dirs.set('/home/user', [
      entry('/home/user', 'projects', 'directory', null),
      entry('/home/user', '.ssh', 'directory', null),
      entry('/home/user', '.hermes', 'directory', null),
      entry('/home/user', 'notes.txt', 'file', 26),
      entry('/home/user', '.bashrc', 'file', 96),
      entry('/home/user', '.env', 'file', 48),
      entry('/home/user', 'blob.bin', 'file', 4096)
    ])
    this.dirs.set('/home/user/projects', [entry('/home/user/projects', 'app', 'directory', null)])
    this.dirs.set('/home/user/projects/app', [
      entry('/home/user/projects/app', 'readme.md', 'file', 6)
    ])
    this.dirs.set('/home/user/.ssh', [
      entry('/home/user/.ssh', 'id_rsa', 'file', PRIVATE_KEY_CONTENT.length),
      entry('/home/user/.ssh', 'id_rsa.pub', 'file', 80),
      entry('/home/user/.ssh', 'known_hosts', 'file', 40)
    ])
    this.dirs.set('/home/user/.hermes', [])
    // 600 subdirectories so GetDirectoryTree must hit its 500-entry cap.
    this.dirs.set(
      '/big',
      Array.from({ length: 600 }, (_, i) =>
        entry('/big', `d${String(i).padStart(3, '0')}`, 'directory', null)
      )
    )

    this.files.set('/home/user/notes.txt', {
      content: 'hello from wslpad fixture\n',
      binary: false
    })
    this.files.set('/home/user/.bashrc', {
      content:
        'export PATH="$HOME/.local/bin:$PATH"\nexport GITHUB_TOKEN=ghp_fixture123\nalias ll="ls -la"\n',
      binary: false
    })
    this.files.set('/home/user/.env', {
      content: `API_TOKEN=${RAW_SECRET}\nEDITOR=vim\n`,
      binary: false
    })
    this.files.set('/home/user/.ssh/id_rsa', { content: PRIVATE_KEY_CONTENT, binary: false })
    this.files.set('/home/user/.ssh/id_rsa.pub', {
      content: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA user@devbox\n',
      binary: false
    })
    this.files.set('/home/user/.ssh/known_hosts', {
      content: 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n',
      binary: false
    })
    this.files.set('/home/user/blob.bin', { content: '\u0000\u0001\u0002', binary: true })
    this.files.set('/home/user/projects/app/readme.md', { content: '# app\n', binary: false })
  }

  async homeDir(): Promise<string> {
    return '/home/user'
  }

  async list(_distro: string, path: string, opts?: ExplorerListOpts): Promise<FileEntry[]> {
    const entries = this.dirs.get(path)
    if (entries === undefined) {
      throw new ExplorerError('ENOENT', path, `no such directory: ${path}`)
    }
    return opts?.showHidden === true ? entries : entries.filter((e) => !e.isHidden)
  }

  async tree(_distro: string, path: string): Promise<FileEntry[]> {
    // Lazy tree semantics: unknown paths simply have no known subdirectories.
    return (this.dirs.get(path) ?? []).filter((e) => e.type === 'directory')
  }

  async stat(distro: string, path: string): Promise<FileStat> {
    if (path === '/') {
      return {
        ...entry('', '/', 'directory', null),
        name: '/',
        path: '/',
        isHidden: false,
        inode: 2,
        atime: ATIME,
        windowsPath: `\\\\wsl.localhost\\${distro}\\`
      }
    }
    const slash = path.lastIndexOf('/')
    const parent = slash === 0 ? '/' : path.slice(0, slash)
    const found = this.dirs.get(parent)?.find((e) => e.path === path)
    if (found === undefined) {
      throw new ExplorerError('ENOENT', path, `no such file or directory: ${path}`)
    }
    return {
      ...found,
      inode: 100001,
      atime: ATIME,
      windowsPath: `\\\\wsl.localhost\\${distro}${path.replace(/\//g, '\\')}`
    }
  }

  async readText(_distro: string, path: string, maxBytes: number): Promise<TextFileContent> {
    const file = this.files.get(path)
    if (file === undefined) {
      throw new ExplorerError('ENOENT', path, `no such file: ${path}`)
    }
    if (file.binary) {
      throw new ExplorerError('BINARY', path, `not a text file: ${path}`)
    }
    const truncated = file.content.length > maxBytes
    return {
      content: truncated ? file.content.slice(0, maxBytes) : file.content,
      encoding: 'utf-8',
      truncated,
      sizeBytes: file.content.length,
      writable: true
    }
  }

  async convertPath(distro: string, input: string, to: 'windows' | 'linux'): Promise<string> {
    if (to === 'windows') {
      if (input.startsWith('/mnt/c/')) {
        return `C:\\${input.slice('/mnt/c/'.length).replace(/\//g, '\\')}`
      }
      if (input.startsWith('/')) {
        return `\\\\wsl.localhost\\${distro}${input.replace(/\//g, '\\')}`
      }
      throw new ExplorerError('UNKNOWN', input, `cannot convert to a Windows path: ${input}`)
    }
    if (/^[Cc]:[\\/]/.test(input)) {
      return `/mnt/c/${input.slice(3).replace(/\\/g, '/')}`
    }
    const unc = `\\\\wsl.localhost\\${distro}\\`
    if (input.startsWith(unc)) {
      return `/${input.slice(unc.length).replace(/\\/g, '/')}`
    }
    throw new ExplorerError('UNKNOWN', input, `cannot convert to a Linux path: ${input}`)
  }

  onProgress(): () => void {
    return () => {}
  }

  async search(): Promise<FileEntry[]> {
    throw new ExplorerError('UNKNOWN', '', 'search is not implemented in the MCP fixture')
  }

  // Mutating APIs — MCP is read-only and must never call these.
  async mkdir(): Promise<void> {
    throw this.mutation()
  }

  async createFile(): Promise<void> {
    throw this.mutation()
  }

  async rename(): Promise<void> {
    throw this.mutation()
  }

  async copyMove(): Promise<string> {
    throw this.mutation()
  }

  async trash(): Promise<void> {
    throw this.mutation()
  }

  async remove(): Promise<void> {
    throw this.mutation()
  }

  async writeText(): Promise<void> {
    throw this.mutation()
  }

  async importFromWindows(): Promise<string> {
    throw this.mutation()
  }

  async exportToWindows(): Promise<string> {
    throw this.mutation()
  }

  async cancelOp(): Promise<void> {
    throw this.mutation()
  }

  private mutation(): ExplorerError {
    return new ExplorerError('UNKNOWN', '', 'mutation attempted through the read-only MCP fixture')
  }
}

export function makeDashboard(): DashboardSnapshot {
  return {
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
      user: 'user',
      home: '/home/user',
      shell: '/bin/bash',
      uptimeSeconds: 5400,
      systemdEnabled: true,
      ip: '172.20.10.2',
      windowsUserProfileLinux: '/mnt/c/Users/user'
    },
    resources: {
      cpuPercent: 12.5,
      cpuCount: 8,
      memTotalBytes: 8589934592,
      memUsedBytes: 2147483648,
      memAvailableBytes: 6442450944,
      swapTotalBytes: 2147483648,
      swapUsedBytes: 0,
      disks: [
        {
          mountPoint: '/',
          exists: true,
          totalBytes: 268435456000,
          usedBytes: 53687091200,
          availableBytes: 214748364800,
          usePercent: 20
        }
      ],
      loadAvg: [0.42, 0.31, 0.25],
      processCount: 2
    },
    paths: [
      {
        id: 'home',
        label: 'HOME',
        linuxPath: '/home/user',
        windowsPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\user',
        exists: true,
        isDirectory: true
      }
    ],
    configuration: [
      {
        id: 'wsl-conf',
        label: '/etc/wsl.conf',
        scope: 'linux',
        linuxPath: '/etc/wsl.conf',
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
        version: 'v20.18.0',
        installMethod: 'apt',
        configPaths: [],
        runningProcesses: 1,
        services: []
      },
      {
        id: 'hermes',
        displayName: 'Hermes',
        installed: true,
        executablePath: '/home/user/.local/bin/hermes',
        version: '1.4.0',
        installMethod: 'pipx',
        configPaths: ['/home/user/.hermes/config.json'],
        runningProcesses: 1,
        services: ['hermes-gateway']
      }
    ],
    hermes: {
      installed: true,
      executablePath: '/home/user/.local/bin/hermes',
      dataDir: '/home/user/.hermes',
      venvPath: null,
      configPath: '/home/user/.hermes/config.json',
      gatewayStatus: 'running',
      dashboardStatus: 'not-detected',
      mcpServerCount: 4,
      processes: [{ pid: 4321, command: 'hermes gateway' }],
      ports: [8600],
      services: ['hermes-gateway'],
      logPaths: ['/home/user/.hermes/logs']
    },
    environment: [
      {
        name: 'PATH',
        maskedValue: '/usr/local/bin:/usr/bin',
        valueLength: 23,
        isSecret: false,
        isPathLike: true,
        fromWindows: false
      },
      {
        // Deliberately unmasked raw value: proves the MCP layer re-masks
        // secrets even if a collector ever slipped one through.
        name: 'API_TOKEN',
        maskedValue: RAW_SECRET,
        valueLength: RAW_SECRET.length,
        isSecret: true,
        isPathLike: false,
        fromWindows: false
      }
    ],
    processes: [
      {
        pid: 1234,
        user: 'user',
        cpuPercent: 1.5,
        memPercent: 2.1,
        elapsedSeconds: 3600,
        command: 'node server.js',
        executablePath: '/usr/bin/node'
      },
      {
        pid: 4321,
        user: 'user',
        cpuPercent: 0.3,
        memPercent: 1,
        elapsedSeconds: 5000,
        command: 'hermes gateway',
        executablePath: '/home/user/.local/bin/hermes'
      }
    ],
    services: [
      {
        name: 'hermes-gateway',
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
        port: 8600,
        pid: 4321,
        processName: 'hermes',
        listening: true,
        localhostUrl: 'http://127.0.0.1:8600'
      }
    ],
    warnings: [
      {
        id: 'fixture-warning',
        severity: 'warning',
        messageKey: 'warnings.fixture',
        message: 'fixture warning'
      }
    ]
  }
}

export function makeSnapshot(overrides: Partial<WslPadSnapshot> = {}): WslPadSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-30T10:00:00.000Z',
    selectedDistro: 'Ubuntu-24.04',
    distros: [
      { name: 'Ubuntu-24.04', state: 'Running', wslVersion: 2, isDefault: true },
      { name: 'Debian', state: 'Stopped', wslVersion: 2, isDefault: false }
    ],
    dashboard: makeDashboard(),
    explorer: { distro: 'Ubuntu-24.04', currentPath: '/home/user', showHidden: false },
    terminal: { distro: 'Ubuntu-24.04', cwd: '/home/user', status: 'ready' },
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
    warnings: [],
    ...overrides
  }
}

export function makeDeps(
  overrides: { snapshot?: WslPadSnapshot; selectedDistro?: string | null } = {}
): McpDeps {
  const snapshot = overrides.snapshot ?? makeSnapshot()
  return {
    getSnapshot: () => snapshot,
    explorer: new FakeExplorer(),
    getSelectedDistro: () =>
      'selectedDistro' in overrides ? (overrides.selectedDistro ?? null) : snapshot.selectedDistro
  }
}
