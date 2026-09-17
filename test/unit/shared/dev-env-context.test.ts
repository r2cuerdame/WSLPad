import { describe, expect, it } from 'vitest'
import {
  AGENT_CONTEXT_MAX_CHARS,
  DEV_ENV_CONTEXT_LIMITS,
  DEV_ENV_CONTEXT_SCHEMA_VERSION,
  MASKED_VALUE
} from '@shared/constants'
import { buildDevEnvContext, windowsPathFor } from '@shared/dev-env-context'
import { devEnvContextToMarkdown } from '@shared/dev-env-context-markdown'
import type { PortInfo, WslPadSnapshot } from '@shared/types'
import { SnapshotStore } from '../../../src/main/state/store'
import { FixtureWslProvider } from '../../../src/main/wsl/fixture/provider'
import {
  clock,
  dns,
  envVar,
  makeDashboard,
  makeSnapshot,
  port,
  svc,
  tool
} from '../state/helpers'

/** The full fixture world through the real store: what the E2E app serves. */
async function fixtureSnapshot(): Promise<WslPadSnapshot> {
  const store = new SnapshotStore(new FixtureWslProvider())
  await store.initialize()
  await Promise.all([store.refreshFast(), store.refreshMedium(), store.refreshSlow()])
  // The reachability verdict needs the networking mode from the slow tier.
  await store.refreshFast()
  store.setTerminalContext({ distro: 'Ubuntu-24.04', cwd: '/mnt/c/Users/dev/src', status: 'ready' })
  store.setExplorerContext({ distro: 'Ubuntu-24.04', currentPath: '/home/dev', showHidden: false })
  store.setMcpStatus({
    running: true,
    transport: 'http',
    endpoint: 'http://127.0.0.1:4923/mcp',
    port: 4923,
    connectedClients: 0,
    lastRequestAt: null,
    readOnly: true,
    tokenSet: true,
    error: null
  })
  const snap = store.get()
  store.dispose()
  return snap
}

