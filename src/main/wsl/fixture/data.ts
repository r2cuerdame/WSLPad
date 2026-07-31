/**
 * Deterministic fixture world for WSLPAD_FIXTURE_MODE=1 (goal.md §18.4).
 * Every function builds fresh plain objects so callers can never mutate
 * shared state — two providers always observe identical data.
 */
import type {
  ClockInfo,
  ConfigurationFileInfo,
  DiskImageInfo,
  DistroDetails,
  DistroSummary,
  DnsInfo,
  FirewallInfo,
  HermesInfo,
  ImportantPathInfo,
  MemoryReconciliation,
  PortInfo,
  ProcessInfo,
  ResourceInfo,
  ServiceInfo,
  SystemInfo,
  ToolInfo,
  WindowsPortInfo,
  DockerInfo,
  PortProxyInfo,
  WslConfigInfo
} from '@shared/types'
import { CONFIG_FILE_SPECS, IMPORTANT_PATH_SPECS, TOOL_SPECS } from '@shared/constants'
import { classifyPathSide } from '../contracts'

export const FIXTURE_UBUNTU = 'Ubuntu-24.04'
export const FIXTURE_DEBIAN = 'Debian'
export const FIXTURE_USER = 'dev'
export const FIXTURE_HOME = '/home/dev'
export const FIXTURE_WINDOWS_USERPROFILE = 'C:\\Users\\dev'

/** Fixed ISO stamps so listings and snapshots are byte-identical across runs. */
export const FIXTURE_SEED_MTIME = '2024-06-01T10:00:00.000Z'
export const FIXTURE_NEW_MTIME = '2024-06-15T12:00:00.000Z'
/** Frozen "now" for the clock card — never Date.now(), or nothing is stable. */
export const FIXTURE_WINDOWS_NOW = '2024-06-15T12:00:00.000Z'
/** 47 s behind Windows: enough to break TLS, small enough to be invisible. */
export const FIXTURE_DISTRO_NOW = '2024-06-15T11:59:13.000Z'
export const FIXTURE_CLOCK_SKEW_SECONDS = -47
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
const MIB = 1024 ** 2
const gib = (n: number): number => Math.round(n * GIB)

/**
 * One filesystem story shared by the Resources card and the Disk card: a 250 GB
 * ext4 holding 23 GB of files inside a .vhdx that grew to 80.5 GB and never
 * shrank back. Both cards must quote the same numbers or neither is trusted.
 */
const FS_SIZE_BYTES = 268435456000
const FS_USED_BYTES = 24696061952
const FS_AVAILABLE_BYTES = FS_SIZE_BYTES - FS_USED_BYTES
const FS_USE_PERCENT = 9
const VHDX_BYTES = 86436216832

