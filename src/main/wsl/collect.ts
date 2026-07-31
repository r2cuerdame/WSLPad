import { PROBE_TIMEOUT_MS } from '@shared/constants'
import type {
  DistroDetails,
  DistroSummary,
  DiskConsumersInfo,
  DockerInfo,
  ZoneIdentifierInfo
} from '@shared/types'
import { WslNotAvailableError, type DistroRunner, type WslProvider } from './contracts'
import { collectClock } from './clock'
import { collectConfigFiles } from './config-files'
import { createDnsCollector } from './dns'
import { detectDocker } from './docker'
import { detectHermes, detectHermesCli, detectTools } from './detectors'
import type { HermesCliDetail } from './detectors/hermes'
import { listDistros } from './distros'
import { collectEnvironment } from './environment'
import { assertValidDistroName } from './escape'
import { createDiskCollector } from './disk'
import { collectDiskConsumers } from './disk-consumers'
import { createFirewallCollector } from './firewall'
import { createPortProxyCollector } from './portproxy'
import { createMemoryCollector } from './memory'
import { collectImportantPaths } from './paths'
import { collectPorts } from './ports'
import { collectProcesses } from './processes'
import { collectResources } from './resources'
import { collectServices } from './services'
import { readServiceLog } from './service-log'
import { collectSystemInfo } from './system'
import { createWindowsPortCollector } from './windows-ports'
import { createWslConfigCollector } from './wsl-config'
import { createTerminalProfilesCollector } from './terminal-profiles'
import { detectZoneIdentifiers } from './zone-identifier'

/** How long one `hermes status` answer is reused (its own CLI takes seconds). */
const HERMES_CLI_TTL_MS = 60_000

/**
 * How long one Docker answer is reused. `docker system df` walks the whole
 * image store and is the most expensive query in the app; images and the build
 * cache change when the user builds something, not by the minute. The slow
 * tier keeps ticking while the window is hidden in the tray, so without this
 * the machine would pay for a full store walk every minute, forever.
 */
const DOCKER_TTL_MS = 120_000

/**
 * How long one Zone.Identifier count is reused. It walks the whole home
 * directory, and the answer only changes when the user copies something in
 * from Windows — five minutes of staleness costs nothing, five minutes of
 * `find` costs the machine.
 */
const ZONE_TTL_MS = 300_000

/**
 * How long one cache measurement is reused. It runs several du walks; the
 * caches it measures grow over hours, not seconds.
 */
const CONSUMERS_TTL_MS = 300_000

/**
 * Real WslProvider wiring all hidden-runner collectors (goal.md §9). The
 * fixture provider implements the same interface for WSLPAD_FIXTURE_MODE.
 */