describe('buildDevEnvContext over the fixture world', () => {
  it('is versioned, bounded and derived from the snapshot alone', async () => {
    const snap = await fixtureSnapshot()
    const ctx = buildDevEnvContext(snap, { appVersion: '9.9.9', now: '2024-06-15T12:00:30.000Z' })

    expect(ctx.schemaVersion).toBe(DEV_ENV_CONTEXT_SCHEMA_VERSION)
    expect(ctx.generatedAt).toBe(snap.generatedAt)
    expect(ctx.provenance.appVersion).toBe('9.9.9')
    expect(ctx.provenance.polled).toBe(true)
    expect(ctx.provenance.readOnly).toBe(true)
    expect(ctx.provenance.secretsMasked).toBe(true)
    expect(ctx.provenance.distroAnswering).toBe(true)
    // Same input, same output: nothing is collected or timed inside the builder.
    expect(buildDevEnvContext(snap, { appVersion: '9.9.9' })).toEqual(
      buildDevEnvContext(snap, { appVersion: '9.9.9' })
    )
  })

  it('describes the distro, the working directory and the boundary', async () => {
    const ctx = buildDevEnvContext(await fixtureSnapshot())
    expect(ctx.distro).toMatchObject({
      name: 'Ubuntu-24.04',
      osName: 'Ubuntu 24.04.2 LTS',
      wslVersion: 2,
      state: 'Running',
      user: 'dev',
      uid: 0,
      systemd: true,
      uncPath: '\\\\wsl.localhost\\Ubuntu-24.04',
      installedDistroCount: 2,
      otherDistros: ['Debian']
    })
    expect(ctx.distro.platform).toEqual({ wsl: '2.6.3.0', windows: '10.0.26200.7840', storeBuild: true })
    expect(ctx.workspace).toMatchObject({
      cwd: '/mnt/c/Users/dev/src',
      cwdSide: 'windows-mount',
      cwdWindowsPath: 'C:\\Users\\dev\\src',
      cwdCrossesBoundary: true,
      consoleStatus: 'ready',
      explorerPath: '/home/dev',
      explorerSide: 'ext4',
      automountRoot: '/mnt/'
    })
    expect(ctx.workspace.paths.map((p) => p.label)).toContain('HOME')
    expect(ctx.workspace.boundaryNotes.join(' ')).toContain('/mnt/c is mounted without the metadata')
  })

  it('groups runtimes, package managers and tools with counts', async () => {
    const ctx = buildDevEnvContext(await fixtureSnapshot())
    expect(ctx.runtimes.items.map((t) => t.id)).toEqual(['node', 'python'])
    expect(ctx.runtimes.installedCount).toBe(2)
    expect(ctx.runtimes.knownCount).toBeGreaterThan(2)
    expect(ctx.packageManagers.items.map((t) => t.id)).toEqual(['npm', 'uv'])
    const ids = ctx.tools.items.map((t) => t.id)
    expect(ids).toContain('git')
    expect(ids).toContain('docker')
    expect(ctx.tools.items.find((t) => t.id === 'code')).toMatchObject({
      shadowedByWindows: true,
      side: 'windows-mount'
    })
    expect(ctx.tools.items.length + ctx.tools.omitted).toBe(ctx.tools.installedCount)
  })

  it('reports PATH, interop and environment counts without a single value', async () => {
    const ctx = buildDevEnvContext(await fixtureSnapshot())
    expect(ctx.path.entryCount).toBe(9)
    expect(ctx.path.entries[0]).toBe('/home/dev/.local/bin')
    expect(ctx.path.windowsEntryCount).toBe(1)
    expect(ctx.path.appendWindowsPath).toBe(false)
    expect(ctx.path.interop).toEqual({ binfmt: 'enabled', binfmtLate: 'enabled', declared: false })
    expect(ctx.path.windowsBinaries).toEqual(['code'])
    expect(ctx.path.environmentVariableCount).toBe(10)
    expect(ctx.path.secretVariableCount).toBe(2)
    const json = JSON.stringify(ctx)
    expect(json).not.toContain('super-secret-fixture-value')
    expect(json).not.toContain('hunter2')
    // Even the masked placeholder never appears: values are counted, not listed.
    expect(json).not.toContain('EDITOR')
  })

  it('reads networking, DNS, Docker, services, ports and storage', async () => {
    const ctx = buildDevEnvContext(await fixtureSnapshot())
    expect(ctx.network).toMatchObject({
      networkingModeDeclared: 'mirrored',
      networkingModeEffective: 'nat',
      ip: '172.20.144.2',
      localhostForwarding: true
    })
    expect(ctx.network.dns).toMatchObject({ handManaged: true, nameservers: ['10.255.255.254'] })
    expect(ctx.network.portProxy).toEqual({ ruleCount: 3, live: 1, stale: 1, elsewhere: 1, unknown: 0 })
    expect(ctx.docker).toMatchObject({
      status: 'running',
      dockerDesktop: true,
      storageDistro: 'docker-desktop',
      imageCount: 2,
      containerCount: 2,
      runningContainerCount: 1,
      composeInstalled: false
    })
    expect(ctx.docker.runningContainers[0].name).toBe('searxng')
    expect(ctx.docker.buildCacheBytes).toBe(21160000000)
    expect(ctx.services).toMatchObject({ systemd: true, total: 3, active: 2, failed: 1 })
    expect(ctx.services.failedUnits).toEqual(['broken.service'])
    expect(ctx.services.notable[0].name).toBe('broken.service')
    expect(ctx.ports.listeningCount).toBe(4)
    // The store re-judges reachability from the firewall it read, not from
    // the fixture's own word — the same verdict the Ports card shows.
    expect(ctx.ports.items.find((p) => p.port === 8080)?.reachability).toBe('windows-only')
    expect(ctx.ports.windowsOnlyCount).toBe(3)
    expect(ctx.storage.rootUsePercent).toBe(9)
    expect(ctx.storage.filesystems.map((f) => f.side)).toEqual(['ext4', 'ext4', 'windows-mount'])
    expect(ctx.storage.drivesWithoutMetadata).toEqual(['/mnt/c'])
    expect(ctx.storage.image?.reclaimableBytes).toBe(86436216832 - 24696061952)
    expect(ctx.storage.topCaches[0].id).toBe('logs')
    expect(ctx.storage.defender).toEqual({ realtimeEnabled: true, imageCoverage: 'unknown' })
    expect(ctx.storage.inotify?.low).toBe(true)
    expect(ctx.storage.zoneIdentifierCount).toBe(47)
  })

  it('lists declared settings, present files and tool configs', async () => {
    const ctx = buildDevEnvContext(await fixtureSnapshot())
    expect(ctx.configs.restartPending).toBe(true)
    expect(ctx.configs.settings.every((s) => s.declaredValue !== null)).toBe(true)
    expect(ctx.configs.settings.map((s) => s.key)).toContain('processors')
    expect(ctx.configs.settings.map((s) => s.key)).not.toContain('localhostForwarding')
    expect(ctx.configs.files.map((f) => f.label)).toContain('~/.bashrc')
    expect(ctx.configs.toolConfigs.map((t) => t.path)).toContain('/home/dev/.gitconfig')
    expect(ctx.configs.terminalProfile).toEqual({
      installed: true,
      profileName: 'Ubuntu-24.04',
      hasProfile: true
    })
  })

  it('runs the doctor and names every armed trap in the fixture world', async () => {
    const ctx = buildDevEnvContext(await fixtureSnapshot())
    const byId = new Map(ctx.doctor.checks.map((c) => [c.id, c]))
    expect(ctx.doctor.overall).toBe('problem')
    expect(byId.get('distro-state')?.status).toBe('ok')
    expect(byId.get('clock-skew')?.status).toBe('problem')
    expect(byId.get('clock-skew')?.summary).toContain('47s behind Windows')
    expect(byId.get('dns')?.status).toBe('attention')
    expect(byId.get('wsl-settings-pending')?.suggestedCommand).toBe('wsl.exe --shutdown')
    expect(byId.get('networking-mode')?.summary).toContain('mirrored was declared but nat')
    expect(byId.get('wsl-settings-ignored')?.summary).toContain('memroy (unknown-key)')
    expect(byId.get('interop')?.status).toBe('attention')
    expect(byId.get('login-user')?.summary).toContain('starts as root')
    expect(byId.get('drive-metadata')?.summary).toContain('/mnt/c')
    // Unelevated: the exclusion list is unreadable, and that is not "not excluded".
    expect(byId.get('defender')?.status).toBe('unknown')
    expect(byId.get('inotify')?.status).toBe('attention')
    expect(byId.get('inotify')?.suggestedCommand).toContain('max_user_watches')
    expect(byId.get('disk-headroom')?.status).toBe('ok')
    expect(byId.get('disk-image')?.status).toBe('attention')
    expect(byId.get('docker')?.status).toBe('ok')
    expect(byId.get('docker')?.summary).toContain('docker-desktop distribution')
    expect(byId.get('services')?.status).toBe('problem')
    expect(byId.get('port-forwarding')?.summary).toContain('8080→172.20.128.7:8080')
    expect(byId.get('windows-binaries')?.summary).toContain('code')
    expect(byId.get('cwd-boundary')?.status).toBe('attention')
    expect(byId.get('zone-identifiers')?.suggestedCommand).toContain('Zone.Identifier')
    expect(byId.get('mcp-server')?.status).toBe('ok')
    // Problems sort first so a cut list never keeps an ok over a problem.
    expect(ctx.doctor.checks[0].status).toBe('problem')
    const total = Object.values(ctx.doctor.counts).reduce((a, n) => a + n, 0)
    expect(total).toBe(ctx.doctor.checks.length)
    expect(ctx.doctor.warnings.map((w) => w.id)).toContain('clock-skew')
  })

  it('says what is unknown and what was cut rather than leaving a gap', async () => {
    const ctx = buildDevEnvContext(await fixtureSnapshot())
    // The fixture world fills every section, so nothing is unread; two of its
    // lists overflow their caps, and provenance says exactly which.
    expect(ctx.provenance.notCollected).toEqual([])
    expect(ctx.provenance.staleQueries).toEqual([])
    expect(ctx.provenance.truncated).toEqual(['storage.topCaches', 'configs.toolConfigs'])
    expect(ctx.storage.topCaches).toHaveLength(DEV_ENV_CONTEXT_LIMITS.caches)
    expect(ctx.configs.toolConfigsOmitted).toBeGreaterThan(0)
  })
})