/** Memory story: Linux sees 922 MB in use while Windows holds 7.2 GB for vmmem. */
const GUEST_TOTAL_BYTES = gib(16.4)
const GUEST_USED_BYTES = gib(0.9)
const GUEST_CACHE_BYTES = gib(6.1)
const GUEST_FREE_BYTES = gib(9.4)
const SWAP_TOTAL_BYTES = 4 * GIB
const SWAP_USED_BYTES = gib(0.25)

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
  return {
    cpuPercent: 7.5,
    cpuCount: 8,
    memTotalBytes: GUEST_TOTAL_BYTES,
    memUsedBytes: GUEST_USED_BYTES,
    memAvailableBytes: GUEST_CACHE_BYTES + GUEST_FREE_BYTES,
    swapTotalBytes: SWAP_TOTAL_BYTES,
    swapUsedBytes: SWAP_USED_BYTES,
    disks: [
      {
        mountPoint: '/',
        exists: true,
        totalBytes: FS_SIZE_BYTES,
        usedBytes: FS_USED_BYTES,
        availableBytes: FS_AVAILABLE_BYTES,
        usePercent: FS_USE_PERCENT
      },
      {
        mountPoint: '/home',
        exists: true,
        totalBytes: FS_SIZE_BYTES,
        usedBytes: FS_USED_BYTES,
        availableBytes: FS_AVAILABLE_BYTES,
        usePercent: FS_USE_PERCENT
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

export function fixtureDiskImage(distro: FixtureDistroName): DiskImageInfo {
  if (distro !== FIXTURE_UBUNTU) {
    // WSL 1 stores files straight on NTFS — there is no virtual disk at all.
    return {
      distro,
      vhdxPath: null,
      basePath: null,
      vhdxBytes: null,
      allocatedBytes: null,
      sparse: null,
      fsSizeBytes: null,
      fsUsedBytes: null,
      reclaimableBytes: null,
      error: 'WSL 1 distributions do not use a virtual disk image'
    }
  }
  const basePath = `${FIXTURE_WINDOWS_USERPROFILE}\\AppData\\Local\\wsl\\${FIXTURE_UBUNTU}`
  return {
    distro,
    vhdxPath: `${basePath}\\ext4.vhdx`,
    basePath,
    vhdxBytes: VHDX_BYTES,
    // Not sparse: every byte the image ever grew to is still on the Windows volume.
    allocatedBytes: VHDX_BYTES,
    sparse: false,
    fsSizeBytes: FS_SIZE_BYTES,
    fsUsedBytes: FS_USED_BYTES,
    reclaimableBytes: VHDX_BYTES - FS_USED_BYTES,
    error: null
  }
}

/** Fixed VM start stamp so restart-pending stays reproducible across runs. */
export const FIXTURE_VM_STARTED_AT = '2024-06-15T08:30:00.000Z'

export function fixtureWslSettings(distro: FixtureDistroName): WslConfigInfo {
  const wslconfigPath = `${FIXTURE_WINDOWS_USERPROFILE}\\.wslconfig`
  if (distro !== FIXTURE_UBUNTU) {
    return {
      wslconfigPath,
      wslconfigExists: true,
      wslConfPath: '/etc/wsl.conf',
      wslConfExists: false,
      restartPending: false,
      vmStartedAt: null,
      // WSL 1 has no utility VM, so the [wsl2] network settings cannot apply.
      networkingModeDeclared: null,
      networkingModeEffective: null,
      platform: {
              wsl: '2.6.3.0',
              kernel: '6.6.87.2-1',
              wslg: '1.0.71',
              msrdc: '1.2.6353',
              direct3d: '1.611.1-81528511',
              dxcore: '10.0.26100.1-240331-1435.ge-release',
              windows: '10.0.26200.7840',
              storeBuild: true
            },
      
      settings: []
    }
  }
  return {
    wslconfigPath,
    wslconfigExists: true,
    wslConfPath: '/etc/wsl.conf',
    wslConfExists: true,
    restartPending: true,
    vmStartedAt: FIXTURE_VM_STARTED_AT,
    networkingModeDeclared: 'mirrored',
    networkingModeEffective: 'nat',
      platform: {
            wsl: '2.6.3.0',
            kernel: '6.6.87.2-1',
            wslg: '1.0.71',
            msrdc: '1.2.6353',
            direct3d: '1.611.1-81528511',
            dxcore: '10.0.26100.1-240331-1435.ge-release',
            windows: '10.0.26200.7840',
            storeBuild: true
          },
    
    settings: [
      {
        key: 'memory',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: '17100MB',
        effectiveValue: '17100MB',
        origin: 'wslconfig',
        provenance: 'user',
        verdict: 'applied',
        note: null
      },
      {
        key: 'processors',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: '12',
        effectiveValue: '8',
        origin: 'wslconfig',
        provenance: 'computed',
        verdict: 'pending-restart',
        note: 'The running VM still uses 8 processors. Applies after wsl --shutdown.'
      },
      {
        key: 'networkingMode',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: 'mirrored',
        effectiveValue: 'nat',
        origin: 'wslconfig',
        provenance: 'unknown',
        verdict: 'unsupported',
        note: 'Mirrored networking needs Windows 11 22H2 or newer. WSL fell back to NAT.'
      },
      {
        key: 'autoMemoryReclaim',
        section: 'experimental',
        scope: 'windows',
        declaredValue: 'dropcache',
        effectiveValue: null,
        origin: 'wslconfig',
        provenance: 'unknown',
        verdict: 'wrong-section',
        note: 'WSL 2.0 and newer read autoMemoryReclaim from [wsl2], not [experimental].'
      },
      {
        key: 'memroy',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: '8GB',
        effectiveValue: null,
        origin: 'wslconfig',
        provenance: 'unknown',
        verdict: 'unknown-key',
        note: 'WSL ignores this key. Did you mean memory?'
      },
      {
        key: 'kernel',
        section: 'wsl2',
        scope: 'windows',
        // Verbatim file value: .wslconfig paths carry escaped backslashes.
        declaredValue: 'C:\\\\Users\\\\dev\\\\kernels\\\\bzImage',
        effectiveValue: null,
        origin: 'wslconfig',
        provenance: 'unknown',
        verdict: 'unknown',
        note: 'The running kernel could not be matched against this file.'
      },
      {
        key: 'swap',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: null,
        effectiveValue: '4GB',
        origin: 'computed',
        provenance: 'computed',
        verdict: 'not-set',
        note: 'Defaults to 25% of the memory limit.'
      },
      {
        key: 'localhostForwarding',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: null,
        effectiveValue: 'true',
        origin: 'default',
        provenance: 'wsl-default',
        verdict: 'not-set',
        note: null
      },
      {
        key: 'nestedVirtualization',
        section: 'wsl2',
        scope: 'windows',
        declaredValue: null,
        effectiveValue: 'true',
        origin: 'default',
        provenance: 'wsl-default',
        verdict: 'not-set',
        note: null
      },
      {
        key: 'systemd',
        section: 'boot',
        scope: 'linux',
        declaredValue: 'true',
        effectiveValue: 'true',
        origin: 'wsl-conf',
        provenance: 'user',
        verdict: 'applied',
        note: null
      },
      {
        key: 'appendWindowsPath',
        section: 'interop',
        scope: 'linux',
        declaredValue: 'false',
        effectiveValue: 'false',
        origin: 'wsl-conf',
        provenance: 'user',
        verdict: 'applied',
        note: null
      },
      {
        key: 'enabled',
        section: 'automount',
        scope: 'linux',
        declaredValue: null,
        effectiveValue: 'true',
        origin: 'default',
        provenance: 'wsl-default',
        verdict: 'not-set',
        note: null
      }
    ]
  }
}

export function fixtureMemoryDetail(distro: FixtureDistroName): MemoryReconciliation {
  if (distro !== FIXTURE_UBUNTU) {
    return {
      hostTotalBytes: gib(33.5),
      vmLimitBytes: null,
      vmLimitSource: 'unknown',
      vmmemWorkingSetBytes: null,
      guestTotalBytes: null,
      guestUsedBytes: null,
      guestCacheBytes: null,
      guestFreeBytes: null,
      swapTotalBytes: null,
      swapUsedBytes: null,
      autoMemoryReclaim: null
    }
  }
  return {
    hostTotalBytes: gib(33.5),
    // 17100MB in .wslconfig, expressed exactly as the VM sees it.
    vmLimitBytes: 17100 * MIB,
    vmLimitSource: 'wslconfig',
    vmmemWorkingSetBytes: gib(7.2),
    guestTotalBytes: GUEST_TOTAL_BYTES,
    guestUsedBytes: GUEST_USED_BYTES,
    guestCacheBytes: GUEST_CACHE_BYTES,
    guestFreeBytes: GUEST_FREE_BYTES,
    swapTotalBytes: SWAP_TOTAL_BYTES,
    swapUsedBytes: SWAP_USED_BYTES,
    autoMemoryReclaim: 'dropcache'
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

/**
 * Four listeners, four different answers to "who can actually reach this?".
 * They are consistent with fixtureFirewall: inbound is blocked by default and
 * only one of the three rules opens 8080, which is why 8080 is the only entry
 * the LAN can touch.
 */
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
      localhostUrl: null,
      windowsBound: false,
      windowsProcess: null,
      reachability: 'loopback-only',
      reachabilityReason:
        'Listening on every interface inside WSL, but nothing on the Windows side forwards port 22 and the firewall blocks inbound traffic.'
    },
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      port: 8790,
      pid: 4242,
      processName: 'hermes',
      listening: true,
      localhostUrl: 'http://127.0.0.1:8790',
      windowsBound: true,
      windowsProcess: 'wslrelay.exe',
      reachability: 'windows-only',
      reachabilityReason:
        'Bound to 127.0.0.1 inside WSL. localhost forwarding carries it to this PC; other machines never see it.'
    },
    {
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      port: 8080,
      pid: 5100,
      processName: 'node',
      listening: true,
      localhostUrl: 'http://127.0.0.1:8080',
      windowsBound: true,
      windowsProcess: 'wslrelay.exe',
      reachability: 'lan',
      reachabilityReason:
        'Forwarded to Windows and allowed by an inbound firewall rule, so other machines on the network can reach it.'
    },
    {
      protocol: 'udp',
      localAddress: '0.0.0.0',
      port: 5353,
      pid: 610,
      processName: 'avahi-daemon',
      listening: true,
      localhostUrl: null,
      windowsBound: false,
      windowsProcess: null,
      reachability: 'loopback-only',
      reachabilityReason:
        'NAT networking does not carry mDNS out of the WSL virtual switch, so the announcements stay inside the distro.'
    }
  ]
}

/**
 * Windows Defender Firewall in the fixture world: inbound blocked by default
 * with three WSL rules, one of which opens 8080. This is what makes the Ports
 * card able to say why 22 is unreachable while 8080 is not.
 */
export function fixtureFirewall(): FirewallInfo {
  return {
    enabled: true,
    defaultInbound: 'Block',
    defaultOutbound: 'Allow',
    loopbackEnabled: true,
    ruleCount: 3,
    error: null
  }
}

/** Both wall clocks, with the distro deliberately 47 s behind Windows. */
export function fixtureClock(distro: FixtureDistroName): ClockInfo {
  if (distro !== FIXTURE_UBUNTU) {
    // A stopped distro has no clock to read; only the Windows side is known.
    return { windowsIso: FIXTURE_WINDOWS_NOW, distroIso: null, skewSeconds: null }
  }
  return {
    windowsIso: FIXTURE_WINDOWS_NOW,
    distroIso: FIXTURE_DISTRO_NOW,
    skewSeconds: FIXTURE_CLOCK_SKEW_SECONDS
  }
}

/**
 * The exact configuration that quietly breaks name resolution: someone replaced
 * the generated symlink with a real file and set generateResolvConf=false, so
 * WSL stopped maintaining it and the servers in it outlived the network they
 * were copied from. The Windows adapter now hands out different ones.
 */
export function fixtureDns(distro: FixtureDistroName): DnsInfo {
  if (distro !== FIXTURE_UBUNTU) {
    return {
      resolvConfPath: '/etc/resolv.conf',
      isGeneratedSymlink: null,
      generateResolvConf: null,
      dnsTunneling: null,
      nameservers: [],
      windowsAdapterDns: ['192.168.1.1', '1.1.1.1'],
      error: null
    }
  }
  return {
    resolvConfPath: '/etc/resolv.conf',
    isGeneratedSymlink: false,
    generateResolvConf: false,
    dnsTunneling: false,
    nameservers: ['10.255.255.254'],
    windowsAdapterDns: ['192.168.1.1', '1.1.1.1'],
    error: null
  }
}

/**
 * Windows host listeners. Port 8080/8790 mirror the WSL side through the WSL2
 * relay; the rest are native Windows services with no WSL counterpart.
 */
export function fixtureWindowsPorts(): WindowsPortInfo[] {
  return [
    {
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      port: 8080,
      pid: 7100,
      processName: 'wslrelay.exe',
      listening: true,
      localhostUrl: 'http://localhost:8080',
      fromWsl: true
    },
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      port: 8790,
      pid: 7100,
      processName: 'wslrelay.exe',
      listening: true,
      localhostUrl: 'http://localhost:8790',
      fromWsl: true
    },
    {
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      port: 3000,
      pid: 9312,
      processName: 'node.exe',
      listening: true,
      localhostUrl: 'http://localhost:3000',
      fromWsl: false
    },
    {
      protocol: 'tcp6',
      localAddress: '[::]',
      port: 5432,
      pid: 4180,
      processName: 'postgres.exe',
      listening: true,
      localhostUrl: 'http://localhost:5432',
      fromWsl: false
    },
    {
      protocol: 'udp',
      localAddress: '0.0.0.0',
      port: 1900,
      pid: 2244,
      processName: 'svchost.exe',
      listening: true,
      localhostUrl: null,
      fromWsl: false
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

/** The one important path that is not on ext4, so `side` is visible at a glance. */
const WINDOWS_PROFILE_LINUX = '/mnt/c/Users/dev'

export function fixtureImportantPaths(distro: FixtureDistroName): ImportantPathInfo[] {
  const specPaths = IMPORTANT_PATH_SPECS.map((spec) => {
    const linuxPath = expandHome(spec.path)
    const exists = !(distro === FIXTURE_DEBIAN && spec.id === 'hermes')
    return {
      id: spec.id,
      label: spec.label,
      linuxPath,
      windowsPath: exists ? toUncPath(distro, linuxPath) : null,
      exists,
      isDirectory: exists ? true : null,
      side: classifyPathSide(linuxPath)
    }
  })
  return [
    ...specPaths,
    {
      id: 'windows-user-profile',
      label: WINDOWS_PROFILE_LINUX,
      linuxPath: WINDOWS_PROFILE_LINUX,
      // A drvfs mount already has a native Windows path; UNC would be a detour.
      windowsPath: FIXTURE_WINDOWS_USERPROFILE,
      exists: true,
      isDirectory: true,
      side: classifyPathSide(WINDOWS_PROFILE_LINUX)
    }
  ]
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

/** Installed tools in the fixture world: at least one per catalog category. */
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
  },
  claude: {
    executablePath: '/usr/local/bin/claude',
    version: '1.0.44',
    installMethod: 'npm-global',
    configPaths: ['/home/dev/.claude.json'],
    runningProcesses: 0,
    services: []
  },
  npm: {
    executablePath: '/home/dev/.nvm/versions/node/v20.19.0/bin/npm',
    version: '10.8.2',
    installMethod: 'nvm',
    configPaths: ['/home/dev/.npmrc'],
    runningProcesses: 0,
    services: []
  },
  uv: {
    executablePath: '/home/dev/.local/bin/uv',
    version: '0.5.11',
    installMethod: 'user-local',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  gh: {
    executablePath: '/usr/bin/gh',
    version: '2.45.0',
    installMethod: 'apt',
    configPaths: ['/home/dev/.config/gh/config.yml'],
    runningProcesses: 0,
    services: []
  },
  kubectl: {
    executablePath: '/usr/local/bin/kubectl',
    version: '1.30.2',
    installMethod: 'manual',
    configPaths: ['/home/dev/.kube/config'],
    runningProcesses: 0,
    services: []
  },
  ssh: {
    executablePath: '/usr/bin/ssh',
    version: '9.6p1',
    installMethod: 'apt',
    configPaths: ['/home/dev/.ssh/config'],
    runningProcesses: 1,
    services: ['ssh.service']
  },
  gcc: {
    executablePath: '/usr/bin/gcc',
    version: '13.2.0',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  make: {
    executablePath: '/usr/bin/make',
    version: '4.3',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  sqlite3: {
    executablePath: '/usr/bin/sqlite3',
    version: '3.45.1',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  vim: {
    executablePath: '/usr/bin/vim',
    version: '9.1',
    installMethod: 'apt',
    configPaths: ['/home/dev/.vimrc'],
    runningProcesses: 1,
    services: []
  },
  tmux: {
    executablePath: '/usr/bin/tmux',
    version: '3.4',
    installMethod: 'apt',
    configPaths: ['/home/dev/.tmux.conf'],
    runningProcesses: 1,
    services: []
  },
  zsh: {
    executablePath: '/usr/bin/zsh',
    version: '5.9',
    installMethod: 'apt',
    configPaths: ['/home/dev/.zshrc'],
    runningProcesses: 0,
    services: []
  },
  ffmpeg: {
    executablePath: '/usr/bin/ffmpeg',
    version: '6.1.1',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  ripgrep: {
    executablePath: '/home/dev/.cargo/bin/rg',
    version: '14.1.0',
    installMethod: 'cargo',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  jq: {
    executablePath: '/usr/bin/jq',
    version: '1.7.1',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  fzf: {
    executablePath: '/usr/bin/fzf',
    version: '0.44.1',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  curl: {
    executablePath: '/usr/bin/curl',
    version: '8.5.0',
    installMethod: 'apt',
    configPaths: [],
    runningProcesses: 0,
    services: []
  },
  // Resolves under /mnt/c: the command that wins on PATH is the Windows build
  // reached through interop, not anything installed inside the distro.
  code: {
    executablePath: '/mnt/c/Users/dev/AppData/Local/Programs/Microsoft VS Code/bin/code',
    version: '1.91.0',
    installMethod: 'windows-interop',
    configPaths: [],
    runningProcesses: 0,
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
        services: [],
        side: 'unknown' as const,
        shadowedByWindows: false
      }
    }
    const side = classifyPathSide(found.executablePath)
    return {
      id: spec.id,
      displayName: spec.displayName,
      installed: true,
      executablePath: found.executablePath,
      version: found.version,
      installMethod: found.installMethod,
      configPaths: [...found.configPaths],
      runningProcesses: found.runningProcesses,
      services: [...found.services],
      side,
      shadowedByWindows: side === 'windows-mount'
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
    logPaths: ['/home/dev/.hermes/logs/gateway.log'],
    platforms: [
      { name: 'Telegram', configured: true, detail: 'bot @fixture_bot' },
      { name: 'Discord', configured: false, detail: 'not configured' },
      { name: 'Slack', configured: false, detail: 'not configured' }
    ],
    profiles: [
      { name: 'default', model: 'claude-opus-5', gatewayState: 'running', isCurrent: true },
      { name: 'research', model: 'gpt-5', gatewayState: 'stopped', isCurrent: false }
    ],
    activeSessions: 2,
    scheduledJobs: 1,
    dashboardPort: null
  }
}

/**
 * A machine whose owner forwarded 8080 to the distro once and never touched the
 * rule again: WSL has since restarted and taken a new address, so the rule now
 * forwards into nothing. The second rule points at Windows itself and still
 * works — the two must never be reported the same way.
 */
export function fixturePortProxy(): PortProxyInfo {
  const distroIp = fixtureSystemInfo(FIXTURE_UBUNTU).ip
  return {
    rules: [
      {
        listenAddress: '0.0.0.0',
        listenPort: 8080,
        connectAddress: '172.20.128.7',
        connectPort: 8080,
        verdict: 'stale'
      },
      {
        listenAddress: '0.0.0.0',
        listenPort: 5173,
        connectAddress: distroIp ?? '172.20.144.2',
        connectPort: 5173,
        verdict: 'live'
      },
      {
        listenAddress: '127.0.0.1',
        listenPort: 9000,
        connectAddress: '127.0.0.1',
        connectPort: 9001,
        verdict: 'elsewhere'
      }
    ],
    distroIp,
    error: null
  }
}

/**
 * The Docker story this app exists to tell: one small image on screen, tens of
 * gigabytes of build cache off it, and all of it on the docker-desktop
 * distribution's disk rather than on the one being inspected.
 */
export function fixtureDocker(distro: FixtureDistroName): DockerInfo | null {
  if (distro !== FIXTURE_UBUNTU) {
    return {
      cliInstalled: false,
      cliPath: null,
      dockerDesktop: false,
      daemonRunning: false,
      serverVersion: null,
      clientVersion: null,
      context: null,
      rootDir: null,
      engineHost: null,
      storageDistro: null,
      images: [],
      containers: [],
      diskUsage: [],
      error: null
    }
  }
  return {
    cliInstalled: true,
    cliPath: '/usr/bin/docker',
    dockerDesktop: true,
    daemonRunning: true,
    serverVersion: '29.2.1',
    clientVersion: '29.2.1',
    context: 'default',
    rootDir: '/var/lib/docker',
    engineHost: 'docker-desktop',
    storageDistro: 'docker-desktop',
    images: [
      {
        repository: 'searxng/searxng',
        tag: 'latest',
        id: '8d1655e92c35',
        sizeBytes: 377000000,
        sizeText: '377MB',
        createdAt: '2026-02-20T12:05:22.000Z',
        containers: 1
      },
      {
        repository: 'postgres',
        tag: '16-alpine',
        id: '3f2b1a90d7c4',
        sizeBytes: 274000000,
        sizeText: '274MB',
        createdAt: '2026-05-02T09:14:00.000Z',
        containers: 0
      }
    ],
    containers: [
      {
        id: '19acd474130a',
        name: 'searxng',
        image: 'searxng/searxng:latest',
        state: 'running',
        status: 'Up 45 seconds',
        ports: '0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp',
        createdAt: '2026-02-21T07:07:53.000Z'
      },
      {
        id: 'b71c0e2f5a83',
        name: 'pg-dev',
        image: 'postgres:16-alpine',
        state: 'exited',
        status: 'Exited (0) 3 weeks ago',
        ports: '',
        createdAt: '2026-05-02T09:20:00.000Z'
      }
    ],
    diskUsage: [
      {
        type: 'Images',
        totalCount: 2,
        activeCount: 1,
        sizeBytes: 17250000000,
        sizeText: '17.25GB',
        reclaimableBytes: 17250000000,
        reclaimableText: '17.25GB (100%)'
      },
      {
        type: 'Containers',
        totalCount: 2,
        activeCount: 1,
        sizeBytes: 520200,
        sizeText: '520.2kB',
        reclaimableBytes: 0,
        reclaimableText: '0B (0%)'
      },
      {
        type: 'Local Volumes',
        totalCount: 18,
        activeCount: 1,
        sizeBytes: 515800000,
        sizeText: '515.8MB',
        reclaimableBytes: 515800000,
        reclaimableText: '515.8MB (100%)'
      },
      {
        type: 'Build Cache',
        totalCount: 437,
        activeCount: 0,
        sizeBytes: 21160000000,
        sizeText: '21.16GB',
        reclaimableBytes: 21160000000,
        reclaimableText: '21.16GB'
      }
    ],
    error: null
  }
}