export function createRealProvider(runner: DistroRunner): WslProvider {
  // Raw env values stay in the main process; only revealEnv reads them back.
  const envRawCache = new Map<string, Map<string, string>>()
  // Host-side table; created once so its pid → name cache survives polls.
  const windowsPorts = createWindowsPortCollector()
  const memoryDetail = createMemoryCollector()
  // Created once so the wsl.exe version it reads is looked up a single time.
  const wslSettings = createWslConfigCollector()
  // Created once so the Lxss registry read is cached across polls.
  const diskImage = createDiskCollector()
  // Created once so its TTL survives polls: each read is a PowerShell start.
  const firewall = createFirewallCollector()
  // Same reasoning: each read is a netsh start, and the rules change by hand.
  const portProxy = createPortProxyCollector()
  // Same reason: the Windows half of the resolver answer is a PowerShell start.
  const dns = createDnsCollector()
  // Same reason again: settings.json is a host file edited by hand, not by the second.
  const terminalProfiles = createTerminalProfilesCollector()

  // Asking Hermes about itself starts a Python process, which is far too heavy
  // for the medium tier the rest of the Hermes section polls on. Cache it, and
  // on a failed refresh keep the previous answer: "we could not ask right now"
  // must never be shown as "nothing is configured".
  const hermesCliCache = new Map<string, { at: number; detail: HermesCliDetail }>()
  const hermesCliDetail = async (distro: string): Promise<HermesCliDetail | null> => {
    const cached = hermesCliCache.get(distro)
    if (cached && Date.now() - cached.at < HERMES_CLI_TTL_MS) return cached.detail
    const fresh = await detectHermesCli(runner, distro)
    if (fresh === null) return cached?.detail ?? null
    hermesCliCache.set(distro, { at: Date.now(), detail: fresh })
    return fresh
  }

  // Same shape as the Hermes CLI cache, and the same rule: a failed refresh
  // keeps the previous answer rather than publishing "no Docker".
  const dockerCache = new Map<string, { at: number; info: DockerInfo }>()
  const dockerInfo = async (distro: string): Promise<DockerInfo | null> => {
    const cached = dockerCache.get(distro)
    if (cached && Date.now() - cached.at < DOCKER_TTL_MS) return cached.info
    const fresh = await detectDocker(runner, distro)
    if (fresh === null) return cached?.info ?? null
    dockerCache.set(distro, { at: Date.now(), info: fresh })
    return fresh
  }

  const zoneCache = new Map<string, { at: number; info: ZoneIdentifierInfo }>()
  const zoneInfo = async (distro: string): Promise<ZoneIdentifierInfo | null> => {
    const cached = zoneCache.get(distro)
    if (cached && Date.now() - cached.at < ZONE_TTL_MS) return cached.info
    const fresh = await detectZoneIdentifiers(runner, distro)
    if (fresh === null) return cached?.info ?? null
    zoneCache.set(distro, { at: Date.now(), info: fresh })
    return fresh
  }

  const consumersCache = new Map<string, { at: number; info: DiskConsumersInfo }>()
  const consumersInfo = async (distro: string): Promise<DiskConsumersInfo | null> => {
    const cached = consumersCache.get(distro)
    if (cached && Date.now() - cached.at < CONSUMERS_TTL_MS) return cached.info
    const fresh = await collectDiskConsumers(runner, distro)
    if (fresh === null) return cached?.info ?? null
    consumersCache.set(distro, { at: Date.now(), info: fresh })
    return fresh
  }

  return {
    async isAvailable(): Promise<boolean> {
      try {
        await listDistros(runner)
        return true
      } catch {
        return false
      }
    },

    listDistros(): Promise<DistroSummary[]> {
      return listDistros(runner)
    },

    /**
     * Cheapest possible in-distro command (issue #37). `true` is a shell
     * builtin, so a healthy distro answers in milliseconds and a wedged one
     * costs PROBE_TIMEOUT_MS instead of one full timeout per collector.
     */
    async probeDistro(distro: string): Promise<boolean> {
      assertValidDistroName(distro)
      try {
        const res = await runner.runInDistro(distro, 'true', { timeoutMs: PROBE_TIMEOUT_MS })
        return !res.timedOut && res.code === 0
      } catch {
        return false
      }
    },

    async getDistroDetails(distro: string): Promise<DistroDetails> {
      assertValidDistroName(distro)
      let summary: DistroSummary | undefined
      try {
        summary = (await listDistros(runner)).find((d) => d.name === distro)
      } catch (err) {
        if (err instanceof WslNotAvailableError) throw err
      }
      const { osName } = await collectSystemInfo(runner, distro)
      return {
        name: distro,
        state: summary?.state ?? 'Unknown',
        wslVersion: summary?.wslVersion ?? 2,
        isDefault: summary?.isDefault ?? false,
        osName,
        uncPath: '\\\\wsl.localhost\\' + distro
      }
    },

    async getSystemInfo(distro) {
      return (await collectSystemInfo(runner, distro)).system
    },

    getResources(distro) {
      return collectResources(runner, distro)
    },

    getProcesses(distro) {
      return collectProcesses(runner, distro)
    },

    getServices(distro, systemdEnabled) {
      return collectServices(runner, distro, systemdEnabled)
    },

    getPorts(distro) {
      return collectPorts(runner, distro)
    },

    getWindowsPorts() {
      return windowsPorts.collect()
    },

    getPortProxy(distroIp) {
      return portProxy.collect(distroIp)
    },

    getFirewall() {
      return firewall.collect()
    },

    getClock(distro) {
      return collectClock(runner, distro)
    },

    getDns(distro) {
      return dns.collect(runner, distro)
    },

    getMemoryDetail(distro) {
      return memoryDetail.collect(runner, distro)
    },

    getDiskImage(distro) {
      return diskImage.collect(runner, distro)
    },

    getWslSettings(distro) {
      return wslSettings.collect(runner, distro)
    },

    async getEnvironment(distro) {
      const { list, raw } = await collectEnvironment(runner, distro)
      envRawCache.set(distro, raw)
      return list
    },

    async revealEnv(distro, name) {
      let raw = envRawCache.get(distro)
      if (raw === undefined) {
        const collected = await collectEnvironment(runner, distro)
        envRawCache.set(distro, collected.raw)
        raw = collected.raw
      }
      return raw.get(name) ?? null
    },

    getImportantPaths(distro) {
      return collectImportantPaths(runner, distro)
    },

    getConfigFiles(distro) {
      return collectConfigFiles(runner, distro)
    },

    getTools(distro) {
      return detectTools(runner, distro)
    },

    getDocker(distro) {
      return dockerInfo(distro)
    },

    getZoneIdentifiers(distro) {
      return zoneInfo(distro)
    },

    getDiskConsumers(distro) {
      return consumersInfo(distro)
    },

    getServiceLog(distro, unit, scope, lines) {
      return readServiceLog(runner, distro, unit, scope, lines)
    },

    async getTerminalProfiles() {
      return terminalProfiles.collect()
    },

    async getHermes(distro) {
      const base = await detectHermes(runner, distro)
      if (base === null || !base.installed) return base
      const detail = await hermesCliDetail(distro)
      return detail === null ? base : { ...base, ...detail }
    }
  }
}