describe('buildDevEnvContext on sparse and empty snapshots', () => {
  it('turns a snapshot with no dashboard into unknowns, not zeroes', () => {
    const ctx = buildDevEnvContext(makeSnapshot({ dashboard: null }))
    expect(ctx.distro.name).toBe('Ubuntu-24.04')
    expect(ctx.distro.kernel).toBeNull()
    expect(ctx.path.entryCount).toBeNull()
    expect(ctx.path.environmentVariableCount).toBeNull()
    expect(ctx.docker.status).toBe('unknown')
    expect(ctx.services.total).toBeNull()
    expect(ctx.ports.windowsOnlyCount).toBeNull()
    expect(ctx.storage.rootUsePercent).toBeNull()
    expect(ctx.configs.restartPending).toBeNull()
    expect(ctx.provenance.notCollected).toContain('system')
    expect(ctx.provenance.notCollected).toContain('docker')
    expect(ctx.doctor.overall).toBe('unknown')
    expect(ctx.doctor.checks).toHaveLength(1)
  })

  it('reports a stopped distro as a problem and a wedged one as not answering', () => {
    const stopped = buildDevEnvContext(
      makeSnapshot({
        distros: [{ name: 'Ubuntu-24.04', state: 'Stopped', wslVersion: 2, isDefault: true }]
      })
    )
    expect(stopped.doctor.checks.find((c) => c.id === 'distro-state')?.status).toBe('problem')

    const wedged = buildDevEnvContext(
      makeSnapshot({
        liveness: {
          distro: 'Ubuntu-24.04',
          answering: false,
          lastAliveAt: '2026-07-30T11:00:00.000Z',
          failures: 3
        }
      })
    )
    const state = wedged.doctor.checks.find((c) => c.id === 'distro-state')
    expect(state?.status).toBe('problem')
    expect(state?.summary).toContain('not answering')
    expect(wedged.distro.answering).toBe(false)
    expect(wedged.provenance.lastAliveAt).toBe('2026-07-30T11:00:00.000Z')
  })

  it('treats a section the snapshot never filled as unknown in the doctor', () => {
    const ctx = buildDevEnvContext(makeSnapshot())
    const byId = new Map(ctx.doctor.checks.map((c) => [c.id, c]))
    for (const id of ['clock-skew', 'dns', 'wsl-settings', 'drive-metadata', 'defender', 'inotify', 'docker', 'port-forwarding', 'zone-identifiers']) {
      expect(byId.get(id)?.status, id).toBe('unknown')
    }
    expect(byId.get('disk-headroom')?.status).toBe('ok')
  })

  it('marks disk pressure by the same thresholds everywhere', () => {
    const pressured = makeDashboard({
      resources: {
        ...makeDashboard().resources,
        disks: [{ mountPoint: '/', exists: true, totalBytes: 100, usedBytes: 92, availableBytes: 8, usePercent: 92 }]
      }
    })
    const ctx = buildDevEnvContext(makeSnapshot({ dashboard: pressured }))
    expect(ctx.doctor.checks.find((c) => c.id === 'disk-headroom')?.status).toBe('problem')
    expect(ctx.storage.rootUsePercent).toBe(92)
  })

  it('knows the stale-query list from the runner warnings', () => {
    const ctx = buildDevEnvContext(
      makeSnapshot({
        warnings: [
          {
            id: 'runner-failed-docker',
            severity: 'warning',
            messageKey: 'warnings.runnerFailed',
            params: { command: 'docker' },
            message: 'A background query failed: docker'
          }
        ]
      })
    )
    expect(ctx.provenance.staleQueries).toEqual(['docker'])
    expect(ctx.doctor.checks.find((c) => c.id === 'collectors')?.status).toBe('attention')
  })
})

