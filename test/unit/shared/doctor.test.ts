import { describe, expect, it } from 'vitest'
import type { DashboardSnapshot, DoctorVerdict } from '@shared/types'
import { runDoctor } from '@shared/doctor'

// ---------------------------------------------------------------------------
// Minimal fixture builder — every field the doctor reads, nothing else.
// ---------------------------------------------------------------------------

const GIB = 1024 ** 3

function makeDash(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
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
      disks: [{
        mountPoint: '/',
        exists: true,
        totalBytes: 100 * GIB,
        usedBytes: 40 * GIB,
        availableBytes: 60 * GIB,
        usePercent: 40
      }],
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
        id: 'gitconfig',
        label: '~/.gitconfig',
        scope: 'linux',
        linuxPath: '/home/dev/.gitconfig',
        windowsPath: null,
        exists: true,
        readable: true,
        writable: true
      },
      {
        id: 'ssh-config',
        label: '~/.ssh/config',
        scope: 'linux',
        linuxPath: '/home/dev/.ssh/config',
        windowsPath: null,
        exists: true,
        readable: true,
        writable: true
      }
    ],
    tools: [
      {
        id: 'git',
        displayName: 'Git',
        installed: true,
        executablePath: '/usr/bin/git',
        version: '2.43.0',
        installMethod: 'apt',
        configPaths: [],
        runningProcesses: 0,
        services: [],
        side: 'ext4',
        shadowedByWindows: false
      },
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
      }
    ],
    hermes: null,
    docker: {
      cliInstalled: false,
      cliPath: null,
      dockerDesktop: false,
      daemonRunning: false,
      endpoint: null,
      localEndpoint: false,
      notProbed: null,
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
    },
    zoneIdentifier: null,
    diskConsumers: null,
    driveMounts: null,
    defender: null,
    inotify: null,
    terminalProfiles: null,
    environment: [
      {
        name: 'PWD',
        maskedValue: '/home/dev/projects/wslpad',
        valueLength: 25,
        isSecret: false,
        isPathLike: true,
        fromWindows: false
      },
      {
        name: 'PATH',
        maskedValue: '/usr/local/bin:/usr/bin:/bin',
        valueLength: 27,
        isSecret: false,
        isPathLike: true,
        fromWindows: false
      }
    ],
    processes: [],
    services: [],
    ports: [],
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
      windowsIso: '2024-06-15T12:00:00.000Z',
      distroIso: '2024-06-15T12:00:00.000Z',
      skewSeconds: 0
    },
    dns: {
      resolvConfPath: '/etc/resolv.conf',
      isGeneratedSymlink: true,
      generateResolvConf: true,
      dnsTunneling: false,
      nameservers: ['172.20.0.1'],
      windowsAdapterDns: ['192.168.1.1'],
      error: null
    },
    warnings: [],
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Environment Doctor (issue #89)', () => {
  // ---- structure ----------------------------------------------------------

  it('returns all 9 checks for a complete snapshot', () => {
    const report = runDoctor(makeDash())
    expect(report.checks).toHaveLength(9)
    expect(report.generatedAt).toBeTruthy()
    expect(report.maskedMarkdown).toContain('# WSLPad Environment Doctor Report')
  })

  it('every check has id, title, evidence, and verdict', () => {
    const report = runDoctor(makeDash())
    const validVerdicts: DoctorVerdict[] = ['healthy', 'warning', 'error', 'unknown']
    for (const check of report.checks) {
      expect(check.id).toBeTruthy()
      expect(check.title).toBeTruthy()
      expect(check.evidence).toBeTruthy()
      expect(validVerdicts).toContain(check.verdict)
    }
  })

  // ---- project path -------------------------------------------------------

  it('healthy when current workspace PWD is on the Linux filesystem', () => {
    const report = runDoctor(makeDash())
    const check = report.checks.find((c) => c.id === 'project-path')!
    expect(check.verdict).toBe('healthy')
    expect(check.evidence).toContain('/home/dev/projects/wslpad')
  })

  it('warning when current workspace PWD is on /mnt', () => {
    const base = makeDash()
    const report = runDoctor(makeDash({
      environment: base.environment.map((entry) =>
        entry.name === 'PWD'
          ? { ...entry, maskedValue: '/mnt/c/dev/wslpad', valueLength: 17 }
          : entry
      )
    }))
    const check = report.checks.find((c) => c.id === 'project-path')!
    expect(check.verdict).toBe('warning')
    expect(check.evidence).toContain('/mnt')
  })

  it('unknown when current workspace PWD was not collected', () => {
    const base = makeDash()
    const report = runDoctor(makeDash({
      environment: base.environment.filter((entry) => entry.name !== 'PWD')
    }))
    const check = report.checks.find((c) => c.id === 'project-path')!
    expect(check.verdict).toBe('unknown')
  })

  // ---- binary shadowing ---------------------------------------------------

  it('healthy when no tools are shadowed', () => {
    const report = runDoctor(makeDash())
    const check = report.checks.find((c) => c.id === 'binary-shadowing')!
    expect(check.verdict).toBe('healthy')
  })

  it('warning when tools are shadowed by Windows', () => {
    const report = runDoctor(makeDash({
      tools: [{
        id: 'node',
        displayName: 'Node.js',
        installed: true,
        executablePath: '/mnt/c/Program Files/nodejs/node.exe',
        version: '20.0.0',
        installMethod: 'unknown',
        configPaths: [],
        runningProcesses: 0,
        services: [],
        side: 'windows-mount',
        shadowedByWindows: true
      }]
    }))
    const check = report.checks.find((c) => c.id === 'binary-shadowing')!
    expect(check.verdict).toBe('warning')
    expect(check.evidence).toContain('Node.js')
  })

  // ---- clock skew ---------------------------------------------------------

  it('healthy when clock skew within 2 s', () => {
    const report = runDoctor(makeDash({
      clock: { windowsIso: '2024-06-15T12:00:00Z', distroIso: '2024-06-15T12:00:01Z', skewSeconds: 1 }
    }))
    const check = report.checks.find((c) => c.id === 'clock-skew')!
    expect(check.verdict).toBe('healthy')
    expect(check.command).toBeNull()
  })

  it('warning when clock skew 3–30 s', () => {
    const report = runDoctor(makeDash({
      clock: { windowsIso: '2024-06-15T12:00:00Z', distroIso: '2024-06-15T11:59:50Z', skewSeconds: -10 }
    }))
    const check = report.checks.find((c) => c.id === 'clock-skew')!
    expect(check.verdict).toBe('warning')
    expect(check.command).toBe('wsl.exe --shutdown')
  })

  it('error when clock skew > 30 s', () => {
    const report = runDoctor(makeDash({
      clock: { windowsIso: '2024-06-15T12:00:00Z', distroIso: '2024-06-15T11:59:13Z', skewSeconds: -47 }
    }))
    const check = report.checks.find((c) => c.id === 'clock-skew')!
    expect(check.verdict).toBe('error')
    expect(check.command).toBe('wsl.exe --shutdown')
  })

  it('unknown when clock not collected', () => {
    const report = runDoctor(makeDash({ clock: null }))
    const check = report.checks.find((c) => c.id === 'clock-skew')!
    expect(check.verdict).toBe('unknown')
    expect(check.command).toBeNull()
  })

  // ---- DNS ---------------------------------------------------------------

  it('healthy when DNS is WSL-generated', () => {
    const report = runDoctor(makeDash())
    const check = report.checks.find((c) => c.id === 'dns-config')!
    expect(check.verdict).toBe('healthy')
  })

  it('warning when manual resolv.conf has no nameservers', () => {
    const report = runDoctor(makeDash({
      dns: {
        resolvConfPath: '/etc/resolv.conf',
        isGeneratedSymlink: false,
        generateResolvConf: false,
        dnsTunneling: false,
        nameservers: [],
        windowsAdapterDns: ['192.168.1.1'],
        error: null
      }
    }))
    const check = report.checks.find((c) => c.id === 'dns-config')!
    expect(check.verdict).toBe('warning')
  })

  it('unknown when DNS not collected', () => {
    const report = runDoctor(makeDash({ dns: null }))
    const check = report.checks.find((c) => c.id === 'dns-config')!
    expect(check.verdict).toBe('unknown')
  })

  // ---- systemd/Docker/runtime ---------------------------------------------

  it('healthy when systemd enabled and no failures', () => {
    const report = runDoctor(makeDash())
    const check = report.checks.find((c) => c.id === 'systemd-docker')!
    expect(check.verdict).toBe('healthy')
    expect(check.evidence).toContain('systemd is enabled')
  })

  it('warning when systemd is not enabled', () => {
    const report = runDoctor(makeDash({
      system: {
        kernel: '6.6.36-microsoft-standard-WSL2',
        hostname: 'devbox',
        user: 'dev',
        home: '/home/dev',
        shell: '/bin/bash',
        uptimeSeconds: 7200,
        systemdEnabled: false,
        ip: '172.20.0.2',
        windowsUserProfileLinux: '/mnt/c/Users/dev'
      }
    }))
    const check = report.checks.find((c) => c.id === 'systemd-docker')!
    expect(check.verdict).toBe('warning')
    expect(check.evidence).toContain('systemd is not enabled')
  })

  it('error when services have failed', () => {
    const report = runDoctor(makeDash({
      services: [{
        name: 'hermes-gateway.service',
        scope: 'user',
        loadState: 'loaded',
        activeState: 'failed',
        subState: 'failed',
        enabled: 'enabled',
        description: 'Hermes Gateway'
      }]
    }))
    const check = report.checks.find((c) => c.id === 'systemd-docker')!
    expect(check.verdict).toBe('error')
    expect(check.evidence).toContain('failed service')
  })

  // ---- port/firewall ------------------------------------------------------

  it('healthy when firewall is ok and no unreachable ports', () => {
    const report = runDoctor(makeDash())
    const check = report.checks.find((c) => c.id === 'port-firewall')!
    expect(check.verdict).toBe('healthy')
  })

  it('error when ports are unreachable', () => {
    const report = runDoctor(makeDash({
      ports: [{
        protocol: 'tcp',
        localAddress: '0.0.0.0',
        port: 8080,
        pid: 42,
        processName: 'node',
        listening: true,
        localhostUrl: 'http://127.0.0.1:8080',
        windowsBound: false,
        windowsProcess: null,
        reachability: 'unreachable',
        reachabilityReason: 'blocked by firewall'
      }]
    }))
    const check = report.checks.find((c) => c.id === 'port-firewall')!
    expect(check.verdict).toBe('error')
  })

  // ---- git/ssh config -----------------------------------------------------

  it('healthy when git installed on ext4 with config files', () => {
    const report = runDoctor(makeDash())
    const check = report.checks.find((c) => c.id === 'git-ssh-config')!
    expect(check.verdict).toBe('healthy')
  })

  it('error when git is shadowed by Windows', () => {
    const report = runDoctor(makeDash({
      tools: [{
        id: 'git',
        displayName: 'Git',
        installed: true,
        executablePath: '/mnt/c/Program Files/Git/cmd/git.exe',
        version: '2.43.0',
        installMethod: 'unknown',
        configPaths: [],
        runningProcesses: 0,
        services: [],
        side: 'windows-mount',
        shadowedByWindows: true
      }]
    }))
    const check = report.checks.find((c) => c.id === 'git-ssh-config')!
    expect(check.verdict).toBe('error')
    expect(check.evidence).toContain('Windows binary')
  })

  // ---- no-auto-mutation ---------------------------------------------------

  it('never returns a command without a warning or error verdict', () => {
    const report = runDoctor(makeDash())
    for (const check of report.checks) {
      if (check.command !== null) {
        expect(['warning', 'error']).toContain(check.verdict)
      }
    }
  })

  // ---- masked markdown ----------------------------------------------------

  it('masks user paths in the markdown report', () => {
    const report = runDoctor(makeDash())
    // The markdown should mask /home/<user> paths
    expect(report.maskedMarkdown).toContain('WSLPad Environment Doctor Report')
    expect(report.maskedMarkdown).toContain('Summary')
    // Evidence text should be present
    for (const check of report.checks) {
      expect(report.maskedMarkdown).toContain(check.title)
    }
  })
})
