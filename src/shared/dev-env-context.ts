/**
 * Developer Environment Context: the one description of "where am I, what is
 * installed, what is broken" that the MCP server and the Copy-for-LLM
 * agent-context preset both emit. It is built purely from a WslPadSnapshot —
 * nothing is collected here — so the two consumers cannot drift apart, and a
 * value the snapshot never read stays null instead of becoming a guess.
 *
 * Three rules hold throughout:
 * - Unknown is never zero. Every list that could not be read is empty *and*
 *   its count is null; provenance names the sections that were never filled.
 * - Bounded by construction. Every list has a cap from DEV_ENV_CONTEXT_LIMITS
 *   and carries the number it left out.
 * - Secrets never enter. Environment values are not copied at all except PATH
 *   and WSLENV (directory lists and variable names, never credentials), and a
 *   WSL setting whose key looks like a secret is masked with the same rule the
 *   collectors use.
 */
import {
  CLOCK_SKEW_WARN_SECONDS,
  DEV_ENV_CONTEXT_LIMITS as LIMITS,
  DEV_ENV_CONTEXT_SCHEMA_VERSION,
  MASKED_VALUE,
  TOOL_SPECS
} from './constants'
import { addExclusionCommand, defenderCoverage, suggestedExclusion } from './defender-coverage'
import { watchesAreLow } from './inotify'
import { isSecretName } from './masking'
import { automountRootFromSettings, classifyPathSide, isCrossBoundary } from './path-boundary'
import type {
  DashboardSnapshot,
  DevEnvCheck,
  DevEnvConfigs,
  DevEnvContext,
  DevEnvDistro,
  DevEnvDocker,
  DevEnvDoctor,
  DevEnvDockerStatus,
  DevEnvNetwork,
  DevEnvPath,
  DevEnvPorts,
  DevEnvProvenance,
  DevEnvSectionId,
  DevEnvServiceRef,
  DevEnvServices,
  DevEnvStorage,
  DevEnvTool,
  DevEnvToolGroup,
  DevEnvVerdict,
  DevEnvWorkspace,
  DistroSummary,
  PathSide,
  ServiceInfo,
  ToolInfo,
  WslPadSnapshot
} from './types'

export interface DevEnvContextOptions {
  /** The WSLPad version producing the context; null when the caller has none. */
  appVersion?: string | null
  /** ISO instant of the build, so the context can say how old its snapshot is. */
  now?: string | null
}

/** Disk usage at or above this is a problem; from here down to `DISK_ATTENTION_PERCENT` it is worth a look. */
const DISK_PROBLEM_PERCENT = 90
const DISK_ATTENTION_PERCENT = 80
/** A disk image keeping this much space Linux no longer uses is worth naming. */
const IMAGE_RECLAIMABLE_NOTICE_BYTES = 10 * 1024 ** 3
const GIB = 1024 ** 3

const CATEGORY_BY_TOOL_ID = new Map(TOOL_SPECS.map((spec) => [spec.id, spec.category]))

type ToolGroupKey = 'runtimes' | 'packageManagers' | 'tools'

function groupOf(id: string): ToolGroupKey {
  const category = CATEGORY_BY_TOOL_ID.get(id)
  if (category === 'runtime') return 'runtimes'
  if (category === 'package') return 'packageManagers'
  return 'tools'
}

/** Cut a list to its cap and remember that it was cut. */
class Bounder {
  readonly truncated: string[] = []

  cap<T>(label: string, items: readonly T[], limit: number): { items: T[]; omitted: number } {
    if (items.length <= limit) return { items: [...items], omitted: 0 }
    this.truncated.push(label)
    return { items: items.slice(0, limit), omitted: items.length - limit }
  }
}

function parseBool(value: string | null): boolean | null {
  if (value === null) return null
  const v = value.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  return null
}

/** One reconciled WSL setting as in force (effective wins over declared). */
function settingValue(dash: DashboardSnapshot | null, section: string, key: string): string | null {
  const entry = dash?.wslSettings?.settings.find(
    (s) => s.section === section && s.key.toLowerCase() === key.toLowerCase()
  )
  if (entry === undefined) return null
  return entry.effectiveValue ?? entry.declaredValue
}

/**
 * The same directory as Windows reaches it. A drive mount maps back to its
 * drive letter; a distro path is reached through the UNC share; anything else
 * is null rather than a path that might not resolve.
 */