describe('buildDevEnvContext bounds and masking', () => {
  it('caps every list and records the cut in provenance', () => {
    const tools = Array.from({ length: 60 }, (_, i) =>
      tool({ id: `tool-${i}`, displayName: `Tool ${i}`, executablePath: `/usr/bin/tool-${i}` })
    )
    const ports: PortInfo[] = Array.from({ length: 40 }, (_, i) => port(3000 + i))
    const services = Array.from({ length: 20 }, (_, i) => svc(`unit-${i}`, 'failed'))
    const pathValue = Array.from({ length: 30 }, (_, i) => `/opt/dir-${i}/bin`).join(':')
    const dashboard = makeDashboard({
      tools,
      ports,
      services,
      environment: [envVar('PATH', pathValue)]
    })
    const ctx = buildDevEnvContext(makeSnapshot({ dashboard }))

    expect(ctx.tools.items).toHaveLength(DEV_ENV_CONTEXT_LIMITS.tools)
    expect(ctx.tools.omitted).toBe(60 - DEV_ENV_CONTEXT_LIMITS.tools)
    expect(ctx.ports.items).toHaveLength(DEV_ENV_CONTEXT_LIMITS.ports)
    expect(ctx.ports.omitted).toBe(40 - DEV_ENV_CONTEXT_LIMITS.ports)
    expect(ctx.path.entries).toHaveLength(DEV_ENV_CONTEXT_LIMITS.pathEntries)
    expect(ctx.path.entryCount).toBe(30)
    expect(ctx.services.failedUnits).toHaveLength(DEV_ENV_CONTEXT_LIMITS.failedUnits)
    expect(ctx.services.failed).toBe(20)
    expect(ctx.provenance.truncated).toEqual(
      expect.arrayContaining(['tools', 'path.entries', 'ports.items', 'services.failedUnits'])
    )
  })

  it('masks a WSL setting whose key looks like a credential', () => {
    const dashboard = makeDashboard({
      wslSettings: {
        wslconfigPath: 'C:\\Users\\dev\\.wslconfig',
        wslconfigExists: true,
        wslConfPath: '/etc/wsl.conf',
        wslConfExists: true,
        restartPending: false,
        vmStartedAt: null,
        networkingModeDeclared: null,
        networkingModeEffective: null,
        platform: null,
        interop: null,
        defaultUser: null,
        settings: [
          {
            key: 'token',
            section: 'user',
            scope: 'linux',
            declaredValue: 'ghp-raw-secret',
            effectiveValue: 'ghp-raw-secret',
            origin: 'wsl-conf',
            provenance: 'user',
            verdict: 'applied',
            note: null
          }
        ]
      }
    })
    const ctx = buildDevEnvContext(makeSnapshot({ dashboard }))
    expect(ctx.configs.settings[0]).toMatchObject({
      key: 'token',
      declaredValue: MASKED_VALUE,
      effectiveValue: MASKED_VALUE
    })
    expect(JSON.stringify(ctx)).not.toContain('ghp-raw-secret')
  })

  it('never copies an environment value other than PATH and WSLENV', () => {
    const dashboard = makeDashboard({
      environment: [
        envVar('PATH', '/usr/bin:/usr/local/bin'),
        envVar('WSLENV', 'WT_SESSION::WT_PROFILE_ID'),
        envVar('EDITOR', 'raw-editor-value-xyz'),
        { ...envVar('API_TOKEN', MASKED_VALUE), isSecret: true }
      ]
    })
    const ctx = buildDevEnvContext(makeSnapshot({ dashboard }))
    const json = JSON.stringify(ctx)
    expect(ctx.path.entries).toEqual(['/usr/bin', '/usr/local/bin'])
    expect(ctx.path.wslenv).toBe('WT_SESSION::WT_PROFILE_ID')
    expect(ctx.path.secretVariableCount).toBe(1)
    expect(json).not.toContain('raw-editor-value-xyz')
    expect(json).not.toContain('API_TOKEN')
  })
})

