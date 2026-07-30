import type { DistroDetails, DistroSummary } from '@shared/types'
import { WslNotAvailableError, type DistroRunner, type WslProvider } from './contracts'
import { collectConfigFiles } from './config-files'
import { detectHermes, detectTools } from './detectors'
import { listDistros } from './distros'
import { collectEnvironment } from './environment'
import { assertValidDistroName } from './escape'
import { collectImportantPaths } from './paths'
import { collectPorts } from './ports'
import { collectProcesses } from './processes'
import { collectResources } from './resources'
import { collectServices } from './services'
import { collectSystemInfo } from './system'

/**
 * Real WslProvider wiring all hidden-runner collectors (goal.md §9). The
 * fixture provider implements the same interface for WSLPAD_FIXTURE_MODE.
 */
export function createRealProvider(runner: DistroRunner): WslProvider {
  // Raw env values stay in the main process; only revealEnv reads them back.
  const envRawCache = new Map<string, Map<string, string>>()

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

    getHermes(distro) {
      return detectHermes(runner, distro)
    }
  }
}