export function windowsPathFor(
  linuxPath: string,
  uncPath: string | null,
  automountRoot: string
): string | null {
  const side = classifyPathSide(linuxPath, automountRoot)
  if (side === 'windows-mount') {
    const rest = linuxPath.slice(automountRoot.length)
    const drive = rest.charAt(0).toUpperCase()
    const tail = rest.slice(1).replace(/\//g, '\\')
    return `${drive}:${tail === '' ? '\\' : tail}`
  }
  if (side === 'ext4' && uncPath !== null) return uncPath + linuxPath.replace(/\//g, '\\')
  return null
}

function toDevEnvTool(tool: ToolInfo): DevEnvTool {
  return {
    id: tool.id,
    name: tool.displayName,
    version: tool.version,
    path: tool.executablePath,
    installMethod: tool.installMethod,
    side: tool.side,
    shadowedByWindows: tool.shadowedByWindows
  }
}

function buildDistro(s: WslPadSnapshot, dash: DashboardSnapshot | null, b: Bounder): DevEnvDistro {
  const selected = s.selectedDistro
  const summary: DistroSummary | null =
    selected === null ? null : (s.distros.find((d) => d.name === selected) ?? null)
  const others = s.distros.filter((d) => d.name !== selected).map((d) => d.name)
  const otherDistros = b.cap('distro.otherDistros', others, LIMITS.otherDistros)
  const platform = dash?.wslSettings?.platform ?? null
  return {
    name: dash?.distro.name ?? selected,
    osName: dash?.distro.osName ?? null,
    wslVersion: dash?.distro.wslVersion ?? summary?.wslVersion ?? null,
    state: dash?.distro.state ?? summary?.state ?? null,
    isDefault: dash?.distro.isDefault ?? summary?.isDefault ?? null,
    answering: s.liveness?.answering ?? null,
    kernel: dash?.system.kernel ?? null,
    hostname: dash?.system.hostname ?? null,
    user: dash?.system.user ?? null,
    uid: dash?.wslSettings?.defaultUser?.effectiveUid ?? null,
    home: dash?.system.home ?? null,
    shell: dash?.system.shell ?? null,
    systemd: dash?.system.systemdEnabled ?? null,
    ip: dash?.system.ip ?? null,
    uptimeSeconds: dash?.system.uptimeSeconds ?? null,
    uncPath: dash?.distro.uncPath ?? (selected === null ? null : `\\\\wsl.localhost\\${selected}`),
    windowsUserProfileLinux: dash?.system.windowsUserProfileLinux ?? null,
    platform:
      platform === null
        ? null
        : { wsl: platform.wsl, windows: platform.windows, storeBuild: platform.storeBuild },
    installedDistroCount: s.distros.length,
    otherDistros: otherDistros.items,
    otherDistrosOmitted: otherDistros.omitted
  }
}

function buildWorkspace(
  s: WslPadSnapshot,
  dash: DashboardSnapshot | null,
  automountRoot: string,
  uncPath: string | null,
  b: Bounder
): DevEnvWorkspace {
  const cwd = s.terminal.cwd
  const cwdSide: PathSide = classifyPathSide(cwd, automountRoot)
  const explorerSide: PathSide = classifyPathSide(s.explorer.currentPath, automountRoot)
  const notes: string[] = []
  notes.push(
    `Windows drives are mounted under ${automountRoot}<drive>; files there are Windows-owned and ` +
      'file-heavy work on them is far slower than on the distro disk.'
  )
  if (uncPath !== null) {
    notes.push(`Windows reaches the distro disk through ${uncPath}.`)
  }
  const bare = (dash?.driveMounts?.drives ?? []).filter((d) => !d.metadata).map((d) => d.point)
  if (bare.length > 0) {
    notes.push(
      `${bare.join(', ')} ${bare.length === 1 ? 'is' : 'are'} mounted without the metadata ` +
        'option: chmod and chown there report success and store nothing.'
    )
  }
  // Paths known to be missing say nothing useful to an agent; the rest map to
  // the Windows notation that reaches them.
  const paths = b.cap(
    'workspace.paths',
    (dash?.paths ?? [])
      .filter((p) => p.exists !== false)
      .map((p) => ({
        label: p.label,
        linuxPath: p.linuxPath,
        windowsPath: p.windowsPath,
        side: p.side,
        exists: p.exists
      })),
    LIMITS.importantPaths
  )
  return {
    cwd,
    cwdSide,
    cwdWindowsPath: cwd === null ? null : windowsPathFor(cwd, uncPath, automountRoot),
    cwdCrossesBoundary: cwd === null ? null : isCrossBoundary(cwdSide),
    consoleStatus: s.terminal.distro === null ? null : s.terminal.status,
    explorerPath: s.explorer.currentPath,
    explorerSide,
    automountRoot,
    paths: paths.items,
    pathsOmitted: paths.omitted,
    boundaryNotes: notes
  }
}

function buildToolGroups(
  dash: DashboardSnapshot | null,
  b: Bounder
): Record<ToolGroupKey, DevEnvToolGroup> {
  const known: Record<ToolGroupKey, number> = { runtimes: 0, packageManagers: 0, tools: 0 }
  for (const spec of TOOL_SPECS) known[groupOf(spec.id)]++
  const installed: Record<ToolGroupKey, DevEnvTool[]> = { runtimes: [], packageManagers: [], tools: [] }
  for (const tool of dash?.tools ?? []) {
    if (!tool.installed) continue
    installed[groupOf(tool.id)].push(toDevEnvTool(tool))
  }
  const group = (key: ToolGroupKey, limit: number): DevEnvToolGroup => {
    const cut = b.cap(key, installed[key], limit)
    return {
      knownCount: known[key],
      installedCount: installed[key].length,
      items: cut.items,
      omitted: cut.omitted
    }
  }
  return {
    runtimes: group('runtimes', LIMITS.runtimes),
    packageManagers: group('packageManagers', LIMITS.packageManagers),
    tools: group('tools', LIMITS.tools)
  }
}

/** A non-secret variable's value, or null when it was not read or is masked. */
function plainEnvValue(dash: DashboardSnapshot | null, name: string): string | null {
  const v = dash?.environment.find((e) => e.name === name)
  if (v === undefined || v.isSecret || isSecretName(v.name)) return null
  return v.maskedValue === MASKED_VALUE ? null : v.maskedValue
}

function buildPath(dash: DashboardSnapshot | null, automountRoot: string, b: Bounder): DevEnvPath {
  const pathValue = plainEnvValue(dash, 'PATH')
  const allEntries = pathValue === null ? null : pathValue.split(':').filter((e) => e.length > 0)
  const entries = b.cap('path.entries', allEntries ?? [], LIMITS.pathEntries)
  const shadowed = (dash?.tools ?? []).filter((t) => t.installed && t.shadowedByWindows)
  const binaries = b.cap(
    'path.windowsBinaries',
    shadowed.map((t) => t.id),
    LIMITS.windowsBinaries
  )
  const env = dash?.environment ?? []
  const envKnown = env.length > 0
  return {
    entries: entries.items,
    entryCount: allEntries === null ? null : allEntries.length,
    omitted: entries.omitted,
    windowsEntryCount:
      allEntries === null
        ? null
        : allEntries.filter((e) => isCrossBoundary(classifyPathSide(e, automountRoot))).length,
    appendWindowsPath: parseBool(settingValue(dash, 'interop', 'appendWindowsPath')),
    interop: dash?.wslSettings?.interop ?? null,
    windowsBinaries: binaries.items,
    windowsBinaryCount: dash === null || dash.tools.length === 0 ? null : shadowed.length,
    wslenv: plainEnvValue(dash, 'WSLENV'),
    environmentVariableCount: envKnown ? env.length : null,
    secretVariableCount: envKnown
      ? env.filter((e) => e.isSecret || isSecretName(e.name)).length
      : null,
    windowsOriginatedVariableCount: envKnown ? env.filter((e) => e.fromWindows).length : null
  }
}

function buildNetwork(dash: DashboardSnapshot | null, b: Bounder): DevEnvNetwork {
  const dns = dash?.dns ?? null
  const nameservers = b.cap('network.dns.nameservers', dns?.nameservers ?? [], LIMITS.nameservers)
  const adapter = b.cap('network.dns.windowsAdapterDns', dns?.windowsAdapterDns ?? [], LIMITS.nameservers)
  const proxy = dash?.portProxy ?? null
  const count = (verdict: string): number =>
    proxy === null ? 0 : proxy.rules.filter((r) => r.verdict === verdict).length
  return {
    networkingModeDeclared: dash?.wslSettings?.networkingModeDeclared ?? null,
    networkingModeEffective: dash?.wslSettings?.networkingModeEffective ?? null,
    ip: dash?.system.ip ?? null,
    localhostForwarding: parseBool(settingValue(dash, 'wsl2', 'localhostForwarding')),
    dns:
      dns === null
        ? null
        : {
            resolvConfPath: dns.resolvConfPath,
            nameservers: nameservers.items,
            nameserverCount: dns.nameservers.length,
            generateResolvConf: dns.generateResolvConf,
            isGeneratedSymlink: dns.isGeneratedSymlink,
            dnsTunneling: dns.dnsTunneling,
            windowsAdapterDns: adapter.items,
            handManaged: dns.generateResolvConf === null ? null : dns.generateResolvConf === false,
            error: dns.error
          },
    firewall:
      dash?.firewall == null
        ? null
        : {
            enabled: dash.firewall.enabled,
            defaultInbound: dash.firewall.defaultInbound,
            loopbackEnabled: dash.firewall.loopbackEnabled
          },
    portProxy:
      proxy === null
        ? null
        : {
            ruleCount: proxy.rules.length,
            live: count('live'),
            stale: count('stale'),
            elsewhere: count('elsewhere'),
            unknown: count('unknown')
          }
  }
}

function dockerStatus(dash: DashboardSnapshot | null): DevEnvDockerStatus {
  const d = dash?.docker ?? null
  if (d === null) return 'unknown'
  if (!d.cliInstalled) return 'not-installed'
  if (d.error !== null) return 'error'
  if (d.daemonRunning) return 'running'
  if (d.notProbed !== null) return 'not-probed'
  return 'installed-not-running'
}

function sumOrNull(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((a, v) => a + v, 0)
}

function buildDocker(dash: DashboardSnapshot | null, b: Bounder): DevEnvDocker {
  const d = dash?.docker ?? null
  const compose = dash?.tools.find((t) => t.id === 'docker-compose') ?? null
  if (d === null) {
    return {
      status: 'unknown',
      cliInstalled: null,
      cliPath: null,
      dockerDesktop: null,
      daemonRunning: null,
      endpoint: null,
      localEndpoint: null,
      context: null,
      serverVersion: null,
      clientVersion: null,
      storageDistro: null,
      composeInstalled: compose === null ? null : compose.installed,
      imageCount: null,
      containerCount: null,
      runningContainerCount: null,
      runningContainers: [],
      runningContainersOmitted: 0,
      reclaimableBytes: null,
      buildCacheBytes: null,
      error: null
    }
  }
  const probed = d.daemonRunning
  const running = d.containers.filter((c) => c.state === 'running')
  const cut = b.cap(
    'docker.runningContainers',
    running.map((c) => ({ name: c.name, image: c.image, ports: c.ports })),
    LIMITS.containers
  )
  // docker's own TYPE word, never localized: `docker system df` prints English.
  const buildCache = d.diskUsage.find((u) => /build\s*cache/i.test(u.type)) ?? null
  return {
    status: dockerStatus(dash),
    cliInstalled: d.cliInstalled,
    cliPath: d.cliPath,
    dockerDesktop: d.dockerDesktop,
    daemonRunning: d.daemonRunning,
    endpoint: d.endpoint,
    localEndpoint: d.localEndpoint,
    context: d.context,
    serverVersion: d.serverVersion,
    clientVersion: d.clientVersion,
    storageDistro: d.storageDistro,
    composeInstalled: compose === null ? null : compose.installed,
    imageCount: probed ? d.images.length : null,
    containerCount: probed ? d.containers.length : null,
    runningContainerCount: probed ? running.length : null,
    runningContainers: cut.items,
    runningContainersOmitted: cut.omitted,
    reclaimableBytes: probed ? sumOrNull(d.diskUsage.map((u) => u.reclaimableBytes)) : null,
    buildCacheBytes: buildCache?.sizeBytes ?? null,
    error: d.error
  }
}

function serviceRef(svc: ServiceInfo): DevEnvServiceRef {
  return { name: svc.name, scope: svc.scope, activeState: svc.activeState, subState: svc.subState }
}

function buildServices(dash: DashboardSnapshot | null, b: Bounder): DevEnvServices {
  const systemd = dash?.system.systemdEnabled ?? null
  const list = dash?.services ?? []
  // An empty unit list is a fact only when systemd is known to be on; off, or
  // never asked, it says nothing about the units.
  const collected = list.length > 0 || systemd === true
  const failed = list.filter((s) => s.activeState === 'failed')
  const owned = new Set((dash?.tools ?? []).flatMap((t) => (t.installed ? t.services : [])))
  const seen = new Set<string>()
  const notable: DevEnvServiceRef[] = []
  const add = (svc: ServiceInfo): void => {
    const key = `${svc.scope}:${svc.name}`
    if (seen.has(key)) return
    seen.add(key)
    notable.push(serviceRef(svc))
  }
  for (const svc of failed) add(svc)
  for (const svc of list) if (owned.has(svc.name)) add(svc)
  for (const svc of list) if (svc.scope === 'user' && svc.activeState === 'active') add(svc)
  const failedCut = b.cap('services.failedUnits', failed.map((s) => s.name), LIMITS.failedUnits)
  const notableCut = b.cap('services.notable', notable, LIMITS.notableServices)
  return {
    systemd,
    total: collected ? list.length : null,
    active: collected ? list.filter((s) => s.activeState === 'active').length : null,
    failed: collected ? failed.length : null,
    failedUnits: failedCut.items,
    failedUnitsOmitted: failedCut.omitted,
    notable: notableCut.items,
    notableOmitted: notableCut.omitted
  }
}

function buildPorts(dash: DashboardSnapshot | null, b: Bounder): DevEnvPorts {
  const listening = (dash?.ports ?? []).filter((p) => p.listening)
  const cut = b.cap(
    'ports.items',
    listening.map((p) => ({
      port: p.port,
      protocol: p.protocol,
      process: p.processName,
      pid: p.pid,
      reachability: p.reachability,
      windowsBound: p.windowsBound,
      url: p.localhostUrl
    })),
    LIMITS.ports
  )
  // The Windows table is known when any WSL port carries a verdict about it or
  // the host listeners were merged in; otherwise its count is unknown, not 0.
  const windowsPorts = dash?.windowsPorts ?? []
  const windowsKnown = windowsPorts.length > 0 || listening.some((p) => p.windowsBound !== null)
  const own = windowsPorts.filter((p) => !p.fromWsl && p.listening)
  const ownCut = b.cap(
    'ports.windowsOnly',
    own.map((p) => ({ port: p.port, protocol: p.protocol, process: p.processName })),
    LIMITS.windowsPorts
  )
  return {
    listeningCount: listening.length,
    items: cut.items,
    omitted: cut.omitted,
    windowsOnlyCount: windowsKnown ? own.length : null,
    windowsOnly: ownCut.items,
    windowsOnlyOmitted: ownCut.omitted
  }
}

function buildStorage(dash: DashboardSnapshot | null, automountRoot: string, b: Bounder): DevEnvStorage {
  const disks = dash?.resources.disks ?? []
  const fsCut = b.cap(
    'storage.filesystems',
    disks.map((d) => ({
      mountPoint: d.mountPoint,
      side: classifyPathSide(d.mountPoint, automountRoot),
      exists: d.exists,
      totalBytes: d.totalBytes,
      availableBytes: d.availableBytes,
      usePercent: d.usePercent
    })),
    LIMITS.filesystems
  )
  const root = disks.find((d) => d.mountPoint === '/' && d.exists) ?? null
  const image = dash?.disk ?? null
  const mounts = dash?.driveMounts ?? null
  const drivesCut = b.cap(
    'storage.windowsDrives',
    (mounts?.drives ?? []).map((d) => ({
      point: d.point,
      source: d.source,
      metadata: d.metadata,
      caseSensitivity: d.caseSensitivity
    })),
    LIMITS.drives
  )
  const res = dash?.resources ?? null
  const mem = dash?.memoryDetail ?? null
  const consumers = dash?.diskConsumers ?? null
  const measured = (consumers?.consumers ?? [])
    .filter((c): c is typeof c & { bytes: number } => c.exists && c.bytes !== null && c.bytes > 0)
    .sort((a, c) => c.bytes - a.bytes)
  const cachesCut = b.cap(
    'storage.topCaches',
    measured.map((c) => ({ id: c.id, path: c.path, bytes: c.bytes })),
    LIMITS.caches
  )
  const defender = dash?.defender ?? null
  const inotify = dash?.inotify ?? null
  return {
    filesystems: fsCut.items,
    filesystemsOmitted: fsCut.omitted,
    rootAvailableBytes: root?.availableBytes ?? null,
    rootUsePercent: root?.usePercent ?? null,
    image:
      image === null
        ? null
        : {
            vhdxPath: image.vhdxPath,
            vhdxBytes: image.vhdxBytes,
            fsUsedBytes: image.fsUsedBytes,
            reclaimableBytes: image.reclaimableBytes,
            sparse: image.sparse
          },
    windowsDrives: mounts === null ? null : drivesCut.items,
    windowsDrivesOmitted: drivesCut.omitted,
    drivesWithoutMetadata: (mounts?.drives ?? []).filter((d) => !d.metadata).map((d) => d.point),
    memory: {
      totalBytes: res?.memTotalBytes ?? null,
      usedBytes: res?.memUsedBytes ?? null,
      availableBytes: res?.memAvailableBytes ?? null,
      swapTotalBytes: res?.swapTotalBytes ?? null,
      swapUsedBytes: res?.swapUsedBytes ?? null,
      vmLimitBytes: mem?.vmLimitBytes ?? null,
      vmLimitSource: mem?.vmLimitSource ?? null
    },
    cpuCount: res?.cpuCount ?? null,
    knownCachesBytes: consumers === null ? null : consumers.measuredBytes,
    knownCachesPartial: consumers === null ? null : consumers.partial,
    topCaches: cachesCut.items,
    zoneIdentifierCount: dash?.zoneIdentifier?.count ?? null,
    defender:
      defender === null
        ? null
        : {
            realtimeEnabled: defender.realtimeEnabled,
            imageCoverage: defenderCoverage(defender, image)
          },
    inotify:
      inotify === null
        ? null
        : {
            maxUserWatches: inotify.maxUserWatches,
            maxUserInstances: inotify.maxUserInstances,
            low: watchesAreLow(inotify)
          }
  }
}

function buildConfigs(dash: DashboardSnapshot | null, b: Bounder): DevEnvConfigs {
  const wsl = dash?.wslSettings ?? null
  const declared = (wsl?.settings ?? []).filter((s) => s.declaredValue !== null)
  const settingsCut = b.cap(
    'configs.settings',
    declared.map((s) => {
      // The same rule the environment collector applies: a key that looks
      // like a credential never carries its value out of the snapshot.
      const secret = isSecretName(s.key)
      return {
        key: s.key,
        section: s.section,
        scope: s.scope,
        declaredValue: secret && s.declaredValue !== null ? MASKED_VALUE : s.declaredValue,
        effectiveValue: secret && s.effectiveValue !== null ? MASKED_VALUE : s.effectiveValue,
        verdict: s.verdict
      }
    }),
    LIMITS.settings
  )
  const files = (dash?.configuration ?? [])
    .filter((f) => f.exists === true)
    .map((f) => ({ label: f.label, path: f.linuxPath ?? f.windowsPath ?? f.label, writable: f.writable }))
  const filesCut = b.cap('configs.files', files, LIMITS.configFiles)
  const toolConfigs = (dash?.tools ?? [])
    .filter((t) => t.installed)
    .flatMap((t) => t.configPaths.map((path) => ({ tool: t.id, path })))
  const toolConfigsCut = b.cap('configs.toolConfigs', toolConfigs, LIMITS.toolConfigs)
  const profiles = dash?.terminalProfiles ?? null
  const mine =
    profiles === null || dash === null
      ? null
      : (profiles.profiles.find((p) => p.distro === dash.distro.name) ?? null)
  return {
    wslconfig: { path: wsl?.wslconfigPath ?? null, exists: wsl === null ? null : wsl.wslconfigExists },
    wslConf: { path: wsl?.wslConfPath ?? null, exists: wsl === null ? null : wsl.wslConfExists },
    restartPending: wsl === null ? null : wsl.restartPending,
    vmStartedAt: wsl?.vmStartedAt ?? null,
    settings: settingsCut.items,
    settingsOmitted: settingsCut.omitted,
    files: filesCut.items,
    filesOmitted: filesCut.omitted,
    toolConfigs: toolConfigsCut.items,
    toolConfigsOmitted: toolConfigsCut.omitted,
    terminalProfile:
      profiles === null
        ? null
        : {
            installed: profiles.installed,
            profileName: mine?.name ?? null,
            hasProfile:
              profiles.installed === false || profiles.error !== null ? null : mine !== null
          }
  }
}

// ---------------------------------------------------------------------------
// Environment Doctor
// ---------------------------------------------------------------------------

function fmtGiB(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`
}

function check(
  id: string,
  status: DevEnvVerdict,
  summary: string,
  detail: string | null = null,
  suggestedCommand: string | null = null
): DevEnvCheck {
  return { id, status, summary, detail, suggestedCommand }
}

/**
 * Facts judged, not diagnosed: each check names one thing the running system
 * does that an agent would otherwise discover by failing. A check that could
 * not run says 'unknown' — Defender's exclusion list read without elevation is
 * the canonical case, and reading that as "not excluded" would be wrong.
 */
function buildChecks(s: WslPadSnapshot, dash: DashboardSnapshot | null): DevEnvCheck[] {
  const out: DevEnvCheck[] = []
  const selected = s.selectedDistro
  const summary = selected === null ? null : (s.distros.find((d) => d.name === selected) ?? null)

  // Distro state and liveness
  if (selected === null) {
    out.push(check('distro-state', 'unknown', 'No distribution is selected in WSLPad.'))
  } else if (summary?.state === 'Stopped') {
    out.push(
      check(
        'distro-state',
        'problem',
        `${selected} is stopped; every in-distro reading is the last one taken while it ran.`
      )
    )
  } else if (s.liveness?.answering === false) {
    out.push(
      check(
        'distro-state',
        'problem',
        `${selected} is listed as running but is not answering probes` +
          (s.liveness.lastAliveAt === null ? '.' : `; last reply ${s.liveness.lastAliveAt}.`),
        'wsl --list keeps saying Running long after a distribution stops responding.',
        'wsl.exe --shutdown'
      )
    )
  } else if (summary?.state === 'Running') {
    out.push(
      check(
        'distro-state',
        s.liveness?.answering === true ? 'ok' : 'unknown',
        s.liveness?.answering === true
          ? `${selected} is running and answering.`
          : `${selected} is listed as running; no probe has confirmed it answers yet.`
      )
    )
  } else {
    out.push(check('distro-state', 'unknown', `${selected}: state ${summary?.state ?? 'unknown'}.`))
  }

  if (dash === null) return out

  // Clock
  const skew = dash.clock?.skewSeconds ?? null
  if (skew === null) {
    out.push(check('clock-skew', 'unknown', 'The distro clock has not been compared with Windows.'))
  } else if (Math.abs(skew) >= CLOCK_SKEW_WARN_SECONDS) {
    out.push(
      check(
        'clock-skew',
        'problem',
        `The distro clock is ${Math.abs(skew)}s ${skew < 0 ? 'behind' : 'ahead of'} Windows.`,
        'TLS handshakes, package signatures and build caches fail without naming the clock.',
        'sudo hwclock -s'
      )
    )
  } else {
    out.push(check('clock-skew', 'ok', `The distro clock is within ${Math.abs(skew)}s of Windows.`))
  }

  // DNS
  const dns = dash.dns
  if (dns === null) {
    out.push(check('dns', 'unknown', 'Name resolution has not been read.'))
  } else if (dns.error !== null) {
    out.push(check('dns', 'unknown', `Name resolution could not be read: ${dns.error}`))
  } else if (dns.nameservers.length === 0) {
    out.push(check('dns', 'problem', `${dns.resolvConfPath} lists no nameserver.`))
  } else if (dns.generateResolvConf === false) {
    out.push(
      check(
        'dns',
        'attention',
        `${dns.resolvConfPath} is hand-managed (generateResolvConf=false); WSL never updates it.`,
        `Nameservers in force: ${dns.nameservers.join(', ')}` +
          (dns.windowsAdapterDns.length === 0
            ? '.'
            : `; the Windows adapter hands out ${dns.windowsAdapterDns.join(', ')}.`)
      )
    )
  } else {
    out.push(check('dns', 'ok', `DNS via ${dns.nameservers.join(', ')} (WSL-managed).`))
  }

  // WSL settings
  const wsl = dash.wslSettings
  if (wsl === null) {
    out.push(check('wsl-settings', 'unknown', '.wslconfig and /etc/wsl.conf have not been read.'))
  } else {
    if (wsl.restartPending) {
      out.push(
        check(
          'wsl-settings-pending',
          'attention',
          'A declared WSL setting is not in effect yet.',
          'Both files are read when the VM starts; the edit waits for a restart.',
          'wsl.exe --shutdown'
        )
      )
    } else {
      out.push(check('wsl-settings-pending', 'ok', 'Every declared WSL setting is in effect.'))
    }
    const declared = wsl.networkingModeDeclared
    const effective = wsl.networkingModeEffective
    if (declared !== null && effective !== null && declared !== effective) {
      out.push(
        check(
          'networking-mode',
          'attention',
          `Networking mode ${declared} was declared but ${effective} is in effect.`
        )
      )
    } else if (effective !== null) {
      out.push(check('networking-mode', 'ok', `Networking mode ${effective}.`))
    } else {
      out.push(check('networking-mode', 'unknown', 'The networking mode in effect is not known.'))
    }
    const mistakes = wsl.settings.filter((x) =>
      ['unknown-key', 'wrong-section', 'unsupported'].includes(x.verdict)
    )
    if (mistakes.length > 0) {
      out.push(
        check(
          'wsl-settings-ignored',
          'attention',
          `${mistakes.length} declared WSL setting(s) are ignored: ` +
            mistakes.map((x) => `[${x.section}] ${x.key} (${x.verdict})`).join(', ') +
            '.',
          mistakes.map((x) => x.note).find((n) => n !== null) ?? null
        )
      )
    } else {
      out.push(check('wsl-settings-ignored', 'ok', 'No declared WSL setting is ignored.'))
    }
    const interop = wsl.interop
    if (interop === null || interop.binfmt === null) {
      out.push(
        check('interop', 'unknown', 'Whether Windows executables can be launched has not been read.')
      )
    } else if (interop.declared !== null && interop.declared !== (interop.binfmt === 'enabled')) {
      out.push(
        check(
          'interop',
          'attention',
          `/etc/wsl.conf declares interop enabled=${interop.declared}, but the running kernel has ` +
            `the binfmt registration ${interop.binfmt}.`,
          'The file is read at start; the running state is what commands see.',
          'wsl.exe --shutdown'
        )
      )
    } else if (interop.binfmt === 'disabled') {
      out.push(
        check(
          'interop',
          'attention',
          'Windows interop is disabled: .exe files cannot be launched from this distro.'
        )
      )
    } else {
      out.push(check('interop', 'ok', 'Windows executables can be launched from this distro.'))
    }
    const who = wsl.defaultUser
    if (who === null || (who.effectiveUid === null && who.effectiveName === null)) {
      out.push(check('login-user', 'unknown', 'Which user the distro starts as has not been read.'))
    } else if (who.effectiveUid === 0) {
      out.push(
        check(
          'login-user',
          'attention',
          'This distribution starts as root: files created without sudo are root-owned, and sudo is a no-op.',
          who.declaredName === null
            ? null
            : `/etc/wsl.conf asks for ${who.declaredName}; the Windows registry DefaultUid wins.`
        )
      )
    } else if (
      who.declaredName !== null &&
      who.effectiveName !== null &&
      who.declaredName !== who.effectiveName
    ) {
      out.push(
        check(
          'login-user',
          'attention',
          `/etc/wsl.conf asks for user ${who.declaredName}, but the distro starts as ${who.effectiveName}.`,
          'The Windows registry DefaultUid outranks [user] default=.'
        )
      )
    } else {
      out.push(
        check(
          'login-user',
          'ok',
          `Starts as ${who.effectiveName ?? `uid ${who.effectiveUid}`}` +
            (who.effectiveUid === null ? '.' : ` (uid ${who.effectiveUid}).`)
        )
      )
    }
  }

  // Drive mounts
  const mounts = dash.driveMounts
  if (mounts === null) {
    out.push(check('drive-metadata', 'unknown', 'How the Windows drives are mounted has not been read.'))
  } else {
    const bare = mounts.drives.filter((d) => !d.metadata).map((d) => d.point)
    if (bare.length > 0) {
      out.push(
        check(
          'drive-metadata',
          'attention',
          `${bare.join(', ')} mounted without metadata: chmod and chown there report success and store nothing.`,
          'Keep work that needs a permission bit on the distro disk.'
        )
      )
    } else if (mounts.drives.length > 0) {
      out.push(check('drive-metadata', 'ok', 'Every Windows drive is mounted with metadata.'))
    } else {
      out.push(check('drive-metadata', 'ok', 'No Windows drive is mounted.'))
    }
  }

  // Defender
  const defender = dash.defender
  if (defender === null) {
    out.push(check('defender', 'unknown', 'Microsoft Defender has not been read.'))
  } else if (defender.realtimeEnabled === false) {
    out.push(check('defender', 'ok', 'Defender real-time protection is off.'))
  } else {
    const coverage = defenderCoverage(defender, dash.disk)
    const folder = suggestedExclusion(dash.disk)
    if (coverage === 'covered') {
      out.push(check('defender', 'ok', "Defender excludes this distro's disk image."))
    } else if (coverage === 'not-covered') {
      out.push(
        check(
          'defender',
          'attention',
          "Defender real-time protection scans this distro's disk image; expect slow file I/O.",
          null,
          folder === null ? null : addExclusionCommand(folder)
        )
      )
    } else {
      out.push(
        check(
          'defender',
          'unknown',
          "Whether Defender excludes this distro's disk image cannot be read without elevation.",
          'Unknown is not "not excluded".'
        )
      )
    }
  }

  // inotify
  const inotify = dash.inotify
  if (inotify === null) {
    out.push(check('inotify', 'unknown', 'The file-watch ceiling has not been read.'))
  } else if (watchesAreLow(inotify)) {
    out.push(
      check(
        'inotify',
        'attention',
        `fs.inotify.max_user_watches is ${inotify.maxUserWatches}; a watcher that runs out reports ENOSPC ("no space left on device") while the disk is not full.`,
        null,
        inotify.raiseCommand
      )
    )
  } else {
    out.push(
      check(
        'inotify',
        'ok',
        `fs.inotify.max_user_watches is ${inotify.maxUserWatches ?? 'unknown'}.`
      )
    )
  }

  // Disk headroom
  const root = dash.resources.disks.find((d) => d.mountPoint === '/' && d.exists) ?? null
  if (root === null || root.usePercent === null) {
    out.push(check('disk-headroom', 'unknown', 'Free space on / has not been read.'))
  } else {
    const free = root.availableBytes === null ? '' : ` (${fmtGiB(root.availableBytes)} free)`
    const status: DevEnvVerdict =
      root.usePercent >= DISK_PROBLEM_PERCENT
        ? 'problem'
        : root.usePercent >= DISK_ATTENTION_PERCENT
          ? 'attention'
          : 'ok'
    out.push(check('disk-headroom', status, `/ is ${root.usePercent}% used${free}.`))
  }
  const image = dash.disk
  if (image !== null && image.reclaimableBytes !== null) {
    if (image.reclaimableBytes >= IMAGE_RECLAIMABLE_NOTICE_BYTES) {
      out.push(
        check(
          'disk-image',
          'attention',
          `The disk image keeps ${fmtGiB(image.reclaimableBytes)} on the Windows disk that Linux no longer uses.`,
          image.vhdxPath
        )
      )
    } else {
      out.push(check('disk-image', 'ok', 'The disk image holds little reclaimable space.'))
    }
  } else if (image !== null && image.error !== null) {
    out.push(check('disk-image', 'unknown', image.error))
  } else {
    out.push(check('disk-image', 'unknown', 'The disk image size has not been read.'))
  }

  // Docker
  const docker = dash.docker
  const dstatus = dockerStatus(dash)
  if (dstatus === 'unknown' || docker === null) {
    out.push(check('docker', 'unknown', 'Docker has not been queried.'))
  } else if (dstatus === 'not-installed') {
    out.push(check('docker', 'ok', 'Docker is not installed in this distro.'))
  } else if (dstatus === 'error') {
    out.push(check('docker', 'problem', `Docker could not be queried: ${docker.error}`))
  } else if (dstatus === 'running') {
    out.push(
      check(
        'docker',
        'ok',
        `Docker ${docker.serverVersion ?? ''} is running` +
          (docker.dockerDesktop ? ' (Docker Desktop)' : '') +
          (docker.storageDistro !== null && docker.storageDistro !== dash.distro.name
            ? `; its data lives in the ${docker.storageDistro} distribution.`
            : '.')
      )
    )
  } else if (dstatus === 'not-probed') {
    out.push(
      check(
        'docker',
        'attention',
        docker.notProbed === 'remote-endpoint'
          ? `Docker points at a remote endpoint (${docker.endpoint ?? 'unknown'}); WSLPad did not contact it.`
          : 'Docker is installed but its daemon is not running.',
        docker.notProbed === 'daemon-not-running'
          ? 'WSLPad does not open the socket itself: on a socket-activated distro that would start the daemon.'
          : null,
        docker.notProbed === 'daemon-not-running' ? 'sudo systemctl start docker' : null
      )
    )
  } else {
    out.push(check('docker', 'attention', 'Docker is installed but its daemon did not answer.'))
  }

  // systemd and services
  if (dash.system.systemdEnabled === false) {
    out.push(
      check(
        'services',
        'attention',
        'systemd is disabled: unit-based services (docker, ssh, …) do not start on their own.'
      )
    )
  } else if (dash.system.systemdEnabled === null) {
    out.push(check('services', 'unknown', 'Whether systemd is enabled has not been read.'))
  } else {
    const failed = dash.services.filter((x) => x.activeState === 'failed')
    if (failed.length > 0) {
      out.push(
        check(
          'services',
          'problem',
          `${failed.length} systemd unit(s) failed: ${failed.map((x) => x.name).join(', ')}.`
        )
      )
    } else {
      out.push(check('services', 'ok', 'No systemd unit is in the failed state.'))
    }
  }

  // Port forwarding
  const proxy = dash.portProxy
  if (proxy === null) {
    out.push(check('port-forwarding', 'unknown', 'Windows port forwarding rules have not been read.'))
  } else if (proxy.error !== null) {
    out.push(check('port-forwarding', 'unknown', `Port forwarding rules could not be read: ${proxy.error}`))
  } else {
    const stale = proxy.rules.filter((r) => r.verdict === 'stale')
    if (stale.length > 0) {
      out.push(
        check(
          'port-forwarding',
          'attention',
          `${stale.length} Windows port forwarding rule(s) point at an address this distro no longer has: ` +
            stale.map((r) => `${r.listenPort}→${r.connectAddress}:${r.connectPort}`).join(', ') +
            '.'
        )
      )
    } else {
      out.push(
        check(
          'port-forwarding',
          'ok',
          proxy.rules.length === 0
            ? 'No Windows port forwarding rule is defined.'
            : 'Every Windows port forwarding rule points somewhere that exists.'
        )
      )
    }
  }

  // Windows binaries on PATH
  if (dash.tools.length === 0) {
    out.push(check('windows-binaries', 'unknown', 'Tool detection has not run.'))
  } else {
    const shadowed = dash.tools.filter((t) => t.installed && t.shadowedByWindows)
    if (shadowed.length > 0) {
      out.push(
        check(
          'windows-binaries',
          'attention',
          `${shadowed.length} command(s) on PATH resolve to Windows binaries: ` +
            shadowed.map((t) => t.id).join(', ') +
            '.',
          'A version installed inside the distro is shadowed by the Windows one.'
        )
      )
    } else {
      out.push(check('windows-binaries', 'ok', 'No detected command resolves to a Windows binary.'))
    }
  }

  // Working directory
  const cwd = s.terminal.cwd
  if (cwd === null) {
    out.push(check('cwd-boundary', 'unknown', 'No Console working directory is known.'))
  } else if (isCrossBoundary(classifyPathSide(cwd, automountRootFromSettings(wsl?.settings)))) {
    out.push(
      check(
        'cwd-boundary',
        'attention',
        `The Console is working in ${cwd}, on the Windows filesystem; builds and git there are far slower.`
      )
    )
  } else {
    out.push(check('cwd-boundary', 'ok', `The Console is working in ${cwd}, on the distro disk.`))
  }

  // Download markers
  const zone = dash.zoneIdentifier
  if (zone === null || zone.count === null) {
    out.push(check('zone-identifiers', 'unknown', 'Windows download markers have not been counted.'))
  } else if (zone.count > 0) {
    out.push(
      check(
        'zone-identifiers',
        'attention',
        `${zone.count}${zone.truncated ? '+' : ''} *:Zone.Identifier files under ${zone.root}.`,
        null,
        zone.cleanupCommand
      )
    )
  } else {
    out.push(check('zone-identifiers', 'ok', `No Windows download markers under ${zone.root}.`))
  }

  // Background queries and the MCP server itself
  const stale = s.warnings.filter((w) => w.id.startsWith('runner-failed-'))
  if (stale.length > 0) {
    out.push(
      check(
        'collectors',
        'attention',
        `${stale.length} background quer${stale.length === 1 ? 'y' : 'ies'} failed on the last run; those sections hold their last good value.`,
        stale.map((w) => w.message).join('; ')
      )
    )
  } else {
    out.push(check('collectors', 'ok', 'Every background query succeeded on its last run.'))
  }
  if (s.mcp.error !== null && s.mcp.error.length > 0) {
    out.push(check('mcp-server', 'problem', `The MCP server failed to start: ${s.mcp.error}`))
  } else {
    out.push(
      check(
        'mcp-server',
        s.mcp.running ? 'ok' : 'unknown',
        s.mcp.running
          ? `The read-only MCP server is serving at ${s.mcp.endpoint ?? 'a local endpoint'}.`
          : 'The MCP server is not running.'
      )
    )
  }
  return out
}

const VERDICT_RANK: Record<DevEnvVerdict, number> = { problem: 3, attention: 2, unknown: 1, ok: 0 }

function buildDoctor(s: WslPadSnapshot, dash: DashboardSnapshot | null, b: Bounder): DevEnvDoctor {
  const all = buildChecks(s, dash)
  const counts: Record<DevEnvVerdict, number> = { ok: 0, attention: 0, problem: 0, unknown: 0 }
  for (const c of all) counts[c.status]++
  // Worst first, so a cut list never drops the problem to keep an ok.
  const ordered = [...all].sort((a, c) => VERDICT_RANK[c.status] - VERDICT_RANK[a.status])
  const cut = b.cap('doctor.checks', ordered, LIMITS.checks)
  const warnings = b.cap(
    'doctor.warnings',
    s.warnings.map((w) => ({ id: w.id, severity: w.severity, message: w.message })),
    LIMITS.warnings
  )
  const overall: DevEnvVerdict =
    counts.problem > 0
      ? 'problem'
      : counts.attention > 0
        ? 'attention'
        : counts.ok > 0
          ? 'ok'
          : 'unknown'
  return {
    overall,
    counts,
    checks: cut.items,
    warnings: warnings.items,
    warningsOmitted: warnings.omitted
  }
}

function notCollectedSections(dash: DashboardSnapshot | null): DevEnvSectionId[] {
  if (dash === null) {
    return [
      'system',
      'resources',
      'disk',
      'wslSettings',
      'memoryDetail',
      'paths',
      'configuration',
      'tools',
      'hermes',
      'docker',
      'zoneIdentifier',
      'diskConsumers',
      'driveMounts',
      'defender',
      'inotify',
      'terminalProfiles',
      'environment',
      'processes',
      'firewall',
      'portProxy',
      'clock',
      'dns'
    ]
  }
  const out: DevEnvSectionId[] = []
  // Sections whose collector always produces something: empty means unread.
  if (dash.system.user === null && dash.system.kernel === null) out.push('system')
  if (dash.resources.cpuCount === null && dash.resources.memTotalBytes === null) out.push('resources')
  if (dash.paths.length === 0) out.push('paths')
  if (dash.configuration.length === 0) out.push('configuration')
  if (dash.tools.length === 0) out.push('tools')
  if (dash.environment.length === 0) out.push('environment')
  if (dash.processes.length === 0) out.push('processes')
  const nullable: Array<[DevEnvSectionId, unknown]> = [
    ['disk', dash.disk],
    ['wslSettings', dash.wslSettings],
    ['memoryDetail', dash.memoryDetail],
    ['hermes', dash.hermes],
    ['docker', dash.docker],
    ['zoneIdentifier', dash.zoneIdentifier],
    ['diskConsumers', dash.diskConsumers],
    ['driveMounts', dash.driveMounts],
    ['defender', dash.defender],
    ['inotify', dash.inotify],
    ['terminalProfiles', dash.terminalProfiles],
    ['firewall', dash.firewall],
    ['portProxy', dash.portProxy],
    ['clock', dash.clock],
    ['dns', dash.dns]
  ]
  for (const [id, value] of nullable) if (value === null) out.push(id)
  return out
}

function ageSeconds(collectedAt: string, now: string | null | undefined): number | null {
  if (typeof now !== 'string') return null
  const a = Date.parse(collectedAt)
  const b = Date.parse(now)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, Math.round((b - a) / 1000))
}

function buildProvenance(
  s: WslPadSnapshot,
  dash: DashboardSnapshot | null,
  options: DevEnvContextOptions,
  b: Bounder
): DevEnvProvenance {
  const stale = s.warnings
    .filter((w) => w.id.startsWith('runner-failed-'))
    .map((w) => {
      const command = w.params?.command
      return typeof command === 'string' ? command : w.message
    })
  return {
    source: 'wslpad',
    appVersion: options.appVersion ?? null,
    snapshotSchemaVersion: s.schemaVersion,
    collectedAt: s.generatedAt,
    ageSeconds: ageSeconds(s.generatedAt, options.now),
    polled: true,
    distroAnswering: s.liveness?.answering ?? null,
    lastAliveAt: s.liveness?.lastAliveAt ?? null,
    notCollected: notCollectedSections(dash),
    staleQueries: stale,
    truncated: [...b.truncated],
    secretsMasked: true,
    readOnly: true
  }
}

/**
 * Build the context from a snapshot. Pure and synchronous: it runs nothing,
 * reads no file, and returns the same object for the same snapshot.
 */
export function buildDevEnvContext(
  s: WslPadSnapshot,
  options: DevEnvContextOptions = {}
): DevEnvContext {
  const dash = s.dashboard
  const b = new Bounder()
  const automountRoot = automountRootFromSettings(dash?.wslSettings?.settings)
  const distro = buildDistro(s, dash, b)
  const groups = buildToolGroups(dash, b)
  return {
    schemaVersion: DEV_ENV_CONTEXT_SCHEMA_VERSION,
    generatedAt: s.generatedAt,
    distro,
    workspace: buildWorkspace(s, dash, automountRoot, distro.uncPath, b),
    runtimes: groups.runtimes,
    packageManagers: groups.packageManagers,
    tools: groups.tools,
    path: buildPath(dash, automountRoot, b),
    network: buildNetwork(dash, b),
    docker: buildDocker(dash, b),
    services: buildServices(dash, b),
    ports: buildPorts(dash, b),
    storage: buildStorage(dash, automountRoot, b),
    configs: buildConfigs(dash, b),
    doctor: buildDoctor(s, dash, b),
    provenance: buildProvenance(s, dash, options, b)
  }
}