describe('windowsPathFor', () => {
  it('maps drive mounts back to their drive and distro paths through the UNC share', () => {
    const unc = '\\\\wsl.localhost\\Ubuntu-24.04'
    expect(windowsPathFor('/mnt/c/Users/dev', unc, '/mnt/')).toBe('C:\\Users\\dev')
    expect(windowsPathFor('/mnt/d', unc, '/mnt/')).toBe('D:\\')
    expect(windowsPathFor('/home/dev', unc, '/mnt/')).toBe(`${unc}\\home\\dev`)
    expect(windowsPathFor('/c/Users/dev', unc, '/')).toBe('C:\\Users\\dev')
    expect(windowsPathFor('/home/dev', null, '/mnt/')).toBeNull()
    expect(windowsPathFor('relative', unc, '/mnt/')).toBeNull()
  })
})

describe('devEnvContextToMarkdown', () => {
  it('renders every section of the fixture world inside the agent budget', async () => {
    const md = devEnvContextToMarkdown(buildDevEnvContext(await fixtureSnapshot()))
    for (const heading of [
      '## WSL environment — Ubuntu-24.04',
      '### Working directory',
      '### Windows ↔ Linux paths',
      '### Runtimes',
      '### Package managers',
      '### Tools on PATH',
      '### PATH & interop',
      '### Network',
      '### Docker',
      '### Services (systemd)',
      '### Ports in use',
      '### Mounts & disk',
      '### Configuration',
      '### Environment doctor — problem',
      '### Provenance'
    ]) {
      expect(md, heading).toContain(heading)
    }
    expect(md).toContain('- Console cwd: /mnt/c/Users/dev/src — Windows drive')
    expect(md).toContain('from Windows: C:\\Users\\dev\\src')
    expect(md).toContain('- PATH (9 entries, 1 on Windows drives)')
    expect(md).toContain('- Networking mode: mirrored declared, nat in effect')
    expect(md).toContain('- Docker Desktop 29.2.1, daemon running')
    expect(md).toContain('- 8080/tcp node — reachable from Windows')
    expect(md).toContain('- Windows-only listeners: 3 (node.exe:3000, postgres.exe:5432, svchost.exe:1900)')
    // One example carries every distro path; the drive mount is listed on its own.
    expect(md).toContain(
      '- /home/dev ↔ \\\\wsl.localhost\\Ubuntu-24.04\\home\\dev (and 7 more distro paths by the same rule)'
    )
    expect(md).toContain('- /mnt/c/Users/dev ↔ C:\\Users\\dev (Windows mount)')
    expect(md).toContain('- [problem] The distro clock is 47s behind Windows.')
    expect(md).toContain('Prepared, not run: `wsl.exe --shutdown`')
    expect(md).not.toContain('super-secret-fixture-value')
    expect(md).not.toContain('hunter2')
    expect(md.length).toBeLessThan(AGENT_CONTEXT_MAX_CHARS)
  })

  it('prints only the checks that need a look, and says so when none do', () => {
    const md = devEnvContextToMarkdown(buildDevEnvContext(makeSnapshot()))
    expect(md).not.toContain('- [ok]')
    expect(md).toContain('- [unknown] The distro clock has not been compared with Windows.')
    // Sparse snapshot: sections with nothing known are left out, and named.
    expect(md).not.toContain('### Docker')
    expect(md).toContain('Not collected yet (unknown, not empty): disk, wslSettings')
  })

  it('stays under the agent budget on a busy machine', () => {
    const tools = Array.from({ length: 60 }, (_, i) =>
      tool({ id: `tool-${i}`, displayName: `Tool ${i}`, executablePath: `/usr/bin/tool-${i}` })
    )
    const ports: PortInfo[] = Array.from({ length: 40 }, (_, i) => port(3000 + i))
    const md = devEnvContextToMarkdown(
      buildDevEnvContext(makeSnapshot({ dashboard: makeDashboard({ tools, ports, clock: clock(), dns: dns() }) }))
    )
    expect(md).toContain(`- … and ${60 - DEV_ENV_CONTEXT_LIMITS.tools} more`)
    expect(md).toContain(`- … and ${40 - DEV_ENV_CONTEXT_LIMITS.ports} more`)
    expect(md).toContain('Lists cut to their cap: tools, ports.items')
    expect(md.length).toBeLessThan(AGENT_CONTEXT_MAX_CHARS)
  })
})
