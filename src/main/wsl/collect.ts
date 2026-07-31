import { PROBE_TIMEOUT_MS } from '@shared/constants'
import type { DistroDetails, DistroSummary } from '@shared/types'
import { WslNotAvailableError, type DistroRunner, type WslProvider } from './contracts'
import { collectClock } from './clock'
import { collectConfigFiles } from './config-files'
import { createDnsCollector } from './dns'
import { detectHermes, detectHermesCli, detectTools } from './detectors'
import type { HermesCliDetail } from './detectors/hermes'
import { listDistros } from './distros'
import { collectEnvironment } from './environment'
import { assertValidDistroName } from './escape'
import { createDiskCollector } from './disk'
import { createFirewallCollector } from './firewall'
import { createPortProxyCollector } from './portproxy'
import { createMemoryCollector } from './memory'
import { collectImportantPaths } from './paths'
import { collectPorts } from './ports'
import { collectProcesses } from './processes'
import { collectResources } from './resources'
import { collectServices } from './services'
import { collectSystemInfo } from './system'
import { createWindowsPortCollector } from './windows-ports'
import { createWslConfigCollector } from './wsl-config'

/** How long one `hermes status` answer is reused (its own CLI takes seconds). */
const HERMES_CLI_TTL_MS = 60_000

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

    async getHermes(distro) {
      const base = await detectHermes(runner, distro)
      if (base === null || !base.installed) return base
      const detail = await hermesCliDetail(distro)
      return detail === null ? base : { ...base, ...detail }
    }
  }
}
